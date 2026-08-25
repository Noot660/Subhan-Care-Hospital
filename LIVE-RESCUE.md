# LIVE-RESCUE — resurrecting the live site after a sandbox replacement

The Subhan Care HMS live site serves on **port 3000** inside the sandbox and is
guarded by a two-layer self-healing stack:

| Layer | File | What it does |
|-------|------|--------------|
| real app | `src/index.ts` (via `publish.sh`) | the HMS API that must own :3000 |
| watchdog | `watchdog.sh` | every 10s checks `/api/health` must return the HMS JSON (`"HMS API"`); if the `serve.ts` placeholder stole the port or the site is down, it re-runs `publish.sh`. Single-instance via `flock`. |
| supervisor | `supervisor.sh` | owns the watchdog: if the watchdog process exits/crashes it logs the exit and respawns it after a short delay. Single-instance via `flock`. |

So a crashed app, a placeholder takeover, or even a **dead watchdog** are all
recovered automatically while either long-lived process is alive.

## The honest boundary

This container has **no systemd, cron, or rc.local**, and PID 1 is a
platform-managed `/entrypoint.sh` that must not be modified. A **full sandbox
replacement kills every process** — watchdog and supervisor alike — and nothing
inside the sandbox can bring them back by itself. That one case is the only one
needing a human.

## Re-arm after a full sandbox replacement — ONE command

```bash
cd /home/team/shared/site && bash site-up
```

`site-up` clears any stray `src/db.ts`, launches `supervisor.sh` detached (which
spawns the watchdog and re-publishes the real app), waits up to ~60s for health,
then prints `watchdog.sh status`.

Equivalent raw one-liner (same effect, no helper script):

```bash
cd /home/team/shared/site && setsid nohup bash supervisor.sh </dev/null >> watchdog.log 2>&1 &
```

## Check status anytime

```bash
bash watchdog.sh status
```

Expect: one watchdog running, and "current :3000 responder: REAL HMS app (health OK)".
