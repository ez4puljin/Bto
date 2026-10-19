import { Inject, Injectable } from '@nestjs/common';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, invalid } from '../../../common/errors/app-error';
import { SETUP_CODE_MAX_ATTEMPTS, SETUP_CODE_TTL_MINUTES } from '../auth.constants';
import type { Actor, AuthContext } from '../auth-context';
import {
  authSessions,
  customerPasswordCodes,
  type CustomerUserStatus,
  customerUsers,
  type SessionRevokeReason,
} from '../schema';
import { AuditService } from './audit.service';
import { CustomerLoginLimiter } from './login-limiter.service';
import type { IssuedCode } from './password-codes';
import { hashSetupCode, newSetupCode } from './tokens';

/** A store's customer app account as the office's «Апп» card shows it (ADR-0079 #11). */
export interface CustomerAccountView {
  id: number;
  customerId: number;
  phone: string;
  status: CustomerUserStatus;
  /** False until the store redeemed a code (and again after a phone change). */
  passwordSet: boolean;
  lastSignInAt: Date | null;
  lockedUntil: Date | null;
  /** When the live one-time code runs out; null when none is live. */
  codeExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AUDITED = 'customer_users';

/**
 * The office's side of the customer app accounts (ADR-0079 #2, #3, #11): linking a store's phone,
 * one-time codes, closing and reopening the app, and the reads other modules need. Every write runs
 * inside the caller's transaction (partners locks the customer row first) with an audit row. In the
 * core module, because the worker's customer import ends sessions too.
 */
@Injectable()
export class CustomerAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly limiter: CustomerLoginLimiter,
  ) {}

  async get(customerId: number, executor: Db | Tx = this.db): Promise<CustomerAccountView | null> {
    const [row] = await executor
      .select({
        id: customerUsers.id,
        customerId: customerUsers.customerId,
        phone: customerUsers.phone,
        status: customerUsers.status,
        passwordSet: sql<boolean>`${customerUsers.passwordHash} IS NOT NULL`,
        lastSignInAt: customerUsers.lastSignInAt,
        lockedUntil: customerUsers.lockedUntil,
        codeExpiresAt: sql<Date | string | null>`(
          SELECT c.expires_at FROM customer_password_codes c
           WHERE c.customer_user_id = customer_users.id
             AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now()
             AND c.attempts < ${SETUP_CODE_MAX_ATTEMPTS})`,
        createdAt: customerUsers.createdAt,
        updatedAt: customerUsers.updatedAt,
      })
      .from(customerUsers)
      .where(eq(customerUsers.customerId, customerId));
    if (!row) return null;
    const codeExpiresAt =
      row.codeExpiresAt === null
        ? null
        : row.codeExpiresAt instanceof Date
          ? row.codeExpiresAt
          : new Date(row.codeExpiresAt);
    return { ...row, codeExpiresAt };
  }

  /**
   * Links `phone` to the customer (one store — one phone, ADR-0079 #2): creates the account, or
   * changes its phone, which clears the password, revokes the live code and ends every session (the
   * phone is the sign-in name; the store takes a new code). The same phone again changes nothing.
   * A phone of another store answers DUPLICATE_VALUE `customer_users_phone_key`.
   */
  async linkInTx(
    tx: Tx,
    ctx: AuthContext,
    customerId: number,
    rawPhone: string,
  ): Promise<CustomerAccountView> {
    const phone = normalizeMnPhone(rawPhone);
    if (!phone) throw invalid('phone', 'phone', 'a Mongolian mobile number');
    const [existing] = await tx
      .select()
      .from(customerUsers)
      .where(eq(customerUsers.customerId, customerId))
      .for('update');
    if (!existing) {
      const [created] = await tx
        .insert(customerUsers)
        .values({ customerId, phone, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning({ id: customerUsers.id });
      if (!created) throw new Error('customer account insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: AUDITED,
        entityId: created.id,
        after: { customerId, phone },
      });
    } else if (existing.phone !== phone) {
      await tx
        .update(customerUsers)
        .set({
          phone,
          passwordHash: null,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(customerUsers.id, existing.id));
      await this.revokeCodes(tx, existing.id);
      const ended = await this.endSessions(tx, existing.id, 'PHONE_CHANGED');
      await this.audit.record(tx, ctx, {
        action: 'PHONE_CHANGE',
        entity: AUDITED,
        entityId: existing.id,
        before: { phone: existing.phone },
        after: { phone, sessionsEnded: ended },
      });
      this.limiter.clearUser(existing.phone);
      this.limiter.clearUser(phone);
    }
    const view = await this.get(customerId, tx);
    if (!view) throw new Error('a linked customer account is missing');
    return view;
  }

  /**
   * A one-time code (Crockford `XXXXX-XXXXX`, 30 minutes, 5 attempts, HMAC with AUTH_PEPPER) the
   * office reads out to the store (ADR-0079 #3); the previous live code is revoked. Shown once,
   * never stored in clear: the route answering it is never `@Idempotent`.
   */
  async issueCodeInTx(tx: Tx, ctx: AuthContext, customerId: number): Promise<IssuedCode> {
    const account = await this.lockAccount(tx, customerId);
    if (account.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED', `customer account ${account.id} is disabled`);
    }
    await this.revokeCodes(tx, account.id);
    const code = newSetupCode();
    const [row] = await tx
      .insert(customerPasswordCodes)
      .values({
        customerUserId: account.id,
        codeHash: hashSetupCode(this.config.require('AUTH_PEPPER'), code),
        createdBy: ctx.userId,
        expiresAt: sql`now() + make_interval(mins => ${SETUP_CODE_TTL_MINUTES})`,
      })
      .returning({ expiresAt: customerPasswordCodes.expiresAt });
    if (!row) throw new Error('customer code insert returned no row');
    await this.audit.record(tx, ctx, {
      action: 'PASSWORD_CODE_ISSUED',
      entity: AUDITED,
      entityId: account.id,
    });
    this.limiter.clearUser(account.phone);
    return { code, expiresAt: row.expiresAt };
  }

  /** «Аппыг хаах» ends every session and revokes the code; «нээх» lets the store sign in again. */
  async setStatusInTx(
    tx: Tx,
    ctx: AuthContext,
    customerId: number,
    status: CustomerUserStatus,
  ): Promise<CustomerAccountView> {
    const account = await this.lockAccount(tx, customerId);
    if (account.status !== status) {
      await tx
        .update(customerUsers)
        .set({
          status,
          ...(status === 'ACTIVE' ? { failedLoginCount: 0, lockedUntil: null } : {}),
          updatedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(customerUsers.id, account.id));
      const ended =
        status === 'DISABLED' ? await this.endSessions(tx, account.id, 'ACCOUNT_DISABLED') : 0;
      if (status === 'DISABLED') await this.revokeCodes(tx, account.id);
      await this.audit.record(tx, ctx, {
        action: status === 'DISABLED' ? 'DISABLE' : 'ENABLE',
        entity: AUDITED,
        entityId: account.id,
        before: { status: account.status },
        after: { status, sessionsEnded: ended },
      });
      if (status === 'ACTIVE') this.limiter.clearUser(account.phone);
    }
    const view = await this.get(customerId, tx);
    if (!view) throw new Error('a customer account vanished');
    return view;
  }

  /**
   * Ends the live sessions of a customer's account, if it has one (partners calls it when the
   * customer becomes inactive, ADR-0079 #2); the account itself stays as it is.
   */
  async endSessionsOfCustomerInTx(
    tx: Tx,
    actor: Actor,
    customerId: number,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const [account] = await tx
      .select({ id: customerUsers.id })
      .from(customerUsers)
      .where(eq(customerUsers.customerId, customerId));
    if (!account) return 0;
    const ended = await this.endSessions(tx, account.id, reason);
    if (ended > 0) {
      await this.audit.record(tx, actor, {
        action: 'SESSIONS_REVOKED',
        entity: AUDITED,
        entityId: account.id,
        after: { reason, sessionsEnded: ended },
      });
    }
    return ended;
  }

  /** Each listed customer's account status; customers without an account are left out. */
  async statusOf(customerIds: readonly number[]): Promise<Map<number, CustomerUserStatus>> {
    if (!customerIds.length) return new Map();
    const rows = await this.db
      .select({ customerId: customerUsers.customerId, status: customerUsers.status })
      .from(customerUsers)
      .where(inArray(customerUsers.customerId, [...new Set(customerIds)]));
    return new Map(rows.map((row) => [row.customerId, row.status]));
  }

  /** The customers with an account (of that status when given), ascending. */
  async customerIdsWithAccount(status?: CustomerUserStatus): Promise<number[]> {
    const rows = await this.db
      .select({ customerId: customerUsers.customerId })
      .from(customerUsers)
      .where(status ? eq(customerUsers.status, status) : undefined)
      .orderBy(asc(customerUsers.customerId));
    return rows.map((row) => row.customerId);
  }

  /** The account of a customer, any status; null when the store has none. */
  async accountIdOf(customerId: number, executor: Db | Tx = this.db): Promise<number | null> {
    const [row] = await executor
      .select({ id: customerUsers.id })
      .from(customerUsers)
      .where(eq(customerUsers.customerId, customerId));
    return row?.id ?? null;
  }

  /** customer id → account id for the listed customers that have one. */
  async accountIdsOf(
    customerIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, number>> {
    if (!customerIds.length) return new Map();
    const rows = await executor
      .select({ id: customerUsers.id, customerId: customerUsers.customerId })
      .from(customerUsers)
      .where(inArray(customerUsers.customerId, [...new Set(customerIds)]));
    return new Map(rows.map((row) => [row.customerId, row.id]));
  }

  /** The ACTIVE accounts' ids, ascending: a customers' notice's recipients (ADR-0079 #8). */
  async activeAccountIds(): Promise<number[]> {
    const rows = await this.db
      .select({ id: customerUsers.id })
      .from(customerUsers)
      .where(eq(customerUsers.status, 'ACTIVE'))
      .orderBy(asc(customerUsers.id));
    return rows.map((row) => row.id);
  }

  /** ACTIVE accounts, for the admin's counts (notices, the home warning). */
  async activeCount(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(customerUsers)
      .where(eq(customerUsers.status, 'ACTIVE'));
    return row?.value ?? 0;
  }

  private async lockAccount(tx: Tx, customerId: number) {
    const [account] = await tx
      .select()
      .from(customerUsers)
      .where(eq(customerUsers.customerId, customerId))
      .for('update');
    if (!account) {
      throw new AppError('NOT_FOUND', `customer ${customerId} has no app account`, {
        id: customerId,
      });
    }
    return account;
  }

  private async revokeCodes(tx: Tx, customerUserId: number): Promise<void> {
    await tx
      .update(customerPasswordCodes)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(customerPasswordCodes.customerUserId, customerUserId),
          isNull(customerPasswordCodes.usedAt),
          isNull(customerPasswordCodes.revokedAt),
        ),
      );
  }

  private async endSessions(
    tx: Tx,
    customerUserId: number,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const rows = await tx
      .update(authSessions)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(
        and(
          eq(authSessions.kind, 'CUSTOMER'),
          eq(authSessions.customerUserId, customerUserId),
          isNull(authSessions.revokedAt),
        ),
      )
      .returning({ id: authSessions.id });
    return rows.length;
  }
}
