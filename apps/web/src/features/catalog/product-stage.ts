import { PRODUCT_STAGES, type ProductStage } from '@tugeel/shared/catalog';
import type { ProductStatus } from './api';

/**
 * Where a product stands (ADR-0044): in use and complete, in use but waiting for its prices (not
 * on orders yet), or not in use. The rule lives in `@tugeel/shared/catalog` (filters and
 * segments use it too, ADR-0049).
 */
export { PRODUCT_STAGES, type ProductStage, productStage } from '@tugeel/shared/catalog';

/** The stage a list's `?status=` names, or undefined. */
export const listStageOf = (value: string | null): ProductStage | undefined =>
  PRODUCT_STAGES.find((stage) => stage === value);

/** What a list's query sends for a stage. */
export const STAGE_FILTER: Record<ProductStage, { status: ProductStatus; saleReady?: boolean }> = {
  ACTIVE: { status: 'ACTIVE', saleReady: true },
  PENDING: { status: 'ACTIVE', saleReady: false },
  INACTIVE: { status: 'INACTIVE' },
};
