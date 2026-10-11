CREATE TABLE "adjustment_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustment_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"adjustment_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"entered_qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"lot_id" bigint,
	"bin_id" bigint NOT NULL,
	"unit_cost" numeric(14, 4),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_lines_qty" CHECK ("adjustment_lines"."entered_qty" > 0 AND "adjustment_lines"."qty_base" > 0),
	CONSTRAINT "adjustment_lines_cost" CHECK ("adjustment_lines"."unit_cost" IS NULL OR "adjustment_lines"."unit_cost" >= 0),
	CONSTRAINT "adjustment_lines_note" CHECK ("adjustment_lines"."note" IS NULL OR length("adjustment_lines"."note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" bigint,
	"number" text,
	"effective_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_number_key" UNIQUE("number"),
	CONSTRAINT "adjustments_reason" CHECK ("adjustments"."reason" IN ('DAMAGED', 'EXPIRED', 'SHORTAGE', 'SURPLUS', 'OPENING')),
	CONSTRAINT "adjustments_status" CHECK ("adjustments"."status" IN ('DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED')),
	CONSTRAINT "adjustments_posted" CHECK (("adjustments"."status" = 'POSTED') = ("adjustments"."number" IS NOT NULL AND "adjustments"."posted_at" IS NOT NULL
        AND "adjustments"."effective_date" IS NOT NULL)),
	CONSTRAINT "adjustments_note" CHECK ("adjustments"."note" IS NULL OR length("adjustments"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "bin_move_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bin_move_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"move_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"entered_qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"lot_id" bigint,
	"from_bin_id" bigint NOT NULL,
	"to_bin_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bin_move_lines_qty" CHECK ("bin_move_lines"."entered_qty" > 0 AND "bin_move_lines"."qty_base" > 0),
	CONSTRAINT "bin_move_lines_bins" CHECK ("bin_move_lines"."from_bin_id" <> "bin_move_lines"."to_bin_id")
);
--> statement-breakpoint
CREATE TABLE "bin_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bin_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"number" text,
	"effective_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bin_moves_number_key" UNIQUE("number"),
	CONSTRAINT "bin_moves_status" CHECK ("bin_moves"."status" IN ('DRAFT', 'POSTED')),
	CONSTRAINT "bin_moves_posted" CHECK (("bin_moves"."status" = 'POSTED') = ("bin_moves"."number" IS NOT NULL AND "bin_moves"."posted_at" IS NOT NULL
        AND "bin_moves"."effective_date" IS NOT NULL)),
	CONSTRAINT "bin_moves_note" CHECK ("bin_moves"."note" IS NULL OR length("bin_moves"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "bin_stock" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bin_stock_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"bin_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"lot_id" bigint,
	"on_hand" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bin_stock_key" UNIQUE NULLS NOT DISTINCT("warehouse_id","bin_id","product_id","lot_id"),
	CONSTRAINT "bin_stock_nonneg" CHECK ("bin_stock"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bins" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"type" text NOT NULL,
	"sellable" boolean GENERATED ALWAYS AS ("type" IN ('STORAGE', 'PICKING', 'SALESFLOOR')) STORED NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"locked_by_stocktake_id" bigint,
	"is_system" boolean DEFAULT false NOT NULL,
	"pick_sequence" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bins_warehouse_code_key" UNIQUE("warehouse_id","code"),
	CONSTRAINT "bins_warehouse_id_key" UNIQUE("warehouse_id","id"),
	CONSTRAINT "bins_code" CHECK (length("bins"."code") BETWEEN 1 AND 32 AND "bins"."code" ~ '^[A-Z0-9][A-Z0-9._/-]*$'),
	CONSTRAINT "bins_type" CHECK ("bins"."type" IN ('RECEIVING', 'STORAGE', 'PICKING', 'STAGING', 'SHIP', 'DAMAGED', 'RETURNS', 'SALESFLOOR', 'CARGO', 'TRANSIT')),
	CONSTRAINT "bins_system_type" CHECK ("bins"."is_system" = NOT ("bins"."type" IN ('STORAGE', 'PICKING'))),
	CONSTRAINT "bins_status" CHECK ("bins"."status" IN ('ACTIVE', 'COUNTING')),
	CONSTRAINT "bins_counting_lock" CHECK (("bins"."status" = 'COUNTING') = ("bins"."locked_by_stocktake_id" IS NOT NULL)),
	CONSTRAINT "bins_archived_idle" CHECK (NOT ("bins"."archived_at" IS NOT NULL AND "bins"."status" = 'COUNTING')),
	CONSTRAINT "bins_name" CHECK ("bins"."name" IS NULL OR length("bins"."name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_receipt_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"entered_qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"lot_id" bigint,
	"bin_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_lines_qty" CHECK ("goods_receipt_lines"."entered_qty" > 0 AND "goods_receipt_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"supplier_doc_no" text,
	"supplier_doc_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"costing_status" text,
	"costing_version" integer DEFAULT 0 NOT NULL,
	"costed_at" timestamp with time zone,
	"costed_by" bigint,
	"note" text,
	"number" text,
	"effective_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_number_key" UNIQUE("number"),
	CONSTRAINT "goods_receipts_status" CHECK ("goods_receipts"."status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
	CONSTRAINT "goods_receipts_posted" CHECK (("goods_receipts"."status" = 'POSTED') = ("goods_receipts"."number" IS NOT NULL AND "goods_receipts"."posted_at" IS NOT NULL
        AND "goods_receipts"."effective_date" IS NOT NULL AND "goods_receipts"."costing_status" IS NOT NULL)),
	CONSTRAINT "goods_receipts_costing" CHECK (("goods_receipts"."costing_status" IS NULL OR "goods_receipts"."costing_status" IN ('PENDING', 'COSTED'))
        AND "goods_receipts"."costing_version" >= 0
        AND ("goods_receipts"."costing_version" = 0) = ("goods_receipts"."costed_at" IS NULL)
        AND ("goods_receipts"."costing_status" = 'COSTED') = ("goods_receipts"."costing_version" > 0)),
	CONSTRAINT "goods_receipts_texts" CHECK (("goods_receipts"."supplier_doc_no" IS NULL OR length("goods_receipts"."supplier_doc_no") BETWEEN 1 AND 50)
        AND ("goods_receipts"."note" IS NULL OR length("goods_receipts"."note") BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"lot_no" text NOT NULL,
	"expiry_date" date,
	"supplier_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_product_lot_key" UNIQUE("product_id","lot_no"),
	CONSTRAINT "lots_lot_no" CHECK (length("lots"."lot_no") BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "product_locations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"is_home" boolean DEFAULT false NOT NULL,
	"default_bin_id" bigint,
	"min_qty" numeric(14, 3),
	"max_qty" numeric(14, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_locations_key" UNIQUE("warehouse_id","product_id"),
	CONSTRAINT "product_locations_levels" CHECK (("product_locations"."min_qty" IS NULL OR "product_locations"."min_qty" >= 0) AND ("product_locations"."max_qty" IS NULL OR "product_locations"."max_qty" >= 0)
        AND ("product_locations"."min_qty" IS NULL OR "product_locations"."max_qty" IS NULL OR "product_locations"."min_qty" <= "product_locations"."max_qty"))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"diff_count" integer NOT NULL,
	"diffs" jsonb NOT NULL,
	"triggered_by" text NOT NULL,
	CONSTRAINT "reconciliation_runs_status" CHECK ("reconciliation_runs"."status" IN ('OK', 'DRIFT')),
	CONSTRAINT "reconciliation_runs_count" CHECK ("reconciliation_runs"."diff_count" >= 0 AND ("reconciliation_runs"."status" = 'OK') = ("reconciliation_runs"."diff_count" = 0))
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_reservations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"lot_id" bigint,
	"doc_type" text NOT NULL,
	"doc_id" bigint NOT NULL,
	"doc_line_id" bigint NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_qty" CHECK ("stock_reservations"."qty_base" > 0),
	CONSTRAINT "stock_reservations_doc_type" CHECK ("stock_reservations"."doc_type" IN ('GR', 'BM', 'TR', 'ADJ', 'ST', 'PK', 'TRIP', 'SO', 'POS', 'CN')),
	CONSTRAINT "stock_reservations_status" CHECK ("stock_reservations"."status" IN ('ACTIVE', 'CONSUMED', 'RELEASED'))
);
--> statement-breakpoint
CREATE TABLE "stocktake_bins" (
	"stocktake_id" bigint NOT NULL,
	"bin_id" bigint NOT NULL,
	CONSTRAINT "stocktake_bins_key" UNIQUE("stocktake_id","bin_id")
);
--> statement-breakpoint
CREATE TABLE "stocktake_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stocktake_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stocktake_id" bigint NOT NULL,
	"bin_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"lot_id" bigint,
	"expected_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3),
	"unit_cost" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktake_lines_key" UNIQUE NULLS NOT DISTINCT("stocktake_id","bin_id","product_id","lot_id"),
	CONSTRAINT "stocktake_lines_qty" CHECK ("stocktake_lines"."expected_qty" >= 0 AND ("stocktake_lines"."counted_qty" IS NULL OR "stocktake_lines"."counted_qty" >= 0)
        AND ("stocktake_lines"."unit_cost" IS NULL OR "stocktake_lines"."unit_cost" >= 0))
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stocktakes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"started_at" timestamp with time zone,
	"started_by" bigint,
	"number" text,
	"effective_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktakes_number_key" UNIQUE("number"),
	CONSTRAINT "stocktakes_status" CHECK ("stocktakes"."status" IN ('DRAFT', 'COUNTING', 'REVIEW', 'APPROVED', 'CANCELLED')),
	CONSTRAINT "stocktakes_approved" CHECK (("stocktakes"."status" = 'APPROVED') = ("stocktakes"."number" IS NOT NULL AND "stocktakes"."posted_at" IS NOT NULL
        AND "stocktakes"."effective_date" IS NOT NULL)),
	CONSTRAINT "stocktakes_started" CHECK (("stocktakes"."status" <> 'DRAFT' OR "stocktakes"."started_at" IS NULL)
        AND ("stocktakes"."status" NOT IN ('COUNTING', 'REVIEW', 'APPROVED') OR "stocktakes"."started_at" IS NOT NULL)),
	CONSTRAINT "stocktakes_note" CHECK ("stocktakes"."note" IS NULL OR length("stocktakes"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "warehouse_stock" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "warehouse_stock_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"lot_id" bigint,
	"on_hand" numeric(14, 3) DEFAULT 0 NOT NULL,
	"sellable_on_hand" numeric(14, 3) DEFAULT 0 NOT NULL,
	"reserved" numeric(14, 3) DEFAULT 0 NOT NULL,
	"avg_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_stock_key" UNIQUE NULLS NOT DISTINCT("warehouse_id","product_id","lot_id"),
	CONSTRAINT "warehouse_stock_nonneg" CHECK ("warehouse_stock"."on_hand" >= 0 AND "warehouse_stock"."reserved" >= 0),
	CONSTRAINT "warehouse_stock_sellable" CHECK ("warehouse_stock"."sellable_on_hand" >= 0 AND "warehouse_stock"."sellable_on_hand" <= "warehouse_stock"."on_hand"),
	CONSTRAINT "warehouse_stock_avg_cost" CHECK ("warehouse_stock"."avg_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_adjustment_id_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_lines" ADD CONSTRAINT "adjustment_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_move_id_bin_moves_id_fk" FOREIGN KEY ("move_id") REFERENCES "public"."bin_moves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_from_bin_id_bins_id_fk" FOREIGN KEY ("from_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_move_lines" ADD CONSTRAINT "bin_move_lines_to_bin_id_bins_id_fk" FOREIGN KEY ("to_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_moves" ADD CONSTRAINT "bin_moves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_moves" ADD CONSTRAINT "bin_moves_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_moves" ADD CONSTRAINT "bin_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_bin_fk" FOREIGN KEY ("warehouse_id","bin_id") REFERENCES "public"."bins"("warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bins" ADD CONSTRAINT "bins_locked_by_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("locked_by_stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_costed_by_users_id_fk" FOREIGN KEY ("costed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_locations" ADD CONSTRAINT "product_locations_default_bin_fk" FOREIGN KEY ("warehouse_id","default_bin_id") REFERENCES "public"."bins"("warehouse_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_bins" ADD CONSTRAINT "stocktake_bins_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_bins" ADD CONSTRAINT "stocktake_bins_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_lines_adjustment_idx" ON "adjustment_lines" USING btree ("adjustment_id","id");--> statement-breakpoint
CREATE INDEX "adjustments_warehouse_idx" ON "adjustments" USING btree ("warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "bin_move_lines_move_idx" ON "bin_move_lines" USING btree ("move_id","id");--> statement-breakpoint
CREATE INDEX "bin_moves_warehouse_idx" ON "bin_moves" USING btree ("warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "bin_stock_product_idx" ON "bin_stock" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bins_one_system_type" ON "bins" USING btree ("warehouse_id","type") WHERE "bins"."is_system";--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines" USING btree ("receipt_id","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_warehouse_idx" ON "goods_receipts" USING btree ("warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_supplier_idx" ON "goods_receipts" USING btree ("supplier_id","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_costing_idx" ON "goods_receipts" USING btree ("id") WHERE "goods_receipts"."status" = 'POSTED' AND "goods_receipts"."costing_status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "product_locations_one_home" ON "product_locations" USING btree ("product_id") WHERE "product_locations"."is_home";--> statement-breakpoint
CREATE INDEX "product_locations_product_idx" ON "product_locations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_idx" ON "reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_active_key" ON "stock_reservations" USING btree ("doc_type","doc_line_id","lot_id") NULLS NOT DISTINCT WHERE "stock_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "stock_reservations_stock_idx" ON "stock_reservations" USING btree ("warehouse_id","product_id") WHERE "stock_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "stocktakes_warehouse_idx" ON "stocktakes" USING btree ("warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "warehouse_stock_product_idx" ON "warehouse_stock" USING btree ("product_id");

--> statement-breakpoint

-- Hand-written (ADR-0007, ADR-0019, ADR-0034): a bin keeps its warehouse, code, type and system flag
-- for life (a label is reprinted as a new bin); the code check keeps labels scannable.
CREATE FUNCTION bins_fixed_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.type IS DISTINCT FROM OLD.type OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'bins: warehouse, code, type and system flag never change (bin %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bins_fixed BEFORE UPDATE ON "bins" FOR EACH ROW EXECUTE FUNCTION bins_fixed_columns();
--> statement-breakpoint

-- Balance caches are updated in place on every posting: room for HOT updates.
ALTER TABLE "warehouse_stock" SET (fillfactor = 80);
--> statement-breakpoint
ALTER TABLE "bin_stock" SET (fillfactor = 80);
--> statement-breakpoint

-- Documents are cancelled, never deleted; balances and reservations change status or quantity, never
-- disappear. Draft lines of receipts, adjustments and stocktakes, bins never used and product
-- locations may be deleted (the services check the state).
REVOKE DELETE, TRUNCATE ON "goods_receipts", "bin_moves", "bin_move_lines", "adjustments", "stocktakes",
  "warehouse_stock", "bin_stock", "stock_reservations", "reconciliation_runs", "lots" FROM app;
