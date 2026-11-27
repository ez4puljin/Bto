CREATE TABLE "expiry_item_sources" (
	"item_id" bigint PRIMARY KEY NOT NULL,
	"receipt_line_id" bigint NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "expiry_item_sources_qty" CHECK ("expiry_item_sources"."qty_base" > 0 AND "expiry_item_sources"."qty_base" <> 'NaN'::numeric),
	CONSTRAINT "expiry_item_sources_version" CHECK ("expiry_item_sources"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "expiry_markdown_balances" (
	"markdown_id" bigint PRIMARY KEY NOT NULL,
	"qty_sold" numeric(14, 3) DEFAULT 0 NOT NULL,
	CONSTRAINT "expiry_markdown_balances_qty" CHECK ("expiry_markdown_balances"."qty_sold" >= 0 AND "expiry_markdown_balances"."qty_sold" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "expiry_markdown_stops" (
	"markdown_id" bigint PRIMARY KEY NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_by" bigint
);
--> statement-breakpoint
CREATE TABLE "expiry_markdowns" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_markdowns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" bigint NOT NULL,
	"revision" integer NOT NULL,
	"product_id" bigint NOT NULL,
	"expiry_date" date NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"receipt_line_id" bigint NOT NULL,
	"costing_version" integer NOT NULL,
	"receipt_qty_base" numeric(14, 3) NOT NULL,
	"accounting_amount" numeric(14, 2) NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"channel" text NOT NULL,
	"context_id" bigint NOT NULL,
	"qty_budget" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"payroll_month" text,
	"liable_users" jsonb NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	CONSTRAINT "expiry_markdowns_positive" CHECK ("expiry_markdowns"."revision" > 0 AND "expiry_markdowns"."costing_version" > 0 AND "expiry_markdowns"."context_id" > 0 AND "expiry_markdowns"."qty_budget" > 0 AND "expiry_markdowns"."receipt_qty_base" > 0 AND "expiry_markdowns"."unit_price" > 0 AND "expiry_markdowns"."accounting_amount" >= 0 AND "expiry_markdowns"."qty_budget" <> 'NaN'::numeric AND "expiry_markdowns"."receipt_qty_base" <> 'NaN'::numeric AND "expiry_markdowns"."unit_price" <> 'NaN'::numeric AND "expiry_markdowns"."accounting_amount" <> 'NaN'::numeric),
	CONSTRAINT "expiry_markdowns_channel" CHECK ("expiry_markdowns"."channel" IN ('RETAIL','WHOLESALE')),
	CONSTRAINT "expiry_markdowns_month" CHECK ("expiry_markdowns"."payroll_month" IS NULL OR "expiry_markdowns"."payroll_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "expiry_markdowns_users" CHECK (jsonb_typeof("expiry_markdowns"."liable_users") = 'array')
);
--> statement-breakpoint
CREATE TABLE "expiry_return_allocations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_return_allocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sale_allocation_id" bigint NOT NULL,
	"source_key" text NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"loss_amount" numeric(14, 2) NOT NULL,
	"shares" jsonb NOT NULL,
	"returned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expiry_return_allocations_values" CHECK ("expiry_return_allocations"."qty_base" > 0 AND "expiry_return_allocations"."loss_amount" >= 0 AND "expiry_return_allocations"."qty_base" <> 'NaN'::numeric AND "expiry_return_allocations"."loss_amount" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "expiry_sale_allocations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_sale_allocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"markdown_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"sale_id" text NOT NULL,
	"line_id" text NOT NULL,
	"source_key" text NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"cost_amount" numeric(14, 2) NOT NULL,
	"revenue_amount" numeric(14, 2) NOT NULL,
	"loss_amount" numeric(14, 2) NOT NULL,
	"shares" jsonb NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input" jsonb NOT NULL,
	CONSTRAINT "expiry_sale_allocations_kind" CHECK ("expiry_sale_allocations"."source_kind" IN ('POS','WHOLESALE')),
	CONSTRAINT "expiry_sale_allocations_values" CHECK ("expiry_sale_allocations"."qty_base" > 0 AND "expiry_sale_allocations"."cost_amount" >= 0 AND "expiry_sale_allocations"."revenue_amount" >= 0 AND "expiry_sale_allocations"."loss_amount" >= 0 AND "expiry_sale_allocations"."qty_base" <> 'NaN'::numeric AND "expiry_sale_allocations"."cost_amount" <> 'NaN'::numeric AND "expiry_sale_allocations"."revenue_amount" <> 'NaN'::numeric AND "expiry_sale_allocations"."loss_amount" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "expiry_sale_exceptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_sale_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"markdown_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"sale_id" text NOT NULL,
	"line_id" text NOT NULL,
	"reason" text NOT NULL,
	"input" jsonb NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" bigint,
	"resolution_note" text,
	CONSTRAINT "expiry_sale_exceptions_kind" CHECK ("expiry_sale_exceptions"."source_kind" IN ('POS','WHOLESALE')),
	CONSTRAINT "expiry_sale_exceptions_resolution" CHECK (("expiry_sale_exceptions"."resolved_at" IS NULL) = ("expiry_sale_exceptions"."resolution_note" IS NULL)),
	CONSTRAINT "expiry_sale_exceptions_qty" CHECK ("expiry_sale_exceptions"."qty_base" > 0 AND "expiry_sale_exceptions"."qty_base" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "payroll_source_deductions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_source_deductions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_kind" text NOT NULL,
	"source_key" text NOT NULL,
	"source_reference" text NOT NULL,
	"user_id" bigint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"requested_month" text,
	"assigned_month" text,
	"reverses_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" bigint,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_source_deductions_kind" CHECK ("payroll_source_deductions"."source_kind" IN ('EXPIRY_SALE', 'EXPIRY_RETURN')),
	CONSTRAINT "payroll_source_deductions_keys" CHECK (length(btrim("payroll_source_deductions"."source_key")) BETWEEN 1 AND 160 AND length(btrim("payroll_source_deductions"."source_reference")) BETWEEN 1 AND 160),
	CONSTRAINT "payroll_source_deductions_month" CHECK (("payroll_source_deductions"."requested_month" IS NULL OR "payroll_source_deductions"."requested_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') AND ("payroll_source_deductions"."assigned_month" IS NULL OR "payroll_source_deductions"."assigned_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')),
	CONSTRAINT "payroll_source_deductions_signed" CHECK ("payroll_source_deductions"."amount" <> 'NaN'::numeric AND (("payroll_source_deductions"."source_kind" = 'EXPIRY_SALE' AND "payroll_source_deductions"."amount" >= 0 AND "payroll_source_deductions"."reverses_id" IS NULL) OR ("payroll_source_deductions"."source_kind" = 'EXPIRY_RETURN' AND "payroll_source_deductions"."amount" <= 0 AND "payroll_source_deductions"."reverses_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "payroll_source_settlements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_source_settlements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deduction_id" bigint NOT NULL,
	"run_id" bigint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" bigint,
	"released_at" timestamp with time zone,
	CONSTRAINT "payroll_source_settlements_finite" CHECK ("payroll_source_settlements"."amount" <> 'NaN'::numeric)
);
--> statement-breakpoint
ALTER TABLE "pos_sale_lines" ADD COLUMN "expiry_barcode" text;--> statement-breakpoint
ALTER TABLE "pos_sale_lines" ADD COLUMN "expiry_exception" text;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD COLUMN "expiry_barcode" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "expiry_barcode" text;--> statement-breakpoint
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdown_balances" ADD CONSTRAINT "expiry_markdown_balances_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdown_stops" ADD CONSTRAINT "expiry_markdown_stops_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdown_stops" ADD CONSTRAINT "expiry_markdown_stops_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_return_allocations" ADD CONSTRAINT "expiry_return_allocations_sale_allocation_id_expiry_sale_allocations_id_fk" FOREIGN KEY ("sale_allocation_id") REFERENCES "public"."expiry_sale_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_sale_allocations" ADD CONSTRAINT "expiry_sale_allocations_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_sale_exceptions" ADD CONSTRAINT "expiry_sale_exceptions_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_sale_exceptions" ADD CONSTRAINT "expiry_sale_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_reverses_id_payroll_source_deductions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payroll_source_deductions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_deduction_id_payroll_source_deductions_id_fk" FOREIGN KEY ("deduction_id") REFERENCES "public"."payroll_source_deductions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_markdowns_revision_key" ON "expiry_markdowns" USING btree ("item_id","revision");--> statement-breakpoint
CREATE INDEX "expiry_markdowns_receipt_idx" ON "expiry_markdowns" USING btree ("receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_return_allocations_source_key" ON "expiry_return_allocations" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_sale_allocations_source_key" ON "expiry_sale_allocations" USING btree ("source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_sale_allocations_line_key" ON "expiry_sale_allocations" USING btree ("source_kind","sale_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_sale_exceptions_line_key" ON "expiry_sale_exceptions" USING btree ("source_kind","sale_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_source_deductions_source_user_key" ON "payroll_source_deductions" USING btree ("source_kind","source_key","user_id");--> statement-breakpoint
CREATE INDEX "payroll_source_deductions_month_user_idx" ON "payroll_source_deductions" USING btree ("assigned_month","user_id");--> statement-breakpoint
CREATE INDEX "payroll_source_deductions_reverses_idx" ON "payroll_source_deductions" USING btree ("reverses_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_source_settlements_active_key" ON "payroll_source_settlements" USING btree ("deduction_id") WHERE "payroll_source_settlements"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payroll_source_settlements_run_idx" ON "payroll_source_settlements" USING btree ("run_id");--> statement-breakpoint

-- Internal Code128 namespace: a normal catalogue lookup must never sell an expiry label as fresh.
ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_expiry_namespace
CHECK (upper(code) NOT LIKE 'BTOEXP-%') NOT VALID;--> statement-breakpoint
ALTER TABLE expiry_items ADD CONSTRAINT expiry_items_finite_quantities
CHECK (qty_floor <> 'NaN'::numeric AND qty_warehouse <> 'NaN'::numeric) NOT VALID;--> statement-breakpoint

CREATE FUNCTION expiry_commerce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'expiry commercial history is immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_markdowns_immutable BEFORE UPDATE OR DELETE ON expiry_markdowns
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_markdown_stops_immutable BEFORE UPDATE OR DELETE ON expiry_markdown_stops
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_sale_allocations_immutable BEFORE UPDATE OR DELETE ON expiry_sale_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_return_allocations_immutable BEFORE UPDATE OR DELETE ON expiry_return_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_markdowns_no_truncate BEFORE TRUNCATE ON expiry_markdowns
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_markdown_stops_no_truncate BEFORE TRUNCATE ON expiry_markdown_stops
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_sale_allocations_no_truncate BEFORE TRUNCATE ON expiry_sale_allocations
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
CREATE TRIGGER expiry_return_allocations_no_truncate BEFORE TRUNCATE ON expiry_return_allocations
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON expiry_markdowns, expiry_markdown_stops,
  expiry_sale_allocations, expiry_return_allocations FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON expiry_item_sources, expiry_markdown_balances, expiry_sale_exceptions FROM app;--> statement-breakpoint

CREATE FUNCTION expiry_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item expiry_items%ROWTYPE; source goods_receipt_lines%ROWTYPE; reserved numeric;
BEGIN
  SELECT * INTO STRICT item FROM expiry_items WHERE id=NEW.item_id FOR UPDATE;
  SELECT * INTO STRICT source FROM goods_receipt_lines WHERE id=NEW.receipt_line_id;
  PERFORM 1 FROM goods_receipts WHERE id=source.receipt_id AND status='POSTED' AND costing_version>0 FOR UPDATE;
  IF NOT FOUND OR item.product_id<>source.product_id OR NEW.qty_base>source.qty_base
     OR NEW.qty_base>item.qty_floor+item.qty_warehouse THEN
    RAISE EXCEPTION 'expiry requires a real posted costed product source and supported quantity' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.item_id<>OLD.item_id OR NEW.version<>OLD.version+1
    OR EXISTS(SELECT 1 FROM expiry_markdowns WHERE item_id=OLD.item_id)) THEN
    RAISE EXCEPTION 'published expiry provenance is frozen' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(qty_base),0) INTO reserved FROM expiry_item_sources
   WHERE receipt_line_id=NEW.receipt_line_id AND item_id<>NEW.item_id;
  IF reserved+NEW.qty_base>source.qty_base THEN
    RAISE EXCEPTION 'receipt quantity already assigned to expiry records' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_source_guard BEFORE INSERT OR UPDATE ON expiry_item_sources
FOR EACH ROW EXECUTE FUNCTION expiry_source_guard();--> statement-breakpoint

CREATE FUNCTION expiry_markdown_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item expiry_items%ROWTYPE; source expiry_item_sources%ROWTYPE; line goods_receipt_lines%ROWTYPE;
        valuation stock_valuation_adjustments%ROWTYPE; committed numeric;
BEGIN
  SELECT * INTO STRICT item FROM expiry_items WHERE id=NEW.item_id FOR UPDATE;
  SELECT * INTO STRICT source FROM expiry_item_sources WHERE item_id=NEW.item_id;
  SELECT * INTO STRICT line FROM goods_receipt_lines WHERE id=NEW.receipt_line_id;
  PERFORM 1 FROM goods_receipts WHERE id=line.receipt_id FOR UPDATE;
  SELECT * INTO valuation FROM stock_valuation_adjustments WHERE doc_type='GR' AND doc_id=line.receipt_id AND doc_line_id=line.id ORDER BY version DESC LIMIT 1;
  IF item.status='ARCHIVED' OR source.receipt_line_id<>NEW.receipt_line_id OR item.product_id<>NEW.product_id
    OR NEW.expiry_date<>item.expiry_date OR NEW.receipt_qty_base<>line.qty_base
    OR valuation.id IS NULL OR NEW.costing_version<>valuation.version OR NEW.accounting_amount<>valuation.amount
    OR NOT EXISTS(SELECT 1 FROM product_units WHERE id=NEW.product_unit_id AND product_id=item.product_id AND is_base) THEN
    RAISE EXCEPTION 'expiry approval source snapshot does not match authoritative provenance' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(CASE WHEN s.markdown_id IS NULL THEN m.qty_budget ELSE b.qty_sold END),0)
    INTO committed FROM expiry_markdowns m JOIN expiry_markdown_balances b ON b.markdown_id=m.id
    LEFT JOIN expiry_markdown_stops s ON s.markdown_id=m.id WHERE m.item_id=NEW.item_id;
  IF committed+NEW.qty_budget>least(source.qty_base,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry approval exceeds observed or source quantity' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.liable_users) u
    WHERE jsonb_typeof(u)<>'object' OR NOT EXISTS(SELECT 1 FROM users WHERE id=(u->>'id')::bigint AND status='ACTIVE'))
    OR (SELECT count(*) FROM jsonb_array_elements(NEW.liable_users)) <>
       (SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(NEW.liable_users) u) THEN
    RAISE EXCEPTION 'expiry liable users must be active and deduplicated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_markdown_guard BEFORE INSERT ON expiry_markdowns
FOR EACH ROW EXECUTE FUNCTION expiry_markdown_guard();--> statement-breakpoint

CREATE FUNCTION expiry_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved expiry_markdowns%ROWTYPE; item expiry_items%ROWTYPE; source_qty numeric; other_sold numeric; actual numeric;
BEGIN
  SELECT * INTO STRICT approved FROM expiry_markdowns WHERE id=NEW.markdown_id;
  SELECT * INTO STRICT item FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  IF TG_OP='UPDATE' AND NEW.markdown_id<>OLD.markdown_id THEN
    RAISE EXCEPTION 'expiry budget identity is immutable' USING ERRCODE='23514';
  END IF;
  SELECT qty_base INTO STRICT source_qty FROM expiry_item_sources WHERE item_id=approved.item_id;
  SELECT coalesce(sum(b.qty_sold),0) INTO other_sold FROM expiry_markdown_balances b
    JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=approved.item_id AND m.id<>NEW.markdown_id;
  SELECT coalesce((SELECT sum(qty_base) FROM expiry_sale_allocations WHERE markdown_id=NEW.markdown_id),0)
    - coalesce((SELECT sum(r.qty_base) FROM expiry_return_allocations r JOIN expiry_sale_allocations s ON s.id=r.sale_allocation_id WHERE s.markdown_id=NEW.markdown_id),0) INTO actual;
  IF NEW.qty_sold<>actual OR NEW.qty_sold>approved.qty_budget OR other_sold+NEW.qty_sold>least(source_qty,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry budget must equal finalized allocations within proven units' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_balance_guard BEFORE INSERT OR UPDATE ON expiry_markdown_balances
FOR EACH ROW EXECUTE FUNCTION expiry_balance_guard();--> statement-breakpoint

CREATE FUNCTION expiry_sale_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved expiry_markdowns%ROWTYPE; split_total numeric;
BEGIN
  SELECT * INTO STRICT approved FROM expiry_markdowns WHERE id=NEW.markdown_id;
  PERFORM 1 FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  SELECT coalesce(sum((s->>'amount')::numeric),0) INTO split_total FROM jsonb_array_elements(NEW.shares) s;
  IF NEW.cost_amount<>round(approved.accounting_amount*NEW.qty_base/approved.receipt_qty_base,2)
    OR NEW.loss_amount<>greatest(0,NEW.cost_amount-NEW.revenue_amount) OR split_total<>NEW.loss_amount THEN
    RAISE EXCEPTION 'expiry loss must follow frozen acquisition cost and actual sale revenue' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.shares) s WHERE (s->>'amount')::numeric<0 OR NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(approved.liable_users) u WHERE u->>'id'=s->>'userId')) THEN
    RAISE EXCEPTION 'expiry sale shares require frozen liable users' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_sale_allocation_guard BEFORE INSERT ON expiry_sale_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_sale_allocation_guard();--> statement-breakpoint

CREATE FUNCTION expiry_return_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original expiry_sale_allocations%ROWTYPE; returned numeric; split_total numeric; original_share jsonb; expected numeric; actual numeric; owner_item bigint;
BEGIN
  SELECT m.item_id INTO STRICT owner_item FROM expiry_sale_allocations s JOIN expiry_markdowns m ON m.id=s.markdown_id WHERE s.id=NEW.sale_allocation_id;
  PERFORM 1 FROM expiry_items WHERE id=owner_item FOR UPDATE;
  -- The mutable parent gate above serializes every return, including direct app-role inserts.
  -- Original allocations are immutable; row-locking them would require the UPDATE privilege
  -- deliberately revoked from app. Read their frozen facts without widening that privilege.
  SELECT * INTO STRICT original FROM expiry_sale_allocations WHERE id=NEW.sale_allocation_id;
  SELECT coalesce(sum(qty_base),0) INTO returned FROM expiry_return_allocations WHERE sale_allocation_id=original.id;
  SELECT coalesce(-sum((s->>'amount')::numeric),0) INTO split_total FROM jsonb_array_elements(NEW.shares) s;
  IF returned+NEW.qty_base>original.qty_base OR split_total<>NEW.loss_amount OR jsonb_array_length(NEW.shares)<>jsonb_array_length(original.shares) THEN
    RAISE EXCEPTION 'expiry return exceeds the original allocation' USING ERRCODE='23514';
  END IF;
  FOR original_share IN SELECT * FROM jsonb_array_elements(original.shares) LOOP
    expected := round((original_share->>'amount')::numeric*(returned+NEW.qty_base)/original.qty_base,2)
               - round((original_share->>'amount')::numeric*returned/original.qty_base,2);
    SELECT -(s->>'amount')::numeric INTO actual FROM jsonb_array_elements(NEW.shares) s WHERE s->>'userId'=original_share->>'userId';
    IF actual IS NULL OR actual<>expected THEN
      RAISE EXCEPTION 'expiry return must reverse each original employee share cumulatively' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_return_allocation_guard BEFORE INSERT ON expiry_return_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_return_allocation_guard();--> statement-breakpoint

-- Evidence and its budget cache must commit together. A correct-looking standalone INSERT is
-- insufficient: the deferred guard sees the final transaction after the service updates balance.
CREATE FUNCTION expiry_allocation_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_markdown_id bigint; approved expiry_markdowns%ROWTYPE; item expiry_items%ROWTYPE;
        actual numeric; cached numeric; source_qty numeric; global_sold numeric;
BEGIN
  IF TG_TABLE_NAME='expiry_sale_allocations' THEN target_markdown_id:=NEW.markdown_id;
  ELSE SELECT s.markdown_id INTO STRICT target_markdown_id FROM expiry_sale_allocations s WHERE s.id=NEW.sale_allocation_id;
  END IF;
  SELECT * INTO STRICT approved FROM expiry_markdowns m WHERE m.id=target_markdown_id;
  SELECT * INTO STRICT item FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  SELECT b.qty_sold INTO cached FROM expiry_markdown_balances b WHERE b.markdown_id=target_markdown_id;
  SELECT coalesce((SELECT sum(s.qty_base) FROM expiry_sale_allocations s WHERE s.markdown_id=target_markdown_id),0)
    -coalesce((SELECT sum(r.qty_base) FROM expiry_return_allocations r JOIN expiry_sale_allocations s ON s.id=r.sale_allocation_id WHERE s.markdown_id=target_markdown_id),0) INTO actual;
  SELECT src.qty_base INTO STRICT source_qty FROM expiry_item_sources src WHERE src.item_id=approved.item_id;
  SELECT coalesce(sum(b.qty_sold),0) INTO global_sold FROM expiry_markdown_balances b JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=approved.item_id;
  IF cached IS NULL OR cached<>actual OR actual<0 OR actual>approved.qty_budget OR global_sold>least(source_qty,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry allocation and bounded budget must commit atomically' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expiry_sale_allocation_consistency AFTER INSERT ON expiry_sale_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expiry_allocation_consistency();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expiry_return_allocation_consistency AFTER INSERT ON expiry_return_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expiry_allocation_consistency();--> statement-breakpoint

CREATE FUNCTION expiry_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['resolved_at','resolved_by','resolution_note']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['resolved_at','resolved_by','resolution_note']) OR NEW.resolved_at IS NULL
    OR NEW.resolved_by IS NULL OR length(btrim(NEW.resolution_note)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'expiry exception facts are immutable; only explicit no-charge resolution is allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_exception_guard BEFORE UPDATE ON expiry_sale_exceptions
FOR EACH ROW EXECUTE FUNCTION expiry_exception_guard();--> statement-breakpoint

CREATE FUNCTION expiry_count_commerce_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sold numeric;
BEGIN
  SELECT coalesce(sum(b.qty_sold),0) INTO sold FROM expiry_markdown_balances b
    JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=NEW.id;
  IF NEW.qty_floor+NEW.qty_warehouse<sold THEN
    RAISE EXCEPTION 'expiry observation cannot fall below already finalized sold units' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER expiry_count_commerce_guard BEFORE UPDATE OF qty_floor,qty_warehouse ON expiry_items
FOR EACH ROW EXECUTE FUNCTION expiry_count_commerce_guard();

--> statement-breakpoint
-- Payroll source persistence/approval guards (append to 0129 after generated tables).
REVOKE DELETE, TRUNCATE ON payroll_source_deductions, payroll_source_settlements FROM app;

CREATE FUNCTION payroll_source_deductions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original payroll_source_deductions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.source_kind, NEW.source_key, NEW.source_reference, NEW.user_id, NEW.amount, NEW.requested_month, NEW.reverses_id, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.source_kind, OLD.source_key, OLD.source_reference, OLD.user_id, OLD.amount, OLD.requested_month, OLD.reverses_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'payroll source identity and allocation are immutable' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM payroll_source_settlements WHERE deduction_id = OLD.id AND released_at IS NULL) THEN
      RAISE EXCEPTION 'a settled payroll source is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_month IS NOT NULL AND EXISTS (SELECT 1 FROM payroll_runs WHERE month = NEW.assigned_month AND status = 'APPROVED') THEN
      RAISE EXCEPTION 'an approved payroll month cannot receive a source assignment' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_kind = 'EXPIRY_RETURN' THEN
    SELECT * INTO original FROM payroll_source_deductions WHERE id = NEW.reverses_id FOR UPDATE;
    IF NOT FOUND OR original.source_kind <> 'EXPIRY_SALE' OR original.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'a return must reverse its original employee allocation' USING ERRCODE = '23514';
    END IF;
    IF original.amount + COALESCE((SELECT sum(amount) FROM payroll_source_deductions WHERE reverses_id = original.id), 0) + NEW.amount < 0 THEN
      RAISE EXCEPTION 'a source allocation cannot be over-reversed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_source_deductions_guard BEFORE INSERT OR UPDATE ON payroll_source_deductions FOR EACH ROW EXECUTE FUNCTION payroll_source_deductions_guard();

CREATE FUNCTION payroll_source_settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source payroll_source_deductions%ROWTYPE;
DECLARE run payroll_runs%ROWTYPE;
BEGIN
  SELECT * INTO run FROM payroll_runs WHERE id = NEW.run_id;
  IF run.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'payroll source settlement requires a draft run' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.deduction_id, NEW.run_id, NEW.amount, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.deduction_id, OLD.run_id, OLD.amount, OLD.created_by, OLD.created_at)
       OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'payroll settlement history is immutable except one authorized release' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO source FROM payroll_source_deductions WHERE id = NEW.deduction_id;
    IF NOT FOUND OR NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL
       OR source.assigned_month IS DISTINCT FROM run.month OR NEW.amount IS DISTINCT FROM source.amount
       OR NOT EXISTS (SELECT 1 FROM payroll_lines WHERE run_id = run.id AND user_id = source.user_id) THEN
      RAISE EXCEPTION 'payroll settlement must match its source and eligible line' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_source_settlements_guard BEFORE INSERT OR UPDATE ON payroll_source_settlements FOR EACH ROW EXECUTE FUNCTION payroll_source_settlements_guard();

--> statement-breakpoint
-- POS facts deliberately have no expiry-item/markdown FK: missing provenance must be recorded.
CREATE TABLE expiry_pos_exceptions (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  operation text NOT NULL,
  document_id text NOT NULL,
  line_id text NOT NULL,
  original_sale_id text,
  original_line_id text,
  barcode text NOT NULL,
  product_id bigint NOT NULL,
  product_unit_id bigint NOT NULL,
  warehouse_id bigint NOT NULL,
  context_id bigint NOT NULL,
  code text NOT NULL,
  qty_base numeric(14,3) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by bigint REFERENCES users(id),
  acknowledgement_note text,
  CONSTRAINT expiry_pos_exceptions_operation CHECK (operation IN ('SALE','RETURN')),
  CONSTRAINT expiry_pos_exceptions_source CHECK (
    (operation='SALE' AND original_sale_id IS NULL AND original_line_id IS NULL) OR
    (operation='RETURN' AND original_sale_id IS NOT NULL AND original_line_id IS NOT NULL AND length(original_sale_id) BETWEEN 1 AND 160 AND length(original_line_id) BETWEEN 1 AND 160)),
  CONSTRAINT expiry_pos_exceptions_facts CHECK (
    length(document_id) BETWEEN 1 AND 160 AND length(line_id) BETWEEN 1 AND 160
    AND length(barcode) BETWEEN 1 AND 200 AND code ~ '^[A-Z][A-Z0-9_]{0,99}$'
    AND product_id > 0 AND product_unit_id > 0 AND warehouse_id > 0 AND context_id > 0
    AND qty_base > 0 AND qty_base <> 'NaN'::numeric),
  CONSTRAINT expiry_pos_exceptions_acknowledgement CHECK (
    (acknowledged_at IS NULL AND acknowledged_by IS NULL AND acknowledgement_note IS NULL) OR
    (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL AND acknowledgement_note IS NOT NULL AND length(btrim(acknowledgement_note)) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX expiry_pos_exceptions_line_key ON expiry_pos_exceptions(operation,document_id,line_id);
--> statement-breakpoint
CREATE INDEX expiry_pos_exceptions_created_idx ON expiry_pos_exceptions(created_at,id);
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON expiry_pos_exceptions FROM app;
--> statement-breakpoint
GRANT SELECT, INSERT ON expiry_pos_exceptions TO app;
--> statement-breakpoint
GRANT UPDATE (acknowledged_at, acknowledged_by, acknowledgement_note) ON expiry_pos_exceptions TO app;
--> statement-breakpoint
CREATE FUNCTION expiry_pos_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.acknowledged_at IS NOT NULL OR NEW.acknowledged_by IS NOT NULL OR NEW.acknowledgement_note IS NOT NULL THEN
      RAISE EXCEPTION 'a new POS expiry exception must remain unacknowledged' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.acknowledged_at IS NOT NULL OR NEW.acknowledged_at IS NULL
    OR NEW.acknowledged_by IS NULL OR NEW.acknowledgement_note IS NULL
    OR length(btrim(NEW.acknowledgement_note)) NOT BETWEEN 1 AND 500
    OR (to_jsonb(NEW)-ARRAY['acknowledged_at','acknowledged_by','acknowledgement_note']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['acknowledged_at','acknowledged_by','acknowledgement_note']) THEN
    RAISE EXCEPTION 'POS expiry facts are immutable; one acknowledgement changes no financial allocation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expiry_pos_exception_guard BEFORE INSERT OR UPDATE ON expiry_pos_exceptions
FOR EACH ROW EXECUTE FUNCTION expiry_pos_exception_guard();
