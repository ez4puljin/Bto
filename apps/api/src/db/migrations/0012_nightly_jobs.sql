ALTER TABLE "files" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "files_unpurged_idx" ON "files" USING btree ("id") WHERE "files"."status" = 'DELETED' AND "files"."purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purged" CHECK ("files"."purged_at" IS NULL OR "files"."status" = 'DELETED');--> statement-breakpoint

-- Snapshot partitions (D9, ADR-0040), added by hand. `app` cannot create or drop tables, so the
-- monthly job calls this function, which runs as its owner (migrator): it creates the missing
-- monthly partitions of both snapshot tables from this Ulaanbaatar month to 24 months ahead, each
-- refusing app DELETE and TRUNCATE like those of 0006, and drops the partitions of months more than
-- 13 months back. It takes no arguments, so a caller cannot widen what it drops; the inventory
-- service serialises callers with an advisory lock.
CREATE FUNCTION maintain_stock_snapshot_partitions(OUT created integer, OUT dropped integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  this_month date := date_trunc('month', now() AT TIME ZONE 'Asia/Ulaanbaatar')::date;
  oldest_kept date := (date_trunc('month', now() AT TIME ZONE 'Asia/Ulaanbaatar') - interval '13 months')::date;
  parent text;
  start_month date;
  partition_name text;
BEGIN
  created := 0;
  dropped := 0;
  FOREACH parent IN ARRAY ARRAY['stock_snapshot_daily', 'stock_snapshot_bin_monthly'] LOOP
    FOR i IN 0..24 LOOP
      start_month := (this_month + make_interval(months => i))::date;
      partition_name := parent || '_p' || to_char(start_month, 'YYYY_MM');
      IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
        EXECUTE format('CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
          partition_name, parent, start_month, (start_month + interval '1 month')::date);
        EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM app', partition_name);
        created := created + 1;
      END IF;
    END LOOP;
    FOR partition_name IN
      SELECT child.relname::text
        FROM pg_inherits
        JOIN pg_class child ON child.oid = pg_inherits.inhrelid
       WHERE pg_inherits.inhparent = format('public.%I', parent)::regclass
         AND CASE WHEN child.relname ~ '_p[0-9]{4}_[0-9]{2}$'
               THEN to_date(right(child.relname::text, 7), 'YYYY_MM') < oldest_kept
               ELSE false END
    LOOP
      EXECUTE format('DROP TABLE public.%I', partition_name);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION maintain_stock_snapshot_partitions() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION maintain_stock_snapshot_partitions() TO app;