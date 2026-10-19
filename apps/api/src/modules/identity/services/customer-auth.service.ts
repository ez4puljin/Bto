import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { checkPassword, PASSWORD_MIN_LENGTH } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { and, eq, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import {
  ACCOUNT_LOCK_MINUTES,
  ACCOUNT_LOCK_THRESHOLD,
  JWT_CUSTOMER_AUDIENCE,
  REFRESH_GRACE_MS,
  SETUP_CODE_MAX_ATTEMPTS,
} from '../auth.constants';
import type { Actor, CustomerActor, CustomerContext } from '../auth-context';
import { CUSTOMER_ACCOUNT_GATE, type CustomerAccountGate } from '../customer-account-gate';
import {
  authSessions,
  customerPasswordCodes,
  customerUsers,
  type SessionRevokeReason,
} from '../schema';
import { AuditService } from './audit.service';
import { type ClientInfo, parseRefreshCookie } from './auth.service';
import { CustomerLoginLimiter } from './login-limiter.service';
import { PasswordHasher } from './password-hasher.service';
import { SettingsService } from './settings.service';
import { hashSetupCode, newRefreshToken, sameDigest, sha256Hex } from './tokens';

/** What a customer sign-in, refresh or code redemption hands back to the controller. */
export interface IssuedCustomerSession {
  customerUserId: number;
  customerId: number;
  phone: string;
  sessionId: string;
  sessionStartedAt: Date;
  accessToken: string;
  accessTokenExpiresAt: Date;
  sessionExpiresAt: Date;
  /** `<sessionId>.<token>`; absent in the 20-second grace window (keep the stored one). */
  refreshToken?: string;
}

interface CreatedSession {
  sessionId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

interface Account {
  id: number;
  customerId: number;
  phone: string;
}

const authActor = (client: ClientInfo): Actor => ({
  kind: 'SYSTEM',
  label: 'auth',
  ...(client.requestId ? { requestId: client.requestId } : {}),
});

const customerActor = (customerUserId: number, client: ClientInfo): CustomerActor => ({
  kind: 'CUSTOMER',
  customerUserId,
  ...(client.requestId ? { requestId: client.requestId } : {}),
});

/** The phone a store types, in its stored form; anything else can never match an account. */
const signInPhone = (input: string): string => normalizeMnPhone(input) ?? input.trim().slice(0, 32);

/**
 * Customer app sign-in (ADR-0079 #3): phone + password with the staff rules (argon2id, the failure
 * limiter on its own counters, the 20-failure lock), one-time codes the office reads out, and
 * sessions on the native body-token transport (ADR-0061 #4) with kind CUSTOMER that end at
 * sign-out or after `auth.customer_session_days` without use. A customer token carries its own
 * audience, so no staff route ever accepts it.
 */
@Injectable()
export class CustomerAuthService implements OnModuleInit {
  private readonly logger = new Logger('CustomerAuthService');
  private gate: CustomerAccountGate | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly limiter: CustomerLoginLimiter,
    private readonly config: AppConfig,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.gate = this.moduleRef.get<CustomerAccountGate>(CUSTOMER_ACCOUNT_GATE, {
        strict: false,
      });
    } catch {
      this.gate = null;
      this.logger.warn('no customer account gate is bound: customer sign-ins are refused');
    }
  }

  async login(
    input: { phone: string; password: string },
    client: ClientInfo,
  ): Promise<IssuedCustomerSession> {
    const phone = signInPhone(input.phone);
    this.limiter.assertAllowed(client.ip, phone);
    const [account] = await this.db
      .select({
        id: customerUsers.id,
        customerId: customerUsers.customerId,
        phone: customerUsers.phone,
        passwordHash: customerUsers.passwordHash,
        status: customerUsers.status,
        lockedUntil: customerUsers.lockedUntil,
      })
      .from(customerUsers)
      .where(eq(customerUsers.phone, phone));
    if (account?.lockedUntil && account.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', `customer account ${account.id} is locked`, {
        lockedUntil: account.lockedUntil.toISOString(),
      });
    }
    const valid = await this.hasher.verify(account?.passwordHash ?? null, input.password);
    if (!account || !valid) {
      this.limiter.recordFailure(client.ip, phone);
      if (account) await this.recordFailedPassword(account.id, client);
      throw new AppError('INVALID_CREDENTIALS', 'invalid phone or password');
    }
    // Only a caller who knows the password learns that the app is closed for the store.
    if (account.status !== 'ACTIVE' || !(await this.customerActive(this.db, account.customerId))) {
      throw new AppError('ACCOUNT_DISABLED', `customer account ${account.id} may not sign in`);
    }
    this.limiter.recordSuccess(client.ip, phone);
    const created = await inTransaction(this.db, async (tx) => {
      await tx
        .update(customerUsers)
        .set({ failedLoginCount: 0, lockedUntil: null, lastSignInAt: sql`now()` })
        .where(eq(customerUsers.id, account.id));
      return this.createSession(tx, account.id, client);
    });
    return this.issue(account, created);
  }

  async refresh(value: string | undefined, client: ClientInfo): Promise<IssuedCustomerSession> {
    const parsed = parseRefreshCookie(value);
    if (!parsed) throw new AppError('UNAUTHORIZED', 'no refresh token', { reason: 'REFRESH' });
    const days = await this.settings.get('auth.customer_session_days');
    const outcome = await inTransaction(this.db, async (tx) => {
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.id, parsed.sessionId), eq(authSessions.kind, 'CUSTOMER')))
        .for('update');
      if (!session?.customerUserId || session.revokedAt) return { kind: 'invalid' as const };
      if (session.expiresAt <= new Date()) return { kind: 'expired' as const };
      const account = await this.activeAccount(tx, session.customerUserId);
      if (!account) return { kind: 'invalid' as const };
      const presented = sha256Hex(parsed.token);
      if (sameDigest(presented, session.tokenHash)) {
        const token = newRefreshToken();
        // Every use moves the end: 90 days without use (ADR-0079 #3).
        const [moved] = await tx
          .update(authSessions)
          .set({
            tokenHash: sha256Hex(token),
            previousTokenHash: session.tokenHash,
            rotatedAt: sql`now()`,
            lastUsedAt: sql`now()`,
            expiresAt: sql`now() + make_interval(days => ${days})`,
          })
          .where(eq(authSessions.id, session.id))
          .returning({ expiresAt: authSessions.expiresAt });
        if (!moved) throw new Error('a locked session vanished');
        return {
          kind: 'rotated' as const,
          account,
          created: {
            sessionId: session.id,
            token,
            createdAt: session.createdAt,
            expiresAt: moved.expiresAt,
          },
        };
      }
      const replayed =
        session.previousTokenHash !== null && sameDigest(presented, session.previousTokenHash);
      if (
        replayed &&
        session.rotatedAt &&
        Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS
      ) {
        // The answer of a refresh was lost and the app asks again: it keeps the token it has.
        return {
          kind: 'grace' as const,
          account,
          created: {
            sessionId: session.id,
            token: '',
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        };
      }
      if (replayed) {
        await this.revoke(tx, eq(authSessions.id, session.id), 'TOKEN_REUSE');
        await this.audit.record(tx, authActor(client), {
          action: 'TOKEN_REUSE',
          entity: 'auth_sessions',
          entityId: session.id,
        });
      }
      return { kind: 'invalid' as const };
    });
    switch (outcome.kind) {
      case 'expired':
        throw new AppError('SESSION_EXPIRED', 'session expired');
      case 'invalid':
        throw new AppError('UNAUTHORIZED', 'refresh rejected', { reason: 'REFRESH' });
      case 'grace':
      case 'rotated':
        return this.issue(outcome.account, outcome.created);
    }
  }

  /** Revokes the session of the refresh token, if it is a live customer one; always succeeds. */
  async logout(value: string | undefined, client: ClientInfo): Promise<void> {
    const parsed = parseRefreshCookie(value);
    if (!parsed) return;
    await inTransaction(this.db, async (tx) => {
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.id, parsed.sessionId), eq(authSessions.kind, 'CUSTOMER')))
        .for('update');
      if (!session?.customerUserId || session.revokedAt) return;
      const presented = sha256Hex(parsed.token);
      const known =
        sameDigest(presented, session.tokenHash) ||
        (session.previousTokenHash !== null && sameDigest(presented, session.previousTokenHash));
      if (!known) return;
      await this.revoke(tx, eq(authSessions.id, session.id), 'LOGOUT');
      await this.audit.record(tx, customerActor(session.customerUserId, client), {
        action: 'LOGOUT',
        entity: 'auth_sessions',
        entityId: session.id,
      });
    });
  }

  /**
   * Redeems the office's one-time code (ADR-0079 #3): sets the password, ends the account's other
   * sessions and signs in. The account row is locked first, so two redemptions of one code run one
   * after the other and only the first finds it live.
   */
  async setupPassword(
    input: { phone: string; code: string; newPassword: string },
    client: ClientInfo,
  ): Promise<IssuedCustomerSession> {
    const phone = signInPhone(input.phone);
    this.limiter.assertAllowed(client.ip, phone);
    this.assertStrong(input.newPassword, phone);
    const passwordHash = await this.hasher.hash(input.newPassword);
    const pepper = this.config.require('AUTH_PEPPER');
    const outcome = await inTransaction(this.db, async (tx) => {
      const [account] = await tx
        .select({
          id: customerUsers.id,
          customerId: customerUsers.customerId,
          phone: customerUsers.phone,
          status: customerUsers.status,
        })
        .from(customerUsers)
        .where(eq(customerUsers.phone, phone))
        .for('update');
      if (account?.status !== 'ACTIVE') return null;
      if (!(await this.customerActive(tx, account.customerId))) return null;
      const [code] = await tx
        .select()
        .from(customerPasswordCodes)
        .where(
          and(
            eq(customerPasswordCodes.customerUserId, account.id),
            isNull(customerPasswordCodes.usedAt),
            isNull(customerPasswordCodes.revokedAt),
          ),
        )
        .for('update');
      if (!code || code.expiresAt <= new Date() || code.attempts >= SETUP_CODE_MAX_ATTEMPTS) {
        return null;
      }
      if (!sameDigest(hashSetupCode(pepper, input.code), code.codeHash)) {
        // Committed although the redemption fails, so the attempt limit holds.
        const exhausted = code.attempts + 1 >= SETUP_CODE_MAX_ATTEMPTS;
        await tx
          .update(customerPasswordCodes)
          .set({
            attempts: sql`${customerPasswordCodes.attempts} + 1`,
            ...(exhausted ? { revokedAt: sql`now()` } : {}),
          })
          .where(eq(customerPasswordCodes.id, code.id));
        return null;
      }
      await tx
        .update(customerPasswordCodes)
        .set({ usedAt: sql`now()` })
        .where(eq(customerPasswordCodes.id, code.id));
      await tx
        .update(customerUsers)
        .set({
          passwordHash,
          passwordChangedAt: sql`now()`,
          failedLoginCount: 0,
          lockedUntil: null,
          lastSignInAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(customerUsers.id, account.id));
      await this.revoke(tx, eq(authSessions.customerUserId, account.id), 'PASSWORD_CHANGED');
      await this.audit.record(tx, customerActor(account.id, client), {
        action: 'PASSWORD_SET',
        entity: 'customer_users',
        entityId: account.id,
      });
      return { account, created: await this.createSession(tx, account.id, client) };
    });
    if (!outcome) {
      this.limiter.recordFailure(client.ip, phone);
      throw new AppError('PASSWORD_CODE_INVALID', 'one-time code rejected');
    }
    this.limiter.recordSuccess(client.ip, phone);
    return this.issue(outcome.account, outcome.created);
  }

  /** «Нууц үг солих»: the current password, then the new one; the other phones are signed out. */
  async changePassword(
    ctx: CustomerContext,
    input: { currentPassword: string; newPassword: string },
    client: ClientInfo,
  ): Promise<void> {
    const [account] = await this.db
      .select({ passwordHash: customerUsers.passwordHash })
      .from(customerUsers)
      .where(eq(customerUsers.id, ctx.customerUserId));
    if (!(await this.hasher.verify(account?.passwordHash ?? null, input.currentPassword))) {
      await this.recordFailedPassword(ctx.customerUserId, client);
      throw new AppError('CURRENT_PASSWORD_INCORRECT', 'current password does not match');
    }
    this.assertStrong(input.newPassword, ctx.phone);
    const passwordHash = await this.hasher.hash(input.newPassword);
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(customerUsers)
        .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(customerUsers.id, ctx.customerUserId));
      await this.revoke(
        tx,
        and(
          eq(authSessions.customerUserId, ctx.customerUserId),
          ne(authSessions.id, ctx.sessionId),
        ),
        'PASSWORD_CHANGED',
      );
      await this.audit.record(tx, ctx, {
        action: 'PASSWORD_CHANGED',
        entity: 'customer_users',
        entityId: ctx.customerUserId,
      });
    });
  }

  private async customerActive(executor: Db | Tx, customerId: number): Promise<boolean> {
    if (!this.gate) return false;
    return this.gate.isActive(executor, customerId);
  }

  private async activeAccount(tx: Tx, customerUserId: number): Promise<Account | null> {
    const [account] = await tx
      .select({
        id: customerUsers.id,
        customerId: customerUsers.customerId,
        phone: customerUsers.phone,
        status: customerUsers.status,
      })
      .from(customerUsers)
      .where(eq(customerUsers.id, customerUserId));
    if (account?.status !== 'ACTIVE') return null;
    if (!(await this.customerActive(tx, account.customerId))) return null;
    return { id: account.id, customerId: account.customerId, phone: account.phone };
  }

  private async revoke(
    tx: Tx,
    where: SQL | undefined,
    reason: SessionRevokeReason,
  ): Promise<number> {
    const rows = await tx
      .update(authSessions)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(where, eq(authSessions.kind, 'CUSTOMER'), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  private assertStrong(password: string, phone: string): void {
    const problem = checkPassword(password, phone);
    if (problem) {
      throw new AppError('PASSWORD_TOO_WEAK', `password rejected: ${problem}`, {
        problem,
        minLength: PASSWORD_MIN_LENGTH,
      });
    }
  }

  /** One statement, so concurrent failures never lose an increment (as for staff). */
  private async recordFailedPassword(customerUserId: number, client: ClientInfo): Promise<void> {
    const reachesLock = sql`${customerUsers.failedLoginCount} + 1 >= ${ACCOUNT_LOCK_THRESHOLD}`;
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(customerUsers)
        .set({
          failedLoginCount: sql`CASE WHEN ${reachesLock} THEN 0 ELSE ${customerUsers.failedLoginCount} + 1 END`,
          lockedUntil: sql`CASE WHEN ${reachesLock}
            THEN now() + make_interval(mins => ${ACCOUNT_LOCK_MINUTES}) ELSE ${customerUsers.lockedUntil} END`,
        })
        .where(eq(customerUsers.id, customerUserId));
      await this.audit.record(tx, authActor(client), {
        action: 'LOGIN_FAILED',
        entity: 'customer_users',
        entityId: customerUserId,
      });
    });
  }

  private async createSession(
    tx: Tx,
    customerUserId: number,
    client: ClientInfo,
  ): Promise<CreatedSession> {
    const days = await this.settings.get('auth.customer_session_days', undefined, tx);
    const token = newRefreshToken();
    const [session] = await tx
      .insert(authSessions)
      .values({
        kind: 'CUSTOMER',
        customerUserId,
        tokenHash: sha256Hex(token),
        userAgent: client.userAgent,
        ip: client.ip,
        expiresAt: sql`now() + make_interval(days => ${days})`,
      })
      .returning({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
      });
    if (!session) throw new Error('session insert returned no row');
    await this.audit.record(tx, customerActor(customerUserId, client), {
      action: 'LOGIN',
      entity: 'auth_sessions',
      entityId: session.id,
    });
    return {
      sessionId: session.id,
      token,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }

  private async issue(account: Account, created: CreatedSession): Promise<IssuedCustomerSession> {
    const accessToken = await this.jwt.signAsync(
      { sub: String(account.id), sid: created.sessionId, kind: 'CUSTOMER' },
      { audience: JWT_CUSTOMER_AUDIENCE },
    );
    const claims = this.jwt.decode<{ exp?: number }>(accessToken);
    return {
      customerUserId: account.id,
      customerId: account.customerId,
      phone: account.phone,
      sessionId: created.sessionId,
      sessionStartedAt: created.createdAt,
      accessToken,
      accessTokenExpiresAt: new Date((claims.exp ?? 0) * 1000),
      sessionExpiresAt: created.expiresAt,
      ...(created.token ? { refreshToken: `${created.sessionId}.${created.token}` } : {}),
    };
  }
}
