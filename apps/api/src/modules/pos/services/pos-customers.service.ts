import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  CreditCheckResponseWire,
  PosCustomerFeed,
  PosCustomerStanding,
} from '@tugeel/shared/pos';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { CreditControlService } from '../../finance';
import { CustomersService, type LockedCustomer } from '../../partners';
import { SalesOrderQueryService } from '../../sales';

/** The centre's credit decision for a till's credit part (never a refusal of an accepted sale). */
export interface PosCreditDecision {
  ok: boolean;
  reason: 'HOLD' | 'LIMIT' | 'INACTIVE' | null;
  exposure: Decimal;
  limit: Decimal | null;
  excess: Decimal;
}

/**
 * The supermarket's customers for credit sales (ADR-0109): the feed every edge pulls beside its
 * snapshot (the ACTIVE customers, their terms and exposure), and the credit check — the same
 * no-tolerance rule as a wholesale order (ADR-0060 #2): under the customer's lock, its net
 * receivable, its confirmed orders not yet invoiced and the amount asked; a customer on hold is
 * refused, one with a limit is refused past it.
 */
@Injectable()
export class PosCustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly credit: CreditControlService,
    private readonly orders: SalesOrderQueryService,
  ) {}

  async feed(): Promise<PosCustomerFeed> {
    const rows = await this.customers.activeForTill();
    const ids = rows.map((row) => row.id);
    const [receivables, open] = await Promise.all([
      this.credit.netReceivables(ids),
      this.orders.openExposures(ids),
    ]);
    const customers: PosCustomerStanding[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      tin: row.tin,
      regNo: row.regNo,
      phone: row.phone,
      creditHold: row.creditHold,
      creditLimit: row.creditLimit?.toFixed(2) ?? null,
      exposure: (receivables.get(row.id) ?? new Decimal(0))
        .plus(open.get(row.id) ?? new Decimal(0))
        .toFixed(2),
    }));
    const version = createHash('sha256').update(JSON.stringify(customers)).digest('hex');
    return { version: version.slice(0, 20), generatedAt: new Date().toISOString(), customers };
  }

  /** The edge's question before a credit sale; it writes nothing. */
  async check(
    customerId: number,
    amount: Decimal,
    pendingOnEdge: Decimal,
  ): Promise<CreditCheckResponseWire> {
    const decision = await inTransaction(this.db, async (tx) => {
      const customer = await this.customers.lockForUpdate(tx, customerId);
      return this.decideInTx(tx, customer, amount.plus(pendingOnEdge));
    });
    return {
      ok: decision.ok,
      reason: decision.reason,
      exposure: decision.exposure.toFixed(2),
      limit: decision.limit?.toFixed(2) ?? null,
      excess: decision.excess.toFixed(2),
    };
  }

  /** The customer row is locked by the caller (lock order: the customer, then its party). */
  async decideInTx(tx: Tx, customer: LockedCustomer, amount: Decimal): Promise<PosCreditDecision> {
    const openOrders = await this.orders.openExposureInTx(tx, customer.id);
    const decision = await this.credit.check(tx, {
      customer,
      orderId: null,
      amount,
      openOrders,
    });
    if (customer.status !== 'ACTIVE') {
      return {
        ok: false,
        reason: 'INACTIVE',
        exposure: decision.ok ? new Decimal(0) : decision.exposure,
        limit: customer.creditLimit,
        excess: new Decimal(0),
      };
    }
    if (decision.ok) {
      return {
        ok: true,
        reason: null,
        exposure: new Decimal(0),
        limit: customer.creditLimit,
        excess: new Decimal(0),
      };
    }
    return {
      ok: false,
      reason: decision.reason,
      exposure: decision.exposure,
      limit: decision.limit,
      excess: decision.excess,
    };
  }
}
