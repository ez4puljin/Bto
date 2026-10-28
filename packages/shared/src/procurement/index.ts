/**
 * Purchase orders (ADR-0115, `docs/workflows.md` §4): one order holds several suppliers, each
 * moving through its own status; the order shows the lowest. Messages live in mn.json under
 * `procurement`.
 */

/**
 * A supplier's status inside an order, in order: «Бэлдэж», «Илгээсэн», «Замд», «Ирсэн» (people move
 * these), «Нягтлан шалгаж» (set when the keepers confirm the receipt), «Орлого авсан» (set when the
 * accountant confirms its prices).
 */
export const PO_SUPPLIER_STATUSES = [
  'PREPARING',
  'SENT',
  'IN_TRANSIT',
  'ARRIVED',
  'ACCOUNTING',
  'RECEIVED',
] as const;
export type PoSupplierStatus = (typeof PO_SUPPLIER_STATUSES)[number];

/** The statuses a person moves a supplier through; the last two follow the receipt. */
export const PO_MANUAL_STATUSES = ['PREPARING', 'SENT', 'IN_TRANSIT', 'ARRIVED'] as const;

/** Quantities may change up to «Замд» (owner 2026-10-29); from «Ирсэн» the receipt counts. */
export const PO_EDITABLE_STATUSES: readonly PoSupplierStatus[] = ['PREPARING', 'SENT', 'IN_TRANSIT'];

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

/** Most suppliers one order may hold, and the grid's page. */
export const MAX_PO_SUPPLIERS = 200;
export const PO_GRID_PAGE = 200;
/** Most cells one save may send. */
export const MAX_PO_CHANGES = 2000;
