-- 0000_foundation: hand-written foundation migration (delivery 1, week 1; ADR-0024). Runs as role "migrator".
-- It creates no roles and no business tables: roles, the UTF-8/ICU database and the database grants come
-- from `pnpm db:provision` (apps/api/src/db/provisioning.ts). Applied migrations are never edited.

-- 1. Extensions. db:provision already created them as the admin user, so these are no-ops there.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 2. Collation assertion (ADR-0003): also called by the test harness and by runbooks.
CREATE FUNCTION assert_unicode_casefold() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'locale assertion failed: server_encoding is %, expected UTF8',
      current_setting('server_encoding');
  END IF;
  IF lower('ӨҮЁ') <> 'өүё' OR upper('өүё') <> 'ӨҮЁ' THEN
    RAISE EXCEPTION 'locale assertion failed: the default collation does not case-fold Mongolian Cyrillic'
      USING HINT = 'Create the database with ENCODING UTF8 LOCALE_PROVIDER icu ICU_LOCALE und TEMPLATE template0 (pnpm db:provision).';
  END IF;
  RETURN true;
END $$;
--> statement-breakpoint
SELECT assert_unicode_casefold();
--> statement-breakpoint

-- 3. Generic append-only guard, attached by the migration of the module that owns the table.
--    Inventory (delivery 1, week 3) adds for example:
--      REVOKE UPDATE, DELETE ON stock_ledger FROM app;
--      CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON stock_ledger
--        FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--      CREATE TRIGGER stock_ledger_no_truncate BEFORE TRUNCATE ON stock_ledger
--        FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
CREATE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';  -- 23001, distinct from 42501 raised by a REVOKE
END $$;
--> statement-breakpoint

-- 4. Every table and sequence migrator creates from now on (any schema, including pgboss) is usable
--    by app for DML only. Append-only tables take UPDATE/DELETE back with an explicit REVOKE.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE migrator GRANT USAGE, SELECT ON SEQUENCES TO app;
