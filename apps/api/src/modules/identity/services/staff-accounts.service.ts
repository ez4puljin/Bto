import { Inject, Injectable } from '@nestjs/common';
import { checkPassword, PASSWORD_MIN_LENGTH, usernameFromPhone } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, invalid } from '../../../common/errors/app-error';
import type { AuditActor, AuthContext } from '../auth-context';
import { authSessions, rolePermissions, roles, userRoles, users } from '../schema';
import { AuditService } from './audit.service';
import { mirrorCompanyRoles } from './company-roles';
import { LoginLimiter } from './login-limiter.service';
import { PasswordHasher } from './password-hasher.service';

export interface PositionRole {
  id: number;
  code: string | null;
  name: string | null;
  permissions: string[];
}

/**
 * Staff accounts as HR keeps them (ADR-0144): an employee registered in «Ажилтан» is a staff user
 * who signs in by phone (ADR-0128), with no roles until an admin gives some; HR may give the first
 * password (owner 2026-11-04: «шууд bto системд нэвтэрдэг байна») and disables the account when the
 * employee leaves. Identity's own tables, written only here and in its other services.
 */
@Injectable()
export class StaffAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: LoginLimiter,
  ) {}

  /** The shared access lock is always taken before a position and its users. */
  async lockAccess(tx: Tx): Promise<number> {
    const [admin] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'ADMIN'))
      .for('update');
    if (!admin) throw new Error('the ADMIN role is missing (synced at api boot)');
    return admin.id;
  }

  async isAdmin(executor: Db | Tx, actor: AuthContext): Promise<boolean> {
    const [admin] = await executor
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'ADMIN'));
    return admin !== undefined && actor.roleIds.includes(admin.id);
  }

  /** Curated identity role data for HR's position picker; keeps existing role IDs and grants. */
  async positionRoles(executor: Db | Tx, roleIds: readonly number[]): Promise<PositionRole[]> {
    if (roleIds.length === 0) return [];
    const rows = await executor
      .select({ id: roles.id, code: roles.code, name: roles.name })
      .from(roles)
      .where(inArray(roles.id, [...roleIds]))
      .orderBy(asc(roles.id));
    if (rows.length !== new Set(roleIds).size)
      throw invalid('roleIds', 'exists', 'unknown role id');
    const grants = await executor
      .select()
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, [...roleIds]));
    return rows.map((row) => ({
      ...row,
      permissions: grants
        .filter((grant) => grant.roleId === row.id)
        .map((grant) => grant.permissionCode)
        .sort(),
    }));
  }

  /**
   * HR owns only the choice of position. Identity replaces the account's roles atomically,
   * preserving scopes, credentials and company-role mirroring, with the existing access guards.
   */
  async assignPositionRoles(
    tx: Tx,
    actor: AuthContext,
    userId: number,
    roleIds: readonly number[],
  ): Promise<void> {
    const adminRoleId = await this.lockAccess(tx);
    const catalog = await this.positionRoles(tx, roleIds);
    const [user] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new AppError('NOT_FOUND', `user ${userId} not found`, { id: userId });
    const held = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(userRoles.roleId));
    const before = held.map((row) => row.roleId);
    const after = catalog.map((row) => row.id);
    const changed = before.join(',') !== after.join(',');
    const isAdmin = actor.roleIds.includes(adminRoleId);
    if (!isAdmin && (before.includes(adminRoleId) || after.includes(adminRoleId))) {
      throw new AppError('FORBIDDEN', 'only ADMIN may assign or change an ADMIN position', {
        permission: 'ADMIN',
      });
    }
    if (changed && userId === actor.userId) {
      throw new AppError('SELF_EDIT_FORBIDDEN', 'users cannot change their own access', {
        id: userId,
      });
    }
    if (
      changed &&
      before.includes(adminRoleId) &&
      !after.includes(adminRoleId) &&
      user.status === 'ACTIVE'
    ) {
      await this.assertAdminRemains(tx, userId);
    }
    if (changed) {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (after.length)
        await tx.insert(userRoles).values(after.map((roleId) => ({ userId, roleId })));
    }
    await mirrorCompanyRoles(tx, userId);
    await tx
      .update(users)
      .set({ rolesManagedBy: 'HR_POSITION', updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'users',
      entityId: userId,
      before: { roleIds: before },
      after: { roleIds: after, rolesManagedBy: 'HR_POSITION' },
    });
  }

  /** One phone, one account: a readable refusal before a second registration. */
  async assertPhoneFree(tx: Tx, input: string): Promise<void> {
    const phone = normalizeMnPhone(input);
    if (!phone) throw invalid('phone', 'isMnPhone', 'phone must be 8 Mongolian digits');
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone));
    if (taken) throw invalid('phone', 'unique', 'this phone belongs to another staff member');
  }

  /** Whether the account holds any role, and ADMIN (who may change its password, ADR-0145). */
  async heldRoles(tx: Tx, userId: number): Promise<{ any: boolean; admin: boolean }> {
    const rows = await tx
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    return { any: rows.length > 0, admin: rows.some((row) => row.code === 'ADMIN') };
  }

  /**
   * The staff user of this phone: the existing one (its name kept), or a new one named
   * `fullName`. A password is set only on a new user or one without a password yet.
   */
  async ensure(
    tx: Tx,
    actor: AuditActor,
    input: { fullName: string; phone: string; password: string | null },
  ): Promise<{ userId: number; created: boolean }> {
    const phone = normalizeMnPhone(input.phone);
    if (!phone) throw invalid('phone', 'isMnPhone', 'phone must be 8 Mongolian digits');
    const fullName = input.fullName.trim();
    if (fullName.length === 0) throw invalid('fullName', 'isNotEmpty', 'a name is needed');
    const [existing] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash, username: users.username })
      .from(users)
      .where(eq(users.phone, phone))
      .for('update');
    if (existing) {
      if (input.password !== null && existing.passwordHash === null) {
        await this.writePassword(tx, actor, existing.id, existing.username, phone, input.password);
      }
      return { userId: existing.id, created: false };
    }
    const username = await this.freeUsername(tx, phone);
    const passwordHash =
      input.password === null ? null : await this.checkedHash(input.password, username, phone);
    const [row] = await tx
      .insert(users)
      .values({
        username,
        fullName,
        phone,
        passwordHash,
        ...(passwordHash ? { passwordChangedAt: sql`now()` } : {}),
      })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'users',
      entityId: row.id,
      after: { username, fullName, phone, passwordSet: passwordHash !== null, by: 'hr' },
    });
    return { userId: row.id, created: true };
  }

  /**
   * A new password given directly (the employee forgot theirs): the lock-out is cleared and every
   * session ends but `keepSession`, the caller's own when they reset themselves.
   */
  async setPassword(
    tx: Tx,
    actor: AuditActor,
    userId: number,
    password: string,
    keepSession: string | null = null,
  ): Promise<void> {
    const [user] = await tx
      .select({ username: users.username, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new AppError('NOT_FOUND', `user ${userId} not found`, { id: userId });
    await this.writePassword(tx, actor, userId, user.username, user.phone, password);
    await tx
      .update(authSessions)
      .set({ revokedAt: sql`now()`, revokedReason: 'PASSWORD_CHANGED' })
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          keepSession === null ? undefined : ne(authSessions.id, keepSession),
        ),
      );
    this.limiter.clearUser(user.username);
    if (user.phone) this.limiter.clearUser(user.phone);
  }

  /**
   * The name and phone shown everywhere follow the card; an admin's are changed only with
   * `mayChangeAdmin` (the phone is how they sign in, ADR-0145).
   */
  async rename(
    tx: Tx,
    actor: AuditActor,
    userId: number,
    input: { fullName: string; phone: string },
    mayChangeAdmin = true,
  ): Promise<void> {
    const phone = normalizeMnPhone(input.phone);
    if (!phone) throw invalid('phone', 'isMnPhone', 'phone must be 8 Mongolian digits');
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), ne(users.id, userId)));
    if (taken) throw new AppError('DUPLICATE_VALUE', 'the phone is taken', { field: 'phone' });
    const [before] = await tx
      .select({ fullName: users.fullName, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));
    if (!before) throw new AppError('NOT_FOUND', `user ${userId} not found`, { id: userId });
    const fullName = input.fullName.trim();
    if (before.fullName === fullName && before.phone === phone) return;
    if (!mayChangeAdmin && (await this.heldRoles(tx, userId)).admin) {
      throw new AppError('FORBIDDEN', 'an admin account needs identity.users.manage', {
        permission: 'identity.users.manage',
      });
    }
    await tx
      .update(users)
      .set({ fullName, phone, updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'users',
      entityId: userId,
      before,
      after: { fullName, phone },
    });
  }

  /** Leaving disables the account and ends its sessions; coming back enables it. */
  async setActive(tx: Tx, actor: AuditActor, userId: number, active: boolean): Promise<void> {
    if (!active) await this.assertAdminRemains(tx, userId);
    const status = active ? 'ACTIVE' : 'DISABLED';
    const rows = await tx
      .update(users)
      .set({ status, updatedAt: sql`now()` })
      .where(and(eq(users.id, userId), ne(users.status, status)))
      .returning({ id: users.id });
    if (rows.length === 0) return;
    if (!active) {
      await tx
        .update(authSessions)
        .set({ revokedAt: sql`now()`, revokedReason: 'USER_DISABLED' })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    }
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'users',
      entityId: userId,
      after: { status, by: 'hr' },
    });
  }

  /** Same lock and rule as `UsersService` (ADR-0027 #6): an ACTIVE user keeps the ADMIN role. */
  private async assertAdminRemains(tx: Tx, userId: number): Promise<void> {
    const [admin] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'ADMIN'))
      .for('update');
    if (!admin) throw new Error('the ADMIN role is missing (synced at api boot)');
    const active = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleId, admin.id), eq(users.status, 'ACTIVE')));
    if (active.length === 1 && active[0]?.userId === userId) {
      throw new AppError('LAST_ADMIN', `user ${userId} is the last active admin`, { id: userId });
    }
  }

  private async writePassword(
    tx: Tx,
    actor: AuditActor,
    userId: number,
    username: string,
    phone: string | null,
    password: string,
  ): Promise<void> {
    const passwordHash = await this.checkedHash(password, username, phone);
    await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: sql`now()`,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId));
    await this.audit.record(tx, actor, {
      action: 'PASSWORD_SET_BY_HR',
      entity: 'users',
      entityId: userId,
    });
  }

  private async checkedHash(password: string, username: string, phone: string | null) {
    const problem = checkPassword(password, username, phone);
    if (problem) {
      throw new AppError('PASSWORD_TOO_WEAK', `password rejected: ${problem}`, {
        problem,
        minLength: PASSWORD_MIN_LENGTH,
      });
    }
    return this.hasher.hash(password);
  }

  private async freeUsername(tx: Tx, phone: string): Promise<string> {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = usernameFromPhone(phone, suffix);
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, candidate));
      if (!taken) return candidate;
    }
    throw new Error(`no free login name for ${phone}`);
  }
}
