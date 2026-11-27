# ADR-0255: The images install from the manifests first; a failed update is said at once

|           |                                                                                    |
| --------- | ---------------------------------------------------------------------------------- |
| Status    | Accepted                                                                           |
| Date      | 2026-11-27                                                                         |
| Deciders  | Owner (2026-11-27: changes must reach app.puljika.site in minutes), Claude         |
| Amends    | ADR-0204 (auto-deploy), ADR-0195 (the watchman)                                    |

## Context

On 2026-11-27 an update of the centre took 8 to 21 minutes. The run logs showed that almost all
of it was the two `pnpm install` steps of the api and web images (200 to 1,200 s), retrying npm
registry timeouts: both Dockerfiles copied the whole repository before the install, so every
change of code made the install run again. Everything else of an update (compile, migrate, roll
the replicas, start) took about 80 s. The same afternoon four updates in a row failed on the
worker's health check, and nobody knew for an hour: the Telegram watchman was never connected, and
the failure only stood in `auto-deploy.log`.

## Decision

1. Both `apps/api/Dockerfile` and `apps/web/Dockerfile` copy the root manifests, the lockfile and
   every workspace `package.json` first, run the filtered `pnpm install --prefer-offline`, and only
   then `COPY . .`. The install layer is reused while no manifest changes: an update of code
   downloads nothing. `pnpm deploy` also prefers the store. `auto-deploy.test.sh` fails when a
   workspace `package.json` is missing from either list.
2. `auto-deploy.sh` says a failed update (the centre not put, `/health` with the wrong version, the
   till server in error) at once in three places, each best-effort: the owner's Telegram through
   `watch.sh --say` (when `alerts-setup.sh` connected it), a `bto-deploy` commit status on GitHub
   (failure; success for a good update), and a message to all on the team board (ADR-0248) as
   `deploy`, which the brain and the second developer's Codex read. Only the commit, the step and
   the log's last error lines go out, never a secret.

3. The build cache kept by `housekeeping.sh` goes from 10 to 30 GB by default
   (`STORE_BUILD_CACHE_GB`): at 10 the web image's dependency layer was the least recently used
   after each update and was pruned, so the next update installed the web's dependencies again
   (the second update after the change, 52f72fab: the api's install cached, the web's not). The PC
   had 88 GB free.

## Consequences

An update without a dependency change is expected to take two to three minutes (a pages-only one
about one); a dependency change still downloads once. A broken update is seen by whoever can fix
it within a minute.
