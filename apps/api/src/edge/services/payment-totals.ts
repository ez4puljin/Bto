import { Decimal } from '@tugeel/shared/money';
import type {
  EdgePaymentTotal,
  SaleDocWire,
  SaleKind,
  SnapshotPaymentType,
  TenderKind,
} from '@tugeel/shared/pos';

const KIND_ORDER: readonly TenderKind[] = ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'POINTS'];

/**
 * The money of these sales and returns by payment type (ADR-0111), in the till's order of the
 * types; tenders from before the types are grouped by their kind, after them.
 */
export function paymentTotalsOf(
  rows: readonly { kind: SaleKind; doc: SaleDocWire }[],
  types: readonly SnapshotPaymentType[],
): EdgePaymentTotal[] {
  const order = new Map(types.map((type, index) => [type.id, index]));
  const totals = new Map<string, { total: EdgePaymentTotal; rank: number }>();
  for (const row of rows) {
    for (const tender of row.doc.tenders) {
      const id = tender.paymentTypeId ?? null;
      const key = id === null ? `kind:${tender.kind}` : `type:${id}`;
      const entry = totals.get(key) ?? {
        total: {
          paymentTypeId: id,
          name: tender.paymentTypeName ?? tender.kind,
          kind: tender.kind,
          sales: '0.00',
          refunds: '0.00',
          net: '0.00',
        },
        rank: id === null ? 1000 + KIND_ORDER.indexOf(tender.kind) : (order.get(id) ?? 500),
      };
      const amount = new Decimal(tender.amount);
      const sales = new Decimal(entry.total.sales).plus(row.kind === 'SALE' ? amount : 0);
      const refunds = new Decimal(entry.total.refunds).plus(row.kind === 'RETURN' ? amount : 0);
      totals.set(key, {
        rank: entry.rank,
        total: {
          ...entry.total,
          sales: sales.toFixed(2),
          refunds: refunds.toFixed(2),
          net: sales.minus(refunds).toFixed(2),
        },
      });
    }
  }
  return [...totals.values()].sort((a, b) => a.rank - b.rank).map((entry) => entry.total);
}
