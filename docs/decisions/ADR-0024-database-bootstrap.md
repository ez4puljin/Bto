# ADR-0024: Database bootstrap: foundation migration 0000, module-owned guards, pg-boss schema installed by `db:migrate`

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-10 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0003 follow-up ("migration 0001 creates … the ledger guards"), ADR-0007 and ADR-0019 ("from migration 0001"), ADR-0016 decision 2 (per-worker database mechanism) |

## Context

ADR-0003, ADR-0007 and ADR-0019 say that "migration 0001" creates the extensions, the collation assertion, the stock-ledger guards, the partitioned snapshot tables and the `lots` table. Two facts make that wording impossible to follow literally:

- The ledger, balance, snapshot and lot tables belong to the `inventory` module, which is built in week 3 of delivery 1. The week-1 scaffold creates no business tables, so a guard on `stock_ledger` cannot exist yet.
- drizzle-kit 0.31 numbers migration files from `0000_`; with no schema files at all, `drizzle-kit generate` (even `--custom`) exits with an error, so an aggregator schema file must exist from the start.

Further facts that shape the bootstrap: pg-boss 12 (ESM-only, schema version 45) installs its own `pgboss` schema and requires queues to exist before `send()`/`work()`; drizzle's migrator runs `CREATE SCHEMA IF NOT EXISTS "drizzle"`, which needs the database `CREATE` privilege; on DigitalOcean Managed PostgreSQL the admin user `doadmin` is not a superuser and PostgreSQL 16+ CREATEROLE rules apply; Jest runs test files in parallel workers (ADR-0016).

## Decision

1. **Foundation migration `0000_foundation.sql`** (created with `pnpm db:generate --custom --name=foundation`, hand-written, runs as `migrator`) contains only:
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `btree_gist`;
   - `assert_unicode_casefold()`: raises unless the database is UTF-8 and `lower('ӨҮЁ') = 'өүё'`, and is called once by the migration itself;
   - the generic trigger function `forbid_update_delete()` (raises `restrict_violation`, SQLSTATE 23001), attached later by the module migrations that own append-only tables;
   - `ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app` and `GRANT USAGE, SELECT ON SEQUENCES TO app`.
   It creates no role and no business table.
2. **Guards ship with the module that owns the table.** The inventory module's first migration (week 3) creates `stock_ledger`, the balance caches, `stock_snapshot_daily` / `stock_snapshot_bin_monthly` (partitioned by month) and the empty `lots` table, and hand-edits in `REVOKE UPDATE, DELETE ON stock_ledger FROM app`, `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers executing `forbid_update_delete()`, the idempotency unique index and the CHECKs listed in `docs/architecture.md` §5.3. Wherever an older ADR says "migration 0001", read "the first migration of the owning module".
3. **Migration naming.** Every later migration is generated with `--name=<module>[_<change>]` (for example `0001_identity`, `0007_inventory`); random drizzle names are not accepted. All pending migrations run in one transaction, so `CREATE INDEX CONCURRENTLY` is never used inside them.
4. **Roles and the database are created by `pnpm db:provision`** (`apps/api/src/db/provision.ts`, logic in `apps/api/src/db/provisioning.ts`, also shipped in the image as `dist/db/provision.js`), run with `ADMIN_DATABASE_URL`. It is idempotent: creates or re-passwords `app` and `migrator` (plain `LOGIN` roles; passwords taken from `DATABASE_URL` and `MIGRATOR_DATABASE_URL`), creates the database with `ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0` when missing, grants `CONNECT, TEMPORARY` to `app` and `CONNECT, TEMPORARY, CREATE` to `migrator`, `USAGE` on schema `public` to `app` and `USAGE, CREATE` to `migrator`, creates the two extensions as the admin user and asserts the locale.
5. **`pnpm db:migrate`** (`apps/api/src/db/migrate.ts`, `node dist/db/migrate.js` in the container entrypoint) runs as `migrator` under one advisory lock: drizzle `migrate()`, then the pg-boss CLI `migrate --schema pgboss`, then `GRANT USAGE` on schema `pgboss` and DML on its tables to `app`, then creates or updates every queue in the job registry. `drizzle-kit migrate` is not used; `drizzle-kit push` stays banned (ADR-0003).
6. **Runtime pg-boss uses `migrate: false`** with the `app` role; the api and the worker both `start()` it (sending needs a started instance), but only the worker runs maintenance (`supervise`) and cron (`schedule`).
7. **Tests: one database per Jest worker, cloned from a migrated template.** `globalSetup` provisions the roles, drops and recreates `${prefix}_${project}_tpl`, runs the same `runMigrations()` once, asserts the locale, then creates `_w1 … _wN` with `CREATE DATABASE … TEMPLATE` (N = Jest `maxWorkers`); database-level grants are re-applied to every clone. Each test file starts by truncating `public` tables and `pgboss.job`. The harness refuses any `TEST_ADMIN_DATABASE_URL` that is not a local host.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Create the inventory tables in week 1 to honour "migration 0001" literally | Builds inventory before identity and catalog, against the delivery order; the table design belongs to the inventory session. |
| Let the runtime `app` role install the pg-boss schema (`migrate: true`) | `app` would need `CREATE` on the database; the runtime role must have no DDL rights. |
| Migrate every per-worker test database separately | Slower and duplicates the migration run N times; a template clone is a file copy inside PostgreSQL. |
| Create roles inside a migration | A migration cannot create the role it runs as, and only the admin user may create roles on Managed PostgreSQL. |

## Consequences

**Positive.** The scaffold has working database guards infrastructure (locale assertion, default privileges, the append-only function) before any business table exists; the inventory session only attaches it. The runtime role never needs DDL. Test databases are created in seconds.

**Negative.** The pg-boss schema version moves with pg-boss minor releases, so every pg-boss upgrade must run `db:migrate` before the new image serves traffic (the entrypoint does this). Older ADR wording ("migration 0001") stays in place and must be read through this ADR.

**Follow-ups.**
- Week 3 (inventory): attach `forbid_update_delete()` to `stock_ledger` and add the guard-existence integrity test required by ADR-0003/ADR-0016.
- `docs/architecture.md` §5.3, §10.4 and §10.5 describe this bootstrap; ADR-0003, ADR-0007, ADR-0016 and ADR-0019 carry an "Amended by ADR-0024" line.

## Related

ADR-0003, ADR-0007, ADR-0013, ADR-0016, ADR-0019, `docs/architecture.md` §5.3, §10.4, §10.5.
