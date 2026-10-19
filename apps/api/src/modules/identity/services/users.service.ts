import { Inject, Injectable } from '@nestjs/common';
import { normalizeUsername, USERNAME_PATTERN } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import type { AuthContext } from '../auth-context';
import { authSessions, branches, roles, userRoles, userScopes, users, warehouses } from '../schema';
import { AuditService } from './audit.service';
import { AuthService } from './auth.service';
import { mirrorCompanyRoles } from './company-roles';
import { LoginLimiter } from './login-limiter.service';
import { type IssuedCode, issuePasswordCode } from './password-codes';

export type UserStatus = (typeof users.$inferSelect)['status'];

export interface UserScopes {
  warehouseIds: number[];
  branchIds: number[];
}

export interface UserSummary {
  id: number;
  username: string;
  fullName: string;
  status: UserStatus;
  roleIds: number[];
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
}

export interface UserDetail extends UserSummary {
  phone: string | null;
  passwordSet: boolean;
  failedLoginCount: number;
  scopes: UserScopes;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserInput {
  username: string;
  fullName: string;
  phone?: string | null;
  roleIds: number[];
  scopes?: UserScopes;
}

export interface UserPatch {
  fullName?: string;
  phone?: string | null;
  status?: UserStatus;
  roleIds?: number[];
  scopes?: UserScopes;
}

export interface SessionView {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

function normalizedPhone(phone: string | null | undefined): string | null | undefined {
  if (phone === undefined || phone === null || phone.trim() === '')
    return phone === undefined ? undefined : null;
  const value = normalizeMnPhone(phone);
  if (!value) throw invalid('phone', 'isMnPhone', 'phone must be 8 Mongolian digits');
  return value;
}

/**
 * Staff accounts (SPEC §5.1, ADR-0027). Only ADMIN holds `identity.users.manage`, so callers are
 * admins; nobody edits their own roles, scopes or status, and the last active ADMIN stays.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly limiter: LoginLimiter,
    private readonly config: AppConfig,
  ) {}

  async list(query: { cursor?: string; limit?: number; q?: string; status?: UserStatus }) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const conditions: SQL[] = [];
    if (typeof after?.id === 'number') conditions.push(gt(users.id, after.id));
    if (query.status) conditions.push(eq(users.status, query.status));
    const term = query.q?.trim();
    if (term) {
      const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const match = or(ilike(users.username, pattern), ilike(users.fullName, pattern));
      if (match) conditions.push(match);
    }
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const roleIds = await this.roleIdsOf(page.data.map((row) => row.id));
    return {
      data: page.data.map((row) => toSummary(row, roleIds.get(row.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<UserDetail> {
    const [row] = await executor.select().from(users).where(eq(users.id, id));
    if (!row) throw new AppError('NOT_FOUND', `user ${id} not found`, { id });
    const roleIds = (await this.roleIdsOf([id], executor)).get(id) ?? [];
    const scopes = await executor
      .select({ branchId: userScopes.branchId, warehouseId: userScopes.warehouseId })
      .from(userScopes)
      .where(eq(userScopes.userId, id));
    return {
      ...toSummary(row, roleIds),
      phone: row.phone,
      passwordSet: row.passwordHash !== null,
      failedLoginCount: row.failedLoginCount,
      scopes: {
        warehouseIds: scopes
          .flatMap((s) => (s.warehouseId === null ? [] : [s.warehouseId]))
          .sort(byNumber),
        branchIds: scopes.flatMap((s) => (s.branchId === null ? [] : [s.branchId])).sort(byNumber),
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(actor: AuthContext, input: UserInput): Promise<UserDetail> {
    const username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(username)) {
      throw invalid('username', 'isUsername', 'username: 3-32 of a-z 0-9 . _ -');
    }
    const phone = normalizedPhone(input.phone);
    return inTransaction(this.db, async (tx) => {
      await this.assertRoles(tx, input.roleIds);
      if (input.scopes) await this.assertScopeTargets(tx, input.scopes);
      const [row] = await tx
        .insert(users)
        .values({ username, fullName: input.fullName.trim(), phone: phone ?? null })
        .returning({ id: users.id });
      if (!row) throw new Error('user insert returned no row');
      await this.replaceRoles(tx, row.id, input.roleIds);
      if (input.scopes) await this.replaceScopes(tx, row.id, input.scopes);
      const created = await this.get(row.id, tx);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'users',
        entityId: row.id,
        after: created,
      });
      return created;
    });
  }

  async update(actor: AuthContext, id: number, patch: UserPatch): Promise<UserDetail> {
    const touchesAccess =
      patch.status !== undefined || patch.roleIds !== undefined || patch.scopes !== undefined;
    if (touchesAccess && id === actor.userId) {
      throw new AppError('SELF_EDIT_FORBIDDEN', 'users cannot change their own access', { id });
    }
    const phone = normalizedPhone(patch.phone);
    return inTransaction(this.db, async (tx) => {
      // Lock order: the ADMIN role row first (serialises every access change), then the user.
      const adminRoleId = await this.lockAdminRole(tx);
      const [locked] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!locked) throw new AppError('NOT_FOUND', `user ${id} not found`, { id });
      const before = await this.get(id, tx);
      if (patch.roleIds) await this.assertRoles(tx, patch.roleIds);
      if (patch.scopes) await this.assertScopeTargets(tx, patch.scopes);
      if (patch.status !== undefined || patch.roleIds !== undefined) {
        await this.assertAdminRemains(tx, adminRoleId, before, {
          status: patch.status ?? before.status,
          roleIds: patch.roleIds ?? before.roleIds,
        });
      }
      const fields: Partial<typeof users.$inferInsert> = {};
      if (patch.fullName !== undefined) fields.fullName = patch.fullName.trim();
      if (phone !== undefined) fields.phone = phone;
      if (patch.status !== undefined) fields.status = patch.status;
      await tx
        .update(users)
        .set({ ...fields, updatedAt: sql`now()` })
        .where(eq(users.id, id));
      if (patch.roleIds) await this.replaceRoles(tx, id, patch.roleIds);
      if (patch.scopes) await this.replaceScopes(tx, id, patch.scopes);
      if (patch.status === 'DISABLED' && before.status !== 'DISABLED') {
        await this.auth.revokeWhere(tx, eq(authSessions.userId, id), 'USER_DISABLED');
      }
      const after = await this.get(id, tx);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'users',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** A one-time code the user redeems to set a password; shown once, never stored in clear. */
  async issuePasswordCode(actor: AuthContext, id: number): Promise<IssuedCode> {
    return inTransaction(this.db, async (tx) => {
      const user = await this.get(id, tx);
      const issued = await issuePasswordCode(tx, {
        userId: user.id,
        createdBy: actor.userId,
        pepper: this.config.require('AUTH_PEPPER'),
      });
      await this.audit.record(tx, actor, {
        action: 'PASSWORD_CODE_ISSUED',
        entity: 'users',
        entityId: id,
      });
      return issued;
    });
  }

