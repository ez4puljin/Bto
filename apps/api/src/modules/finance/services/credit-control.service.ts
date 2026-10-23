import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { Tx } from '../../../common/db/db.types';
import { FinReader } from '../../../finance-core';
import { BTO_SOURCE, customerRef } from '../../fin-bridge';
import { systemActor } from '../../identity';
import type { CreditCheckInput, CreditChecker, CreditDecision } from '../../sales';
import { FinBooks } from './fin-books';

/**
 * The credit check sales runs under the customer lock when an order is confirmed or re-priced
 * (ADR-0060 #2, SPEC §6.2), on the Finance Core's exposure since F2 (ADR-0073 #4, ADR-0090): the
 * customer's party is locked in the same transaction, after the customer row. A customer on hold is
 * refused; one with a limit is refused when the net receivable, the other open orders and this
 * order pass it. An overdue amount never refuses (owner 2026-10-21, ADR-0101 #3): it only reminds,
 * and the refusal carries it for the message.
 */
@Injectable()
export class CreditControlService implements CreditChecker {
  private readonly actor = systemActor('finance:credit');

  constructor(
    private readonly reader: FinReader,
    private readonly books: FinBooks,
  ) {}

  async check(tx: Tx, input: CreditCheckInput): Promise<CreditDecision> {
    const { customer } = input;
    const exposure = await this.reader.exposureInTx(tx, this.books.source(this.actor), {
      company: await this.books.company(),
      party: { system: BTO_SOURCE, ref: customerRef(customer.id) },
    });
    const total = new Decimal(exposure.net).plus(input.openOrders).plus(input.amount);
    const refused = (reason: 'HOLD' | 'LIMIT', excess = new Decimal(0)) => ({
      ok: false as const,
      reason,
      exposure: total,
      limit: customer.creditLimit,
      excess,
      overdueAmount: new Decimal(exposure.overdue),
      oldestDueDate: exposure.oldestDueDate,
    });
    if (customer.creditHold) return refused('HOLD');
    if (customer.creditLimit !== null && total.gt(customer.creditLimit)) {
      return refused('LIMIT', total.minus(customer.creditLimit));
    }
    return { ok: true };
  }
}
