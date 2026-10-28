CREATE TABLE "goods_receipt_confirmations" (
	"receipt_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"confirmed_by" bigint,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_confirmations_receipt_id_warehouse_id_pk" PRIMARY KEY("receipt_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_supplier_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_key" UNIQUE("order_supplier_id","product_id"),
	CONSTRAINT "purchase_order_lines_qty" CHECK ("purchase_order_lines"."qty" > 0 AND "purchase_order_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"status" text DEFAULT 'PREPARING' NOT NULL,
	"receipt_id" bigint,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_suppliers_key" UNIQUE("order_id","supplier_id"),
	CONSTRAINT "purchase_order_suppliers_receipt_key" UNIQUE("receipt_id"),
	CONSTRAINT "purchase_order_suppliers_status" CHECK ("purchase_order_suppliers"."status" IN ('PREPARING', 'SENT', 'IN_TRANSIT', 'ARRIVED', 'ACCOUNTING', 'RECEIVED')),
	CONSTRAINT "purchase_order_suppliers_receipt" CHECK (("purchase_order_suppliers"."receipt_id" IS NOT NULL) = ("purchase_order_suppliers"."status" IN ('ARRIVED', 'ACCOUNTING', 'RECEIVED')))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" text NOT NULL,
	"order_date" date NOT NULL,
	"note" text,
	"status" text DEFAULT 'PREPARING' NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_key" UNIQUE("number"),
	CONSTRAINT "purchase_orders_status" CHECK ("purchase_orders"."status" IN ('PREPARING', 'SENT', 'IN_TRANSIT', 'ARRIVED', 'ACCOUNTING', 'RECEIVED')),
	CONSTRAINT "purchase_orders_note" CHECK ("purchase_orders"."note" IS NULL OR length("purchase_orders"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "supplier_orderers" (
	"supplier_id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" DROP CONSTRAINT "goods_receipt_lines_qty";--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "expected_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "note_total_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "note_total_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "note_photo_file_id" bigint;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "origin" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "origin_ref" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_confirmations" ADD CONSTRAINT "goods_receipt_confirmations_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_confirmations" ADD CONSTRAINT "goods_receipt_confirmations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_confirmations" ADD CONSTRAINT "goods_receipt_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_supplier_id_purchase_order_suppliers_id_fk" FOREIGN KEY ("order_supplier_id") REFERENCES "public"."purchase_order_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orderers" ADD CONSTRAINT "supplier_orderers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orderers" ADD CONSTRAINT "supplier_orderers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orderers" ADD CONSTRAINT "supplier_orderers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_product_idx" ON "purchase_order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_order_suppliers_supplier_idx" ON "purchase_order_suppliers" USING btree ("supplier_id","order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "supplier_orderers_user_idx" ON "supplier_orderers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_note_photo_file_id_files_id_fk" FOREIGN KEY ("note_photo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_qty" CHECK ("goods_receipt_lines"."entered_qty" >= 0 AND "goods_receipt_lines"."qty_base" >= 0 AND ("goods_receipt_lines"."entered_qty" = 0) = ("goods_receipt_lines"."qty_base" = 0)
        AND ("goods_receipt_lines"."entered_qty" > 0 OR "goods_receipt_lines"."expected_qty" IS NOT NULL)
        AND ("goods_receipt_lines"."expected_qty" IS NULL OR "goods_receipt_lines"."expected_qty" > 0));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_origin" CHECK ("goods_receipts"."origin" IN ('MANUAL', 'IMPORT', 'ORDER'));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_note_totals" CHECK (("goods_receipts"."note_total_qty" IS NULL OR "goods_receipts"."note_total_qty" >= 0)
        AND ("goods_receipts"."note_total_amount" IS NULL OR "goods_receipts"."note_total_amount" >= 0)
        AND ("goods_receipts"."origin_ref" IS NULL OR length("goods_receipts"."origin_ref") BETWEEN 1 AND 50));--> statement-breakpoint
-- Hand-written (ADR-0115): lines entered before this migration were checked when entered.
UPDATE "goods_receipt_lines" SET "checked_at" = "created_at" WHERE "checked_at" IS NULL;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "purchase_orders" FROM app;--> statement-breakpoint
REVOKE TRUNCATE ON "purchase_order_suppliers", "purchase_order_lines", "supplier_orderers", "goods_receipt_confirmations" FROM app;
