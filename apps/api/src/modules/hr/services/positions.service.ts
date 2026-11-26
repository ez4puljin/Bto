import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { addMonths, businessDate } from '@tugeel/shared/time';
import { asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  AuditService,
  type AuthContext,
  type PositionRole,
  StaffAccountsService,
} from '../../identity';
import {
  hrEmployeePositionAssignments,
  hrEmployees,
  hrPositionRoles,
  hrPositionSalaries,
  hrPositions,
} from '../schema';

export interface PositionSalary {
  effectiveMonth: string;
  baseSalary: string;
}
export interface PositionBaseSalary {
  positionId: number;
  position: string;
  baseSalary: string;
  nextBaseSalary: string | null;
  nextEffectiveMonth: string | null;
}
export interface PositionSalarySchedule {
  current: { positionId: number; position: string; baseSalary: string } | null;
  next: { positionId: number; position: string; baseSalary: string; effectiveMonth: string } | null;
}
export interface Position {
  id: number;
  name: string;
  roleIds: number[];
  roles: PositionRole[];
  baseSalary: string | null;
  nextBaseSalary: string | null;
  nextEffectiveMonth: string | null;
  salaryHistory: PositionSalary[];
  archivedAt: Date | null;
  employeeCount: number;
  grantsAdmin: boolean;
  canAssign: boolean;
}
export interface PositionInput {
  name: string;
  baseSalary: string;
  roleIds: number[];
}

export function nextPositionMonth(month: string): string {
  return addMonths(`${month}-01`, 1).slice(0, 7);
}

