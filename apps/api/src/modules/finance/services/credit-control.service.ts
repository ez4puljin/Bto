import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Tx } from '../../../common/db/db.types';
import { FinReader } from '../../../finance-core';
import { BTO_SOURCE, customerRef } from '../../fin-bridge';
import { SettingsService, systemActor } from '../../identity';
import type { CreditCheckInput, CreditChecker, CreditDecision } from '../../sales';
import { FinBooks } from './fin-books';

/**
 * The credit check sales runs under the customer lock when an order is confirmed or re-priced
 * (ADR-0060 #2, SPEC §6.2), on the Finance Core's exposure since F2 (ADR-0073 #4, ADR-0090): the
 * customer's party is locked in the same transaction, after the customer row. A customer on hold is
 * refused; one with an overdue amount larger than its open credits is refused (the default rule,
 * ADR-0073 #5; with `credit.overdue_nets_credits` off any overdue amount refuses); one with a limit
 * is refused when the net receivable, the other open orders and this order pass it.
 */
@Injectable()
export class CreditControlService implements CreditChecker {
  private readonly actor = systemActor('finance:credit');

  constructor(
    private readonly reader: FinReader,
    private readonly books: FinBooks,
    private readonly settings: SettingsService,
  ) {}

  async check(tx: Tx, input: CreditCheckInput): Promise<CreditDecision> {
    const { customer } = input;
    const today = businessDate();
    const exposure = await this.reader.exposureInTx(tx, this.books.source(this.actor), {
      company: await this.books.company(),
      party: { system: BTO_SOURCE, ref: customerRef(customer.id) },
    });
    const overdue = new Decimal(exposure.overdue);
    const creditsOpen = new Decimal(exposure.creditsOpen);
    const nets = await this.settings.get('credit.overdue_nets_credits', today, tx);
    const total = new Decimal(exposure.net).plus(input.openOrders).plus(input.amount);
    const refused = (reason: 'HOLD' | 'OVERDUE' | 'LIMIT', excess = new Decimal(0)) => ({
      ok: false as const,
      reason,
      exposure: total,
      limit: customer.creditLimit,
      excess,
      overdueAmount: overdue,
      oldestDueDate: exposure.oldestDueDate,
      creditsOpen,
    });
    if (customer.creditHold) return refused('HOLD');
    if (nets ? overdue.gt(creditsOpen) : overdue.gt(0)) return refused('OVERDUE');
    if (customer.creditLimit !== null && total.gt(customer.creditLimit)) {
      return refused('LIMIT', total.minus(customer.creditLimit));
    }
    return { ok: true };
  }
}
