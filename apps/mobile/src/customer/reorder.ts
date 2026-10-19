import { Decimal } from '@tugeel/shared/money';
import type { CartLine } from '../cart/cart';

// «Дахин захиалах» (ADR-0079 #6): an earlier order's lines into the cart at today's prices. The
// server says which lines can be ordered today (`GET /customer-app/orders/:id/reorder`); the batch
// read gives the products the cart lines need.

interface ReorderProduct {
  id: number;
  sku: string;
  name: string;
  thumbUrl: string | null;
  stock: 'IN' | 'LOW' | 'OUT';
  units: readonly {
    id: number;
    uomName: string;
    uomCode: string | null;
    factorToBase: string;
    isBase: boolean;
    wholesale: string | null;
  }[];
}

export type SkipReason = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'UNIT_CHANGED';

export interface ReorderPlan {
  lines: { line: Omit<CartLine, 'qty'>; qty: number }[];
  skipped: { productId: number; name: string | null; reason: SkipReason }[];
}

/**
 * The cart lines to add (whole units, as the cart counts them) and what was skipped: the server's
 * skips, and any line whose product, unit or price the batch no longer has.
 */
export function reorderPlan(
  reorder: {
    lines: readonly { productId: number; productUnitId: number; qty: string }[];
    skipped: readonly { productId: number; name: string | null; reason: SkipReason }[];
  },
  products: readonly ReorderProduct[],
): ReorderPlan {
  const plan: ReorderPlan = { lines: [], skipped: [...reorder.skipped] };
  for (const entry of reorder.lines) {
    const product = products.find((candidate) => candidate.id === entry.productId);
    const unit = product?.units.find((candidate) => candidate.id === entry.productUnitId);
    const qty = new Decimal(entry.qty).ceil();
    if (!product || !unit) {
      plan.skipped.push({
        productId: entry.productId,
        name: product?.name ?? null,
        reason: 'UNAVAILABLE',
      });
      continue;
    }
    if (product.stock === 'OUT') {
      plan.skipped.push({ productId: product.id, name: product.name, reason: 'OUT_OF_STOCK' });
      continue;
    }
    if (unit.wholesale === null || qty.lte(0)) {
      plan.skipped.push({ productId: product.id, name: product.name, reason: 'UNAVAILABLE' });
      continue;
    }
    plan.lines.push({
      qty: qty.toNumber(),
      line: {
        productId: product.id,
        productUnitId: unit.id,
        sku: product.sku,
        name: product.name,
        uomName: unit.uomName,
        uomCode: unit.uomCode,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
        wholesale: unit.wholesale,
        thumbUrl: product.thumbUrl,
      },
    });
  }
  return plan;
}
