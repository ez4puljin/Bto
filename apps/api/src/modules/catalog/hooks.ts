import type { SegmentDefinition } from '@tugeel/shared/segments';
import type { Tx } from '../../common/db/db.types';

/**
 * Called inside the transaction that supersedes a unit (ADR-0008 #4). Pricing binds it in delivery 2
 * to re-issue the price rules of the old unit on the new one; catalog may not import pricing.
 */
export interface UnitSupersededHook {
  onUnitSuperseded(tx: Tx, change: { oldUnitId: number; newUnitId: number }): Promise<void>;
}

export const UNIT_SUPERSEDED_HOOK = Symbol('UNIT_SUPERSEDED_HOOK');

/** A product list's filter (ADR-0049 #4): conditions sent with the request and/or a saved segment. */
export interface ProductSetFilter {
  where?: SegmentDefinition;
  segmentId?: number;
}

/**
 * Narrows the product list to the products a filter keeps (ADR-0049 #4). The segments module binds
 * it to its evaluator, which asks every data owner (catalog, partners, inventory, pricing) through
 * their public services; catalog may not import segments. 404 for an unknown or archived segment,
 * 422 for a segment of another entity or conditions that fail `segmentIssue`.
 */
export interface ProductSetResolver {
  /** Ascending ids of the products the filter keeps. */
  productIds(filter: ProductSetFilter): Promise<number[]>;
}

export const PRODUCT_SET_RESOLVER = Symbol('PRODUCT_SET_RESOLVER');
