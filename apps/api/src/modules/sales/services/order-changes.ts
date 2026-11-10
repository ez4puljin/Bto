import type { Decimal } from '@tugeel/shared/money';

/** A header field that changed; the values as stored, read by the screen. */
export interface OrderFieldChange {
  field:
    | 'customer'
    | 'fulfilment'
    | 'deliveryDate'
    | 'address'
    | 'contactName'
    | 'contactPhone'
    | 'paymentMethod'
    | 'note';
  before: string | null;
  after: string | null;
}

/** A line added, removed or changed, kept by product unit and warehouse. */
export interface OrderLineChange {
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  productName: string;
  unitName: string;
  warehouseId: number;
  qtyBefore: string | null;
  qtyAfter: string | null;
  totalBefore: string | null;
  totalAfter: string | null;
}

interface LineFacts {
  productName: string;
  productUnitId: number;
  unitName: string;
  warehouseId: number;
  qty: Decimal;
  total: Decimal | null;
}

type HeaderFacts = Record<OrderFieldChange['field'], string | null>;

const money = (value: Decimal | null | undefined) => value?.toFixed(2) ?? null;

/**
 * What one save changed (ADR-0147). A repricing alone counts: the customer's total moved. Lines
 * repeated for one unit and warehouse are added up, so a reordered list is not a change.
 */
export function diffOrder(
  before: { header: HeaderFacts; lines: readonly LineFacts[] },
  after: { header: HeaderFacts; lines: readonly LineFacts[] },
): { fields: OrderFieldChange[]; lines: OrderLineChange[] } {
  const fields: OrderFieldChange[] = [];
  for (const field of Object.keys(before.header) as OrderFieldChange['field'][]) {
    if (before.header[field] !== after.header[field]) {
      fields.push({ field, before: before.header[field], after: after.header[field] });
    }
  }
  const grouped = (lines: readonly LineFacts[]) => {
    const map = new Map<string, LineFacts>();
    for (const line of lines) {
      const key = `${line.productUnitId}:${line.warehouseId}`;
      const seen = map.get(key);
      map.set(
        key,
        seen
          ? {
              ...seen,
              qty: seen.qty.plus(line.qty),
              total:
                seen.total && line.total ? seen.total.plus(line.total) : (seen.total ?? line.total),
            }
          : line,
      );
    }
    return map;
  };
  const was = grouped(before.lines);
  const now = grouped(after.lines);
  const lines: OrderLineChange[] = [];
  for (const [key, old] of was) {
    const line = now.get(key);
    if (!line) {
      lines.push({
        kind: 'REMOVED',
        productName: old.productName,
        unitName: old.unitName,
        warehouseId: old.warehouseId,
        qtyBefore: old.qty.toString(),
        qtyAfter: null,
        totalBefore: money(old.total),
        totalAfter: null,
      });
    } else if (!old.qty.eq(line.qty) || money(old.total) !== money(line.total)) {
      lines.push({
        kind: 'CHANGED',
        productName: line.productName,
        unitName: line.unitName,
        warehouseId: line.warehouseId,
        qtyBefore: old.qty.toString(),
        qtyAfter: line.qty.toString(),
        totalBefore: money(old.total),
        totalAfter: money(line.total),
      });
    }
  }
  for (const [key, line] of now) {
    if (!was.has(key)) {
      lines.push({
        kind: 'ADDED',
        productName: line.productName,
        unitName: line.unitName,
        warehouseId: line.warehouseId,
        qtyBefore: null,
        qtyAfter: line.qty.toString(),
        totalBefore: null,
        totalAfter: money(line.total),
      });
    }
  }
  return { fields, lines };
}
