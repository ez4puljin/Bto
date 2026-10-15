import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import type { CreditCheckInput, CreditChecker, CreditDecision } from '../../sales';
import { ArLedgerService } from './ar-ledger.service';

/**
 * The credit check sales runs under the customer lock when an order is confirmed or re-priced
 * (ADR-0060 #2, SPEC §6.2): no tolerance, for every payment method. A customer on hold or with an
 * overdue invoice is refused; a customer with a limit is refused when the ledger balance, the
 * other open orders and this order pass it; no limit means no limit.
 */
@Injectable()
export class CreditControlService implements CreditChecker {
  constructor(private readonly ledger: ArLedgerService) {}

  async check(tx: Tx, input: CreditCheckInput): Promise<CreditDecision> {
    const { customer } = input;
    const today = businessDate();
    const overdue = await this.ledger.overdueOf(customer.id, today, tx);
    const balance = (await this.ledger.balanceOf(customer.id, tx)).balance;
    const exposure = balance.plus(input.openOrders).plus(input.amount);
    const refused = (reason: 'HOLD' | 'OVERDUE' | 'LIMIT', excess = new Decimal(0)) => ({
      ok: false as const,
      reason,
      exposure,
      limit: customer.creditLimit,
      excess,
      overdueAmount: overdue.amount,
      oldestDueDate: overdue.oldestDueDate,
    });
    if (customer.creditHold) return refused('HOLD');
    if (overdue.amount.gt(0)) return refused('OVERDUE');
    if (customer.creditLimit !== null && exposure.gt(customer.creditLimit)) {
      return refused('LIMIT', exposure.minus(customer.creditLimit));
    }
    return { ok: true };
  }
}
