import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type { CreditCheckResponseWire } from '@tugeel/shared/pos';
import { AppError } from '../../common/errors/app-error';
import { CentralClient, CentralError } from './central.client';
import { CustomerStore } from './customer.store';

/**
 * Whether a till may put this much on a customer's credit (ADR-0109 #7). Online the centre
 * decides under the customer's lock, with no tolerance, counting what this edge sold on credit
 * and has not replayed yet: a hold or a passed limit is 409 CREDIT_BLOCKED. Offline (the centre
 * did not answer in time) the till decides from the feed it pulled last: a hold is refused; a
 * passed limit warns (409 POS_CREDIT_OFFLINE_OVER_LIMIT) and sells when the cashier goes on
 * (owner 2026-10-27), the centre noting the excess when the sale arrives. Called with no edge
 * transaction open.
 */
@Injectable()
export class CreditGate {
  private readonly logger = new Logger(CreditGate.name);

  constructor(
    private readonly central: CentralClient,
    private readonly customers: CustomerStore,
  ) {}

  async assert(customerId: number, amount: Decimal, acceptOverLimit: boolean): Promise<void> {
    const customer = this.customers.get(customerId);
    const unsent = (await this.customers.pending([customerId], null)).get(customerId);
    let answer: CreditCheckResponseWire | null = null;
    try {
      answer = await this.central.creditCheck({
        customerId,
        amount: amount.toFixed(2),
        pendingOnEdge: (unsent ?? new Decimal(0)).toFixed(2),
      });
    } catch (error: unknown) {
      if (!(error instanceof CentralError)) throw error;
      // An answer that refuses the question (the customer is gone) is no outage.
      if (error.status !== null && error.status < 500) {
        throw blocked('INACTIVE', { exposure: customer.exposure, limit: customer.creditLimit });
      }
      this.logger.warn(`credit check offline: ${error.message}`);
    }
    if (answer) {
      if (answer.ok) return;
      throw blocked(answer.reason ?? 'LIMIT', {
        exposure: answer.exposure,
        limit: answer.limit,
        excess: answer.excess,
      });
    }
    if (customer.creditHold) {
      throw blocked('HOLD', { exposure: customer.exposure, limit: customer.creditLimit });
    }
    if (customer.creditLimit === null || acceptOverLimit) return;
    const pending = (await this.customers.pending([customerId], this.customers.generatedAt())).get(
      customerId,
    );
    const available = new Decimal(customer.creditLimit)
      .minus(customer.exposure)
      .minus(pending ?? new Decimal(0));
    if (amount.lte(available)) return;
    throw new AppError(
      'POS_CREDIT_OFFLINE_OVER_LIMIT',
      'offline: the customer’s limit as last known is passed',
      {
        available: available.toFixed(2),
        excess: amount.minus(Decimal.max(available, 0)).toFixed(2),
        limit: customer.creditLimit,
      },
    );
  }
}

function blocked(reason: string, params: Record<string, string | null>): AppError {
  return new AppError('CREDIT_BLOCKED', `the credit check refused: ${reason}`, {
    reason,
    ...params,
  });
}
