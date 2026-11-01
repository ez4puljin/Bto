import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import { type BookDocType, idsIn, warehouseMovement } from './book-sql';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import { allOf, dateText, dec, int, intOrNull, money, rowsOf, textOrNull } from './report-sql';

export interface StockDocumentsFilter {
  from: string;
  to: string;
  docTypes?: readonly BookDocType[];
  warehouseIds?: readonly number[];
  productId?: number;
  customerId?: number;
  supplierId?: number;
  /** The staff member who wrote the document (the cashier for the till). */
  userId?: number;
}

export const STOCK_PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'USER', 'NAME'] as const;
export type StockPartyKind = (typeof STOCK_PARTY_KINDS)[number];

/** One stock document of the period with its movement and, for a sale, its amounts. */
export interface StockDocumentRow {
  docType: BookDocType;
  docId: number;
  number: string | null;
  date: string;
  note: string | null;
  /** An adjustment's reason code. */
  reason: string | null;
  /** A transfer's warehouses. */
  sourceWarehouse: string | null;
  destWarehouse: string | null;
  authorName: string | null;
  partyKind: StockPartyKind | null;
  partyId: number | null;
  partyName: string | null;
  /** The invoice of a sold order, or the one a credit note corrects. */
  invoiceId: number | null;
  inQty: string;
  outQty: string;
  /** At cost; null without `reports.margins.view`. */
  inValue: string | null;
  outValue: string | null;
  /** A sale's or return's amount with VAT, and without VAT and city tax. */
  total: string | null;
  net: string | null;
}

export interface StockDocumentsReport extends DateRange {
  rows: StockDocumentRow[];
  totals: {
    inValue: string | null;
    outValue: string | null;
    total: string;
    net: string;
  };
  truncated: boolean;
}

/** One product of a document. */
export interface StockDocumentLine {
  productId: number;
  sku: string;
  name: string;
  unit: string | null;
  warehouseId: number;
  warehouseName: string;
  /** Signed: in positive, out negative (base units). */
  qty: string;
  unitCost: string | null;
  value: string | null;
}

const MAX_ROWS = 3_000;

/**
 * Erkhet's «Бараа материалын тайлан /баримтаар/» on Bto's stock ledger (ADR-0133): one row per
 * stock document of the period — receipt, issue, transfer, adjustment, count, sold order, till
 * sale, credit note — with its number, date, note, author, party, the quantities and cost that
 * moved and, for sales and returns, the amount with and without VAT; the products of a document.
 */
