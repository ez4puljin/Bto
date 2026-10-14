/**
 * Where a product stands (ADR-0044): in use and complete, in use but waiting for its prices (not
 * on orders yet), or not in use. The rule lives in `@tugeel/shared/catalog` (filters and
 * segments use it too, ADR-0049).
 */
export { PRODUCT_STAGES, type ProductStage, productStage } from '@tugeel/shared/catalog';
