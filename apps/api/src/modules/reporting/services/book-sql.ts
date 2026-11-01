import { type SQL, sql } from 'drizzle-orm';

/**
 * The ledger's movements that change a warehouse's stock (ADR-0133): receipts, sales, issues,
 * returns, transfers and corrections. The bin moves inside a warehouse (put-away, bin to bin,
 * picking, dispatch) leave the warehouse's quantity and value as they were and are left out.
 */
export const WAREHOUSE_MOVEMENTS = [
  'RECEIPT',
  'DELIVERY_ISSUE',
  'POS_SALE',
  'GOODS_ISSUE',
  'GOODS_ISSUE_REVERSAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RETURN_IN',
  'ADJUSTMENT',
  'COUNT_CORRECTION',
] as const;

/** `l.movement_type IN (…)` over the warehouse movements (ledger alias `l`). */
export const warehouseMovement: SQL = sql`l.movement_type IN (${sql.join(
  WAREHOUSE_MOVEMENTS.map((type) => sql`${type}`),
  sql`, `,
)})`;

/** The stock documents a report can name (the ledger's `doc_type`). */
export const BOOK_DOC_TYPES = ['GR', 'GI', 'TR', 'ADJ', 'ST', 'SO', 'POS', 'CN'] as const;
export type BookDocType = (typeof BOOK_DOC_TYPES)[number];

/** A document's number by the ledger's `doc_type` / `doc_id` (aliases given). */
export function docNumberSql(type: SQL, id: SQL): SQL {
  return sql`CASE ${type}
    WHEN 'GR' THEN (SELECT d.number FROM public.goods_receipts d WHERE d.id = ${id})
    WHEN 'BM' THEN (SELECT d.number FROM public.bin_moves d WHERE d.id = ${id})
    WHEN 'ADJ' THEN (SELECT d.number FROM public.adjustments d WHERE d.id = ${id})
    WHEN 'ST' THEN (SELECT d.number FROM public.stocktakes d WHERE d.id = ${id})
    WHEN 'TR' THEN (SELECT d.number FROM public.transfers d WHERE d.id = ${id})
    WHEN 'SO' THEN (SELECT d.number FROM public.sales_orders d WHERE d.id = ${id})
    WHEN 'CN' THEN (SELECT d.number FROM public.credit_notes d WHERE d.id = ${id})
    WHEN 'POS' THEN (SELECT d.number FROM public.pos_sales d WHERE d.id = ${id})
    WHEN 'GI' THEN (SELECT d.number FROM public.goods_issues d WHERE d.id = ${id})
  END`;
}

/** `col IN (…)` of positive ids, or null without any. */
export function idsIn(column: SQL, ids: readonly number[] | undefined): SQL | null {
  if (!ids || ids.length === 0) return null;
  return sql`${column} IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** The products of a category and everything under it (`<column> IN (…)`), or null. */
export function inCategory(productColumn: SQL, categoryId: number | undefined): SQL | null {
  if (!categoryId) return null;
  return sql`${productColumn} IN (
    SELECT p.id FROM public.products p WHERE p.category_id IN (
      WITH RECURSIVE sub AS (
        SELECT id FROM public.categories WHERE id = ${categoryId}
        UNION ALL SELECT k.id FROM public.categories k JOIN sub ON k.parent_id = sub.id)
      SELECT id FROM sub))`;
}
