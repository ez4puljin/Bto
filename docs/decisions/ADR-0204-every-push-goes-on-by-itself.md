# ADR-0204: Every push to main goes onto the real system by itself

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-16 |
| Deciders | Owner (2026-11-16: «push гармагц PC өөрөө ~/bto-г шинэчилдэг, CI-г болон таны «тийм»-ийг хүлээдэггүй болгоно … Дүрмийг өөрчилж, Хөгжүүлэлтийг хурдлуулья»), Claude (the direct-mode session) |
| Amends | the direct-mode rule of 2026-11-11 («Push бүрийн дараа», CLAUDE.md), ADR-0196 #3 (the CI gate), `docs/runbooks/store-install.md` §7 |

## Context

Since 2026-11-11 a session put every pushed code change on the real system itself: it waited for CI (`gh run watch`, 8–20 minutes on this PC's runs), then ran `git pull --ff-only`, `deploy/store/setup.sh` and `deploy/edge/setup.sh` in `~/bto`, and sometimes asked the owner first (a migration). The owner saw a session that said «done» long after the code was. Two sessions working at once made it worse: each waited, and one could not tell what the other had put on.

## Decision

1. **A timer puts it on** (`deploy/store/auto-deploy.sh`, installed by `install-auto-deploy-timer.sh` as the owner's systemd timer, from `~/bto`): every minute it fetches `origin/main` and, when main has moved, decides from the changed files and CI's word:
   - only docs (`docs/`, `*.md`, `.claude/`, `.github/`) → the checkout moves, nothing is rebuilt;
   - code → `setup.sh` at once, CI still running, then `deploy/edge/setup.sh`; `setup.sh` still refuses a commit CI has already found red;
   - **a new migration waits for CI green** (no human): `rollback.sh` cannot undo a migration, so this one case keeps the gate; a red one is refused;
   - `~/bto` with local changes, or not an ancestor of main → nothing, said once in the log.
2. **CI's late answer is followed.** When CI turns red on the version that was put on while it ran, the next round runs `rollback.sh` to the version before (which itself refuses when a migration stands between them).
3. **Sessions no longer deploy or wait.** A session commits and pushes; it does not watch CI, does not run `setup.sh`, and does not ask the owner before an update. It may check `/health` a few minutes later, and reads `~/.local/state/bto-deploy/auto-deploy.log` when something is wrong.
4. **Each update is timed.** `runs/<sha>.log` has the time of every line of `setup.sh` and `deploy/edge/setup.sh`; the log line says the seconds of the centre and of the till server, so the slow step can be shortened later.
5. **Low priority**: Nice 10, CPU and disk weight 20 of 100, so the two apps keep their speed while images are built. One round at a time (`flock`).
6. **Stage only your own paths.** Two sessions share `~/bto-dev`; a push of someone's half-done files is now on the real system a few minutes later. `git add` names files, never a folder or `-A`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep waiting for CI before every update | The owner's wait this decision removes; most pushes are web changes CI only confirms. |
| No gate at all, migrations included | A migration that CI would have caught cannot be rolled back by retagging; the way back is the night's backup and the day's lost work. |
| A GitHub webhook or a self-hosted runner | Needs the PC reachable from GitHub or a runner's token on it; a one-minute poll does the same with what is there. |
| Deploy from `~/bto-dev` on push (a git hook) | Misses pushes from GitHub's site or another checkout, and runs inside the session's own command. |

## Consequences

**Positive.** A push is live a few minutes later without anyone waiting; the owner sees the change sooner and sessions finish sooner. The slow step can be measured and shortened.

**Negative.** Code reaches the real system before CI has run on it: a bug CI would catch is live for the minutes until CI answers and the rollback runs. A change of the till kiosk restarts the till server's containers while the shop is open (about a minute). Every push of code is an update, so many small pushes are many short pauses of the office's screens. A flaky red CI keeps a migration off until the next push.

## Related

ADR-0186, ADR-0187, ADR-0195, ADR-0196, `deploy/store/auto-deploy.sh`, `install-auto-deploy-timer.sh`, `auto-deploy.test.sh`, `docs/runbooks/store-install.md` §7.
