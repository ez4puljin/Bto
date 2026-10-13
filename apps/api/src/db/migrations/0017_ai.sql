CREATE TABLE "ai_conversations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversations_title" CHECK (length("ai_conversations"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "ai_questions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"question" text NOT NULL,
	"kind" text,
	"status" text NOT NULL,
	"sql" text,
	"explanation" text,
	"summary" text,
	"error_code" text,
	"row_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"repaired" boolean DEFAULT false NOT NULL,
	"duration_ms" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_questions_status" CHECK ("ai_questions"."status" IN ('ANSWERED', 'CLARIFY', 'UNSUPPORTED', 'REFUSED', 'FAILED')),
	CONSTRAINT "ai_questions_kind" CHECK ("ai_questions"."kind" IS NULL OR "ai_questions"."kind" IN ('QUERY', 'CLARIFY', 'UNSUPPORTED')),
	CONSTRAINT "ai_questions_provider" CHECK ("ai_questions"."provider" IN ('openai', 'anthropic', 'ollama')),
	CONSTRAINT "ai_questions_question" CHECK (length("ai_questions"."question") BETWEEN 1 AND 1000),
	CONSTRAINT "ai_questions_answered" CHECK ("ai_questions"."status" <> 'ANSWERED' OR ("ai_questions"."sql" IS NOT NULL AND "ai_questions"."row_count" IS NOT NULL)),
	CONSTRAINT "ai_questions_counts" CHECK ("ai_questions"."row_count" >= 0 AND "ai_questions"."duration_ms" >= 0 AND "ai_questions"."input_tokens" >= 0 AND "ai_questions"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"sql" text NOT NULL,
	"source_question_id" bigint NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" bigint,
	CONSTRAINT "ai_reports_name" CHECK (length(btrim("ai_reports"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "ai_reports_deleted" CHECK (("ai_reports"."deleted_at" IS NULL) = ("ai_reports"."deleted_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_source_question_id_ai_questions_id_fk" FOREIGN KEY ("source_question_id") REFERENCES "public"."ai_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_questions_conversation_idx" ON "ai_questions" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "ai_reports_live_idx" ON "ai_reports" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "ai_reports"."deleted_at" IS NULL;
--> statement-breakpoint

-- Hand-written: ai_questions is the assistant's log and append-only like audit_log (ADR-0045 #8);
-- conversations and reports are never deleted by app (reports are soft-deleted).
REVOKE UPDATE, DELETE, TRUNCATE ON "ai_questions" FROM app;
--> statement-breakpoint
CREATE TRIGGER "ai_questions_no_update_delete" BEFORE UPDATE OR DELETE ON "ai_questions"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER "ai_questions_no_truncate" BEFORE TRUNCATE ON "ai_questions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "ai_conversations", "ai_reports" FROM app;
--> statement-breakpoint

-- Hand-written: schema ai, the read-only views the assistant queries (ADR-0045 #2,
-- docs/modules/ai.md §2). Owned by migrator; role ai_reader gets USAGE and SELECT from
-- `pnpm db:migrate` (migrate.ts), app gets nothing. Rules for every view:
--   * explicit column lists, built-in functions only, no security_invoker (the view reads as its
--     owner; ai_reader has no privilege on the tables below);
--   * never auth_sessions, password_resets, idempotency_keys, files, audit_log or import_rows, and
--     from users only id and full_name (checked by the view contract test);
--   * "today" is the Ulaanbaatar business date;
--   * a rule that also lives in a service (derived unit price, low stock, discount status, stock
--     value) is tested against that service (ai-views.int-spec.ts);
--   * a later migration that changes a column used here recreates the view in the same migration;
--     the column lists match AI_DATASETS (modules/ai/semantic/datasets.ts).
CREATE SCHEMA ai;
--> statement-breakpoint
REVOKE ALL ON SCHEMA ai FROM PUBLIC;
--> statement-breakpoint

CREATE VIEW ai.categories AS
WITH RECURSIVE tree AS (
  SELECT c.id, c.parent_id, c.name, c.name AS path, 1 AS level, c.id AS top_category_id,
         c.name AS top_category_name, c.sku_from, c.sku_to
    FROM public.categories c
   WHERE c.parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, c.name, t.path || ' / ' || c.name, t.level + 1, t.top_category_id,
         t.top_category_name, c.sku_from, c.sku_to
    FROM public.categories c
    JOIN tree t ON t.id = c.parent_id
)
SELECT id, parent_id, name, path, level, top_category_id, top_category_name, sku_from, sku_to
  FROM tree;
--> statement-breakpoint

CREATE VIEW ai.products AS
SELECT p.id, p.sku, p.name, p.category_id, c.path AS category_path, c.top_category_name,
       p.status, p.sale_ready_at IS NOT NULL AS ready_for_sale, p.sale_ready_at,
       base_uom.name AS base_unit, p.vat_type, p.city_tax, p.classification_code,
       p.tax_product_code, p.weight_kg, p.created_at, p.updated_at
  FROM public.products p
  JOIN ai.categories c ON c.id = p.category_id
  LEFT JOIN public.product_units bu ON bu.product_id = p.id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id;
--> statement-breakpoint

CREATE VIEW ai.product_units AS
SELECT u.id, u.product_id, p.sku, p.name AS product_name, m.name AS unit_name, m.code AS uom_code,
       u.factor_to_base, u.is_base, u.is_default_sales, u.is_default_purchase,
       (SELECT b.code FROM public.product_barcodes b
         WHERE b.product_unit_id = u.id AND b.is_primary) AS primary_barcode,
       (SELECT string_agg(b.code, ', ' ORDER BY b.is_primary DESC, b.code)
          FROM public.product_barcodes b WHERE b.product_unit_id = u.id) AS barcodes
  FROM public.product_units u
  JOIN public.products p ON p.id = u.product_id
  JOIN public.uoms m ON m.id = u.uom_id
 WHERE u.superseded_at IS NULL;
--> statement-breakpoint

CREATE VIEW ai.warehouses AS
SELECT w.id, w.code, w.name, w.kind, w.status, w.branch_id, b.name AS branch_name
  FROM public.warehouses w
  LEFT JOIN public.branches b ON b.id = w.branch_id;
--> statement-breakpoint

-- Lots summed per warehouse and product, as StockQueryService does: value = Σ round(on hand ×
-- average, 2) over the rows, average = value / on hand (4 decimals; the kept average at zero).
CREATE VIEW ai.stock AS
SELECT s.warehouse_id, w.name AS warehouse_name, w.kind AS warehouse_kind, s.product_id, p.sku,
       p.name AS product_name, base_uom.name AS base_unit, s.on_hand, s.sellable_on_hand,
       s.reserved, greatest(s.sellable_on_hand - s.reserved, 0) AS available,
       CASE WHEN s.on_hand > 0 THEN round(s.stock_value / s.on_hand, 4) ELSE s.kept_avg_cost END
         AS avg_cost,
       s.stock_value, l.min_qty, l.max_qty, coalesce(l.is_home, false) AS is_home_warehouse,
       fixed_bin.code AS fixed_bin_code
  FROM (SELECT ws.warehouse_id, ws.product_id, sum(ws.on_hand) AS on_hand,
               sum(ws.sellable_on_hand) AS sellable_on_hand, sum(ws.reserved) AS reserved,
               sum(round(ws.on_hand * ws.avg_cost, 2)) AS stock_value,
               max(ws.avg_cost) AS kept_avg_cost
          FROM public.warehouse_stock ws
         GROUP BY ws.warehouse_id, ws.product_id) s
  JOIN public.warehouses w ON w.id = s.warehouse_id
  JOIN public.products p ON p.id = s.product_id
  LEFT JOIN public.product_units bu ON bu.product_id = p.id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id
  LEFT JOIN public.product_locations l
    ON l.warehouse_id = s.warehouse_id AND l.product_id = s.product_id
  LEFT JOIN public.bins fixed_bin ON fixed_bin.id = l.default_bin_id;
--> statement-breakpoint

-- The low-stock list of ADR-0039 (StockQueryService.lowStock) for every warehouse at once.
CREATE VIEW ai.low_stock AS
SELECT x.warehouse_id, w.name AS warehouse_name, x.product_id, p.sku, p.name AS product_name,
       base_uom.name AS base_unit, CASE WHEN x.on_hand = 0 THEN 'OUT' ELSE 'LOW' END AS status,
       x.on_hand, x.min_qty, x.max_qty,
       CASE WHEN coalesce(x.max_qty, x.min_qty) > x.on_hand
            THEN coalesce(x.max_qty, x.min_qty) - x.on_hand END AS suggested_qty,
       home.warehouse_id AS home_warehouse_id, home_w.name AS home_warehouse_name
  FROM (SELECT k.warehouse_id, k.product_id, coalesce(s.on_hand, 0) AS on_hand, l.min_qty,
               l.max_qty, s.product_id IS NOT NULL AS held
          FROM (SELECT pl.warehouse_id, pl.product_id FROM public.product_locations pl
                 WHERE pl.min_qty IS NOT NULL
                UNION
                SELECT ws.warehouse_id, ws.product_id FROM public.warehouse_stock ws) k
          LEFT JOIN public.product_locations l
            ON l.warehouse_id = k.warehouse_id AND l.product_id = k.product_id
          LEFT JOIN (SELECT ws.warehouse_id, ws.product_id, sum(ws.on_hand) AS on_hand
                       FROM public.warehouse_stock ws
                      GROUP BY ws.warehouse_id, ws.product_id) s
            ON s.warehouse_id = k.warehouse_id AND s.product_id = k.product_id) x
  JOIN public.products p ON p.id = x.product_id AND p.status = 'ACTIVE'
  JOIN public.warehouses w ON w.id = x.warehouse_id
  LEFT JOIN public.product_units bu ON bu.product_id = p.id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id
  LEFT JOIN public.product_locations home ON home.product_id = x.product_id AND home.is_home
  LEFT JOIN public.warehouses home_w ON home_w.id = home.warehouse_id
 WHERE (x.min_qty IS NOT NULL AND x.on_hand <= x.min_qty)
    OR (x.min_qty IS NULL AND x.held AND x.on_hand = 0);
--> statement-breakpoint

CREATE VIEW ai.stock_movements AS
SELECT l.id, l.posted_at, l.effective_date AS movement_date, l.warehouse_id,
       w.name AS warehouse_name, b.code AS bin_code, l.product_id, p.sku, p.name AS product_name,
       base_uom.name AS base_unit, l.qty_base, l.entered_qty, entered_uom.name AS entered_unit,
       l.unit_cost, round(l.qty_base * l.unit_cost, 2) AS value, l.movement_type, l.doc_type,
       l.doc_id, coalesce(gr.number, bm.number, adj.number, st.number, tr.number) AS doc_number,
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
  LEFT JOIN public.users u ON u.id = l.created_by;
--> statement-breakpoint

-- Transfers have no single posting: their date is the receive date, else the ship date.
CREATE VIEW ai.stock_documents AS
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
  LEFT JOIN public.users ru ON ru.id = t.received_by;
--> statement-breakpoint

-- The supplier's cost of a line is the amount of its latest costing version (ADR-0033); NULL while
-- the receipt waits for the accountant.
CREATE VIEW ai.receipt_lines AS
SELECT r.id AS receipt_id, r.number AS receipt_number, r.status AS receipt_status,
       r.effective_date AS receipt_date, r.warehouse_id, w.name AS warehouse_name, r.supplier_id,
       s.name AS supplier_name, r.supplier_doc_no, r.costing_status, gl.id AS line_id,
       gl.product_id, p.sku, p.name AS product_name, gl.entered_qty, m.name AS entered_unit,
       gl.qty_base, base_uom.name AS base_unit, c.amount, c.free_goods,
       CASE WHEN c.amount IS NOT NULL AND gl.qty_base > 0
            THEN round(c.amount / gl.qty_base, 4) END AS unit_cost
  FROM public.goods_receipt_lines gl
  JOIN public.goods_receipts r ON r.id = gl.receipt_id
  JOIN public.warehouses w ON w.id = r.warehouse_id
  JOIN public.suppliers s ON s.id = r.supplier_id
  JOIN public.products p ON p.id = gl.product_id
  JOIN public.product_units pu ON pu.id = gl.product_unit_id
  JOIN public.uoms m ON m.id = pu.uom_id
  LEFT JOIN public.product_units bu ON bu.product_id = gl.product_id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id
  LEFT JOIN LATERAL (
    SELECT v.amount, v.free_goods
      FROM public.stock_valuation_adjustments v
     WHERE v.doc_type = 'GR' AND v.doc_line_id = gl.id
     ORDER BY v.version DESC
     LIMIT 1
  ) c ON true;
--> statement-breakpoint

CREATE VIEW ai.customers AS
SELECT c.id, c.code, c.kind, c.name, c.reg_no, c.tin, c.consumer_no, c.phone, c.vat_payer,
       c.city_payer, c.credit_limit, c.payment_term_days, c.credit_hold, c.credit_hold_reason,
       c.status, c.note,
       (SELECT a.address FROM public.customer_addresses a
         WHERE a.customer_id = c.id AND a.is_default) AS default_address,
       c.created_at, c.updated_at
  FROM public.customers c;
--> statement-breakpoint

CREATE VIEW ai.customer_addresses AS
SELECT a.id, a.customer_id, c.name AS customer_name, a.label, a.address, a.lat, a.lng,
       a.gps_source, a.is_default, a.archived_at IS NOT NULL AS archived, a.note
  FROM public.customer_addresses a
  JOIN public.customers c ON c.id = a.customer_id;
--> statement-breakpoint

CREATE VIEW ai.suppliers AS
SELECT s.id, s.code, s.name, s.reg_no, s.tin, s.phone, s.email, s.address, s.bank_name,
       s.bank_account, s.payment_term_days, s.status, s.note, s.created_at, s.updated_at
  FROM public.suppliers s;
--> statement-breakpoint

CREATE VIEW ai.product_suppliers AS
SELECT ps.product_id, p.sku, p.name AS product_name, ps.supplier_id, s.name AS supplier_name,
       ps.is_main
  FROM public.product_suppliers ps
  JOIN public.products p ON p.id = ps.product_id
  JOIN public.suppliers s ON s.id = ps.supplier_id;
--> statement-breakpoint

-- Today's price of every current unit in both lists, as UnitPricesService.view shows it: the
-- unit's own price in force, else (not the base unit) the base unit's price × factor rounded half
-- up to whole MNT. Units without either are left out.
CREATE VIEW ai.prices_today AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d),
in_force AS (
  SELECT up.list, up.product_unit_id, up.price, up.valid_from, up.valid_to
    FROM public.unit_prices up, today
   WHERE up.valid_from <= today.d AND (up.valid_to IS NULL OR up.valid_to > today.d)
)
SELECT l.list, u.product_id, p.sku, p.name AS product_name, u.id AS product_unit_id,
       m.name AS unit_name, u.factor_to_base, u.is_base,
       coalesce(own.price, round(base.price * u.factor_to_base, 0)::numeric(14, 2)) AS price,
       CASE WHEN own.price IS NOT NULL THEN 'UNIT' ELSE 'DERIVED' END AS price_source,
       own.valid_from, own.valid_to
  FROM public.product_units u
  CROSS JOIN (VALUES ('WHOLESALE'), ('RETAIL')) AS l (list)
  JOIN public.products p ON p.id = u.product_id
  JOIN public.uoms m ON m.id = u.uom_id
  LEFT JOIN in_force own ON own.list = l.list AND own.product_unit_id = u.id
  LEFT JOIN public.product_units bu ON bu.product_id = u.product_id AND bu.is_base
  LEFT JOIN in_force base ON base.list = l.list AND base.product_unit_id = bu.id
 WHERE u.superseded_at IS NULL
   AND (own.price IS NOT NULL OR (base.price IS NOT NULL AND NOT u.is_base));
--> statement-breakpoint

-- Every price period that applied (a row closed on its first day never did).
CREATE VIEW ai.price_history AS
SELECT up.id, up.list, u.product_id, p.sku, p.name AS product_name, up.product_unit_id,
       m.name AS unit_name, up.price, up.valid_from, up.valid_to, up.created_at,
       cu.full_name AS created_by_name
  FROM public.unit_prices up
  JOIN public.product_units u ON u.id = up.product_unit_id
  JOIN public.products p ON p.id = u.product_id
  JOIN public.uoms m ON m.id = u.uom_id
  LEFT JOIN public.users cu ON cu.id = up.created_by
 WHERE up.valid_to IS NULL OR up.valid_to > up.valid_from;
--> statement-breakpoint

-- Status today as DiscountProgramsService.statusOf: ENDED from valid_to on (or never applied),
-- SCHEDULED before valid_from, else ACTIVE. Steps as text "threshold => value; …".
CREATE VIEW ai.discount_programs AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT dp.id, dp.name, dp.list, dp.scope, dp.measure, dp.effect, dp.product_id,
       p.name AS product_name, pm.name AS unit_name, tm.name AS threshold_unit_name,
       dp.category_id, c.path AS category_path, cm.name AS count_unit_name, dp.valid_from,
       dp.valid_to,
       CASE WHEN dp.valid_to IS NOT NULL AND (dp.valid_to <= today.d OR dp.valid_to <= dp.valid_from)
            THEN 'ENDED'
            WHEN dp.valid_from > today.d THEN 'SCHEDULED'
            ELSE 'ACTIVE' END AS status,
       (SELECT string_agg(s.threshold::text || ' => ' || s.value::text, '; ' ORDER BY s.threshold)
          FROM public.discount_steps s WHERE s.program_id = dp.id) AS steps,
       dp.created_at, u.full_name AS created_by_name
  FROM public.discount_programs dp
  CROSS JOIN today
  LEFT JOIN public.products p ON p.id = dp.product_id
  LEFT JOIN public.product_units pu ON pu.id = dp.product_unit_id
  LEFT JOIN public.uoms pm ON pm.id = pu.uom_id
  LEFT JOIN public.product_units tu ON tu.id = dp.threshold_unit_id
  LEFT JOIN public.uoms tm ON tm.id = tu.uom_id
  LEFT JOIN ai.categories c ON c.id = dp.category_id
  LEFT JOIN public.uoms cm ON cm.id = dp.count_uom_id
  LEFT JOIN public.users u ON u.id = dp.created_by;
--> statement-breakpoint

-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;