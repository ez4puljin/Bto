import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { checkPassword, normalizeUsername, PASSWORD_MIN_LENGTH } from '@tugeel/shared/auth';
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import {
  ACCOUNT_LOCK_MINUTES,
  ACCOUNT_LOCK_THRESHOLD,
  REFRESH_GRACE_MS,
  SETUP_CODE_MAX_ATTEMPTS,
} from '../auth.constants';
import type { Actor, AuthContext } from '../auth-context';
import { authSessions, passwordResets, type SessionRevokeReason, users } from '../schema';
import { AuditService } from './audit.service';
import { LoginLimiter } from './login-limiter.service';
import { PasswordHasher } from './password-hasher.service';
import { SettingsService } from './settings.service';
import { hashSetupCode, newRefreshToken, sameDigest, sha256Hex } from './tokens';

/** Where a request came from; stored on the session and used by the limiter. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId?: string;
}

/** What a successful login, refresh or code redemption hands back to the controller. */
export interface IssuedSession {
  userId: number;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  sessionExpiresAt: Date;
  /** `<sessionId>.<token>` when the refresh cookie must be (re)set; absent in the grace window. */
  refreshCookie?: string;
}

interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

const authActor = (client: ClientInfo): Actor => ({
  kind: 'SYSTEM',
  label: 'auth',
  ...(client.requestId ? { requestId: client.requestId } : {}),
});