@Injectable()
export class StockDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async report(ctx: AuthContext, filter: StockDocumentsFilter): Promise<StockDocumentsReport> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(filter.from, filter.to);
    const movement = allOf([
      warehouseMovement,
      sql`l.effective_date BETWEEN ${range.from}::date AND ${range.to}::date`,
      filter.docTypes?.length
        ? sql`l.doc_type IN (${sql.join(
            filter.docTypes.map((type) => sql`${type}`),
            sql`, `,
          )})`
        : null,
      idsIn(sql`l.warehouse_id`, filter.warehouseIds),
      filter.productId ? sql`l.product_id = ${filter.productId}` : null,
    ]);
    const header = allOf([
      filter.customerId
        ? sql`h.party_kind = 'CUSTOMER' AND h.party_id = ${filter.customerId}`
        : null,
      filter.supplierId
        ? sql`h.party_kind = 'SUPPLIER' AND h.party_id = ${filter.supplierId}`
        : null,
      filter.userId ? sql`h.author_id = ${filter.userId}` : null,
    ]);
    const rows = await rowsOf(
      this.db,
      sql`WITH d AS (
            SELECT l.doc_type, l.doc_id, min(l.effective_date) AS day, min(l.id) AS first_id,
                   coalesce(sum(l.qty_base) FILTER (WHERE l.qty_base > 0), 0) AS in_qty,
                   coalesce(sum(-l.qty_base) FILTER (WHERE l.qty_base < 0), 0) AS out_qty,
                   coalesce(sum(l.qty_base * l.unit_cost) FILTER (WHERE l.qty_base > 0), 0) AS in_value,
                   coalesce(sum(-l.qty_base * l.unit_cost) FILTER (WHERE l.qty_base < 0), 0) AS out_value
              FROM public.stock_ledger l
             WHERE ${movement}
             GROUP BY l.doc_type, l.doc_id)
          SELECT d.*, h.number, h.note, h.reason, h.source_wh, h.dest_wh, h.author_id,
                 u.full_name AS author_name, h.party_kind, h.party_id, h.party_name, h.invoice_id,
                 h.total, h.net
            FROM d
            LEFT JOIN LATERAL (${headerSql}) h ON TRUE
            LEFT JOIN public.users u ON u.id = h.author_id
           WHERE ${header}
           ORDER BY d.day, d.first_id
           LIMIT ${MAX_ROWS + 1}`,
    );
    const sums = {
      in: new Decimal(0),
      out: new Decimal(0),
      total: new Decimal(0),
      net: new Decimal(0),
    };
    const out = rows.slice(0, MAX_ROWS).map((row): StockDocumentRow => {
      const inValue = dec(row.in_value);
      const outValue = dec(row.out_value);
      sums.in = sums.in.plus(inValue);
      sums.out = sums.out.plus(outValue);
      if (row.total !== null) sums.total = sums.total.plus(dec(row.total));
      if (row.net !== null) sums.net = sums.net.plus(dec(row.net));
      return {
        docType: row.doc_type as BookDocType,
        docId: int(row.doc_id),
        number: textOrNull(row.number),
        date: dateText(row.day) ?? '',
        note: textOrNull(row.note),
        reason: textOrNull(row.reason),
        sourceWarehouse: textOrNull(row.source_wh),
        destWarehouse: textOrNull(row.dest_wh),
        authorName: textOrNull(row.author_name),
        partyKind: (textOrNull(row.party_kind) as StockPartyKind | null) ?? null,
        partyId: intOrNull(row.party_id),
        partyName: textOrNull(row.party_name),
        invoiceId: intOrNull(row.invoice_id),
        inQty: dec(row.in_qty).toFixed(),
        outQty: dec(row.out_qty).toFixed(),
        inValue: scope.margins ? money(inValue) : null,
        outValue: scope.margins ? money(outValue) : null,
        total: row.total === null ? null : money(dec(row.total)),
        net: row.net === null ? null : money(dec(row.net)),
      };
    });
    return {
      ...range,
      rows: out,
      totals: {
        inValue: scope.margins ? money(sums.in) : null,
        outValue: scope.margins ? money(sums.out) : null,
        total: money(sums.total),
        net: money(sums.net),
      },
      truncated: rows.length > MAX_ROWS,
    };
  }

  /** The products a document moved (in the filter's warehouses), in ledger order. */
  async lines(
    ctx: AuthContext,
    query: { docType: BookDocType; docId: number; warehouseIds?: readonly number[] },
  ): Promise<StockDocumentLine[]> {
    const scope = await this.context.scope(ctx);
    const rows = await rowsOf(
      this.db,
      sql`SELECT l.product_id, p.sku, p.name, u.name AS unit, l.warehouse_id, w.name AS warehouse_name,
                 sum(l.qty_base) AS qty, sum(l.qty_base * l.unit_cost) AS value, min(l.id) AS first_id
            FROM public.stock_ledger l
            JOIN public.products p ON p.id = l.product_id
            JOIN public.warehouses w ON w.id = l.warehouse_id
            LEFT JOIN public.product_units pu ON pu.product_id = p.id AND pu.is_base AND pu.superseded_by IS NULL
            LEFT JOIN public.uoms u ON u.id = pu.uom_id
           WHERE ${allOf([
             warehouseMovement,
             sql`l.doc_type = ${query.docType} AND l.doc_id = ${query.docId}`,
             idsIn(sql`l.warehouse_id`, query.warehouseIds),
           ])}
           GROUP BY l.product_id, p.sku, p.name, u.name, l.warehouse_id, w.name
           ORDER BY first_id`,
    );
    if (rows.length === 0) throw notFound('stock document', query.docId);
    return rows.map((row) => {
      const qty = dec(row.qty);
      const value = dec(row.value);
      return {
        productId: int(row.product_id),
        sku: textOrNull(row.sku) ?? '',
        name: textOrNull(row.name) ?? '',
        unit: textOrNull(row.unit),
        warehouseId: int(row.warehouse_id),
        warehouseName: textOrNull(row.warehouse_name) ?? '',
        qty: qty.toFixed(),
        unitCost: scope.margins && !qty.isZero() ? money(value.div(qty).abs()) : null,
        value: scope.margins ? money(value.abs()) : null,
      };
    });
  }
}

/**
 * A document's header by the ledger's `d.doc_type` / `d.doc_id`: number, note, reason (ADJ), the
 * transfer's warehouses, author, party and, for a sale or a return, the amounts with and without
 * VAT.
 */
