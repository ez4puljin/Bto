-- Management reports (ADR-0108, docs/modules/reporting.md). SQL only: schema `reporting` with the
-- daily sales totals as a materialized view refreshed every 15 minutes by the job
-- `reporting.refresh`, and live views over the Finance Core's receivables and payables (only a
-- migration names a `fin` relation, tools/finance-core/fin-sql.test.mjs). Owned by migrator; app
-- gets USAGE, SELECT and EXECUTE on the refresh function, nothing else; ai_reader nothing.
-- Rules: sales are ex-VAT and ex-city-tax and net of returns (owner, 2026-10-24); a sale's cost is
-- what the stock ledger booked out (ADR-0033, ADR-0097), a re-costing's variance a COST_ADJ row.
-- A later migration that changes a column used here recreates the object in the same migration.
CREATE SCHEMA reporting;
--> statement-breakpoint
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA reporting TO app;
--> statement-breakpoint

-- Every sold line, live, with its document (the drill-down from a total to its documents):
--   WHOLESALE  issued invoices (+) and their credit notes (−); the rep is the order's author,
--              none for «Bto300» orders (channel CUSTOMER_APP);
--   POS        the till's sales (+) and returns (−), no customer and no rep;
--   COST_ADJ   a re-costing's variance on goods already gone (stock_valuation_adjustments), cost only.
-- An invoice line's cost is its share of what the order line booked out (an order line may be
-- invoiced in parts per unit); a credit note's and a till line's cost are their own ledger rows.
-- The ledger rows are found by (doc_type, doc_line_id), the ledger's unique index stock_ledger_idem.
CREATE VIEW reporting.sales_lines AS
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
UNION ALL
SELECT CASE WHEN s.kind = 'RETURN' THEN 'POS_RETURN' ELSE 'POS_SALE' END, s.id, s.number,
       NULL::bigint, s.sold_day::date, 'POS', 'POS', pc.warehouse_id, NULL::bigint, pl.product_id,
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
--> statement-breakpoint

-- One row per day × source × channel × warehouse × customer × product × rep, rebuilt from
-- reporting.sales_lines every 15 minutes (owner, 2026-10-24) and on «Шинэчлэх».
CREATE MATERIALIZED VIEW reporting.mv_sales_daily AS
SELECT f.day, f.source, f.channel, f.warehouse_id, w.branch_id, f.customer_id, f.product_id,
       p.category_id, f.rep_user_id,
       concat_ws(':', f.day, f.source, f.channel, coalesce(f.warehouse_id, 0), coalesce(f.customer_id, 0),
                 f.product_id, coalesce(f.rep_user_id, 0)) AS row_key,
       sum(f.qty_base)::numeric(18, 3) AS qty_base,
       sum(f.net_sales)::numeric(16, 2) AS net_sales,
       round(sum(f.cost), 2)::numeric(16, 2) AS cost,
       sum(f.returns)::numeric(16, 2) AS returns,
       count(*)::integer AS line_count
  FROM reporting.sales_lines f
  JOIN public.products p ON p.id = f.product_id
  LEFT JOIN public.warehouses w ON w.id = f.warehouse_id
 GROUP BY f.day, f.source, f.channel, f.warehouse_id, w.branch_id, f.customer_id, f.product_id,
          p.category_id, f.rep_user_id
WITH DATA;
--> statement-breakpoint
-- REFRESH … CONCURRENTLY needs a unique index on plain columns, without a predicate: row_key
-- spells the grouping (branch and category follow from the warehouse and the product).
CREATE UNIQUE INDEX mv_sales_daily_key ON reporting.mv_sales_daily (row_key);
--> statement-breakpoint
CREATE INDEX mv_sales_daily_product ON reporting.mv_sales_daily (product_id, day);
--> statement-breakpoint
CREATE INDEX mv_sales_daily_customer ON reporting.mv_sales_daily (customer_id, day);
--> statement-breakpoint

-- When the totals were last rebuilt (one row; written only by reporting.refresh_sales()).
CREATE TABLE reporting.refresh_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  refreshed_at timestamptz,
  duration_ms integer
);
--> statement-breakpoint
INSERT INTO reporting.refresh_state (id, refreshed_at, duration_ms) VALUES (1, now(), 0);
--> statement-breakpoint

-- Rebuilds the totals as their owner (app cannot refresh a view it does not own). One run at a
-- time: a second caller gets NULL at once. Returns the time the rebuilt data is as of.
CREATE FUNCTION reporting.refresh_sales() RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  started timestamptz := clock_timestamp();
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('reporting.refresh_sales')) THEN
    RETURN NULL;
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY reporting.mv_sales_daily;
  UPDATE reporting.refresh_state
     SET refreshed_at = started,
         duration_ms = (extract(epoch FROM clock_timestamp() - started) * 1000)::integer
   WHERE id = 1;
  RETURN started;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reporting.refresh_sales() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reporting.refresh_sales() TO app;
--> statement-breakpoint