@Injectable()
export class PositionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly accounts: StaffAccountsService,
  ) {}

  async canViewSalary(ctx: AuthContext): Promise<boolean> {
    return ctx.permissions.has('hr.payroll.view') || this.accounts.isAdmin(this.db, ctx);
  }

  async staffResponse<
    T extends {
      positionBaseSalary: string | null;
      positionNextBaseSalary: string | null;
      positionNextEffectiveMonth: string | null;
    },
  >(ctx: AuthContext, input: T | Promise<T>): Promise<T> {
    const row = await input;
    return (await this.canViewSalary(ctx))
      ? row
      : {
          ...row,
          positionBaseSalary: null,
          positionNextBaseSalary: null,
          positionNextEffectiveMonth: null,
        };
  }

  async list(
    ctx: AuthContext,
    includeArchived = false,
    executor: Db | Tx = this.db,
  ): Promise<Position[]> {
    if (
      !ctx.permissions.has('hr.attendance.view') &&
      !ctx.permissions.has('hr.attendance.manage') &&
      !(await this.accounts.isAdmin(executor, ctx))
    ) {
      throw new AppError('FORBIDDEN', 'HR access is required', {
        permission: 'hr.attendance.view',
      });
    }
    const [positions, memberships, salaries, counts, isAdmin] = await Promise.all([
      executor
        .select()
        .from(hrPositions)
        .where(includeArchived ? undefined : isNull(hrPositions.archivedAt))
        .orderBy(asc(hrPositions.name)),
      executor.select().from(hrPositionRoles).orderBy(asc(hrPositionRoles.roleId)),
      executor.select().from(hrPositionSalaries).orderBy(desc(hrPositionSalaries.effectiveMonth)),
      executor
        .select({ positionId: hrEmployees.positionId, count: sql<number>`count(*)::int` })
        .from(hrEmployees)
        .where(isNull(hrEmployees.leftOn))
        .groupBy(hrEmployees.positionId),
      this.accounts.isAdmin(executor, ctx),
    ]);
    const roleCatalog = await this.accounts.positionRoles(executor, [
      ...new Set(memberships.map((row) => row.roleId)),
    ]);
    const month = businessDate().slice(0, 7);
    const viewPay = isAdmin || ctx.permissions.has('hr.payroll.view');
    return positions.map((position) => {
      const roleIds = memberships
        .filter((row) => row.positionId === position.id)
        .map((row) => row.roleId);
      const roles = roleCatalog.filter((row) => roleIds.includes(row.id));
      const grantsAdmin = roles.some((row) => row.code === 'ADMIN');
      const history = salaries.filter((row) => row.positionId === position.id);
      const current = history.find((row) => row.effectiveMonth <= month);
      const next = history.filter((row) => row.effectiveMonth > month).at(-1);
      return {
        id: position.id,
        name: position.name,
        roleIds,
        roles,
        baseSalary: viewPay ? (current?.baseSalary.toFixed(2) ?? null) : null,
        nextBaseSalary: viewPay ? (next?.baseSalary.toFixed(2) ?? null) : null,
        nextEffectiveMonth: viewPay ? (next?.effectiveMonth ?? null) : null,
        salaryHistory: viewPay
          ? history.map((row) => ({
              effectiveMonth: row.effectiveMonth,
              baseSalary: row.baseSalary.toFixed(2),
            }))
          : [],
        archivedAt: position.archivedAt,
        employeeCount: counts.find((row) => row.positionId === position.id)?.count ?? 0,
        grantsAdmin,
        canAssign: position.archivedAt === null && isAdmin,
      };
    });
  }

  async get(ctx: AuthContext, id: number, executor: Db | Tx = this.db): Promise<Position> {
    const found = (await this.list(ctx, true, executor)).find((row) => row.id === id);
    if (!found) throw notFound('hr_position', id);
    return found;
  }

  async save(ctx: AuthContext, id: number | null, input: PositionInput): Promise<Position> {
    const name = input.name.replace(/\s+/g, ' ').trim();
    if (!name || [...name].length > 80)
      throw invalid('name', 'length', 'a position name needs 1–80 characters');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(input.baseSalary))
      throw invalid(
        'baseSalary',
        'money',
        'a nonnegative money amount with at most two decimals is required',
      );
    const baseSalary = new Decimal(input.baseSalary);
    if (baseSalary.gte('1000000000000'))
      throw invalid('baseSalary', 'money', 'salary exceeds the money limit');
    const savedId = await inTransaction(this.db, async (tx) => {
      await this.accounts.lockAccess(tx);
      await this.assertAdmin(tx, ctx);
      const roleIds = [...new Set(input.roleIds)].sort((a, b) => a - b);
      await this.accounts.positionRoles(tx, roleIds);
      let positionId = id;
      const before = id === null ? null : await this.lock(tx, id);
      if (id !== null) {
        const [ownCard] = await tx
          .select({ positionId: hrEmployees.positionId })
          .from(hrEmployees)
          .where(eq(hrEmployees.userId, ctx.userId));
        if (ownCard?.positionId === id) {
          const currentRoles = await tx
            .select({ roleId: hrPositionRoles.roleId })
            .from(hrPositionRoles)
            .where(eq(hrPositionRoles.positionId, id))
            .orderBy(asc(hrPositionRoles.roleId));
          if (currentRoles.map((row) => row.roleId).join(',') !== roleIds.join(',')) {
            throw invalid(
              'roleIds',
              'ownPositionRoles',
              'another ADMIN must change the roles of your own position',
            );
          }
        }
      }
      if (before?.archivedAt)
        throw invalid('id', 'archived', 'restore the position before editing it');
      if (positionId === null) {
        const [created] = await tx
          .insert(hrPositions)
          .values({ name, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning({ id: hrPositions.id });
        if (!created) throw new Error('position insert returned no row');
        positionId = created.id;
      } else {
        await tx
          .update(hrPositions)
          .set({ name, updatedBy: ctx.userId, updatedAt: sql`now()` })
          .where(eq(hrPositions.id, positionId));
      }
      const month = businessDate().slice(0, 7);
      const rates = await tx
        .select()
        .from(hrPositionSalaries)
        .where(eq(hrPositionSalaries.positionId, positionId))
        .orderBy(desc(hrPositionSalaries.effectiveMonth));
      const nextMonth = nextPositionMonth(month);
      const intendedRate =
        rates.find((row) => row.effectiveMonth === nextMonth) ??
        rates.find((row) => row.effectiveMonth <= month);
      // Name/role-only saves never create a spurious rate. Repeated salary edits replace next month's rate.
      if (id === null || !intendedRate?.baseSalary.eq(baseSalary)) {
        const effectiveMonth = id === null ? month : nextMonth;
        await tx
          .insert(hrPositionSalaries)
          .values({ positionId, effectiveMonth, baseSalary, updatedBy: ctx.userId })
          .onConflictDoUpdate({
            target: [hrPositionSalaries.positionId, hrPositionSalaries.effectiveMonth],
            set: { baseSalary, updatedBy: ctx.userId, updatedAt: sql`now()` },
          });
      }
      await tx.delete(hrPositionRoles).where(eq(hrPositionRoles.positionId, positionId));
      if (roleIds.length)
        await tx.insert(hrPositionRoles).values(roleIds.map((roleId) => ({ positionId, roleId })));
      const members = await tx
        .select({ userId: hrEmployees.userId })
        .from(hrEmployees)
        .where(eq(hrEmployees.positionId, positionId))
        .orderBy(asc(hrEmployees.userId));
      for (const member of members)
        await this.accounts.assignPositionRoles(tx, ctx, member.userId, roleIds);
      await this.audit.record(tx, ctx, {
        action: id === null ? 'CREATE' : 'UPDATE',
        entity: 'hr_position',
        entityId: positionId,
        before: before ?? undefined,
        after: {
          name,
          roleIds,
          effectiveMonth: id === null ? month : nextMonth,
        },
      });
      return positionId;
    });
    return this.get(ctx, savedId);
  }

  async archive(ctx: AuthContext, id: number, archived: boolean): Promise<Position> {
    await inTransaction(this.db, async (tx) => {
      await this.accounts.lockAccess(tx);
      await this.assertAdmin(tx, ctx);
      await this.lock(tx, id);
      await tx
        .update(hrPositions)
        .set({
          archivedAt: archived ? sql`now()` : null,
          updatedAt: sql`now()`,
          updatedBy: ctx.userId,
        })
        .where(eq(hrPositions.id, id));
      await this.audit.record(tx, ctx, {
        action: archived ? 'ARCHIVE' : 'RESTORE',
        entity: 'hr_position',
        entityId: id,
      });
    });
    return this.get(ctx, id);
  }

  /** Called inside the employee transaction, before the card write; never unbinds managed staff. */
  async assign(
    tx: Tx,
    ctx: AuthContext,
    userId: number,
    requestedId: number | null | undefined,
    newStaff = false,
  ): Promise<{ id: number; name: string } | null> {
    await this.accounts.lockAccess(tx);
    const [current] = await tx
      .select({ positionId: hrEmployees.positionId })
      .from(hrEmployees)
      .where(eq(hrEmployees.userId, userId));
    const isAdmin = await this.accounts.isAdmin(tx, ctx);
    if (!newStaff && !isAdmin && (await this.accounts.heldRoles(tx, userId)).admin) {
      throw new AppError('FORBIDDEN', 'only ADMIN may change an ADMIN employee', {
        permission: 'ADMIN',
      });
    }
    const id = requestedId === undefined ? (current?.positionId ?? null) : requestedId;
    if (id === null) {
      if (current?.positionId != null)
        throw invalid('positionId', 'positionManaged', 'a bound employee must keep a position');
      return null;
    }
    const changing = newStaff || current?.positionId !== id;
    if (changing && userId === ctx.userId) {
      throw new AppError('SELF_EDIT_FORBIDDEN', 'another ADMIN must change your position', {
        id: userId,
      });
    }
    if (changing && !isAdmin) {
      throw new AppError('FORBIDDEN', 'only ADMIN may assign or move staff positions', {
        permission: 'ADMIN',
      });
    }
    const position = await this.lock(tx, id);
    if (position.archivedAt && current?.positionId !== id)
      throw invalid('positionId', 'archived', 'the position is archived');
    // Unchanged HR card edits must not rewrite roles, company access or assignment history.
    if (!changing) return { id, name: position.name };
    const assigned = await tx
      .select({ roleId: hrPositionRoles.roleId })
      .from(hrPositionRoles)
      .where(eq(hrPositionRoles.positionId, id));
    await this.accounts.assignPositionRoles(
      tx,
      ctx,
      userId,
      assigned.map((row) => row.roleId),
    );
    if (newStaff || current?.positionId !== id) {
      const effectiveMonth = newStaff
        ? businessDate().slice(0, 7)
        : nextPositionMonth(businessDate().slice(0, 7));
      await tx
        .insert(hrEmployeePositionAssignments)
        .values({ userId, positionId: id, effectiveMonth, assignedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [
            hrEmployeePositionAssignments.userId,
            hrEmployeePositionAssignments.effectiveMonth,
          ],
          set: { positionId: id, assignedBy: ctx.userId, assignedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_employee_position_assignment',
        entityId: userId,
        after: { positionId: id, effectiveMonth },
      });
    }
    return { id, name: position.name };
  }

  /** Trusted payroll reader: salary as of the target month; no rate means no map entry. */
  async baseSalariesForUsers(
    executor: Db | Tx,
    userIds: readonly number[],
    month: string,
  ): Promise<Map<number, PositionBaseSalary>> {
    const schedules = await this.salarySchedulesForUsers(executor, userIds, month);
    return new Map(
      [...schedules].flatMap(([userId, schedule]) =>
        schedule.current === null
          ? []
          : [
              [
                userId,
                {
                  ...schedule.current,
                  nextBaseSalary: schedule.next?.baseSalary ?? null,
                  nextEffectiveMonth: schedule.next?.effectiveMonth ?? null,
                },
              ] as const,
            ],
      ),
    );
  }

  async salarySchedulesForUsers(
    executor: Db | Tx,
    userIds: readonly number[],
    month: string,
  ): Promise<Map<number, PositionSalarySchedule>> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('month', 'month', 'YYYY-MM');
    const result = new Map<number, PositionSalarySchedule>();
    if (!userIds.length) return result;
    const members = await executor
      .select({
        userId: hrEmployeePositionAssignments.userId,
        positionId: hrPositions.id,
        position: hrPositions.name,
        effectiveMonth: hrEmployeePositionAssignments.effectiveMonth,
      })
      .from(hrEmployeePositionAssignments)
      .innerJoin(hrPositions, eq(hrPositions.id, hrEmployeePositionAssignments.positionId))
      .where(inArray(hrEmployeePositionAssignments.userId, [...userIds]))
      .orderBy(desc(hrEmployeePositionAssignments.effectiveMonth));
    const ids = [...new Set(members.map((row) => row.positionId))];
    if (!ids.length) return result;
    const salaries = await executor
      .select()
      .from(hrPositionSalaries)
      .where(inArray(hrPositionSalaries.positionId, ids))
      .orderBy(desc(hrPositionSalaries.effectiveMonth));
    for (const userId of new Set(members.map((row) => row.userId))) {
      const assignments = members.filter((row) => row.userId === userId);
      const salaryAt = (targetMonth: string) => {
        const assignment = assignments.find((row) => row.effectiveMonth <= targetMonth);
        if (!assignment) return null;
        const salary = salaries.find(
          (row) => row.positionId === assignment.positionId && row.effectiveMonth <= targetMonth,
        );
        return salary
          ? {
              positionId: assignment.positionId,
              position: assignment.position,
              baseSalary: salary.baseSalary.toFixed(2),
            }
          : null;
      };
      const futureMonths = [
        ...new Set([
          ...assignments.map((row) => row.effectiveMonth),
          ...salaries.map((row) => row.effectiveMonth),
        ]),
      ]
        .filter((value) => value > month)
        .sort();
      const current = salaryAt(month);
      let next: PositionSalarySchedule['next'] = null;
      for (const effectiveMonth of futureMonths) {
        const candidate = salaryAt(effectiveMonth);
        if (
          candidate !== null &&
          (current === null ||
            candidate.positionId !== current.positionId ||
            candidate.baseSalary !== current.baseSalary)
        ) {
          next = { ...candidate, effectiveMonth };
          break;
        }
      }
      result.set(userId, { current, next });
    }
    return result;
  }

  async assignmentEffectiveMonths(
    executor: Db | Tx,
    userIds: readonly number[],
  ): Promise<Map<number, string>> {
    if (!userIds.length) return new Map();
    const rows = await executor
      .select()
      .from(hrEmployeePositionAssignments)
      .where(inArray(hrEmployeePositionAssignments.userId, [...userIds]))
      .orderBy(asc(hrEmployeePositionAssignments.effectiveMonth));
    return new Map(rows.map((row) => [row.userId, row.effectiveMonth]));
  }

  private async assertAdmin(tx: Tx, ctx: AuthContext): Promise<void> {
    if (!(await this.accounts.isAdmin(tx, ctx)))
      throw new AppError('FORBIDDEN', 'only ADMIN may configure positions', {
        permission: 'ADMIN',
      });
  }

  private async lock(tx: Tx, id: number) {
    const [position] = await tx
      .select()
      .from(hrPositions)
      .where(eq(hrPositions.id, id))
      .for('update');
    if (!position) throw notFound('hr_position', id);
    return position;
  }
}