  async unlock(actor: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const user = await this.get(id, tx);
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(users.id, id));
      this.limiter.clearUser(user.username);
      await this.audit.record(tx, actor, { action: 'UNLOCK', entity: 'users', entityId: id });
    });
  }

  async sessions(id: number): Promise<SessionView[]> {
    await this.get(id);
    return this.db
      .select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        expiresAt: authSessions.expiresAt,
        userAgent: authSessions.userAgent,
        ip: authSessions.ip,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, id),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(authSessions.createdAt));
  }

  /** Revokes one device (sessionId) or every device of a user. */
  async revokeSessions(actor: AuthContext, id: number, sessionId?: string): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      await this.get(id, tx);
      const target = sessionId
        ? and(eq(authSessions.userId, id), eq(authSessions.id, sessionId))
        : eq(authSessions.userId, id);
      const count = await this.auth.revokeWhere(tx, target, 'ADMIN');
      if (sessionId && count === 0) {
        throw new AppError('NOT_FOUND', `session ${sessionId} not found`, { sessionId });
      }
      await this.audit.record(tx, actor, {
        action: 'SESSIONS_REVOKED',
        entity: 'users',
        entityId: id,
        after: { sessionId: sessionId ?? 'ALL', count },
      });
    });
  }

  private async lockAdminRole(tx: Tx): Promise<number> {
    const [admin] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'ADMIN'))
      .for('update');
    if (!admin) throw new Error('the ADMIN role is missing (synced at api boot)');
    return admin.id;
  }

  /** Under the ADMIN role lock: at least one ACTIVE user keeps the ADMIN role (ADR-0027 #6). */
  private async assertAdminRemains(
    tx: Tx,
    adminRoleId: number,
    before: UserDetail,
    after: { status: UserStatus; roleIds: number[] },
  ): Promise<void> {
    const wasAdmin = before.status === 'ACTIVE' && before.roleIds.includes(adminRoleId);
    const staysAdmin = after.status === 'ACTIVE' && after.roleIds.includes(adminRoleId);
    if (!wasAdmin || staysAdmin) return;
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleId, adminRoleId), eq(users.status, 'ACTIVE')));
    if ((row?.count ?? 0) <= 1) {
      throw new AppError('LAST_ADMIN', `user ${before.id} is the last active admin`, {
        id: before.id,
      });
    }
  }

  private async assertRoles(tx: Tx, roleIds: number[]): Promise<void> {
    const unique = [...new Set(roleIds)];
    if (!unique.length) return;
    const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));
    if (found.length !== unique.length) throw invalid('roleIds', 'exists', 'unknown role id');
  }

  private async assertScopeTargets(tx: Tx, scopes: UserScopes): Promise<void> {
    const warehouseIds = [...new Set(scopes.warehouseIds)];
    const branchIds = [...new Set(scopes.branchIds)];
    if (warehouseIds.length) {
      const found = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(inArray(warehouses.id, warehouseIds));
      if (found.length !== warehouseIds.length) {
        throw invalid('scopes.warehouseIds', 'exists', 'unknown warehouse id');
      }
    }
    if (branchIds.length) {
      const found = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(inArray(branches.id, branchIds));
      if (found.length !== branchIds.length) {
        throw invalid('scopes.branchIds', 'exists', 'unknown branch id');
      }
    }
  }

  private async replaceRoles(tx: Tx, userId: number, roleIds: number[]): Promise<void> {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    const unique = [...new Set(roleIds)];
    if (unique.length) {
      await tx.insert(userRoles).values(unique.map((roleId) => ({ userId, roleId })));
    }
    await mirrorCompanyRoles(tx, userId);
  }

  private async replaceScopes(tx: Tx, userId: number, scopes: UserScopes): Promise<void> {
    await tx.delete(userScopes).where(eq(userScopes.userId, userId));
    const rows = [
      ...[...new Set(scopes.warehouseIds)].map((warehouseId) => ({ userId, warehouseId })),
      ...[...new Set(scopes.branchIds)].map((branchId) => ({ userId, branchId })),
    ];
    if (rows.length) await tx.insert(userScopes).values(rows);
  }

  private async roleIdsOf(
    userIds: number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    if (!userIds.length) return result;
    const rows = await executor
      .select({ userId: userRoles.userId, roleId: userRoles.roleId })
      .from(userRoles)
      .where(inArray(userRoles.userId, userIds))
      .orderBy(asc(userRoles.roleId));
    for (const row of rows) result.set(row.userId, [...(result.get(row.userId) ?? []), row.roleId]);
    return result;
  }
}

const byNumber = (a: number, b: number) => a - b;

function toSummary(row: typeof users.$inferSelect, roleIds: number[]): UserSummary {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    status: row.status,
    roleIds,
    lastLoginAt: row.lastLoginAt,
    lockedUntil: row.lockedUntil,
  };
}
