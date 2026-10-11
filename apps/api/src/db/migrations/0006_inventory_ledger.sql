-- Hand-written (ADR-0007, ADR-0033, ADR-0034, docs/architecture.md §5.3): the stock ledger, the costing
-- history of goods receipts and the monthly-partitioned snapshots. Their Drizzle objects live in
-- src/modules/inventory/ledger.schema.ts, which the schema aggregator does not export, so drizzle-kit
-- never generates or diffs these tables and ESLint G2 keeps the ledger inside stock-posting.service.ts.

CREATE TABLE "stock_ledger" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "posted_at" timestamp with time zone NOT NULL,
  "effective_date" date NOT NULL,
  "warehouse_id" bigint NOT NULL,
  "bin_id" bigint NOT NULL,
  "product_id" bigint NOT NULL REFERENCES "products" ("id"),
  "lot_id" bigint REFERENCES "lots" ("id"),
  "qty_base" numeric(14, 3) NOT NULL,
  "unit_cost" numeric(14, 4) NOT NULL,
  "movement_type" text NOT NULL,
  "doc_type" text NOT NULL,
  "doc_id" bigint NOT NULL,
  "doc_line_id" bigint NOT NULL,
  "leg" smallint NOT NULL,
  "entered_qty" numeric(14, 3) NOT NULL,
  "product_unit_id" bigint NOT NULL REFERENCES "product_units" ("id"),
  "factor_snapshot" numeric(18, 6) NOT NULL,
  "created_by" bigint REFERENCES "users" ("id"),
  CONSTRAINT "stock_ledger_bin_fk" FOREIGN KEY ("warehouse_id", "bin_id") REFERENCES "bins" ("warehouse_id", "id"),
  CONSTRAINT "stock_ledger_qty_nonzero" CHECK ("qty_base" <> 0),
  CONSTRAINT "stock_ledger_movement_type" CHECK ("movement_type" IN ('RECEIPT', 'PUTAWAY_OUT', 'PUTAWAY_IN',
    'BIN_MOVE_OUT', 'BIN_MOVE_IN', 'PICK_OUT', 'PICK_IN', 'DISPATCH_OUT', 'DISPATCH_IN', 'DELIVERY_ISSUE',
    'POS_SALE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_IN', 'ADJUSTMENT', 'COUNT_CORRECTION')),
  CONSTRAINT "stock_ledger_sign" CHECK (CASE
    WHEN "movement_type" IN ('RECEIPT', 'PUTAWAY_IN', 'BIN_MOVE_IN', 'PICK_IN', 'DISPATCH_IN', 'TRANSFER_IN',
      'RETURN_IN') THEN "qty_base" > 0
    WHEN "movement_type" IN ('PUTAWAY_OUT', 'BIN_MOVE_OUT', 'PICK_OUT', 'DISPATCH_OUT', 'DELIVERY_ISSUE',
      'POS_SALE', 'TRANSFER_OUT') THEN "qty_base" < 0
    ELSE true END),
  -- A pair posts leg 1 (out) and leg 2 (in); a transfer's receive posts legs 3 and 4 (ADR-0034).
  CONSTRAINT "stock_ledger_leg" CHECK (CASE
    WHEN "movement_type" = 'TRANSFER_OUT' THEN "leg" IN (1, 3)
    WHEN "movement_type" = 'TRANSFER_IN' THEN "leg" IN (2, 4)
    WHEN "movement_type" IN ('PUTAWAY_IN', 'BIN_MOVE_IN', 'PICK_IN', 'DISPATCH_IN') THEN "leg" = 2
    ELSE "leg" = 1 END),
  CONSTRAINT "stock_ledger_doc_type" CHECK ("doc_type" IN ('GR', 'BM', 'TR', 'ADJ', 'ST', 'PK', 'TRIP', 'SO',
    'POS', 'CN')),
  -- The base quantity is exactly what was entered times the factor of its unit (ADR-0008 #2).
  CONSTRAINT "stock_ledger_quantities" CHECK ("entered_qty" > 0 AND "factor_snapshot" > 0
    AND abs("qty_base") = "entered_qty" * "factor_snapshot"),
  CONSTRAINT "stock_ledger_unit_cost" CHECK ("unit_cost" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_ledger_idem" ON "stock_ledger" ("doc_type", "doc_line_id", "movement_type", "leg");
--> statement-breakpoint
CREATE INDEX "stock_ledger_product_idx" ON "stock_ledger" ("product_id", "id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_doc_idx" ON "stock_ledger" ("doc_type", "doc_id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_posted_brin" ON "stock_ledger" USING brin ("posted_at");
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "stock_ledger" FROM app;
--> statement-breakpoint
CREATE TRIGGER "stock_ledger_no_update_delete" BEFORE UPDATE OR DELETE ON "stock_ledger"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER "stock_ledger_no_truncate" BEFORE TRUNCATE ON "stock_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint

-- One row per goods-receipt line and costing version (ADR-0033): what the accountant entered and how
-- much of the price difference moved the average.
CREATE TABLE "stock_valuation_adjustments" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "posted_at" timestamp with time zone NOT NULL,
  "effective_date" date NOT NULL,
  "warehouse_id" bigint NOT NULL REFERENCES "warehouses" ("id"),
  "product_id" bigint NOT NULL REFERENCES "products" ("id"),
  "lot_id" bigint REFERENCES "lots" ("id"),
  "doc_type" text NOT NULL,
  "doc_id" bigint NOT NULL,
  "doc_line_id" bigint NOT NULL,
  "version" integer NOT NULL,
  "qty_base" numeric(14, 3) NOT NULL,
  "free_goods" boolean NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "value_before" numeric(14, 2) NOT NULL,
  "value_delta" numeric(14, 2) NOT NULL,
  "on_hand_at" numeric(14, 3) NOT NULL,
  "absorbed" numeric(14, 2) NOT NULL,
  "variance" numeric(14, 2) NOT NULL,
  "avg_before" numeric(14, 4) NOT NULL,
  "avg_after" numeric(14, 4) NOT NULL,
  "created_by" bigint REFERENCES "users" ("id"),
  CONSTRAINT "stock_valuation_adjustments_doc_type" CHECK ("doc_type" = 'GR'),
  CONSTRAINT "stock_valuation_adjustments_values" CHECK ("version" >= 1 AND "qty_base" > 0
    AND "amount" >= 0 AND "value_before" >= 0 AND "on_hand_at" >= 0 AND "avg_before" >= 0 AND "avg_after" >= 0
    AND (NOT "free_goods" OR "amount" = 0)
    AND "value_delta" = "amount" - "value_before"
    AND "absorbed" + "variance" = "value_delta")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_valuation_adjustments_version" ON "stock_valuation_adjustments" ("doc_type", "doc_line_id", "version");
--> statement-breakpoint
CREATE INDEX "stock_valuation_adjustments_product_idx" ON "stock_valuation_adjustments" ("product_id", "id");
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "stock_valuation_adjustments" FROM app;
--> statement-breakpoint
CREATE TRIGGER "stock_valuation_adjustments_no_update_delete" BEFORE UPDATE OR DELETE ON "stock_valuation_adjustments"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER "stock_valuation_adjustments_no_truncate" BEFORE TRUNCATE ON "stock_valuation_adjustments"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint

-- Snapshots (D9), partitioned by month from the start. `app` cannot create tables, so 24 months are
-- created here (2026-10 … 2028-09); a later migration or a migrator-owned function adds more.
CREATE TABLE "stock_snapshot_daily" (
  "snapshot_date" date NOT NULL,
  "warehouse_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "lot_id" bigint,
  "on_hand" numeric(14, 3) NOT NULL,
  "sellable_on_hand" numeric(14, 3) NOT NULL,
  "reserved" numeric(14, 3) NOT NULL,
  "avg_cost" numeric(14, 4) NOT NULL,
  CONSTRAINT "stock_snapshot_daily_key" UNIQUE NULLS NOT DISTINCT ("snapshot_date", "warehouse_id", "product_id", "lot_id")
) PARTITION BY RANGE ("snapshot_date");
--> statement-breakpoint
CREATE TABLE "stock_snapshot_bin_monthly" (
  "snapshot_date" date NOT NULL,
  "warehouse_id" bigint NOT NULL,
  "bin_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "lot_id" bigint,
  "on_hand" numeric(14, 3) NOT NULL,
  CONSTRAINT "stock_snapshot_bin_monthly_key" UNIQUE NULLS NOT DISTINCT ("snapshot_date", "warehouse_id", "bin_id", "product_id", "lot_id")
) PARTITION BY RANGE ("snapshot_date");
--> statement-breakpoint
DO $$
DECLARE
  start_month date;
  partition_name text;
BEGIN
  FOR i IN 0..23 LOOP
    start_month := (date '2026-10-01' + make_interval(months => i))::date;
    partition_name := 'stock_snapshot_daily_p' || to_char(start_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE %I PARTITION OF "stock_snapshot_daily" FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_month, (start_month + interval '1 month')::date);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM app', partition_name);
    partition_name := 'stock_snapshot_bin_monthly_p' || to_char(start_month, 'YYYY_MM');
    EXECUTE format('CREATE TABLE %I PARTITION OF "stock_snapshot_bin_monthly" FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_month, (start_month + interval '1 month')::date);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM app', partition_name);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "stock_snapshot_daily", "stock_snapshot_bin_monthly" FROM app;
