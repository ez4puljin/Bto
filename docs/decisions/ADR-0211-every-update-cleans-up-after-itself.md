# ADR-0211: Every update cleans up after itself

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «диск 85% дүүрсэн … байнгын шийдлийг хийж өгнө үү»; done when «шинэчлэл хэдэн ч удаа тавигдсан диск өөрөө өсөхгүй болсон, буцаах боломж хэвээр, дискний сул зай багасахад эзэнд мэдэгддэг болсон»), Claude |
| Amends | ADR-0186 (#7, `housekeeping.sh`), ADR-0204 (what a round does at its end) |

## Context

On 2026-11-17 the one disk of the PC (233 GB) was 85 % full, 34 GB free. Measured that day: `/var/lib/containerd` 88 GB; 65 images of which 59 without a tag (the api's about 700 MB each, the web's 100 MB); 396 build cache records, 84 GB (the two counts overlap: they are the same layers seen from both sides).

Every build copies the whole repository before `pnpm install`, so every commit makes new layers: a full update left about 6 GB behind, a pages-only one about 2 GB, and the image it replaced lost its tag and stayed. Nothing removed them: `setup.sh` and the Sunday backup pruned only build cache older than 168 hours, written when an update was an event of the week; `image prune` stood only in `housekeeping.sh`, which nothing ran; and Docker's own limit for the build cache on this disk is 174 GB. Since ADR-0204 a push is an update, twenty of them in the first day and a half.

The watchman (ADR-0195) had seen the disk at its 85 % from 09:57 that day, round after round, and told nobody: the owner's Telegram is not connected yet (`alerts-setup.sh`).

## Decision

1. **Every update ends with the housekeeping.** `deploy/store/setup.sh` (both the full and the `--only-web` update) and `deploy/edge/setup.sh` run `housekeeping.sh --quiet` as their last step; `auto-deploy.sh` runs it after an update that failed; `setup.sh` runs it before building when under 15 GB is free. `backup.sh` runs it every night instead of Sundays, for what builds outside an update leave (`pnpm docker:build`, `pnpm ci:rehearse`). No timer of its own: the disk grows only when something is built.
2. **Images: only those without a tag** (`docker image prune -f`, never `-a`). The images the stacks run and `bto-api:store-previous`, `bto-web:store-previous` carry tags and stay, so `rollback.sh` (ADR-0196) is unchanged.
3. **Build cache: a limit by size, not by age.** `docker builder prune -f --max-used-space <N>gb`, N = `STORE_BUILD_CACHE_GB` of `deploy/store/.env`, default 10; the least recently used records go first. What makes a build fast (the base images, the layer that installs pnpm, pnpm's store mount of 0.9 GB) is used by every build and stays; the layers of older commits are never used again. A limit by age would empty the cache after a quiet week and make the next update a first build of 10–20 minutes.
4. **Never a volume, never a container.** The databases and the uploaded files are out of its reach.
5. **The disk alert stays the watchman's** (`STORE_ALERT_DISK_PERCENT`, default 85: about 35 GB free on this disk; said again every six hours). It reaches the owner once `bash deploy/store/alerts-setup.sh` has been run in `~/bto`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A timer of its own (hourly) | The disk grows only at a build; a timer would also prune while another build runs, and is one more unit to install. The nightly backup already is the second net. |
| A shorter age filter (`until=24h`) | Twenty updates in a day still leave 80 GB inside the window; a quiet week empties the cache. |
| Docker's own limit (`builder.gc` in `/etc/docker/daemon.json`) | Needs sudo and a restart of Docker, which stops the real system; it does nothing about untagged images. |
| Change the Dockerfiles so `pnpm install` is cached across commits | Worth doing for the build's time; it does not remove the image each update replaces. Left open. |

## Consequences

- Run by hand that day: 34 GB → 110 GB free in two minutes, `/var/lib/containerd` 88 GB → 12 GB; every tagged image, `:store-previous` included, and every container untouched.
- Docker now holds the running images, the way back and at most 10 GB of cache, plus what the update at work adds (about 6 GB) until it ends.
- An update takes a few seconds longer at its end.
- The old ERP's backup in the owner's `~/Desktop` (46 GB) is not Bto's and is left alone.

## Related

ADR-0186, ADR-0195, ADR-0196, ADR-0204, ADR-0205, `deploy/store/housekeeping.sh`, `deploy/store/housekeeping.test.sh`, `docs/runbooks/store-install.md` §4, `docs/architecture.md` §10.7.
