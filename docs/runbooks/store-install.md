# Runbook: the centre on the store's Ubuntu PC (ADR-0186)

Mongolian version: [store-install.mn.md](store-install.mn.md).

Until the external server exists, the centre (PostgreSQL, api, worker, the admin's pages) runs on the store's Ubuntu PC beside the store edge. This runbook covers the install from zero, the master data, the edge's move, the backups, the pilot day, updates, roll-back and a dead box. Commands run on the box in the repository folder (`~/bto`) unless a step says «on the owner's PC».

**Rules that hold in every step.** Never `docker compose … down -v` and never `docker volume rm`: the volumes are the databases. Never paste a value of a `.env` file into a chat, a document or this repository (it is public). The system is reachable only inside the store's network: forward no port to it on the router. No test sale is made on this system: what is sold here is real.

| | |
|---|---|
| The box | `bto-edge@192.168.1.152`, Ubuntu, Docker; one disk |
| Staff open | `http://192.168.1.152` (port 80) |
| The tills open | `http://192.168.1.152:7400` (`/K1` …), as before |
| Stacks | `bto-store` (`deploy/store`: `postgres`, `api`, `worker`, `web`) and `bto-edge` (`deploy/edge`: `edge-db`, `edge`, `kiosk`) |
| Secrets | `deploy/store/.env` and `deploy/edge/.env` on the box, mode 600, written by the setup scripts |
| Backups | `/var/backups/bto` on the box; a USB disk at `/mnt/bto-backup`; `Documents\Bto-backups\store` on the owner's PC |

Short forms used below:

```bash
S="docker compose -f deploy/store/docker-compose.store.yml --env-file deploy/store/.env"
E="docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env"
```

## 1. Before the install

1. **A fixed address** for the box: a DHCP reservation on the router for `192.168.1.152`. Every till, phone and office PC keeps this address.
2. **The same commit on both sides.** On the owner's PC the main checkout is on the latest `main`, its dev database migrated (`pnpm db:migrate`). On the box: `cd ~/bto && git pull`. The file `deploy/edge/..env.swp` there is an editor's leftover: leave it alone.
3. **Outside opening hours.** The first build takes 10–20 minutes and most of the box's memory.
4. **Free disk:** `df -h /` shows more than 30 GB. Otherwise `bash deploy/store/housekeeping.sh` first (the old build cache is about 40 GB).

## 2. Install the centre

```bash
cd ~/bto
bash deploy/store/setup.sh
sudo ufw allow 80/tcp        # once: the firewall is on; the edge reaches the centre through this port too
```

The script checks Docker, writes `deploy/store/.env` with fresh secrets (never shown), builds the two images, starts PostgreSQL, creates the roles and the database (`provision`) and applies the migrations (`migrate`). With an empty database it **stops there** and says so: the master data goes in before anything starts (§3). To start an empty system instead, `bash deploy/store/setup.sh --start`, then make the first admin:

```bash
$S run --rm --no-deps api node dist/modules/identity/cli/create-admin.js --phone <phone> --full-name "<name>"
```

It prints a one-time code valid for 30 minutes; the person opens `http://192.168.1.152/set-password` («Нэг удаагийн кодоор нууц үг тохируулах»).

## 3. The master data from the dev database (on the owner's PC)

What moves and what does not: ADR-0186 #7 and the dry run's own list. Documents, stock, journals and history never move.

1. **A tunnel to the box's PostgreSQL**, in a second PowerShell window that stays open until step 5:

   ```powershell
   ssh -N -L 25433:127.0.0.1:15433 bto-edge@192.168.1.152
   ```

2. **The target's address in the environment**, without showing the password. In the main checkout (`pnpm dev` may keep running; what is typed there during the copy may be missed, so nobody edits master data meanwhile):

   ```powershell
   $pw = ssh bto-edge@192.168.1.152 "grep '^MIGRATOR_DB_PASSWORD=' ~/bto/deploy/store/.env | cut -d= -f2-"
   $env:SEED_TARGET_DATABASE_URL = "postgres://migrator:$pw@127.0.0.1:25433/bto"
   ```

3. **The dry run.** Read the three lists and the problems, if any:

   ```powershell
   pnpm store:seed
   ```

   «NOT DECIDED» tables stay empty; the owner's answers to them are a later, separate step. «the two databases are on different migrations»: step 2 of §1. «the target is not empty»: the system on the box was already started; see «Troubleshooting».

4. **The copy**, with the list of files to carry:

   ```powershell
   pnpm store:seed --apply --files-list ../../tmp/store-seed/files.txt
   ```

   It ends with `Copied … rows into 98 tables`. Any refusal writes nothing.

5. **The files** (product pictures, staff photos, the published APKs; about 3 GB, a few minutes), then forget the password and close the tunnel window:

   ```powershell
   cmd /c "tar -C .data\storage -cf - -T tmp\store-seed\files.txt releases | ssh bto-edge@192.168.1.152 ""docker run --rm -i -v bto-store_storage:/data/storage bto-api:store-local tar -xf - -C /data/storage"""
   Remove-Item Env:SEED_TARGET_DATABASE_URL; Remove-Variable pw
   ```

   Leave `releases` out of the command when `.data\storage\releases` does not exist.

6. **Start the centre** (on the box): `bash deploy/store/setup.sh`. It now finds the master data and starts everything. Open `http://192.168.1.152/system/status`.

7. **Straight after the first sign-in, as an admin:**
   - Everybody signs in with the password they had on the dev system. **Disable the test sign-ins** that came along (the logins used for testing on the dev system) in the staff list («Ажилтан»), and change the admins' passwords if the dev ones were simple.
   - «Тохиргоо → AI»: type the AI key again (it never travels).
   - «Компани»: check the company's register number and TIN.
   - Stock is zero everywhere and no document exists: check one product, one customer, one price.

## 4. Backups (once, right after the install)

```bash
sudo bash deploy/store/install-backup-timer.sh     # every night at 02:30, and after a missed night
sudo systemctl start bto-backup.service            # one run now
cat /var/backups/bto/last-run.txt
```

A night's folder `/var/backups/bto/daily/<date>_<time>` holds `centre.dump`, `edge.dump` (pg_dump archives), `globals.sql` (the roles), `counts-*.tsv` (every table's row count), `store.env`, `edge.env`, `commit.txt` and `SHA256SUMS`; `/var/backups/bto/storage` mirrors the uploaded files. Kept 14 days on the box (`BACKUP_KEEP_DAYS` in `deploy/store/.env`).

