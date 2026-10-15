-- Order boards and stages (ADR-0056): boards per branch, stages with their action, rights by
-- role, where each channel's orders land, every card move; the pick and the sale on the order.
CREATE TABLE "sales_board_roles" (
	"board_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"right" text NOT NULL,
	CONSTRAINT "sales_board_roles_board_id_role_id_right_pk" PRIMARY KEY("board_id","role_id","right"),
	CONSTRAINT "sales_board_roles_right" CHECK ("sales_board_roles"."right" IN ('VIEW', 'MANAGE'))
);
--> statement-breakpoint
CREATE TABLE "sales_boards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_boards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"branch_id" bigint,
	"position" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_boards_name" CHECK (length("sales_boards"."name") BETWEEN 1 AND 80),
	CONSTRAINT "sales_boards_position" CHECK ("sales_boards"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_channel_defaults" (
	"channel" text PRIMARY KEY NOT NULL,
	"board_id" bigint NOT NULL,
	"stage_id" bigint NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channel_defaults_channel" CHECK ("sales_channel_defaults"."channel" IN ('ADMIN', 'CUSTOMER_APP', 'SALES_REP', 'POS'))
);
--> statement-breakpoint
CREATE TABLE "sales_stage_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_stage_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"from_stage_id" bigint,
	"to_stage_id" bigint NOT NULL,
	"actor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_stage_roles" (
	"stage_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"right" text NOT NULL,
	CONSTRAINT "sales_stage_roles_stage_id_role_id_right_pk" PRIMARY KEY("stage_id","role_id","right"),
	CONSTRAINT "sales_stage_roles_right" CHECK ("sales_stage_roles"."right" IN ('VIEW', 'EDIT', 'MOVE'))
);
--> statement-breakpoint
CREATE TABLE "sales_stages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_stages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"action" text DEFAULT 'NONE' NOT NULL,
	"print_pick_list" boolean DEFAULT false NOT NULL,
	"print_delivery_note" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_stages_name" CHECK (length("sales_stages"."name") BETWEEN 1 AND 80),
	CONSTRAINT "sales_stages_position" CHECK ("sales_stages"."position" >= 0),
	CONSTRAINT "sales_stages_action" CHECK ("sales_stages"."action" IN ('NONE', 'CONFIRM', 'PICK', 'SALE', 'CANCEL'))
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "qty_picked" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "pick_bin_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "qty_delivered" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "board_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "stage_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "stage_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "picked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "picked_by" bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "delivered_by" bigint;--> statement-breakpoint
ALTER TABLE "sales_board_roles" ADD CONSTRAINT "sales_board_roles_board_id_sales_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."sales_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_board_roles" ADD CONSTRAINT "sales_board_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_boards" ADD CONSTRAINT "sales_boards_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_boards" ADD CONSTRAINT "sales_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD CONSTRAINT "sales_channel_defaults_board_id_sales_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."sales_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD CONSTRAINT "sales_channel_defaults_stage_id_sales_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD CONSTRAINT "sales_channel_defaults_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_moves" ADD CONSTRAINT "sales_stage_moves_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_moves" ADD CONSTRAINT "sales_stage_moves_from_stage_id_sales_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_moves" ADD CONSTRAINT "sales_stage_moves_to_stage_id_sales_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_moves" ADD CONSTRAINT "sales_stage_moves_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_roles" ADD CONSTRAINT "sales_stage_roles_stage_id_sales_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_roles" ADD CONSTRAINT "sales_stage_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_board_id_sales_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."sales_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_stage_moves_order_idx" ON "sales_stage_moves" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "sales_stages_board_idx" ON "sales_stages" USING btree ("board_id","position");--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_pick_bin_id_bins_id_fk" FOREIGN KEY ("pick_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_board_id_sales_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."sales_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_stage_id_sales_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_picked" CHECK (("sales_order_lines"."qty_picked" IS NULL OR ("sales_order_lines"."qty_picked" >= 0 AND "sales_order_lines"."qty_picked" <= "sales_order_lines"."qty_base")) AND ("sales_order_lines"."qty_delivered" IS NULL OR ("sales_order_lines"."qty_picked" IS NOT NULL AND "sales_order_lines"."qty_delivered" >= 0 AND "sales_order_lines"."qty_delivered" <= "sales_order_lines"."qty_picked")));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_board" CHECK (("sales_orders"."board_id" IS NULL) = ("sales_orders"."stage_id" IS NULL) AND ("sales_orders"."stage_id" IS NULL) = ("sales_orders"."stage_entered_at" IS NULL));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_picked" CHECK (("sales_orders"."picked_at" IS NULL) = ("sales_orders"."picked_by" IS NULL) AND ("sales_orders"."delivered_at" IS NULL OR "sales_orders"."picked_at" IS NOT NULL));--> statement-breakpoint
-- An edited order (ADR-0056 #4) rewrites its frozen price parts: app may delete them again.
GRANT DELETE ON "sales_order_line_parts" TO app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_boards" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_stages" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "sales_stage_moves" FROM app;--> statement-breakpoint

-- The assistant sees the board, the stage, the pick and the sale (ADR-0056 #9).
DROP VIEW ai.sales_order_lines;--> statement-breakpoint
DROP VIEW ai.sales_orders;--> statement-breakpoint
CREATE VIEW ai.sales_orders AS
SELECT o.id, o.number, o.status, o.channel, o.customer_id, c.code AS customer_code,
       c.name AS customer_name, o.fulfilment, o.delivery_date, o.address_text, o.payment_method,
       o.price_date, o.subtotal, o.discount_total, o.total,
       (SELECT count(*) FROM public.sales_order_lines l WHERE l.order_id = o.id) AS line_count,
       o.board_id, b.name AS board_name, o.stage_id, s.name AS stage_name, o.stage_entered_at,
       o.submitted_at, o.confirmed_at, o.picked_at, o.delivered_at, o.cancelled_at,
       o.cancel_reason, o.created_at, cu.full_name AS created_by_name
  FROM public.sales_orders o
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.sales_boards b ON b.id = o.board_id
  LEFT JOIN public.sales_stages s ON s.id = o.stage_id
  LEFT JOIN public.users cu ON cu.id = o.created_by;
--> statement-breakpoint

CREATE VIEW ai.sales_order_lines AS
SELECT l.id, l.order_id, o.number AS order_number, o.status AS order_status, o.customer_id,
       c.name AS customer_name, o.delivery_date, l.line_no::integer AS line_no, l.product_id, p.sku,
       p.name AS product_name, um.name AS unit_name, l.qty, l.factor_snapshot, l.qty_base,
       base_uom.name AS base_unit, l.warehouse_id, w.name AS warehouse_name, l.qty_approved,
       l.qty_backordered, l.qty_picked, l.qty_delivered, l.subtotal, l.discount_amount, l.total
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

-- Picks and sales post under the order's number (ADR-0056 #6): the same columns, so OR REPLACE.
CREATE OR REPLACE VIEW ai.stock_movements AS
SELECT l.id, l.posted_at, l.effective_date AS movement_date, l.warehouse_id,
       w.name AS warehouse_name, b.code AS bin_code, l.product_id, p.sku, p.name AS product_name,
       base_uom.name AS base_unit, l.qty_base, l.entered_qty, entered_uom.name AS entered_unit,
       l.unit_cost, round(l.qty_base * l.unit_cost, 2) AS value, l.movement_type, l.doc_type,
       l.doc_id, coalesce(gr.number, bm.number, adj.number, st.number, tr.number, so.number) AS doc_number,
       adj.reason AS adjustment_reason, gr.supplier_id, sup.name AS supplier_name,
       u.full_name AS posted_by_name
  FROM public.stock_ledger l
  JOIN public.warehouses w ON w.id = l.warehouse_id
  JOIN public.bins b ON b.id = l.bin_id
  JOIN public.products p ON p.id = l.product_id
  JOIN public.product_units pu ON pu.id = l.product_unit_id
  JOIN public.uoms entered_uom ON entered_uom.id = pu.uom_id
  LEFT JOIN public.product_units bu ON bu.product_id = l.product_id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id
  LEFT JOIN public.goods_receipts gr ON l.doc_type = 'GR' AND gr.id = l.doc_id
  LEFT JOIN public.suppliers sup ON sup.id = gr.supplier_id
  LEFT JOIN public.bin_moves bm ON l.doc_type = 'BM' AND bm.id = l.doc_id
  LEFT JOIN public.adjustments adj ON l.doc_type = 'ADJ' AND adj.id = l.doc_id
  LEFT JOIN public.stocktakes st ON l.doc_type = 'ST' AND st.id = l.doc_id
  LEFT JOIN public.transfers tr ON l.doc_type = 'TR' AND tr.id = l.doc_id
  LEFT JOIN public.sales_orders so ON l.doc_type = 'SO' AND so.id = l.doc_id
  LEFT JOIN public.users u ON u.id = l.created_by;
--> statement-breakpoint

-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
