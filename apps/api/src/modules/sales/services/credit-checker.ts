import { Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import type { Tx } from '../../../common/db/db.types';
import type { LockedCustomer } from '../../partners';

/** The outcome of a credit check (SPEC §6.2 #2). */
export type CreditDecision = 'OK' | 'NEEDS_APPROVAL' | 'BLOCKED';

/**
 * Decides whether a locked customer may take an order of this amount (architecture §5.5). The
 * caller has locked the customer row, so two confirmations never pass on the same headroom.
 */
export abstract class CreditChecker {
  abstract check(tx: Tx, customer: LockedCustomer, amount: Decimal): Promise<CreditDecision>;
}

/** Every order passes until finance replaces this in delivery 3 (SPEC §6.2 #5). */
@Injectable()
export class AllowAllCreditChecker extends CreditChecker {
  check(_tx: Tx, _customer: LockedCustomer, _amount: Decimal): Promise<CreditDecision> {
    return Promise.resolve('OK');
  }
}
