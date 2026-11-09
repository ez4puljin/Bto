# The development database on Windows

Since 2026-11-09 (owner) the development PostgreSQL runs on Windows itself instead of in Docker
Desktop: Docker Desktop's Linux VM held 2–5 GB of the PC's 16 GB. Nothing else changed for the code:
the same PostgreSQL 18 with UTF-8 and the ICU `und` collation, the same port `127.0.0.1:15432`, the
same roles and passwords, so `apps/api/.env` is unchanged. CI keeps its `postgres:18` service on Linux.

| | |
|---|---|
| Binaries | `C:\Program Files\PostgreSQL\18\bin` (the EDB installer; override with `BTO_PG_BIN`) |
| Data folder | `%LOCALAPPDATA%\Bto\pg18` (override with `BTO_PG_DATA`); a failed start is in its `pg_ctl.log`, the running server's messages in its `log` folder. PostgreSQL's Windows tools take paths in the ANSI code page: on a PC whose user name has letters outside it (Ө, Ү), set `BTO_PG_DATA` to a plain path such as `C:\BtoData\pg18` |
| Start / stop / status | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev-db\dev-db.ps1 start` (`stop`, `status`); `start.bat` and `stop.bat` call it |
| Runs as | the signed-in user, in a hidden window; it is not a Windows service, so it starts with `start.bat` (or the command above) after a restart |

`dev-db.ps1` never runs docker. If the old `tugeel-postgres-1` container still holds port 15432,
`start` stops with exit code 4 and `start.bat` says so; stop the container in Docker Desktop.

## Differences from the Docker server

- `client_connection_check_interval` cannot be set on Windows: `configureAiReader` skips it there
  and the integrity suite proves the server refuses it (Linux servers keep the 2 s setting).
- The libc locale is `en-US` (Windows has no `en_US.utf8`). Collation, `lower`/`upper`, `ILIKE` and
  regular expressions go through ICU as before, and `pg_trgm` splits Cyrillic words as before. One
  visible difference: the text form of a whole row (`t::text`) quotes a field containing the byte
  0xA0, the second byte of «Р», because the Windows locale counts it as a space. No code reads rows
  that way.

## Setting up another PC

1. Install PostgreSQL 18 from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
   (the server and command line tools are enough; its own service and data folder are not used).
2. Create the data folder with the Docker image's settings:

   ```powershell
   $bin = 'C:\Program Files\PostgreSQL\18\bin'; $data = "$env:LOCALAPPDATA\Bto\pg18"
   $pw = "$env:TEMP\pgpw.txt"; Set-Content $pw 'postgres'   # the local superuser of docker-compose.yml
   & "$bin\initdb.exe" -D $data -U postgres --pwfile=$pw -E UTF8 --locale-provider=icu --icu-locale=und `
     --locale=en-US --lc-messages=C --auth-local=scram-sha-256 --auth-host=scram-sha-256
   Remove-Item $pw
   Add-Content -Encoding ascii "$data\postgresql.auto.conf" @"
   port = 15432
   listen_addresses = 'localhost'
   max_connections = 200
   timezone = 'Etc/UTC'
   log_timezone = 'Etc/UTC'
   logging_collector = on
   log_directory = 'log'
   log_filename = 'postgresql-%a.log'
   log_truncate_on_rotation = on
   log_rotation_age = 1d
   log_rotation_size = 0
   "@
   ```

3. `tools\dev-db\dev-db.ps1 start`, then `pnpm db:provision` and `pnpm db:migrate` as in the README.

## How the owner's PC was moved (2026-11-09)

With `pnpm dev` stopped: `pg_dumpall --globals-only` and one `pg_dump -Fc` per real database
(bto_main, the `tugeel_ca*` copies and the other kept databases; the `*_integration_*`,
`*_integrity_*` and `*_edge_*` databases are rebuilt by every test run and were left behind);
`docker compose stop`; the new data folder as above; the roles, then each database with its owner,
privileges and settings, then `pg_restore`. Every table's row count and contents were compared
before and after, and the integration and integrity suites passed on the new server. The dumps are
kept in `tmp/db-backups/2026-11-09-docker-move/` (gitignored). The owner then had Docker Desktop
uninstalled from this PC with its data, the old volume included: `pnpm edge:up`, `pnpm ci:rehearse`
and `pnpm docker:build` need Docker installed again (CI builds the images on every push).
