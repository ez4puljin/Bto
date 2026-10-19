import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  type AuthContext,
  type CustomerAccountGate,
  type CustomerAccountView,
  CustomerAccountsService,
  type CustomerUserStatus,
  type IssuedCode,
} from '../../identity';
import { customers } from '../schema';
import { CustomersService } from './customers.service';

/**
 * Partners' answer to identity's CUSTOMER_ACCOUNT_GATE (ADR-0079 #2): an inactive or unknown
 * customer cannot sign in to the customer app, redeem a code or refresh a session.
 */
@Injectable()
export class CustomerAccountGateService implements CustomerAccountGate {
  async isActive(executor: Db | Tx, customerId: number): Promise<boolean> {
    const [row] = await executor
      .select({ status: customers.status })
      .from(customers)
      .where(eq(customers.id, customerId));
    return row?.status === 'ACTIVE';
  }
}

/**
 * The «Апп» card of a customer's page (ADR-0079 #11): every change locks the customer row first
 * (FOR NO KEY UPDATE, as a credit decision does), checks it, and hands identity the transaction
 * that writes the account.
 */
@Injectable()
export class CustomerAppAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly accounts: CustomerAccountsService,
  ) {}

  async get(customerId: number): Promise<CustomerAccountView | null> {
    await this.assertExists(customerId);
    return this.accounts.get(customerId);
  }

  /** Links a phone to an active customer, or changes it (a new code is then needed). */
  link(ctx: AuthContext, customerId: number, phone: string): Promise<CustomerAccountView> {
    return inTransaction(this.db, async (tx) => {
      await this.lockActive(tx, customerId);
      return this.accounts.linkInTx(tx, ctx, customerId, phone);
    });
  }

  issueCode(ctx: AuthContext, customerId: number): Promise<IssuedCode> {
    return inTransaction(this.db, async (tx) => {
      await this.lockActive(tx, customerId);
      return this.accounts.issueCodeInTx(tx, ctx, customerId);
    });
  }

  /** «Аппыг хаах» works for any customer; «нээх» only for an active one. */
  setStatus(
    ctx: AuthContext,
    customerId: number,
    status: CustomerUserStatus,
  ): Promise<CustomerAccountView> {
    return inTransaction(this.db, async (tx) => {
      const locked = await this.customers.lockForUpdate(tx, customerId);
      if (status === 'ACTIVE' && locked.status !== 'ACTIVE') {
        throw new AppError('CUSTOMER_INACTIVE', `customer ${customerId} is inactive`, {
          id: customerId,
        });
      }
      return this.accounts.setStatusInTx(tx, ctx, customerId, status);
    });
  }

  private async lockActive(tx: Tx, customerId: number): Promise<void> {
    const locked = await this.customers.lockForUpdate(tx, customerId);
    if (locked.status !== 'ACTIVE') {
      throw new AppError('CUSTOMER_INACTIVE', `customer ${customerId} is inactive`, {
        id: customerId,
      });
    }
  }

  private async assertExists(customerId: number): Promise<void> {
    const [row] = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!row) throw notFound('customer', customerId);
  }
}
