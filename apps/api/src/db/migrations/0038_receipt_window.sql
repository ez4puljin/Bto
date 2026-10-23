-- ADR-0099 #1: a receipt's lines may lie in several wholesale warehouses, each its product's home;
-- the warehouse moves from the header to the line (backfilled from the header, then required).
ALTER TABLE "goods_receipt_lines" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
UPDATE "goods_receipt_lines" l SET "warehouse_id" = r."warehouse_id"
  FROM "goods_receipts" r WHERE r."id" = l."receipt_id";--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ALTER COLUMN "warehouse_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "sale_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "discount_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "discount_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_warehouse_idx" ON "goods_receipt_lines" USING btree ("warehouse_id","receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_product_idx" ON "goods_receipt_lines" USING btree ("product_id","id");--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_sale_price" CHECK ("goods_receipt_lines"."sale_price" IS NULL OR ("goods_receipt_lines"."sale_price" > 0 AND "goods_receipt_lines"."sale_price" = trunc("goods_receipt_lines"."sale_price")));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_discount" CHECK (("goods_receipts"."discount_pct" IS NULL OR "goods_receipts"."discount_amount" IS NULL)
        AND ("goods_receipts"."discount_pct" IS NULL OR ("goods_receipts"."discount_pct" > 0 AND "goods_receipts"."discount_pct" <= 100))
        AND ("goods_receipts"."discount_amount" IS NULL OR "goods_receipts"."discount_amount" > 0));--> statement-breakpoint
-- ADR-0099 #4: each costing version keeps the line's share of the delivery note's discount; the
-- payable is doc_amount less it. The table is defined in 0006 (--custom), so drizzle-kit does not see it.
ALTER TABLE "stock_valuation_adjustments" ADD COLUMN "discount_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "stock_valuation_adjustments" ADD CONSTRAINT "stock_valuation_adjustments_discount_amount" CHECK ("discount_amount" IS NULL OR ("discount_amount" >= 0 AND "doc_amount" IS NOT NULL AND "discount_amount" <= "doc_amount"));--> statement-breakpoint
-- The assistant's views read the warehouse from the line (ADR-0045: a migration that changes a
-- column an ai.* view uses recreates the view). A receipt's header row names its warehouse only
-- when all its lines share one; warehouse_name lists them.
CREATE OR REPLACE VIEW ai.stock_documents AS
SELECT 'GR'::text AS doc_type, r.id, r.number, r.status, rw.warehouse_id,
       rw.warehouse_name, NULL::bigint AS dest_warehouse_id, NULL::text AS dest_warehouse_name,
       r.supplier_id, s.name AS supplier_name, r.supplier_doc_no, NULL::text AS adjustment_reason,
       r.costing_status, r.effective_date, NULL::date AS ship_date, NULL::date AS receive_date,
       r.posted_at, r.created_at, cu.full_name AS created_by_name, pu.full_name AS posted_by_name,
       r.note
  FROM public.goods_receipts r
  JOIN public.suppliers s ON s.id = r.supplier_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(DISTINCT gl.warehouse_id) = 1 THEN min(gl.warehouse_id) END AS warehouse_id,
           string_agg(DISTINCT w.name, ', ') AS warehouse_name
      FROM public.goods_receipt_lines gl
      JOIN public.warehouses w ON w.id = gl.warehouse_id
     WHERE gl.receipt_id = r.id
  ) rw ON true
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
  LEFT JOIN public.users pu ON pu.id = g.posted_by;;
--> statement-breakpoint
CREATE OR REPLACE VIEW ai.receipt_lines AS
SELECT r.id AS receipt_id, r.number AS receipt_number, r.status AS receipt_status,
       r.effective_date AS receipt_date, gl.warehouse_id, w.name AS warehouse_name, r.supplier_id,
       s.name AS supplier_name, r.supplier_doc_no, r.costing_status, gl.id AS line_id,
       gl.product_id, p.sku, p.name AS product_name, gl.entered_qty, m.name AS entered_unit,
       gl.qty_base, base_uom.name AS base_unit, c.amount, c.free_goods,
       CASE WHEN c.amount IS NOT NULL AND gl.qty_base > 0
            THEN round(c.amount / gl.qty_base, 4) END AS unit_cost,
       c.doc_amount, c.discount_amount
  FROM public.goods_receipt_lines gl
  JOIN public.goods_receipts r ON r.id = gl.receipt_id
  JOIN public.warehouses w ON w.id = gl.warehouse_id
  JOIN public.suppliers s ON s.id = r.supplier_id
  JOIN public.products p ON p.id = gl.product_id
  JOIN public.product_units pu ON pu.id = gl.product_unit_id
  JOIN public.uoms m ON m.id = pu.uom_id
  LEFT JOIN public.product_units bu ON bu.product_id = gl.product_id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id
  LEFT JOIN LATERAL (
    SELECT v.amount, v.free_goods, v.doc_amount, v.discount_amount
      FROM public.stock_valuation_adjustments v
     WHERE v.doc_type = 'GR' AND v.doc_line_id = gl.id
     ORDER BY v.version DESC
     LIMIT 1
  ) c ON true;
--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk";--> statement-breakpoint
DROP INDEX "goods_receipts_warehouse_idx";--> statement-breakpoint
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts" USING btree ("status","id");--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "warehouse_id";