/**
 * Purchase orders (ADR-0115, ADR-0118, `docs/workflows.md` §4 and §7): one order holds several
 * suppliers, each moving through its own status; the order shows the lowest. Messages live in
 * mn.json under `procurement`.
 */

import { Decimal, type DecimalInput } from '../money';

/**
 * A supplier's status inside an order, in order: «Бэлдэж», «Илгээсэн», «Ачигдаж байна», «Замд»,
 * «Ирсэн» (people move these), «Нягтлан шалгаж» (set when the keepers confirm the receipt),
 * «Орлого авсан» (set when the accountant confirms its prices). «Ачигдаж байна» came back with
 * ADR-0118: the supplier's shipped quantities are typed there.
 */
export const PO_SUPPLIER_STATUSES = [
  'PREPARING',
  'SENT',
  'SHIPPING',
  'IN_TRANSIT',
  'ARRIVED',
  'ACCOUNTING',
  'RECEIVED',
] as const;
export type PoSupplierStatus = (typeof PO_SUPPLIER_STATUSES)[number];

/** The statuses a person moves a supplier through; the last two follow the receipt. */
export const PO_MANUAL_STATUSES = [
  'PREPARING',
  'SENT',
  'SHIPPING',
  'IN_TRANSIT',
  'ARRIVED',
] as const;

/** Quantities may change up to «Замд» (owner 2026-10-29); from «Ирсэн» the receipt counts. */
export const PO_EDITABLE_STATUSES: readonly PoSupplierStatus[] = [
  'PREPARING',
  'SENT',
  'SHIPPING',
  'IN_TRANSIT',
];

/** The shipped quantities are typed in this status only (owner 2026-10-29, ADR-0118 #1). */
export const PO_SHIPPING_STATUS: PoSupplierStatus = 'SHIPPING';

export function poStatusRank(status: PoSupplierStatus): number {
  return PO_SUPPLIER_STATUSES.indexOf(status);
}

/** The order's status: the lowest of its suppliers' (PREPARING for an order without suppliers). */
export function lowestPoStatus(statuses: readonly PoSupplierStatus[]): PoSupplierStatus {
  let lowest: PoSupplierStatus | null = null;
  for (const status of statuses) {
    if (lowest === null || poStatusRank(status) < poStatusRank(lowest)) lowest = status;
  }
  return lowest ?? 'PREPARING';
}

/** The status a person may move a supplier to next, or null from «Ирсэн» on. */
export function nextPoStatus(status: PoSupplierStatus): PoSupplierStatus | null {
  const index = PO_MANUAL_STATUSES.indexOf(status as (typeof PO_MANUAL_STATUSES)[number]);
  return index >= 0 && index < PO_MANUAL_STATUSES.length - 1
    ? (PO_MANUAL_STATUSES[index + 1] ?? null)
    : null;
}

/** The status a manager may step a supplier back to, or null (from «Бэлдэж», or once received). */
export function previousPoStatus(status: PoSupplierStatus): PoSupplierStatus | null {
  const index = PO_MANUAL_STATUSES.indexOf(status as (typeof PO_MANUAL_STATUSES)[number]);
  return index > 0 ? (PO_MANUAL_STATUSES[index - 1] ?? null) : null;
}

/**
 * Most suppliers one order may hold (every active supplier at once: a few hundred today), and the
 * grid's page. The rows stay bounded per supplier (the grid's cap) and per save (`MAX_PO_CHANGES`).
 */
export const MAX_PO_SUPPLIERS = 1000;
export const PO_GRID_PAGE = 200;
/** Most cells one save may send. */
export const MAX_PO_CHANGES = 2000;
/** The history screen's page. */
export const PO_HISTORY_PAGE = 100;

/**
 * A base quantity as boxes × loose pieces of a unit (`factor` pieces per box): 50 pieces of a box
 * of 12 are 4 boxes and 2 pieces. A factor of 1 (or less) counts everything as pieces.
 */
export function splitBoxes(
  qtyBase: DecimalInput,
  factor: DecimalInput,
): { boxes: Decimal; pieces: Decimal } {
  const base = new Decimal(qtyBase);
  const perBox = new Decimal(factor);
  if (perBox.lte(1)) return { boxes: new Decimal(0), pieces: base };
  const boxes = base.div(perBox).floor();
  return { boxes, pieces: base.minus(boxes.times(perBox)) };
}

/** Boxes × pieces back to a base quantity. */
export function joinBoxes(
  boxes: DecimalInput,
  pieces: DecimalInput,
  factor: DecimalInput,
): Decimal {
  return new Decimal(boxes).times(factor).plus(pieces);
}

/**
 * The detail page's column groups (ADR-0118 #5), hidden per user in the browser (ADR-0050); the
 * groups a present stage types in cannot be hidden.
 */
export const PO_COLUMN_GROUPS = [
  'stock',
  'sales',
  'order',
  'shipping',
  'receiving',
  'pricing',
] as const;
export type PoColumnGroup = (typeof PO_COLUMN_GROUPS)[number];

const GROUP_OF_STATUS: Partial<Record<PoSupplierStatus, PoColumnGroup>> = {
  PREPARING: 'order',
  SENT: 'order',
  SHIPPING: 'shipping',
  IN_TRANSIT: 'order',
  ARRIVED: 'receiving',
  ACCOUNTING: 'pricing',
};

/** The column groups the suppliers' current stages require (locked in the chooser). */
export function requiredGroupsFor(statuses: readonly PoSupplierStatus[]): PoColumnGroup[] {
  const required = new Set<PoColumnGroup>();
  for (const status of statuses) {
    const group = GROUP_OF_STATUS[status];
    if (group) required.add(group);
  }
  return PO_COLUMN_GROUPS.filter((group) => required.has(group));
}

/** What the history screen shows (ADR-0118 #6), each read from an audit row. */
export const PO_HISTORY_KINDS = [
  'CREATED',
  'NOTE',
  'SUPPLIERS_ADDED',
  'SUPPLIER_REMOVED',
  'STATUS',
  'ORDER_QTY',
  'SHIPPED_QTY',
  'ARRIVED_QTY',
  'LINE_NOTE',
  'LINE_ADDED',
  'LINE_REMOVED',
  'RECEIPT_CONFIRMED',
  'RECEIPT_WITHDRAWN',
  'RECEIPT_POSTED',
  'RECEIPT_CANCELLED',
  'PRICES',
  'ARCHIVED',
  'UNARCHIVED',
] as const;
export type PoHistoryKind = (typeof PO_HISTORY_KINDS)[number];
