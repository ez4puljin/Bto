-- Customer orders (ADR-0055). An order is cancelled, never deleted: orders, their price parts and
-- their status events cannot be deleted by app. A draft's lines are replaced when it is edited, so
-- app may delete lines (the service does so only for drafts).
CREATE TABLE "order_status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_id" bigint,
	"actor_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_events_to" CHECK ("order_status_events"."to_status" IN ('DRAFT', 'SUBMITTED', 'APPROVAL_PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED', 'DELIVERY_FAILED', 'INVOICED', 'CLOSED', 'CANCELLED')),
	CONSTRAINT "order_status_events_from" CHECK ("order_status_events"."from_status" IS NULL OR "order_status_events"."from_status" IN ('DRAFT', 'SUBMITTED', 'APPROVAL_PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED', 'DELIVERY_FAILED', 'INVOICED', 'CLOSED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "sales_order_line_parts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_line_parts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"line_id" bigint NOT NULL,
	"part_no" smallint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"uom_name" text NOT NULL,
	"basis" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"list_price" numeric(14, 2) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"applied" jsonb NOT NULL,
	CONSTRAINT "sales_order_line_parts_no" UNIQUE("line_id","part_no"),
	CONSTRAINT "sales_order_line_parts_basis" CHECK ("sales_order_line_parts"."basis" IN ('WAREHOUSE', 'LOOSE', 'RETAIL', 'RETAIL_BULK')),
	CONSTRAINT "sales_order_line_parts_qty" CHECK ("sales_order_line_parts"."qty" > 0 AND "sales_order_line_parts"."qty_base" > 0),
	CONSTRAINT "sales_order_line_parts_money" CHECK ("sales_order_line_parts"."list_price" >= 0 AND "sales_order_line_parts"."unit_price" >= 0 AND "sales_order_line_parts"."discount_amount" >= 0 AND "sales_order_line_parts"."total" = "sales_order_line_parts"."subtotal" - "sales_order_line_parts"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"qty_approved" numeric(14, 3) DEFAULT 0 NOT NULL,
	"qty_backordered" numeric(14, 3) DEFAULT 0 NOT NULL,
	"subtotal" numeric(14, 2),
	"discount_amount" numeric(14, 2),
	"total" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_lines_no" UNIQUE("order_id","line_no"),
	CONSTRAINT "sales_order_lines_qty" CHECK ("sales_order_lines"."qty" > 0 AND "sales_order_lines"."qty_base" > 0 AND "sales_order_lines"."factor_snapshot" > 0),
	CONSTRAINT "sales_order_lines_split" CHECK ("sales_order_lines"."qty_approved" >= 0 AND "sales_order_lines"."qty_backordered" >= 0 AND "sales_order_lines"."qty_approved" + "sales_order_lines"."qty_backordered" <= "sales_order_lines"."qty_base"),
	CONSTRAINT "sales_order_lines_totals" CHECK ("sales_order_lines"."total" IS NULL OR "sales_order_lines"."total" = "sales_order_lines"."subtotal" - "sales_order_lines"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" text,
	"channel" text DEFAULT 'ADMIN' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"customer_id" bigint NOT NULL,
	"fulfilment" text NOT NULL,
	"delivery_date" date NOT NULL,
	"address_id" bigint,
	"address_text" text,
	"address_lat" numeric(9, 6),
	"address_lng" numeric(9, 6),
	"contact_name" text,
	"contact_phone" text,
	"payment_method" text NOT NULL,
	"note" text,
	"price_date" date,
	"subtotal" numeric(14, 2),
	"discount_total" numeric(14, 2),
	"total" numeric(14, 2),
	"submitted_at" timestamp with time zone,
	"submitted_by" bigint,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" bigint,
	"cancel_reason" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_status" CHECK ("sales_orders"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVAL_PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'DISPATCHED', 'DELIVERED', 'DELIVERY_FAILED', 'INVOICED', 'CLOSED', 'CANCELLED')),
	CONSTRAINT "sales_orders_channel" CHECK ("sales_orders"."channel" IN ('ADMIN', 'CUSTOMER_APP', 'SALES_REP', 'POS')),
	CONSTRAINT "sales_orders_fulfilment" CHECK ("sales_orders"."fulfilment" IN ('PICKUP', 'DELIVERY')),
	CONSTRAINT "sales_orders_payment_method" CHECK ("sales_orders"."payment_method" IN ('CASH', 'BANK_TRANSFER', 'CREDIT')),
	CONSTRAINT "sales_orders_submitted" CHECK (("sales_orders"."submitted_at" IS NULL) = ("sales_orders"."number" IS NULL) AND ("sales_orders"."submitted_at" IS NULL) = ("sales_orders"."price_date" IS NULL) AND ("sales_orders"."submitted_at" IS NULL) = ("sales_orders"."total" IS NULL)),
	CONSTRAINT "sales_orders_draft" CHECK (("sales_orders"."status" = 'DRAFT') = ("sales_orders"."submitted_at" IS NULL AND "sales_orders"."cancelled_at" IS NULL)),
	CONSTRAINT "sales_orders_cancelled" CHECK (("sales_orders"."status" = 'CANCELLED') = ("sales_orders"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "sales_orders_address" CHECK ("sales_orders"."submitted_at" IS NULL OR "sales_orders"."fulfilment" = 'PICKUP' OR "sales_orders"."address_id" IS NOT NULL),
	CONSTRAINT "sales_orders_note" CHECK ("sales_orders"."note" IS NULL OR length("sales_orders"."note") <= 500),
	CONSTRAINT "sales_orders_contact" CHECK (("sales_orders"."contact_name" IS NULL OR length("sales_orders"."contact_name") <= 120) AND ("sales_orders"."contact_phone" IS NULL OR "sales_orders"."contact_phone" ~ '^\+976[0-9]{8}$')),
	CONSTRAINT "sales_orders_cancel_reason" CHECK ("sales_orders"."cancel_reason" IS NULL OR length("sales_orders"."cancel_reason") <= 500),
	CONSTRAINT "sales_orders_totals" CHECK ("sales_orders"."total" IS NULL OR ("sales_orders"."subtotal" >= 0 AND "sales_orders"."discount_total" >= 0 AND "sales_orders"."total" = "sales_orders"."subtotal" - "sales_orders"."discount_total"))
);
--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line_parts" ADD CONSTRAINT "sales_order_line_parts_line_id_sales_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line_parts" ADD CONSTRAINT "sales_order_line_parts_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_address_id_customer_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_status_events_order_idx" ON "order_status_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_product_idx" ON "sales_order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_number" ON "sales_orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_orders_customer_idx" ON "sales_orders" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "sales_orders_status_idx" ON "sales_orders" USING btree ("status","id");--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_orders" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_order_line_parts" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "order_status_events" FROM app;--> statement-breakpoint
REVOKE TRUNCATE ON "sales_order_lines" FROM app;--> statement-breakpoint

-- The assistant reads orders (ADR-0045, docs/modules/ai.md §11).
CREATE VIEW ai.sales_orders AS
SELECT o.id, o.number, o.status, o.channel, o.customer_id, c.code AS customer_code,
       c.name AS customer_name, o.fulfilment, o.delivery_date, o.address_text, o.payment_method,
       o.price_date, o.subtotal, o.discount_total, o.total,
       (SELECT count(*) FROM public.sales_order_lines l WHERE l.order_id = o.id) AS line_count,
       o.submitted_at, o.confirmed_at, o.cancelled_at, o.cancel_reason, o.created_at,
       cu.full_name AS created_by_name
  FROM public.sales_orders o
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.users cu ON cu.id = o.created_by;
--> statement-breakpoint

CREATE VIEW ai.sales_order_lines AS
SELECT l.id, l.order_id, o.number AS order_number, o.status AS order_status, o.customer_id,
       c.name AS customer_name, o.delivery_date, l.line_no::integer AS line_no, l.product_id, p.sku,
       p.name AS product_name, um.name AS unit_name, l.qty, l.factor_snapshot, l.qty_base,
       base_uom.name AS base_unit, l.warehouse_id, w.name AS warehouse_name, l.qty_approved,
       l.qty_backordered, l.subtotal, l.discount_amount, l.total
  FROM public.sales_order_lines l
  JOIN public.sales_orders o ON o.id = l.order_id
  JOIN public.customers c ON c.id = o.customer_id
  JOIN public.products p ON p.id = l.product_id
  JOIN public.product_units pu ON pu.id = l.product_unit_id
  JOIN public.uoms um ON um.id = pu.uom_id
  JOIN public.warehouses w ON w.id = l.warehouse_id
  LEFT JOIN public.product_units bu ON bu.product_id = l.product_id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id;
--> statement-breakpoint

-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
