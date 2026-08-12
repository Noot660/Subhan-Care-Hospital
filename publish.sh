#!/usr/bin/env bash
# Rebuild the site and (re)start the production server on port 3000.
#
# Build runs in the foreground so errors surface; the server is launched in a new
# session (setsid) so it keeps running after this script — and your shell — exits.
#
# Port handover: any existing listener on port 3000 is terminated BEFORE the new
# server starts — targeted at the port only, never a broad process kill — so the
# new server can always bind. Success is then verified against the NEW process:
# the wait loop only reports success when the fresh server logged a successful
# bind AND answers /api/health. An old listener answering must never count as
# success — that was the false-success bug (the new process died with EADDRINUSE
# while the loop curled the stale server and reported "published").
set -euo pipefail
cd "$(dirname "$0")"
# Group-writable so any team member can publish over another member's build.
umask 002
mkdir -p .run
# The workspace starts as sources only (the coming-soon placeholder serves from
# the image's pre-built copy), so the first publish installs deps here. No-op
# once node_modules is current.
bun install
bun run build

# START_CMD is a test seam: test/publish_regression.sh injects a broken command
# to prove publish fails when the server cannot start. Default: the real server.
START_CMD="${START_CMD:-bun run start}"

# One publish attempt: free the port, start the server, wait until the NEW
# server proves it is up (fresh log line + health endpoint), else return 1.
publish_attempt() {
  local port_pids server_pid
  port_pids="$(sudo lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$port_pids" ]; then
    echo "  replacing existing listener(s) on port 3000 (pid(s): $(echo "$port_pids" | tr '\n' ' '))"
    # SIGTERM first — the HMS server shuts down gracefully on SIGTERM.
    sudo sh -c 'lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill' || true
    # Wait for the port to actually free up (kill is async; a fresh bind must
    # not race a dying socket).
    for _ in $(seq 1 25); do
      if [ -z "$(sudo lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)" ]; then
        break
      fi
      sleep 0.2
    done
    # Escalate only if a listener ignored SIGTERM (still targeted at the port).
    if [ -n "$(sudo lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)" ]; then
      echo "  port 3000 still occupied after SIGTERM — escalating to SIGKILL" >&2
      sudo sh -c 'lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill -9' || true
      sleep 0.5
    fi
  fi

  # Fresh log: the only writer is the server started below, so a "running" line
  # in it proves the responder on :3000 is THIS process, not a stale one.
  : > .run/server.log
  setsid nohup $START_CMD > .run/server.log 2>&1 < /dev/null &
  server_pid=$!

  # Success = fresh bind logged + health answers. src/index.ts prints
  # "Subhan Care HMS API running" only after Bun.serve() succeeds, so the log
  # line ties the healthy responder to the freshly started process.
  for _ in $(seq 1 50); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
      # The launched process tree died — it crashed during startup.
      return 1
    fi
    if curl -sf -o /dev/null http://localhost:3000/api/health \
      && grep -q "HMS API running" .run/server.log; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

# Retry a few times to absorb races (e.g. a concurrent publish between our kill
# and our bind — last publish wins).
for attempt in 1 2 3; do
  if publish_attempt; then
    echo "site published; fresh server verified on port 3000"
    exit 0
  fi
  echo "  publish attempt $attempt did not verify; retrying..." >&2
  sleep 1
done

echo "publish FAILED: the new server did not start (no fresh bind, or it crashed). Log tail:" >&2
tail -n 20 .run/server.log >&2 || true
exit 1
