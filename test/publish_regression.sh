#!/usr/bin/env bash
# Regression test: publish.sh must (1) replace an existing listener on port 3000
# with the freshly started server, and (2) FAIL when the new server does not
# actually start.
#
# Background bug: publish.sh launched the new server without freeing port 3000.
# A stale listener (e.g. a pre-PR#8 build) kept answering while the new process
# died with EADDRINUSE; the wait loop curled the OLD server and reported
# "site published" — a false success. This test pins the fix.
#
# Usage: bash test/publish_regression.sh   (from repo root)
# Takes over port 3000 (kills whatever listens there) and ends by leaving the
# freshly published server running and verified.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="http://localhost:3000"
FAILED=0
red()   { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }
pass()  { green "  ✅ PASS: $1"; }
fail()  { red "  ❌ FAIL: $1"; FAILED=1; }

free_port() { sudo sh -c 'lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill' || true; }

start_stale() {
  free_port
  setsid nohup bun test/fixtures/stale_listener.ts > /tmp/stale_listener.log 2>&1 < /dev/null &
  for _ in $(seq 1 50); do
    if [ "$(curl -sf "$BASE/__stale_marker__" 2>/dev/null || echo NO)" = '{"stale":true}' ]; then
      return 0
    fi
    sleep 0.2
  done
  red "fixture stale listener never came up"; exit 1
}

echo "====================================================="
echo " publish.sh regression — port handover & fail-on-crash"
echo "====================================================="

# ── Test 1: a stale listener must be replaced by the fresh server ──
echo "== Test 1: stale listener on :3000 is replaced by the fresh server =="
start_stale
pass "stale listener up (serving marker)"
if bash ./publish.sh; then
  pass "publish.sh exited 0 with a stale listener on the port"
else
  fail "publish.sh exited non-zero with a stale listener on the port"
fi
HEALTH="$(curl -sf "$BASE/api/health" 2>/dev/null || echo DOWN)"
case "$HEALTH" in
  *'"service":"Subhan Care HMS API"'*) pass "port answers with the FRESH server (health JSON)" ;;
  *) fail "port does not answer with the fresh server (got: $HEALTH)" ;;
esac
STALE="$(curl -sf "$BASE/__stale_marker__" 2>/dev/null || echo NONE)"
if [ "$STALE" = '{"stale":true}' ]; then
  fail "stale marker still served after publish — old listener survived"
else
  pass "stale listener is gone (marker no longer served)"
fi
grep -q "HMS API running" .run/server.log \
  && pass "fresh server logged a successful bind in .run/server.log" \
  || fail "no fresh-bind log line — success was not tied to the new process"

# ── Test 2: publish must FAIL when the new server cannot start ──
echo "== Test 2: publish fails when the new server cannot start =="
free_port
# Inject a broken start command (the START_CMD test seam) — publish must exit
# non-zero and must NOT leave a stale responder on the port.
if START_CMD="bun run does-not-exist.ts" bash ./publish.sh > /tmp/publish_fail.log 2>&1; then
  fail "publish.sh exited 0 although the server failed to start"
else
  pass "publish.sh exited non-zero when the server failed to start"
fi
grep -q "did not start" /tmp/publish_fail.log \
  && pass "publish reported the startup failure" \
  || fail "publish did not explain the failure (log: $(tail -c 300 /tmp/publish_fail.log))"
if curl -sf -o /dev/null --max-time 2 "$BASE/api/health"; then
  fail "port still answers after a failed publish"
else
  pass "no stale responder left on :3000 after failed publish"
fi

rm -f /tmp/stale_listener.log /tmp/publish_fail.log

if [ "$FAILED" = 0 ]; then
  green "ALL PUBLISH REGRESSION TESTS PASSED"
  # Leave a real, verified publish running so the port is in a good state.
  bash ./publish.sh
else
  red "PUBLISH REGRESSION TESTS FAILED"
  exit 1
fi
