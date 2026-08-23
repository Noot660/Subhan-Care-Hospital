#!/usr/bin/env bash
#
# watchdog.sh — keep the Subhan Care HMS *real* app serving on port 3000.
#
# The live site is the HMS API (`bun run src/index.ts`, started via `publish.sh`).
# A separate static "coming soon" placeholder (`serve.ts`) also wants port 3000 and
# takes it over whenever the real app's process dies. Because there is no
# systemd/cron/boot-registration in this container (PID 1 is /entrypoint.sh, a
# platform file we must not modify), the only persistence available is a long-lived
# detached process. This watchdog is that process.
#
# It loops forever: every CHECK_INTERVAL seconds it hits /api/health and requires
# the body to actually be the HMS JSON (contains "HMS API"). If the health check is
# missing, or a placeholder is answering instead of the real app, it logs a
# timestamped line and runs `bun run publish` (which frees the port, starts the
# real app, and verifies fresh health + log line before declaring success).
#
# Single-instance: uses flock on .run/watchdog.pid so only one watchdog runs.
#
# Re-arm after a FULL sandbox replacement (which kills all processes):
#     cd /home/team/shared/site && setsid nohup bash watchdog.sh </dev/null >> watchdog.log 2>&1 &
# Check status anytime:
#     bash watchdog.sh status
#
set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SITE_DIR"

LOG="$SITE_DIR/watchdog.log"
PIDFILE="$SITE_DIR/.run/watchdog.pid"
HEALTH_URL="http://localhost:3000/api/health"
EXPECT="HMS API"                  # substring that only the real HMS app returns
CHECK_INTERVAL="${WATCHDOG_INTERVAL:-10}"   # seconds; overridable for testing

mkdir -p "$SITE_DIR/.run"

log() { echo "[$(date -Is)] $*" >> "$LOG"; }

# ---- status subcommand (also safe to call while stopped) ----
if [ "${1:-}" = "status" ]; then
  echo "=== Subhan Care HMS watchdog status ==="
  if [ -f "$PIDFILE" ] && [ -s "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running: yes (pid $(cat "$PIDFILE"))"
  else
    echo "running: no"
  fi
  if [ -f "$LOG" ]; then
    echo "last recovery / log tail:"
    tail -n 6 "$LOG"
  else
    echo "no watchdog.log yet"
  fi
  if body="$(curl -sf -m 5 "$HEALTH_URL" 2>/dev/null)" && case "$body" in *"$EXPECT"*) true;; *) false;; esac; then
    echo "current :3000 responder: REAL HMS app (health OK)"
  else
    echo "current :3000 responder: DOWN or placeholder"
  fi
  exit 0
fi

# ---- are we already running? (flock: atomic single-instance lock) ----
exec 9>"$PIDFILE"
if ! flock -n 9; then
  log "another watchdog is already running (pid $(cat "$PIDFILE" 2>/dev/null || echo '?', fd 9 locked)); exiting."
  exit 0
fi
echo $$ >&9
# Keep fd 9 open for the process lifetime (the flock lease). Do NOT remove the
# pidfile on exit — deleting a locked file creates a lock/remove race where a
# second instance could open+lock a fresh inode and run concurrently.

log "watchdog started (pid $$), interval ${CHECK_INTERVAL}s, dir $SITE_DIR"

# ---- health check: HMS JSON body required (placeholder != healthy) ----
is_healthy() {
  local body
  body="$(curl -sf -m 5 "$HEALTH_URL" 2>/dev/null)" || return 1
  case "$body" in
    *"$EXPECT"*) return 0 ;;
    *) return 1 ;;
  esac
}

recover() {
  log "HEALTH FAILURE - placeholder or down detected; running publish to restore real app"
  # Defensive: a stray Neon src/db.ts (see PR #13 intent) would break startup on
  # import. Move it out of the way; never commit src/db.ts or data/*.db.
  if [ -f "$SITE_DIR/src/db.ts" ]; then
    mv "$SITE_DIR/src/db.ts" /tmp/src-db.ts.bak 2>/dev/null || true
    log "moved stray src/db.ts -> /tmp/src-db.ts.bak"
  fi
  if ( cd "$SITE_DIR" && bash ./publish.sh ) >> "$LOG" 2>&1; then
    log "publish OK - real HMS app verified on port 3000"
  else
    log "publish FAILED ($?) - will retry next interval (see tail above)"
  fi
}

# Recover immediately at startup in case we inherited a broken state.
if ! is_healthy; then
  log "initial health check failed at startup; recovering."
  recover
fi

while true; do
  sleep "$CHECK_INTERVAL"
  if ! is_healthy; then
    recover
  fi
done