-- The receivables' open items, live (the aging and the dashboard's receivables). A DEBIT item is
-- owed by the customer, a CREDIT item an advance or an unapplied payment. `customer_id` is NULL for
-- a party that is not a Bto customer (the legacy party of the opening, ADR-0084).
CREATE VIEW reporting.ar_open_items AS
SELECT c.code AS company_code, i.id AS item_id, i.party_id, pa.name AS party_name,
       CASE WHEN r.external_id IS NULL THEN NULL ELSE substring(r.external_id FROM 10)::bigint END
         AS customer_id,
       i.side, i.item_date, i.due_date, i.amount, i.open_amount,
       d.id AS document_id, d.class AS document_class, d.number AS document_number,
       d.source_doc_type, d.source_doc_id
  FROM fin.open_items i
  JOIN fin.accounts a ON a.company_id = i.company_id AND a.id = i.account_id
  JOIN fin.companies c ON c.id = i.company_id
  JOIN fin.parties pa ON pa.tenant_id = c.tenant_id AND pa.id = i.party_id
  JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
  LEFT JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
  LEFT JOIN fin.party_refs r
    ON r.tenant_id = c.tenant_id AND r.source_system_id = s.id AND r.party_id = i.party_id
   AND r.external_id LIKE 'customer:%'
 WHERE a.control = 'RECEIVABLE' AND i.open_amount > 0;
--> statement-breakpoint

-- The suppliers' payables by journal entry, live (the supplier report). `amount` is what the entry
-- added to the payable (+ a bill, − a payment or a credit); `vat_amount` the entry's input VAT.
-- `kind`: PURCHASE (a goods receipt's bill, a re-costing's difference, a supplier return),
-- OPENING, PAYMENT (any other entry that lowers the payable) or OTHER_BILL (one that raises it:
-- a service bill by a manual entry); a reversal keeps the kind of the entry it reverses.
CREATE VIEW reporting.ap_entries AS
WITH lines AS (
  SELECT l.company_id, l.entry_id, l.party_id, sum(l.credit - l.debit) AS amount
    FROM fin.journal_lines l
    JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
   WHERE a.control = 'PAYABLE' AND l.party_id IS NOT NULL
   GROUP BY l.company_id, l.entry_id, l.party_id
), entries AS (
  SELECT x.*, e.entry_date, e.number AS entry_number, e.reverses_id, e.document_id,
         coalesce(d.source_doc_type, e.source_doc_type) AS source_doc_type,
         coalesce(d.source_doc_id, e.source_doc_id) AS source_doc_id,
         d.number AS document_number, d.class AS document_class,
         (SELECT coalesce(sum(v.debit - v.credit), 0) FROM fin.journal_lines v
           WHERE v.company_id = x.company_id AND v.entry_id = x.entry_id
             AND v.posting_key = 'VAT_INPUT') AS vat_amount
    FROM lines x
    JOIN fin.journal_entries e ON e.company_id = x.company_id AND e.id = x.entry_id
    LEFT JOIN fin.documents d ON d.company_id = e.company_id AND d.id = e.document_id
), kinds AS (
  SELECT en.*,
         CASE WHEN en.source_doc_type IN ('GOODS_RECEIPT', 'RECEIPT_RECOST', 'SUPPLIER_RETURN')
                THEN 'PURCHASE'
              WHEN en.source_doc_type = 'OPENING' THEN 'OPENING'
              WHEN en.amount < 0 THEN 'PAYMENT'
              ELSE 'OTHER_BILL' END AS own_kind
    FROM entries en
)
SELECT c.code AS company_code, k.entry_id, k.entry_date, k.entry_number, k.party_id,
       pa.name AS party_name,
       CASE WHEN r.external_id IS NULL THEN NULL ELSE substring(r.external_id FROM 10)::bigint END
         AS supplier_id,
       coalesce(o.own_kind, k.own_kind) AS kind, k.amount, k.vat_amount, k.document_id,
       k.document_class, k.document_number, k.source_doc_type, k.source_doc_id,
       k.reverses_id IS NOT NULL AS is_reversal
  FROM kinds k
  LEFT JOIN kinds o ON o.company_id = k.company_id AND o.entry_id = k.reverses_id
                   AND o.party_id = k.party_id
  JOIN fin.companies c ON c.id = k.company_id
  JOIN fin.parties pa ON pa.tenant_id = c.tenant_id AND pa.id = k.party_id
  LEFT JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
  LEFT JOIN fin.party_refs r
    ON r.tenant_id = c.tenant_id AND r.source_system_id = s.id AND r.party_id = k.party_id
   AND r.external_id LIKE 'supplier:%';
--> statement-breakpoint
-- The control accounts' movement by day, live: a balance on any date is the sum up to it (the
-- dashboard's receivables a month and a year ago).
CREATE VIEW reporting.control_daily AS
SELECT c.code AS company_code, a.control, e.entry_date, sum(l.debit - l.credit) AS net_debit
  FROM fin.journal_lines l
  JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
  JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN fin.companies c ON c.id = l.company_id
 WHERE a.control IN ('RECEIVABLE', 'PAYABLE')
 GROUP BY c.code, a.control, e.entry_date;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO app;
