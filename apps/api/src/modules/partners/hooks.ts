import type { AuthContext } from '../identity';

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