**The box has one disk: a backup that stays on it is not a backup.** Two copies leave it:

- **The USB disk.** Format a disk as ext4, mount it at `/mnt/bto-backup` for good (an `/etc/fstab` line with `nofail`), and every night's folder and the file mirror are copied there and kept 90 days. `last-run.txt` says «USB: NOT copied» when it is not mounted. The disk holds everything, secrets included: it is kept locked away.
- **The pull from the owner's PC** (weekly at least, daily during the pilot):

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup\pull.ps1            # the newest night
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup\pull.ps1 -Storage   # and the files written since the last pull
  ```

  It shows the box's last run, fetches the newest night into `Documents\Bto-backups\store` and checks every file against its checksum. Keep that folder out of cloud-synced folders.

**The restore drill** (after the install, then every quarter and after any change to the backup): restores the newest night into a scratch database beside the live one, compares every table with the counts written at backup time, and removes the scratch database.

```bash
sudo bash deploy/store/restore-drill.sh
```

`DRILL OK` is the proof; `FEWER` or `MISSING` lines name the tables that are not whole.

**Disk housekeeping:** `bash deploy/store/housekeeping.sh` after an update when `df -h /` is under 30 GB (the backup prunes the build cache every Sunday by itself). It never touches a volume.

## 5. Move the edge to the new centre

The box's edge is a dev edge linked to the dev centre on the owner's PC. It becomes the production edge with a **fresh database inside the same PostgreSQL**: nothing is deleted, the old database is renamed and never opened again. Do it at the start of a day, before a sale (the day's sale numbers start again).

1. On the dev centre, «Супермаркет → Пос»: every shift closed, the edge's «Илгээгээгүй» 0. The 13 refused test documents stay where they are.
2. Stop the edge and the kiosk, keep their database running:

   ```bash
   $E stop kiosk edge
   ```

3. Rename the old database and make an empty one (the date in the name is today's):

   ```bash
   $E exec -T edge-db psql -U edge -d postgres -c "ALTER DATABASE tugeel_edge RENAME TO tugeel_edge_dev_20261111"
   $E exec -T edge-db createdb -U edge -T template0 -E UTF8 tugeel_edge
   ```

4. The link must come from the kiosk, not from the file: in `deploy/edge/.env` the three lines `CENTRAL_API_URL=`, `EDGE_NODE_TOKEN=` and `POS_PIN_PEPPER=` are empty, and `EBARIMT_PROVIDER=fake`. (Look with `grep -c` or an editor; never print the file.)
5. Start the edge again; it migrates the empty database and the kiosk shows «Төв системтэй холбох»:

   ```bash
   bash deploy/edge/setup.sh
   ```

6. Check that the edge reaches the centre on the same PC:

   ```bash
   $E exec -T edge node -e "fetch('http://host.docker.internal/health').then((r)=>r.text()).then(console.log)"
   ```

   It prints `{"status":"ok",…}`. If it cannot connect: `sudo ufw allow 80/tcp` (step 2 of §2); if it still cannot, use the fallback at the end of this section.
7. On the new centre (`http://192.168.1.152`), «Супермаркет → Пос» → the edge server's row → «Холбох код». On `http://192.168.1.152:7400`: «Төв системийн хаяг» `http://host.docker.internal`, the edge server's code, the link code.
8. Each till PC opens its own address (`http://192.168.1.152:7400/K1`, ADR-0138). The cashiers' PINs are set first (§6).

