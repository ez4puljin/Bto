CREATE TABLE "goods_issue_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_issue_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"issue_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"entered_qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"lot_id" bigint,
	"bin_id" bigint NOT NULL,
	"unit_cost" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_issue_lines_qty" CHECK ("goods_issue_lines"."entered_qty" > 0 AND "goods_issue_lines"."qty_base" > 0),
	CONSTRAINT "goods_issue_lines_cost" CHECK ("goods_issue_lines"."unit_cost" IS NULL OR "goods_issue_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_issues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"issued_on" date NOT NULL,
	"expense_type_id" bigint NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_user_id" bigint,
	"recipient_customer_id" bigint,
	"recipient_supplier_id" bigint,
	"recipient_name" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"number" text,
	"effective_date" date,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_issues_number_key" UNIQUE("number"),
	CONSTRAINT "goods_issues_status" CHECK ("goods_issues"."status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
	CONSTRAINT "goods_issues_recipient_kind" CHECK ("goods_issues"."recipient_kind" IN ('USER', 'CUSTOMER', 'SUPPLIER', 'OTHER')),
	CONSTRAINT "goods_issues_recipient" CHECK (("goods_issues"."recipient_user_id" IS NOT NULL) = ("goods_issues"."recipient_kind" = 'USER')
        AND ("goods_issues"."recipient_customer_id" IS NOT NULL) = ("goods_issues"."recipient_kind" = 'CUSTOMER')
        AND ("goods_issues"."recipient_supplier_id" IS NOT NULL) = ("goods_issues"."recipient_kind" = 'SUPPLIER')
        AND ("goods_issues"."recipient_kind" <> 'OTHER' OR "goods_issues"."recipient_name" IS NOT NULL)),
	CONSTRAINT "goods_issues_posted" CHECK (("goods_issues"."status" = 'POSTED') = ("goods_issues"."number" IS NOT NULL AND "goods_issues"."posted_at" IS NOT NULL
        AND "goods_issues"."effective_date" IS NOT NULL)),
	CONSTRAINT "goods_issues_texts" CHECK (("goods_issues"."recipient_name" IS NULL OR length("goods_issues"."recipient_name") BETWEEN 1 AND 200)
        AND ("goods_issues"."note" IS NULL OR length("goods_issues"."note") BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "issue_expense_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "issue_expense_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_expense_types_name_key" UNIQUE("name_key"),
	CONSTRAINT "issue_expense_types_code_key" UNIQUE("code"),
	CONSTRAINT "issue_expense_types_name" CHECK (length("issue_expense_types"."name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind";--> statement-breakpoint
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_doc_type";--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_issue_id_goods_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."goods_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_expense_type_id_issue_expense_types_id_fk" FOREIGN KEY ("expense_type_id") REFERENCES "public"."issue_expense_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_recipient_customer_id_customers_id_fk" FOREIGN KEY ("recipient_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_recipient_supplier_id_suppliers_id_fk" FOREIGN KEY ("recipient_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_issue_lines_issue_idx" ON "goods_issue_lines" USING btree ("issue_id","id");--> statement-breakpoint
CREATE INDEX "goods_issues_warehouse_idx" ON "goods_issues" USING btree ("warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "goods_issues_expense_type_idx" ON "goods_issues" USING btree ("expense_type_id","id");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind" CHECK ("import_jobs"."kind" IN ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'LEVELS', 'PRICES', 'RECEIPTS', 'ISSUES'));--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_doc_type" CHECK ("stock_reservations"."doc_type" IN ('GR', 'BM', 'TR', 'ADJ', 'ST', 'PK', 'TRIP', 'SO', 'POS', 'CN', 'GI'));--> statement-breakpoint
-- By hand (ADR-0081). Document headers are never deleted (as 0005 does for the other documents).
REVOKE DELETE, TRUNCATE ON "goods_issues", "issue_expense_types" FROM app;--> statement-breakpoint
-- The ledger takes the goods issue: its document type and its outbound movement (0006 is hand-written).
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_doc_type";--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_doc_type" CHECK ("doc_type" IN ('GR', 'BM', 'TR',
  'ADJ', 'ST', 'PK', 'TRIP', 'SO', 'POS', 'CN', 'GI'));--> statement-breakpoint
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_movement_type";--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_movement_type" CHECK ("movement_type" IN ('RECEIPT',
  'PUTAWAY_OUT', 'PUTAWAY_IN', 'BIN_MOVE_OUT', 'BIN_MOVE_IN', 'PICK_OUT', 'PICK_IN', 'DISPATCH_OUT',
  'DISPATCH_IN', 'DELIVERY_ISSUE', 'POS_SALE', 'GOODS_ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_IN',
  'ADJUSTMENT', 'COUNT_CORRECTION'));--> statement-breakpoint
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_sign";--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_sign" CHECK (CASE
  WHEN "movement_type" IN ('RECEIPT', 'PUTAWAY_IN', 'BIN_MOVE_IN', 'PICK_IN', 'DISPATCH_IN', 'TRANSFER_IN',
    'RETURN_IN') THEN "qty_base" > 0
  WHEN "movement_type" IN ('PUTAWAY_OUT', 'BIN_MOVE_OUT', 'PICK_OUT', 'DISPATCH_OUT', 'DELIVERY_ISSUE',
    'POS_SALE', 'GOODS_ISSUE', 'TRANSFER_OUT') THEN "qty_base" < 0
  ELSE true END);--> statement-breakpoint
-- The expense types a database starts with; the admin renames, adds and retires them (ADR-0081 #5).
-- name_key as nameKey(normalizeName(name)) of @tugeel/shared/text gives it.
INSERT INTO "issue_expense_types" ("name", "name_key", "code", "sort_order") VALUES
  ('Дотоод хэрэглээ', 'дотоод хэрэглээ', 'INTERNAL_USE', 10),
  ('Урамшуулал', 'урамшуулал', 'BONUS', 20),
  ('Сурталчилгаа', 'сурталчилгаа', 'MARKETING', 30),
  ('Хорогдол, гэмтэл', 'хорогдол гэмтэл', 'WRITE_OFF', 40),
  ('Нийлүүлэгчид буцаалт', 'нийлүүлэгчид буцаалт', 'SUPPLIER_RETURN', 50),
  ('Бусад байгууллагад шилжүүлэлт', 'бусад байгууллагад шилжүүлэлт', 'TRANSFER_OUT', 60)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The assistant's movement history names the goods issues too (ADR-0045, ADR-0081).
CREATE OR REPLACE VIEW ai.stock_movements AS
SELECT l.id, l.posted_at, l.effective_date AS movement_date, l.warehouse_id,
       w.name AS warehouse_name, b.code AS bin_code, l.product_id, p.sku, p.name AS product_name,
       base_uom.name AS base_unit, l.qty_base, l.entered_qty, entered_uom.name AS entered_unit,
       l.unit_cost, round(l.qty_base * l.unit_cost, 2) AS value, l.movement_type, l.doc_type,
       l.doc_id, coalesce(gr.number, bm.number, adj.number, st.number, tr.number, so.number, ps.number, gi.number) AS doc_number,
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
  LEFT JOIN public.pos_sales ps ON l.doc_type = 'POS' AND ps.id = l.doc_id
  LEFT JOIN public.goods_issues gi ON l.doc_type = 'GI' AND gi.id = l.doc_id
  LEFT JOIN public.users u ON u.id = l.created_by;
--> statement-breakpoint
-- Goods issues among the stock documents: a recipient supplier (a return) in the supplier columns,
-- the expense type in the reason column, the document date until the posting.
CREATE OR REPLACE VIEW ai.stock_documents AS
SELECT 'GR'::text AS doc_type, r.id, r.number, r.status, r.warehouse_id, w.name AS warehouse_name,
       NULL::bigint AS dest_warehouse_id, NULL::text AS dest_warehouse_name, r.supplier_id,
       s.name AS supplier_name, r.supplier_doc_no, NULL::text AS adjustment_reason,
       r.costing_status, r.effective_date, NULL::date AS ship_date, NULL::date AS receive_date,
       r.posted_at, r.created_at, cu.full_name AS created_by_name, pu.full_name AS posted_by_name,
       r.note
  FROM public.goods_receipts r
  JOIN public.warehouses w ON w.id = r.warehouse_id
  JOIN public.suppliers s ON s.id = r.supplier_id
  LEFT JOIN public.users cu ON cu.id = r.created_by
  LEFT JOIN public.users pu ON pu.id = r.posted_by
UNION ALL
SELECT 'BM', m.id, m.number, m.status, m.warehouse_id, w.name, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, m.effective_date, NULL, NULL, m.posted_at, m.created_at, cu.full_name, pu.full_name,
       m.note
  FROM public.bin_moves m
  JOIN public.warehouses w ON w.id = m.warehouse_id
  LEFT JOIN public.users cu ON cu.id = m.created_by
  LEFT JOIN public.users pu ON pu.id = m.posted_by
UNION ALL
SELECT 'ADJ', a.id, a.number, a.status, a.warehouse_id, w.name, NULL, NULL, NULL, NULL, NULL,
       a.reason, NULL, a.effective_date, NULL, NULL, a.posted_at, a.created_at, cu.full_name,
       pu.full_name, a.note
  FROM public.adjustments a
  JOIN public.warehouses w ON w.id = a.warehouse_id
  LEFT JOIN public.users cu ON cu.id = a.created_by
  LEFT JOIN public.users pu ON pu.id = a.posted_by
UNION ALL
SELECT 'ST', t.id, t.number, t.status, t.warehouse_id, w.name, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, t.effective_date, NULL, NULL, t.posted_at, t.created_at, cu.full_name, pu.full_name,
       t.note
  FROM public.stocktakes t
  JOIN public.warehouses w ON w.id = t.warehouse_id
  LEFT JOIN public.users cu ON cu.id = t.created_by
  LEFT JOIN public.users pu ON pu.id = t.posted_by
UNION ALL
SELECT 'TR', t.id, t.number, t.status, t.source_warehouse_id, sw.name, t.dest_warehouse_id,
       dw.name, NULL, NULL, NULL, NULL, NULL, coalesce(t.receive_date, t.ship_date), t.ship_date,
       t.receive_date, coalesce(t.received_at, t.shipped_at), t.created_at, cu.full_name,
       coalesce(ru.full_name, su.full_name), t.note
  FROM public.transfers t
  JOIN public.warehouses sw ON sw.id = t.source_warehouse_id
  JOIN public.warehouses dw ON dw.id = t.dest_warehouse_id
  LEFT JOIN public.users cu ON cu.id = t.created_by
  LEFT JOIN public.users su ON su.id = t.shipped_by
  LEFT JOIN public.users ru ON ru.id = t.received_by
UNION ALL
SELECT 'GI', g.id, g.number, g.status, g.warehouse_id, w.name, NULL, NULL, g.recipient_supplier_id,
       CASE WHEN g.recipient_kind = 'SUPPLIER' THEN g.recipient_name END, NULL, et.name, NULL,
       coalesce(g.effective_date, g.issued_on), NULL, NULL, g.posted_at, g.created_at, cu.full_name,
       pu.full_name, g.note
  FROM public.goods_issues g
  JOIN public.warehouses w ON w.id = g.warehouse_id
  JOIN public.issue_expense_types et ON et.id = g.expense_type_id
  LEFT JOIN public.users cu ON cu.id = g.created_by
  LEFT JOIN public.users pu ON pu.id = g.posted_by;
--> statement-breakpoint
-- The default privileges of app (0000_foundation) cover views too: take them back.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
