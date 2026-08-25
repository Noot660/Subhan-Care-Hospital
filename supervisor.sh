#!/usr/bin/env bash
#
# supervisor.sh — keep the watchdog alive so the Subhan Care HMS *real* app stays
# on port 3000.
#
# Layered resilience inside the sandbox:
#   publish.sh   -> (re)starts the real HMS app on :3000 (frees the port, boots
#                   `bun run src/index.ts`, verifies fresh health + log line).
#   watchdog.sh  -> every WATCHDOG_INTERVAL s checks /api/health requires the HMS
#                   JSON body ("HMS API"); if the placeholder (`serve.ts`) took the
#                   port or the site is down, it re-publishes. Single-instance via
#                   flock on .run/watchdog.pid.
#   supervisor.sh-> THE layer above the watchdog: it owns the watchdog. If the
#                   watchdog process ever exits or crashes, the supervisor logs the
#                   exit, waits a short delay, and respawns it. So a dead watchdog is
#                   itself recovered. Single-instance via flock on .run/supervisor.pid.
#
# HONEST BOUNDARY: this container has no systemd/cron/rc.local, and PID 1 is a
# platform-managed /entrypoint.sh we must NOT modify. A FULL sandbox replacement
# kills every process (watchdog AND supervisor) and cannot be auto-resurrected from
# inside the sandbox. Recovery after a full reset is manual and trivial:
#
#     cd /home/team/shared/site && bash site-up
#
# (`site-up` is the single documented re-arm command; see LIVE-RESCUE.md. Equivalently
# the raw one-liner is: cd /home/team/shared/site && setsid nohup bash supervisor.sh </dev/null >> watchdog.log 2>&1 &)
#
set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SITE_DIR"

LOG="$SITE_DIR/watchdog.log"
SUP_PIDFILE="$SITE_DIR/.run/supervisor.pid"
HEALTH_URL="http://localhost:3000/api/health"
EXPECT="HMS API"                                        # only the real HMS app returns this
RESTART_DELAY="${SUPERVISOR_RESTART_DELAY:-3}"          # s between watchdog respawns

mkdir -p "$SITE_DIR/.run"

log() { echo "[$(date -Is)] [supervisor] $*" >> "$LOG"; }

# ---- health: HMS JSON body required (placeholder != healthy) ----
is_healthy() {
  local body
  body="$(curl -sf -m 5 "$HEALTH_URL" 2>/dev/null)" || return 1
  case "$body" in
    *"$EXPECT"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---- direct recovery (defensive parity with watchdog.sh) ----
recover() {
  log "health not OK; running publish to restore real app"
  # Defensive: a stray Neon src/db.ts (see PR #13 intent) breaks startup on import.
  if [ -f "$SITE_DIR/src/db.ts" ]; then
    mv "$SITE_DIR/src/db.ts" /tmp/src-db.ts.bak 2>/dev/null || true
    log "moved stray src/db.ts -> /tmp/src-db.ts.bak"
  fi
  if ( cd "$SITE_DIR" && bash ./publish.sh ) >> "$LOG" 2>&1; then
    log "publish OK - real HMS app verified on port 3000"
  else
    log "publish FAILED ($?) - will retry (see tail above)"
  fi
}

# ---- single-instance: only one supervisor (flock on .run/supervisor.pid) ----
exec 9>"$SUP_PIDFILE"
if ! flock -n 9; then
  log "another supervisor is already running (pid $(cat "$SUP_PIDFILE" 2>/dev/null || echo '?')); exiting."
  exit 0
fi
echo $$ >&9
# Keep fd 9 open for the process lifetime (the flock lease).

log "supervisor started (pid $$), restart delay ${RESTART_DELAY}s, dir $SITE_DIR"

# ---- initial recovery pass on start (inherit dead/placeholder state) ----
if ! is_healthy; then
  log "initial health check failed at startup; recovering."
  recover
fi

# ---- supervise the watchdog forever ----
while true; do
  # If we reach here without a healthy site (e.g. right after a respawn), let the
  # freshly-spawned watchdog own its own initial recovery; it duplicates this check.
  bash ./watchdog.sh >> "$LOG" 2>&1 &
  wd_pid=$!
  log "watchdog spawned (pid $wd_pid); supervising"
  set +e
  wait "$wd_pid"
  wd_exit=$?
  set -e
  log "watchdog exited (pid $wd_pid, code $wd_exit); respawning in ${RESTART_DELAY}s"
  sleep "$RESTART_DELAY"
done