const staffActor = (userId: number, client: ClientInfo): Actor => ({
  kind: 'STAFF',
  userId,
  ...(client.requestId ? { requestId: client.requestId } : {}),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits the refresh cookie `<sessionId>.<token>`; null when it is not ours. */
export function parseRefreshCookie(
  value: string | undefined,
): { sessionId: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  const sessionId = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (dot < 0 || !UUID.test(sessionId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { sessionId, token };
}

/**
 * Staff authentication (ADR-0005, ADR-0027): argon2id passwords, 15-minute access JWTs, refresh
 * tokens rotated inside a session with a fixed lifetime, one-time codes instead of admin-known
 * passwords, a failure limiter and an account lock as backstop.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly limiter: LoginLimiter,
    private readonly config: AppConfig,
  ) {}

  async login(
    input: { username: string; password: string },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const username = normalizeUsername(input.username);
    this.limiter.assertAllowed(client.ip, username);
    const [user] = await this.db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .where(eq(users.username, username));
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', `user ${user.id} is locked`, {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }
    const valid = await this.hasher.verify(user?.passwordHash ?? null, input.password);
    if (!user || !valid) {
      this.limiter.recordFailure(client.ip, username);
      if (user) await this.recordFailedPassword(user.id, client);
      throw new AppError('INVALID_CREDENTIALS', 'invalid username or password');
    }
    // Only a caller who knows the password learns that the account is disabled.
    if (user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_DISABLED', `user ${user.id} is disabled`);
    this.limiter.recordSuccess(client.ip, username);
    const created = await inTransaction(this.db, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` })
        .where(eq(users.id, user.id));
      return this.createSession(tx, user.id, client);
    });
    return this.issue(user.id, created);
  }

  async refresh(cookie: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    const parsed = parseRefreshCookie(cookie);
    if (!parsed) throw new AppError('UNAUTHORIZED', 'no refresh cookie', { reason: 'REFRESH' });
    const outcome = await inTransaction(this.db, async (tx) => {
      // Staff sessions only: a customer app token never refreshes here (ADR-0079 #3).
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.id, parsed.sessionId), eq(authSessions.kind, 'STAFF')))
        .for('update');
      if (!session?.userId || session.revokedAt) return { kind: 'invalid' as const };
      if (session.expiresAt <= new Date()) return { kind: 'expired' as const };
      const userId = session.userId;
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId));
      if (user?.status !== 'ACTIVE') return { kind: 'invalid' as const };
      const presented = sha256Hex(parsed.token);
      if (sameDigest(presented, session.tokenHash)) {
        const token = newRefreshToken();
        await tx
          .update(authSessions)
          .set({
            tokenHash: sha256Hex(token),
            previousTokenHash: session.tokenHash,
            rotatedAt: sql`now()`,
            lastUsedAt: sql`now()`,
          })
          .where(eq(authSessions.id, session.id));
        return {
          kind: 'rotated' as const,
          userId,
          created: { sessionId: session.id, token, expiresAt: session.expiresAt },
        };
      }
      const replayed =
        session.previousTokenHash !== null && sameDigest(presented, session.previousTokenHash);
      if (
        replayed &&
        session.rotatedAt &&
        Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS
      ) {
        // Two tabs refreshed at once: the other tab already holds the new cookie.
        return {
          kind: 'grace' as const,
          userId,
          sessionId: session.id,
          expiresAt: session.expiresAt,
        };
      }
      if (replayed) {
        await this.revokeWhere(tx, eq(authSessions.id, session.id), 'TOKEN_REUSE');
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
        return this.issue(outcome.userId, {
          sessionId: outcome.sessionId,
          token: '',
          expiresAt: outcome.expiresAt,
        });
      case 'rotated':
        return this.issue(outcome.userId, outcome.created);
    }
  }

  /** Revokes the session of the refresh cookie, if it is a live one; always succeeds. */
  async logout(cookie: string | undefined, client: ClientInfo): Promise<void> {
    const parsed = parseRefreshCookie(cookie);
    if (!parsed) return;
    await inTransaction(this.db, async (tx) => {
      const [session] = await tx
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.id, parsed.sessionId), eq(authSessions.kind, 'STAFF')))
        .for('update');
      if (!session?.userId || session.revokedAt) return;
      const presented = sha256Hex(parsed.token);
      const known =
        sameDigest(presented, session.tokenHash) ||
        (session.previousTokenHash !== null && sameDigest(presented, session.previousTokenHash));
      if (!known) return;
      await this.revokeWhere(tx, eq(authSessions.id, session.id), 'LOGOUT');
      await this.audit.record(tx, staffActor(session.userId, client), {
        action: 'LOGOUT',
        entity: 'auth_sessions',
        entityId: session.id,
      });
    });
  }

  /** Signs the caller out on every device, this one included. */
  async logoutAll(ctx: AuthContext): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      await this.revokeWhere(tx, eq(authSessions.userId, ctx.userId), 'LOGOUT_ALL');
      await this.audit.record(tx, ctx, {
        action: 'LOGOUT_ALL',
        entity: 'users',
        entityId: ctx.userId,
      });
    });
  }

  async changePassword(
    ctx: AuthContext,
    input: { currentPassword: string; newPassword: string },
    client: ClientInfo,
  ): Promise<void> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, ctx.userId));
    if (!(await this.hasher.verify(user?.passwordHash ?? null, input.currentPassword))) {
      await this.recordFailedPassword(ctx.userId, client);
      throw new AppError('CURRENT_PASSWORD_INCORRECT', 'current password does not match');
    }
    this.assertStrong(input.newPassword, ctx.username);
    const passwordHash = await this.hasher.hash(input.newPassword);
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, ctx.userId));
      await this.revokeWhere(
        tx,
        and(eq(authSessions.userId, ctx.userId), ne(authSessions.id, ctx.sessionId)),
        'PASSWORD_CHANGED',
      );
      await this.audit.record(tx, ctx, {
        action: 'PASSWORD_CHANGED',
        entity: 'users',
        entityId: ctx.userId,
      });
    });
  }

  /** Redeems an admin-issued one-time code: sets the password, ends other sessions, logs in. */
  async setupPassword(
    input: { username: string; code: string; newPassword: string },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const username = normalizeUsername(input.username);
    this.limiter.assertAllowed(client.ip, username);
    this.assertStrong(input.newPassword, username);
    const passwordHash = await this.hasher.hash(input.newPassword);
    const pepper = this.config.require('AUTH_PEPPER');
    const outcome = await inTransaction(this.db, async (tx) => {
      const [user] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.username, username))
        .for('update');
      if (user?.status !== 'ACTIVE') return null;
      const [code] = await tx
        .select()
        .from(passwordResets)
        .where(
          and(
            eq(passwordResets.userId, user.id),
            isNull(passwordResets.usedAt),
            isNull(passwordResets.revokedAt),
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
          .update(passwordResets)
          .set({
            attempts: sql`${passwordResets.attempts} + 1`,
            ...(exhausted ? { revokedAt: sql`now()` } : {}),
          })
          .where(eq(passwordResets.id, code.id));
        return null;
      }
      await tx
        .update(passwordResets)
        .set({ usedAt: sql`now()` })
        .where(eq(passwordResets.id, code.id));
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: sql`now()`,
          failedLoginCount: 0,
          lockedUntil: null,
          // Redeeming the code signs the user in.
          lastLoginAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, user.id));
      await this.revokeWhere(tx, eq(authSessions.userId, user.id), 'PASSWORD_CHANGED');
      await this.audit.record(tx, staffActor(user.id, client), {
        action: 'PASSWORD_SET',
        entity: 'users',
        entityId: user.id,
      });
      return { userId: user.id, created: await this.createSession(tx, user.id, client) };
    });
    if (!outcome) {
      this.limiter.recordFailure(client.ip, username);
      throw new AppError('PASSWORD_CODE_INVALID', 'one-time code rejected');
    }
    this.limiter.recordSuccess(client.ip, username);
    return this.issue(outcome.userId, outcome.created);
  }

  /** Revokes live sessions matching `where` (used by logout, admin actions, password changes). */
  async revokeWhere(tx: Tx, where: SQL | undefined, reason: SessionRevokeReason): Promise<number> {
    const rows = await tx
      .update(authSessions)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(where, isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  private assertStrong(password: string, username: string): void {
    const problem = checkPassword(password, username);
    if (problem) {
      throw new AppError('PASSWORD_TOO_WEAK', `password rejected: ${problem}`, {
        problem,
        minLength: PASSWORD_MIN_LENGTH,
      });
    }
  }

  /** One statement, so concurrent failures never lose an increment (integrity suite). */
  private async recordFailedPassword(userId: number, client: ClientInfo): Promise<void> {
    const reachesLock = sql`${users.failedLoginCount} + 1 >= ${ACCOUNT_LOCK_THRESHOLD}`;
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(users)
        .set({
          failedLoginCount: sql`CASE WHEN ${reachesLock} THEN 0 ELSE ${users.failedLoginCount} + 1 END`,
          lockedUntil: sql`CASE WHEN ${reachesLock}
            THEN now() + make_interval(mins => ${ACCOUNT_LOCK_MINUTES}) ELSE ${users.lockedUntil} END`,
        })
        .where(eq(users.id, userId));
      await this.audit.record(tx, authActor(client), {
        action: 'LOGIN_FAILED',
        entity: 'users',
        entityId: userId,
      });
    });
  }

  private async createSession(tx: Tx, userId: number, client: ClientInfo): Promise<CreatedSession> {
    const hours = await this.settings.get('auth.staff_session_hours', undefined, tx);
    const token = newRefreshToken();
    const [session] = await tx
      .insert(authSessions)
      .values({
        kind: 'STAFF',
        userId,
        tokenHash: sha256Hex(token),
        userAgent: client.userAgent,
        ip: client.ip,
        expiresAt: sql`now() + make_interval(hours => ${hours})`,
      })
      .returning({ id: authSessions.id, expiresAt: authSessions.expiresAt });
    if (!session) throw new Error('session insert returned no row');
    await this.audit.record(tx, staffActor(userId, client), {
      action: 'LOGIN',
      entity: 'auth_sessions',
      entityId: session.id,
    });
    return { sessionId: session.id, token, expiresAt: session.expiresAt };
  }

  private async issue(userId: number, created: CreatedSession): Promise<IssuedSession> {
    const accessToken = await this.jwt.signAsync({
      sub: String(userId),
      sid: created.sessionId,
      kind: 'STAFF',
    });
    const claims = this.jwt.decode<{ exp?: number }>(accessToken);
    return {
      userId,
      sessionId: created.sessionId,
      accessToken,
      accessTokenExpiresAt: new Date((claims.exp ?? 0) * 1000),
      sessionExpiresAt: created.expiresAt,
      ...(created.token ? { refreshCookie: `${created.sessionId}.${created.token}` } : {}),
    };
  }
}
