# ADR-0196: An update keeps the way back, replaces the apps' processes one at a time, and asks CI first

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «бусад хөгжүүлэлтээ хий», the third item of the assessment after the saved views and the watchman — «шинэчлэлтийн скрипт CI ногоон болохыг хүлээдэг, өмнөх image-ийг хадгалдаг, нэг командаар буцаадаг болгох»), Claude (the direct-mode session) |
| Amends | ADR-0186 #6 and the runbook's §8 (going back is no longer a rebuild), ADR-0192 (the replicas are now what makes an update quiet for the apps) |

## Context

Every pushed change goes onto the store's PC at once (CLAUDE.md, the owner's rule of 2026-11-11), and `deploy/store/setup.sh` is the whole of it: build, migrate, `up -d --wait`. Three things were missing from it.

**Going back cost a rebuild.** The runbook's §8 is `git checkout <old>` and both setup scripts again: ten to twenty minutes on this PC, with the store waiting, and the newly built image replaces the one that worked. The image that was running a minute ago is still on the disk but has no name, so nothing can reach it.

**Everything restarted together.** `up -d --wait` replaces every container whose image changed at once: the primary api, the four `api-apps` replicas, the report replica, the web. For the length of that restart «Bto300» and the staff app are down — against the owner's standing rule that the two apps must never lag (2026-11-13). The replicas of ADR-0192 are four processes behind one load balancer, which is exactly what makes a quiet update possible, but compose was replacing them in one step.

**Nothing asked CI.** Twice on 2026-11-13 the real system was updated before CI had finished with the commit. Nothing broke, but the store would have been the place where a red build was discovered.

## Decision

1. **The running images are kept as the way back** (`deploy/store/deploy-lib.sh`): before a build, `bto-api:store-local` and `bto-web:store-local` are tagged `:store-previous`, and the version of the last finished update is written to `~/.local/state/bto-deploy/current` (the one before it to `previous`). One step back is kept, never two: the night's backup is what reaches further.
2. **`deploy/store/rollback.sh` puts those images back** under the tags the stack runs and starts the centre on them — about half a minute, no build, no network. It **moves the running system only**: the checkout stays where it is, so the next `setup.sh` builds the newer code again, and the script says so. It is the stopgap that buys time to fix forward, not a way to keep an old version.
3. **A migration between the two versions stops a rollback** unless `--force`: the older code may not fit the changed tables, and the honest way back is then the night's backup (runbook §9). The two versions' migration files are compared with `git diff`.
4. **The app replicas are replaced one at a time** (`roll_service`), before the rest of the stack restarts: one container is removed and `compose up --no-recreate` makes good the missing one from the new image, leaving the others serving. Compose has no rolling update of its own — `up` replaces every stale container of a service together — and this is the smallest thing that bends it: the new container takes the next free number, so the names drift upward, which nothing depends on (the watchman and the Caddyfile go by the compose labels and the service's DNS name). A service of one container is left to the plain `up`: rolling it would be the same gap with more moving parts, so the primary api, the worker, the web and a single report replica still restart as before.
5. **What CI said about this commit is looked up before anything is built**: red stops the update (`--no-ci-check` goes on anyway), green says so, and anything the box cannot tell — no `gh`, not signed in, no run for this commit, a run still going — is a line on the screen and the update proceeds. The owner's rule is to deploy at once; waiting ten minutes for every deploy would replace it with a different rule, while refusing a known-red build costs nothing.
6. **Tried without Docker or GitHub**: `deploy/store/deploy-lib.test.sh` runs the verdicts, the kept versions and which containers would roll against fake commands; CI's `deploy-config` job runs it beside the watchman's.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep every built image, tagged by commit | Each is 662 MB on a 238 GB disk that also holds the backups and the build cache; one step back covers the case this is for (an update that went wrong a minute ago). |
| A second primary api, so even it rolls | The primary keeps the sign-in limits, the e-Barimt print's secrets and the server panel's history in its memory (ADR-0192): two of them would answer differently. The apps are the part that must not pause, and they do not. |
| Swarm or Kubernetes, which roll properly | A second runtime to learn and maintain on one PC that one person looks after. |
| Wait for CI on every update | Ten to fifteen minutes between the owner's push and the fix reaching the store, for a check the owner has already seen go green on the development server. Red is the case worth stopping for. |
| A rollback that also moves the checkout | A detached checkout that the next `git pull` fights with, and a system whose code nobody can find. The script is loud about being temporary instead. |

## Consequences

**Positive.** A bad update is undone in half a minute instead of twenty, by one command, with a warning when a migration makes it the wrong answer; the two apps keep answering through an update; a red build does not reach the store; the state the deploy keeps (`current`, `previous`) is also what tells the owner what is running.

**Negative.** One more image tag per build, 662 MB and 102 MB kept on the disk (`housekeeping.sh` must not prune them). The rolling makes an update longer: four replicas, each waited for in turn, before the rest of the stack. Container names drift upward (`api-apps-5`, `-6`, …) and only compose's labels stay meaningful. The migrations run before the first new replica, so for the minute of the roll the old and the new code both answer against the new schema — which is the rule migrations are already written to (a new column is added before it is used), but it is now a rule with a longer window. The CI gate is only as good as `gh` being signed in on the box; when it is not, the gate is a line of text.

**First run on the real system, 2026-11-14 (28bb2f16 → 69379736), and what it changed.** The four `api-apps` replicas were replaced one at a time (they are `api-apps-5` … `-8` now) and through all of it the app route, asked every 0.3 s, answered without one failure; `:store-previous` holds the images that ran before, and `current` / `previous` the versions. But the two apps were still cut off, for 12 s (35 of 761 polls refused, 13:57:25–13:57:37): not by their processes but by the door. Caddy in `web` is the only way in, to the replicas too; the plain `up -d --wait` took the old Caddy down at its start and brought the new one up only when the api was healthy, and Caddy itself does not stop while an event stream is open (the apps' live stock, the office's `/events`), so Docker waited its 10 s and killed it. Measured apart, on a scratch container of the same image: 10.1 s to stop with one open stream, 1.1 s with a grace period. Two changes, **proven on the real system the same day** (69379736 → e3ac885b, 14:38–14:40: the four replicas rolled, then the rest, then the door; of 351 polls of the app route two failed, both within the same second, 14:39:21, against 35 over 12 s before; `/health`, which the primary api answers, did not answer for about 8 s while that process restarted, as decided):
- `start_stack` (`deploy-lib.sh`, used by `setup.sh` and `rollback.sh`): everything but `web` first, while the old Caddy still hands the apps to their replicas; then `web` alone (`up --no-deps --timeout 2`: the Caddy that is running may have been started before the grace period was in its file, since a changed mounted file restarts nothing, so Docker is told not to wait for it longer than 2 s).
- `grace_period 1s` in `Caddyfile.store`: stopping does not wait for the streams that never end. A request longer than a second that is under way at that moment is cut; at an update its api process was about to be replaced anyway.
The office's web and the tills' sync still wait for the primary api (about 10 s of 502), as decided above.

**Follow-ups.**
- The till server's `deploy/edge/setup.sh` could keep its own previous image the same way.
- The watchman could say which version is running and when it last changed.
- A rollback that also puts back the night's database when a migration stands between the versions, as one command instead of a runbook section.

## Related

ADR-0186, ADR-0192, ADR-0195, `deploy/store/deploy-lib.sh`, `deploy/store/setup.sh`, `deploy/store/rollback.sh`, `deploy/store/deploy-lib.test.sh`, `docs/runbooks/store-install.md` §7, §8.
