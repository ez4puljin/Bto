import type { CustomerKind } from '@tugeel/shared/taxpayer';
import type { Tx } from '../../common/db/db.types';
import type { Actor, AuthContext } from '../identity';

/** The partner lists a segment narrows (ADR-0049 #4). */
export type PartnerSetEntity = 'CUSTOMER' | 'SUPPLIER';

/**
 * Narrows the customer and supplier lists to a saved segment (ADR-0049 #4). The segments module
 * binds it to its evaluator; partners may not import segments. 404 for an unknown or archived
 * segment, 422 for a segment of another entity; customer segments keep only the customers the
 * caller may read (`CustomersService.visibleTo`).
 */
export interface PartnerSetResolver {
  /** Ascending ids of the customers or suppliers the segment keeps. */
  ids(ctx: AuthContext, entity: PartnerSetEntity, segmentId: number): Promise<number[]>;
}

export const PARTNER_SET_RESOLVER = Symbol('PARTNER_SET_RESOLVER');

/** A customer as its Finance Core party follows it (ADR-0070 #8, ADR-0084). */
export interface CustomerPartyFacts {
  id: number;
  kind: CustomerKind;
  name: string;
  tin: string | null;
  regNo: string | null;
}

/**
 * Called inside the transaction that creates a customer or changes its kind, name, TIN or register
 * number (ADR-0084). fin-bridge binds it to keep the customer's Finance Core party in step, in the
 * api and in the worker (imports); partners may not import fin-bridge.
 */
export interface CustomerChangedHook {
  onCustomerChanged(tx: Tx, actor: Actor, customer: CustomerPartyFacts): Promise<void>;
}

export const CUSTOMER_CHANGED_HOOK = Symbol('CUSTOMER_CHANGED_HOOK');
