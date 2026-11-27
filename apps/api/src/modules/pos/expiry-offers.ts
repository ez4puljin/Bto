import type { ExpirySaleOffer } from '@tugeel/shared/expiry';
import type { Db, Tx } from '../../common/db/db.types';

/** Public approved offers only; no source cost or employee liability crosses this port. */
export const POS_EXPIRY_OFFERS = Symbol('POS_EXPIRY_OFFERS');
export interface PosExpiryOffers {
  snapshots(
    executor: Db | Tx,
    filter?: { warehouseId?: number; channel?: 'RETAIL' | 'WHOLESALE'; contextId?: number },
  ): Promise<ExpirySaleOffer[]>;
}