const headerSql = sql`
  SELECT g.number, g.note, NULL::text AS reason, NULL::text AS source_wh, NULL::text AS dest_wh,
         g.created_by AS author_id, 'SUPPLIER'::text AS party_kind, g.supplier_id AS party_id,
         s.name::text AS party_name, NULL::bigint AS invoice_id, NULL::numeric AS total, NULL::numeric AS net
    FROM public.goods_receipts g LEFT JOIN public.suppliers s ON s.id = g.supplier_id
   WHERE d.doc_type = 'GR' AND g.id = d.doc_id
  UNION ALL
  SELECT g.number, g.note, NULL, NULL, NULL, g.created_by,
         CASE WHEN g.recipient_customer_id IS NOT NULL THEN 'CUSTOMER'
              WHEN g.recipient_supplier_id IS NOT NULL THEN 'SUPPLIER'
              WHEN g.recipient_user_id IS NOT NULL THEN 'USER'
              WHEN g.recipient_name IS NOT NULL THEN 'NAME' END,
         coalesce(g.recipient_customer_id, g.recipient_supplier_id, g.recipient_user_id),
         coalesce(c.name, s.name, ru.full_name, g.recipient_name)::text, NULL, NULL, NULL
    FROM public.goods_issues g
    LEFT JOIN public.customers c ON c.id = g.recipient_customer_id
    LEFT JOIN public.suppliers s ON s.id = g.recipient_supplier_id
    LEFT JOIN public.users ru ON ru.id = g.recipient_user_id
   WHERE d.doc_type = 'GI' AND g.id = d.doc_id
  UNION ALL
  SELECT t.number, t.note, NULL, sw.name, dw.name, t.created_by, NULL, NULL, NULL, NULL, NULL, NULL
    FROM public.transfers t
    LEFT JOIN public.warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN public.warehouses dw ON dw.id = t.dest_warehouse_id
   WHERE d.doc_type = 'TR' AND t.id = d.doc_id
  UNION ALL
  SELECT a.number, a.note, a.reason, NULL, NULL, a.created_by, NULL, NULL, NULL, NULL, NULL, NULL
    FROM public.adjustments a WHERE d.doc_type = 'ADJ' AND a.id = d.doc_id
  UNION ALL
  SELECT k.number, k.note, NULL, NULL, NULL, k.created_by, NULL, NULL, NULL, NULL, NULL, NULL
    FROM public.stocktakes k WHERE d.doc_type = 'ST' AND k.id = d.doc_id
  UNION ALL
  SELECT o.number, o.note, NULL, NULL, NULL, o.created_by, 'CUSTOMER', o.customer_id, c.name::text,
         (SELECT max(i.id) FROM public.invoices i WHERE i.order_id = o.id AND i.status = 'ISSUED'),
         (SELECT sum(i.total) FROM public.invoices i WHERE i.order_id = o.id AND i.status = 'ISSUED'),
         (SELECT sum(i.total - i.vat_total - i.city_tax_total) FROM public.invoices i
           WHERE i.order_id = o.id AND i.status = 'ISSUED')
    FROM public.sales_orders o LEFT JOIN public.customers c ON c.id = o.customer_id
   WHERE d.doc_type = 'SO' AND o.id = d.doc_id
  UNION ALL
  SELECT ps.number, ps.note, NULL, NULL, NULL, ps.cashier_user_id,
         CASE WHEN ps.customer_id IS NOT NULL THEN 'CUSTOMER'
              WHEN ps.customer_name IS NOT NULL THEN 'NAME' END,
         ps.customer_id, coalesce(c.name, ps.customer_name)::text, NULL,
         CASE WHEN ps.kind = 'RETURN' THEN -ps.total ELSE ps.total END,
         CASE WHEN ps.kind = 'RETURN' THEN -(ps.total - ps.vat_total) ELSE ps.total - ps.vat_total END
    FROM public.pos_sales ps LEFT JOIN public.customers c ON c.id = ps.customer_id
   WHERE d.doc_type = 'POS' AND ps.id = d.doc_id
  UNION ALL
  SELECT n.number, n.reason, NULL, NULL, NULL, n.created_by, 'CUSTOMER', n.customer_id, c.name::text,
         n.invoice_id, -n.total, -(n.total - n.vat_total - n.city_tax_total)
    FROM public.credit_notes n LEFT JOIN public.customers c ON c.id = n.customer_id
   WHERE d.doc_type = 'CN' AND n.id = d.doc_id`;
