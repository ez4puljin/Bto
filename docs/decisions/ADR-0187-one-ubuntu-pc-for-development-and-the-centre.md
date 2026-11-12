# ADR-0187: Development and the centre move to one Ubuntu PC; the owner's laptop is a terminal

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-12 |
| Deciders | Owner (2026-11-12: «laptop зөвхөн terminal бүрэн эрхтэйгээр … Энэ laptop дээр ямар ч файл дээр ажиллахгүй, Шинэ ubuntu дээр bto болон касс системийг бүрэн суулгаж ажлуулж бас хөгжүүлж явна»; on the real system's database: «Цэвэрээр эхэл»), Claude (the direct-mode session) |
| Amends | ADR-0186 (which PC carries the centre and the edge: #1, #2 and #9 to #11 name the store PC; the kit itself is unchanged), ADR-0026 #1 (where development happens), ADR-0061 #2 (where the APKs are built), the owner's rule of 2026-11-11 «Push бүрийн дараа» (where a pushed change is put), the dev database on Windows of 2026-11-09 (`tools/dev-db`, for this PC only) |

## Context

Until 2026-11-12 Bto was developed on the owner's Windows laptop (16 GB, the checkout in a folder with spaces, PostgreSQL installed on Windows, `start.bat`), and since 2026-11-11 the centre for the supermarket's pilot ran on the store's Ubuntu PC `bto-edge@192.168.1.152` (i3-10100, 7.1 GB with swap in use, one disk) beside the store edge (ADR-0186). The laptop was short of memory for a check and a build at once, the store box was tight for a build during opening hours, and every pushed change travelled from one to the other over SSH.

The owner put a stronger PC on the same LAN and decided that everything runs there. The machine, read on 2026-11-12: `nvme-server@192.168.1.250` (the host is named `nvme-server` too), Ubuntu 26.04.1 desktop, a Xeon E5-4657L v2 (12 cores, 24 threads), 30 GB of memory, a 238 GB NVMe disk as `/` (141 GB free after the install), a second 238 GB SSD that still holds an old Windows installation (NTFS, nearly full), the firewall (`ufw`) on, the clock on Asia/Ulaanbaatar, no automatic suspend, lingering on for the user. The owner gave the user passwordless `sudo`. The same PC already runs the company's old ERP (ports 8000, 8080 and 8100, a `cloudflared` tunnel), which is not part of Bto.

The pilot had not started: the centre on the store box held the seeded master data and no real document, its edge sold nothing real (`EBARIMT_PROVIDER=fake`). The store box was off the network during the whole install on 2026-11-12.

## Decision

1. **One PC carries both.** `192.168.1.250` is the development machine and, until the external server of ADR-0026 #3, the real system: the centre (`deploy/store`) and the till server (`deploy/edge`). The owner's laptop keeps no working copy and no database in use: it opens the PC over SSH (the alias `bto-server`), Claude Code runs on the PC, and the owner looks at the screens in a browser at the PC's LAN address. The store box `192.168.1.152` is no longer the centre.
2. **Two checkouts and two PostgreSQL servers that never cross.**

   | | Development | The real system |
   |---|---|---|
   | Checkout | `~/bto-dev` (`main`, direct mode) | `~/bto` |
   | Runs as | the user service `bto-dev` (`pnpm dev`) | Docker projects `bto-store` and `bto-edge` |
   | Address | `http://192.168.1.250:5173` | `http://192.168.1.250` (staff), `http://192.168.1.250:7400` (tills) |
   | PostgreSQL | the repository's `docker-compose.yml` (project `tugeel`), `127.0.0.1:15432`, database `bto_main` | `bto-store`'s own, `127.0.0.1:15433`; the edge's own inside its stack |
   | Files | `~/bto-dev/.data` | the volume `bto-store_storage` |

   Code is written only in `~/bto-dev`. `~/bto` changes only by `git pull --ff-only` and the setup scripts. No development `.env` ever names port 15433, no command there is run with `down -v`, and no volume is removed (ADR-0186 #10's rule, now with the dev stack as a neighbour). `pnpm edge:up` and `pnpm edge:down` are never run in `~/bto-dev` on this PC: they name the Docker project `bto-edge` and port 7400, which here are the real till server's (today they stop at the missing `deploy/edge/.env` of that checkout, which is never created); a development edge on this PC is `pnpm --filter @tugeel/api edge:dev` on port 3400.
3. **The development server is a service.** The user unit `bto-dev` (`tools/dev-server/bto-dev.service`, installed in `~/.config/systemd/user`) runs `pnpm db:migrate`, then `pnpm dev` with `DEV_LAN=1`, and starts with the PC (lingering). `systemctl --user restart bto-dev` and `journalctl --user -u bto-dev` are what `start.bat`, `stop.bat` and the «Bto dev» window were on Windows; those files stay for a Windows PC. Before a full `pnpm check` the service is stopped and started again afterwards, as the dev window was.
4. **The development database is the Docker container again, on this PC.** The move to PostgreSQL installed on Windows (2026-11-09) answered Docker Desktop's virtual machine holding 2 to 5 GB of a 16 GB laptop; on Linux the container is an ordinary process. `bto_main` was restored from the laptop's dump (99 migrations; products, customers, sign-ins counted equal), with `apps/api/.env`, `.data` and `tmp`. `tools/dev-db` stays for a Windows PC and is not used here. The laptop's own server and its other databases (the `tugeel_ca*` copies, test copies) stay on the laptop untouched.
5. **The centre is installed fresh here, not moved from the store box** (owner «Цэвэрээр эхэл»): the same kit and the same order as ADR-0186, with nothing carried from `192.168.1.152`. `bash deploy/store/setup.sh` made new secrets on this PC, and `pnpm store:seed --apply` copied the master data from the dev database on the same PC (122 810 rows into 98 tables, 14 461 picture files and the published APKs into the storage volume). The seven test sign-ins that travel with the dev database were removed in one transaction before anyone signed in, the temporary import admin's rows moved to `admin` first (one audit row, `cli:store-install`); 41 sign-ins remain. By ADR-0186 #4 every password stays as it was, every cashier's PIN is set again and the AI key is typed again. What was set by hand on the store box after its own seed (its cashiers, its edge link) is set again here; nothing on that box is deleted, and what becomes of it is the owner's call.
6. **The till server is installed fresh beside it** (project `bto-edge`, kiosk on port 7400, `EBARIMT_PROVIDER=fake`): it reaches the centre at `http://host.docker.internal` and is linked by the owner on the screens with a one-time code (ADR-0136). The provider switch on the pilot day stays the owner's step (ADR-0186 #10).
7. **Sizes and addresses of ADR-0186 stand.** The compose file's limits (written for 7 GB) are kept as they are on 30 GB; LAN-only plain HTTP, no forwarded port, no certificate (ADR-0186 #3). The firewall lets in 22, 5173 (dev), 80 (the centre) and 7400 (the tills), beside the old ERP's ports.
8. **A pushed code change is put on the real system on the same PC**, at once and without asking as before (owner 2026-11-11): `cd ~/bto && git pull --ff-only && bash deploy/store/setup.sh && bash deploy/edge/setup.sh`, the centre first; a docs-only push needs none. This replaces the SSH to the store box.
9. **Backups.** The nightly timer of ADR-0186 #9 runs on this PC (02:30, `/var/backups/bto`, 14 nights). It is on the same disk as the databases: until a second place is chosen the copy off the disk does not exist. The kit already offers a USB disk mounted at `/mnt/bto-backup` and `tools/store-backup/pull.ps1 -Server nvme-server@192.168.1.250` from a Windows PC; which one, or the PC's second SSD, is the owner's choice.
10. **APKs are built on this PC.** `pnpm mobile:apk` runs on Windows and on Linux: the tools folder is `C:\Android` or `~/Android` (the SDK in `Sdk`, the build mirror in `m`, Gradle's cache in `gradle`), the mirror is made by robocopy or by rsync, the JDK is looked for in `/usr/lib/jvm` too, and the office-network address is found past Docker's bridges. On this PC: Ubuntu's `openjdk-17-jdk-headless` and the SDK packages of `docs/modules/mobile.md` §9 in `~/Android/Sdk`.
11. **What is not Bto's on this PC is left alone:** the old ERP (`~/Desktop/erp-merge-order version1.0`, its three ports and its tunnel) and the owner's desktop session, which is never restarted or signed out.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep developing on the laptop and only move the centre | The owner wants one place; the laptop's 16 GB could not carry a check and a build together, and its checkout path with spaces needed the build mirror and other workarounds. |
| Move the store box's database here (dump and restore) | It held the same master data as the dev database and no real document, and the box was off the network; the owner chose a clean start. A restore would also have carried secrets made on another machine. |
| Keep the centre on the store box and use this PC for development only | Two machines to update and back up, and the weaker one carrying the real system. |
| One PostgreSQL server for development and the real system | A wrong `DATABASE_URL` or a test run would then be one database name away from real sales; two servers on two ports with different passwords keep them apart. |
| Develop in the real system's checkout | A half-built change would be one `setup.sh` away from the tills. |
| PostgreSQL installed on the host for development, as on Windows | The reason for it was Docker Desktop's virtual machine; here the compose file the repository already has is the simpler, documented way and matches CI. |

## Consequences

**Positive.** One always-on machine with four times the store box's memory builds, checks and serves; the owner works from any PC with a terminal; an update of the real system is a local command; APK builds no longer need the Windows-only path workarounds; the dev database and the real one were filled from the same dump, so what the owner tested is what was seeded.

**Negative.** ADR-0186 refused the centre on a development machine because a laptop sleeps, restarts and migrates at will. This PC does not sleep, and the two sides are separate checkouts, Docker projects and databases, but they share one user, one Docker daemon, one disk and one power supply: a mistaken command in development can reach the real stack (the rules of #2 are the guard, not a wall), a heavy check or APK build takes memory and processor time from the tills' server (once the pilot sells, long builds wait for closing time), and a dead disk takes the code's working copy, the real database and its backups together until #9's second place exists. The machine also carries the old ERP, which Bto's work must not disturb. The work the store box held after 2026-11-11 (five cashiers, the linked edge) is repeated here by the owner.

**Follow-ups.**
- The owner: `gh auth login` on this PC (until then commits made here cannot be pushed); linking the till server and the cashiers' PINs; the admin passwords and the AI key on the real system; a second place for the backups; what becomes of the store box `192.168.1.152`; access from other networks (Tailscale, or a tunnel like the old ERP's), which stays closed until decided (ADR-0186 #3).
- `docs/runbooks/store-install.md` (`.mn.md`) still names the store box in its examples; the steps are the same with this PC's address and user.
- The apps' download page (`tools/apk-share`, port 3302, started by `start.bat` on Windows) is not started on this PC yet.
- The external server (ADR-0026 #3) is unchanged: a dump and restore of this centre's database.

## Related

ADR-0026, ADR-0061, ADR-0067, ADR-0136, ADR-0186, `docs/architecture.md` §10.1, §10.7, §10.8, `tools/dev-server/README.md`, `tools/dev-db/README.md`, `docs/modules/mobile.md` §9, `docs/runbooks/store-install.md`, `deploy/store/`, `deploy/edge/`.