**Fallback when step 6 fails** (the edge joins the centre's Docker network): start the edge with both files and use `http://api:3000` as the centre's address. An edge started this way is updated with the same command, not with `deploy/edge/setup.sh` alone.

```bash
docker compose -f deploy/edge/docker-compose.edge.yml -f deploy/store/docker-compose.edge-link.yml --env-file deploy/edge/.env up -d
```

## 6. The pilot: one till

**Before the day (owner).**

- [ ] **Stock.** It is zero. Count the supermarket floor with «Тооллого», or load the opening-stock import. A till never refuses a sale for stock: an uncounted product sells and leaves a «Дутагдал» row for the storekeeper, so count first.
- [ ] **The books.** They are empty; the opening is the accountant's cut-over step. Pilot sales post into Bto's books while Erkhet stays the official books; how the two meet at the cut-over is the accountant's open question (architecture §13.2 T41): ask before the day.
- [ ] «Супермаркет → Пос»: the pilot POS (К1) with its printer, drawer, receipt templates and the cashiers allowed on it; the payment types.
- [ ] «Супермаркет → Кассчин»: **a new PIN for every cashier** (PINs never travel).
- [ ] The till PC: Chrome shortcut to `http://192.168.1.152:7400/K1`, the receipt printer and the drawer (`pos-till-printing.md`), the scanner. Sign in with a PIN, search a product, use «Үнэ шалгах», print the printer's test page. **Do not sell yet.**
- [ ] The first backup ran and the drill said `DRILL OK` (§4).

**The morning of the day.**

- [ ] **Switch the e-Barimt provider** in `deploy/edge/.env`: `EBARIMT_PROVIDER=posapi`, `POSAPI_URL=http://192.168.1.254:7080`, `EBARIMT_BRANCH_NO=<the branch number on the old till's receipts>`, then `bash deploy/edge/setup.sh`. **From this moment every receipt is a real tax receipt.** «Супермаркет → Пос» shows PosAPI's version and remaining lottery numbers when the edge reaches it.
- [ ] Open the shift with the float. The first sale: the receipt prints with its ДДТД, lottery number and QR; on the centre it appears under «Борлуулалт» with the receipt's state.

**Every evening.**

- [ ] The shift is closed with the counted cash; the variance is read.
- [ ] «Супермаркет → Пос»: «Илгээгээгүй» 0, refused documents 0, PosAPI's last sent date is today («Татвар руу илгээх» when it is not).
- [ ] «Дутагдал»: the day's rows are looked at by the storekeeper.
- [ ] The cash handed over matches the shift.
- [ ] `tools\store-backup\pull.ps1` on the owner's PC says `OK` for last night.

**Stepping back.** The pilot till returns to the old till software (the other tills never left it); set `EBARIMT_PROVIDER=fake` and run `bash deploy/edge/setup.sh`. What was sold in Bto stays in Bto.

## 7. Update after a push to main

The owner's rule (2026-11-11, «Push бүрийн дараа»): every pushed code change goes onto the box at once, the centre first; a docs-only push needs no update. A session does it over SSH without sudo (`git pull --ff-only && bash deploy/store/setup.sh && bash deploy/edge/setup.sh`). The office's screens pause for a minute or two and the tills for a minute, so a large change is still best pushed at a quiet moment. Before the nightly timer exists, the backup line below is `BACKUP_DIR=$HOME/bto-backups bash deploy/store/backup.sh` (no sudo; without the file mirror).

```bash
cd ~/bto
sudo systemctl start bto-backup.service && cat /var/backups/bto/last-run.txt
git pull
bash deploy/store/setup.sh      # builds, applies the migrations, restarts (the office's screens pause for a minute or two)
bash deploy/edge/setup.sh       # then the edge and the kiosk (the tills pause for a minute)
```

`http://192.168.1.152/system/status` shows the new version. Logs: `$S logs -f --tail 100 api` (or `worker`, `web`, `postgres`).

## 8. Roll back

- **The code**, when the update applied no migration (`git diff --stat <old> <new> -- apps/api/src/db/migrations` is empty): `git checkout <old commit>`, both setup scripts again, and `git checkout main` when the fix is in.
- **After a migration** the old code may not fit the new tables. Fix forward (a new commit on main, §7). The last resort is the data of last night: §9 from step 3 on the same box. Everything typed since that backup is lost, so it is the owner's decision.

## 9. When the box dies

What is lost: everything since the last backup that left the box. The store's PosAPI PC still holds the receipts it issued; the tills go back to the old till software meanwhile.

1. A PC with Ubuntu, Docker and git; the same address (`192.168.1.152`) on the router. Take the newest night's folder from the USB disk or from `Documents\Bto-backups\store` on the owner's PC, and check it: `sha256sum -c SHA256SUMS` inside it.
2. `git clone https://github.com/ez4puljin/Bto.git ~/bto && cd ~/bto && git checkout $(cat <night>/commit.txt)`. Put the two files back before anything starts: `cp <night>/store.env deploy/store/.env && cp <night>/edge.env deploy/edge/.env && chmod 600 deploy/store/.env deploy/edge/.env`.
3. The centre. The first command builds, creates the roles with the passwords of the file and stops at the empty database; the next ones replace that empty database with the backup's (**only ever on a box whose database is empty or lost**):

   ```bash
   bash deploy/store/setup.sh
   $S stop api worker web
   $S exec -T postgres dropdb -U postgres --if-exists bto
   $S exec -T postgres createdb -U postgres -T template0 -E UTF8 --locale-provider=icu --icu-locale=und bto
   $S exec -T postgres pg_restore -U postgres -d bto --exit-on-error < <night>/centre.dump
   $S run --rm provision
   ```

4. The files: `docker run --rm -v bto-store_storage:/data/storage -v <backup>/storage:/from:ro bto-api:store-local cp -a /from/. /data/storage/`.
5. `bash deploy/store/setup.sh` (it finds the data and starts), then `git checkout main && git pull && bash deploy/store/setup.sh` to return to the current version.
6. The edge: `bash deploy/edge/setup.sh`, then put its database back, link and bindings included:

   ```bash
   $E stop kiosk edge
   $E exec -T edge-db dropdb -U edge --if-exists tugeel_edge
   $E exec -T edge-db createdb -U edge -T template0 -E UTF8 tugeel_edge
   $E exec -T edge-db pg_restore -U edge -d tugeel_edge --exit-on-error < <night>/edge.dump
   bash deploy/edge/setup.sh
   ```

   Sales the dead box's edge had not sent to the centre and that are not in the night's dump are re-entered from the receipts.
7. §4 again: the timer, one run, the drill.

## Troubleshooting

- **«the target is not empty» at the seed.** The centre was started before the seed (the api writes the permissions at its first start). On a box that holds nothing real yet: `$S stop api worker web`, then the `dropdb` / `createdb` lines of §9 step 3, `$S run --rm provision`, `$S run --rm migrate`, and the seed again. Never on a system somebody has worked in.
- **`provision` cannot sign in to PostgreSQL.** `deploy/store/.env` was deleted and written anew while the database volume kept the old passwords. Put the old file back from a backup (`store.env`), or give the superuser the new file's password from inside the container, without showing it:

  ```bash
  PW=$(grep '^POSTGRES_PASSWORD=' deploy/store/.env | cut -d= -f2-)
  echo "ALTER ROLE postgres PASSWORD :'pw'" | $S exec -T postgres psql -U postgres -v pw="$PW"
  unset PW
  ```

- **A page does not open from another PC.** `$S ps` (every service `healthy`), `sudo ufw allow 80/tcp`, the box's address.
- **The build stops for memory.** Stop the edge's containers for the build (`$E stop kiosk edge`, start again with `bash deploy/edge/setup.sh`), outside opening hours.
- **The staff app.** It reaches this centre only on the store's Wi-Fi, with a build made for it (`BTO_SERVER=http://192.168.1.152 pnpm mobile:apk` on the owner's PC); the newest published APK is served at `http://192.168.1.152/api/v1/app-releases/staff/apk`. Bto300 stays on the test server.

## Rehearsing the backup scripts without Docker

`backup.sh` and `restore-drill.sh` reach PostgreSQL inside the containers. Against a plain PostgreSQL (a developer's PC), the prefix is replaced: `BTO_CENTRE_PG=env BTO_CENTRE_DB=<a scratch database> BACKUP_DIR=<a scratch folder> BTO_STORAGE_SRC=<a folder>` with `PGHOST`, `PGPORT`, `PGPASSWORD` in the environment and the PostgreSQL tools on the `PATH`; `BTO_EDGE_PG`, `BTO_EDGE_DB` and `BTO_EDGE_USER` do the same for the edge. The 2026-11-11 rehearsal ran both scripts this way on a seeded scratch database, with a short count and a damaged archive to see the drill fail.
