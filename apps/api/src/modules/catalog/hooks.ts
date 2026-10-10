import type { Tx } from '../../common/db/db.types';

/**
 * Called inside the transaction that supersedes a unit (ADR-0008 #4). Pricing binds it in delivery 2
 * to re-issue the price rules of the old unit on the new one; catalog may not import pricing.
 */
export interface UnitSupersededHook {
  onUnitSuperseded(tx: Tx, change: { oldUnitId: number; newUnitId: number }): Promise<void>;
}

export const UNIT_SUPERSEDED_HOOK = Symbol('UNIT_SUPERSEDED_HOOK');
