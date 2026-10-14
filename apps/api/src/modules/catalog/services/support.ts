import { Decimal } from '@tugeel/shared/money';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { products } from '../schema';

// Shared with other modules through src/common; re-exported so catalog imports stay unchanged.
export { escapeLike } from '../../../common/db/like';
export { invalid, notFound } from '../../../common/errors/app-error';

/** A decimal string validated by the DTO as a Decimal (never a JS number: ESLint G3). */
export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}

/**
 * Marks a product changed because its units, barcodes or photos changed (the «шинэчилсэн огноо»
 * filter, ADR-0049 #2), taking its row lock first so product writers keep their table order
 * (architecture §5.3). False for an unknown product.
 */
export async function touchProduct(tx: Tx, productId: number): Promise<boolean> {
  const [row] = await tx
    .update(products)
    .set({ updatedAt: sql`now()` })
    .where(eq(products.id, productId))
    .returning({ id: products.id });
  return row !== undefined;
}
