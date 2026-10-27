ALTER TABLE "pos_shifts" DROP CONSTRAINT "pos_shifts_money";--> statement-breakpoint
ALTER TABLE "pos_tenders" DROP CONSTRAINT "pos_tenders_kind";--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "customer_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_total" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "invoice_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_note_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_doc_number" text;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_excess" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_reviewed_by" bigint;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "credit_review_note" text;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "credit_sales" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "credit_refunds" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_credit_reviewed_by_users_id_fk" FOREIGN KEY ("credit_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_sales_customer_idx" ON "pos_sales" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sales_invoice" ON "pos_sales" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sales_credit_note" ON "pos_sales" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "pos_sales_credit_excess_idx" ON "pos_sales" USING btree ("id") WHERE "pos_sales"."credit_excess" IS NOT NULL AND "pos_sales"."credit_reviewed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_credit" CHECK ("pos_sales"."credit_total" >= 0 AND "pos_sales"."credit_total" <= "pos_sales"."total" AND ("pos_sales"."credit_total" = 0 OR ("pos_sales"."customer_id" IS NOT NULL AND "pos_sales"."receipt_type" = 'B2C' AND "pos_sales"."ebarimt_status" = 'NONE')));--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_credit_docs" CHECK (("pos_sales"."invoice_id" IS NULL OR ("pos_sales"."kind" = 'SALE' AND "pos_sales"."credit_total" > 0)) AND ("pos_sales"."credit_note_id" IS NULL OR ("pos_sales"."kind" = 'RETURN' AND "pos_sales"."credit_total" > 0)));--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_credit_review" CHECK (("pos_sales"."credit_excess" IS NULL OR "pos_sales"."credit_excess" > 0) AND ("pos_sales"."credit_reviewed_at" IS NULL) = ("pos_sales"."credit_reviewed_by" IS NULL) AND ("pos_sales"."credit_reviewed_at" IS NULL OR "pos_sales"."credit_excess" IS NOT NULL) AND ("pos_sales"."credit_review_note" IS NULL OR length("pos_sales"."credit_review_note") BETWEEN 1 AND 300));--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_money" CHECK ("pos_shifts"."cash_sales" >= 0 AND "pos_shifts"."cash_refunds" >= 0 AND "pos_shifts"."credit_sales" >= 0 AND "pos_shifts"."credit_refunds" >= 0 AND "pos_shifts"."card_sales" >= 0 AND "pos_shifts"."card_refunds" >= 0 AND "pos_shifts"."sales_total" >= 0 AND "pos_shifts"."returns_total" >= 0 AND "pos_shifts"."sales_count" >= 0 AND "pos_shifts"."returns_count" >= 0 AND ("pos_shifts"."counted_cash" IS NULL OR "pos_shifts"."counted_cash" >= 0) AND ("pos_shifts"."float_kept" IS NULL OR "pos_shifts"."float_kept" >= 0));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_kind" CHECK ("pos_tenders"."kind" IN ('CASH', 'CARD', 'CREDIT'));--> statement-breakpoint
-- ADR-0109: a till's sale on credit is invoiced (and its return credited) to keep the customer's
-- receivable; the management reports still count it once, as a POS sale (now with its customer),
-- so its invoice and credit note leave the WHOLESALE rows. Same columns, so the materialized view
-- built on it stays.
CREATE OR REPLACE VIEW reporting.sales_lines AS
SELECT 'INVOICE'::text AS doc_kind, i.id AS doc_id, i.number AS doc_number, i.order_id,
       i.invoice_date AS day, 'WHOLESALE'::text AS source, coalesce(o.channel, 'ADMIN') AS channel,
       il.warehouse_id, i.customer_id, il.product_id,
       CASE WHEN o.channel = 'CUSTOMER_APP' THEN NULL ELSE coalesce(o.created_by, i.created_by) END
         AS rep_user_id,
       il.qty_base,
       il.total - il.vat_amount - il.city_tax_amount AS net_sales,
       coalesce(round(il.qty_base * sc.cost / nullif(sc.qty, 0), 4), 0) AS cost,
       0::numeric AS returns
  FROM public.invoices i
  JOIN public.invoice_lines il ON il.invoice_id = i.id
  LEFT JOIN public.sales_orders o ON o.id = i.order_id
  LEFT JOIN LATERAL (
    SELECT sum(-l.qty_base) AS qty, sum(-l.qty_base * l.unit_cost) AS cost
      FROM public.stock_ledger l
     WHERE l.doc_type = 'SO' AND l.doc_line_id = il.order_line_id
       AND l.movement_type = 'DELIVERY_ISSUE') sc ON true
 WHERE i.status = 'ISSUED'
   AND NOT EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.invoice_id = i.id)
UNION ALL
SELECT 'CREDIT_NOTE', cn.id, cn.number, i.order_id, cn.note_date, 'WHOLESALE',
       coalesce(o.channel, 'ADMIN'), coalesce(cn.warehouse_id, il.warehouse_id), cn.customer_id,
       cnl.product_id,
       CASE WHEN o.channel = 'CUSTOMER_APP' THEN NULL ELSE coalesce(o.created_by, i.created_by) END,
       -cnl.qty_base,
       -(cnl.total - cnl.vat_amount - cnl.city_tax_amount),
       -coalesce(cc.cost, 0),
       cnl.total - cnl.vat_amount - cnl.city_tax_amount
  FROM public.credit_notes cn
  JOIN public.credit_note_lines cnl ON cnl.credit_note_id = cn.id
  JOIN public.invoices i ON i.id = cn.invoice_id
  LEFT JOIN public.invoice_lines il ON il.id = cnl.invoice_line_id
  LEFT JOIN public.sales_orders o ON o.id = i.order_id
  LEFT JOIN LATERAL (
    SELECT sum(l.qty_base * l.unit_cost) AS cost
      FROM public.stock_ledger l
     WHERE l.doc_type = 'CN' AND l.doc_line_id = cnl.id AND l.movement_type = 'RETURN_IN') cc ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.credit_note_id = cn.id)
UNION ALL
SELECT CASE WHEN s.kind = 'RETURN' THEN 'POS_RETURN' ELSE 'POS_SALE' END, s.id, s.number,
       NULL::bigint, s.sold_day::date, 'POS', 'POS', pc.warehouse_id, s.customer_id, pl.product_id,
       NULL::bigint,
       CASE WHEN s.kind = 'RETURN' THEN -pl.qty_base ELSE pl.qty_base END,
       CASE WHEN s.kind = 'RETURN' THEN -(pl.total - pl.vat_amount) ELSE pl.total - pl.vat_amount END,
       coalesce(pc.cost, 0),
       CASE WHEN s.kind = 'RETURN' THEN pl.total - pl.vat_amount ELSE 0 END
  FROM public.pos_sales s
  JOIN public.pos_sale_lines pl ON pl.sale_id = s.id
  LEFT JOIN LATERAL (
    SELECT min(l.warehouse_id) AS warehouse_id, sum(-l.qty_base * l.unit_cost) AS cost
      FROM public.stock_ledger l
     WHERE l.doc_type = 'POS' AND l.doc_line_id = pl.id
       AND l.movement_type IN ('POS_SALE', 'RETURN_IN')) pc ON true
UNION ALL
SELECT 'COST_ADJ', a.doc_id, NULL::text, NULL::bigint, a.effective_date, 'COST_ADJ', 'NONE',
       a.warehouse_id, NULL::bigint, a.product_id, NULL::bigint, 0::numeric, 0::numeric, a.variance,
       0::numeric
  FROM public.stock_valuation_adjustments a
 WHERE a.variance <> 0;
