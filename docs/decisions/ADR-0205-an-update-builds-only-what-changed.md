# ADR-0205: An automatic update builds only what changed

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-16 |
| Deciders | Owner (2026-11-16: «Удаан алхмыг богиносго. Бүх шинээр үүссэн болон одоогийн бүх session дээр энэ дүрэм үйлчилдэг байх ёстой»), Claude (the direct-mode session) |
| Amends | ADR-0204 (#1, the timer's interval and what an update builds) |

## Context

The first timed update under ADR-0204 (662faf0b, `runs/662faf0b.log`) took 263 s for the centre and 42 s for the till server, plus up to 60 s before the timer saw the push. The centre's time was: building the images 153 s (the api's `pnpm install` 28 s and `nest build` 73 s, the web's 38 s, writing the images 31 s), the database and migrations 7 s, rolling the four app replicas 46 s, starting the rest 55 s. Both Dockerfiles `COPY . .`, so a change of a page rebuilt the api too and restarted every api process. The till server's api gets `APP_VERSION` at run time, so every update also recreated it and paused the tills.

## Decision

1. **A change of the office's pages alone** (every code file under `apps/web`, not its `Dockerfile` or `package.json`) is put on with `setup.sh --only-web`. It builds the web image only and replaces the door (`web`, about a second). No api build, no replica roll, no migration step. `/health` keeps the api's older version, and the update is recorded in `DEPLOY_STATE/current`.
2. **The till server is rebuilt only when what it is built from changed.** That is anything but docs and `apps/web` outside `src/pos`, `pos.html`, the web's `Dockerfile` and `package.json`. Otherwise the tills do not pause.
3. **The timer looks every 20 seconds**, not every minute (a `git fetch`: cheap).
4. **The rule reaches every session.** `~/.claude/CLAUDE.md` (loaded by every session of this account, wherever it starts) says it in short; the repo's `CLAUDE.md` in full; the sessions running on 2026-11-16 were told by message.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Copy the manifests first and install before `COPY . .` (a cached dependency layer) | Saves about 28 s per image, but Docker cannot copy every workspace `package.json` with its folders in one line without the labs syntax; a later step. |
| Read the version from the web for the office's pages | `/health` is the api's; the deploy state file and the log say what was put on. |
| Never rebuild the till server automatically | The kiosk and the edge must follow the api and the shared package, or a sale is refused. |

## Consequences

A push of pages only is live in about one to one and a half minutes; other code in about five, as before. `/health`'s version is the api's, not always the last push's. The kiosk's bundle may be older than the office's when only shared web components changed, until the next push that touches the kiosk.

## Related

ADR-0196, ADR-0204, `deploy/store/auto-deploy.sh`, `setup.sh --only-web`, `install-auto-deploy-timer.sh`, `~/.claude/CLAUDE.md`.
