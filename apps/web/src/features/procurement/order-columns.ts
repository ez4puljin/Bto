import type { PoColumnGroup } from '@tugeel/shared/procurement';
import type { ColumnSpec } from '@/lib/column-layout';

/** Which groups the signed-in user sees at all, beyond the hidden ones (ADR-0118 #5). */
export interface ColumnView {
  hidden: ReadonlySet<string>;
  canPrices: boolean;
  canCosts: boolean;
}

export const shows = (view: ColumnView, group: PoColumnGroup) =>
  !view.hidden.has(group) && (group !== 'pricing' || view.canCosts);

/**
 * The column spec of the order's table (ADR-0119), one entry per cell of `OrderTableHead` in the
 * same order; the inputs' widths set the quantity and note columns.
 */
export function orderColumns(view: ColumnView): ColumnSpec[] {
  const qty = (key: string, width?: number): ColumnSpec => ({ key, kind: 'qty', width });
  const columns: ColumnSpec[] = [
    { key: 'sku', kind: 'code' },
    { key: 'name', kind: 'text', weight: 3, min: 14 },
  ];
  if (shows(view, 'stock')) {
    columns.push({ key: 'warehouse', kind: 'text', weight: 1 }, qty('onHand'), qty('minQty'));
  }
  if (shows(view, 'sales')) {
    columns.push(qty('avg12'), qty('avg3'), qty('lastMonth'), qty('sameMonthLastYear'));
  }
  if (shows(view, 'order')) {
    columns.push(
      qty('boxSize'),
      qty('unitWeight'),
      { key: 'unit', kind: 'text', weight: 0.5, min: 8.5 },
      qty('qty', 7),
      qty('pieces'),
      qty('kg'),
    );
    if (view.canPrices) {
      columns.push({ key: 'lastPrice', kind: 'money' }, { key: 'estimated', kind: 'money' });
    }
  }
  if (shows(view, 'shipping')) columns.push(qty('shipped'));
  if (shows(view, 'receiving')) {
    columns.push(qty('arrived'), qty('difference'), {
      key: 'note',
      kind: 'text',
      weight: 2,
      min: 11.5,
    });
  }
  if (shows(view, 'pricing')) {
    columns.push(
      { key: 'unitPrice', kind: 'money' },
      { key: 'amount', kind: 'money' },
      { key: 'priceDiff', kind: 'money' },
    );
  }
  return columns;
}
