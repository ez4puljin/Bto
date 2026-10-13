import type { ProductStatus } from './api';

/**
 * Where a product stands (ADR-0044): in use and complete, in use but waiting for its prices (not
 * on orders yet), or not in use. The status column, the product page and the scan result show it.
 */
export type ProductStage = 'ACTIVE' | 'PENDING' | 'INACTIVE';

export function productStage(product: {
  status: ProductStatus;
  saleReadyAt: string | null;
}): ProductStage {
  if (product.status === 'INACTIVE') return 'INACTIVE';
  return product.saleReadyAt === null ? 'PENDING' : 'ACTIVE';
}
