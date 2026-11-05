import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_SCHEDULE,
  type EducationLevel,
  type EmployeeGender,
  type EmploymentType,
  HR_LIMITS,
  type JobLevel,
  type LeftReasonKind,
  type MaritalStatus,
  minutesOf,
  planOfDays,
  planOfSchedule,
  type Schedule,
  scheduleOnDate,
  TIME_PATTERN,
  type WeekPlan,
  weekdayIndex,
  WORKDAYS_PATTERN,
} from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, actorUserId, AuditService, UserNamesService } from '../../identity';
import { hrEmployees, hrEmployeeSites, hrSchedules, hrSettings, hrWorkSites } from '../schema';
import { ATTENDANCE_MANAGE } from './work-sites.service';

export interface CompanySchedule extends Schedule {
  updatedAt: Date | null;
}

/** An employee's own terms over the company's (ADR-0131 #2); null = the company's value. */
export interface EmployeeTerms {
  tracked: boolean;
  workStart: string | null;
  workEnd: string | null;
  graceMinutes: number | null;
  workdays: string | null;
  siteIds: number[];
}

/** The employee's card (ADR-0144). */
export interface EmployeeCard {
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  divisionId: number | null;
  employmentType: EmploymentType;
  gender: EmployeeGender | null;
  employedOn: string | null;
  leftOn: string | null;
  leftReason: string | null;
  photoFileId: number | null;
  scheduleId: number | null;
  externalRef: string | null;
  birthDate: string | null;
  education: EducationLevel | null;
  maritalStatus: MaritalStatus | null;
  district: string | null;
  jobLevel: JobLevel | null;
  leftReasonKind: LeftReasonKind | null;
}

export interface Employee extends EmployeeTerms, EmployeeCard {
  userId: number;
  fullName: string;
  phone: string | null;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  passwordSet: boolean;
  status: 'ACTIVE' | 'DISABLED';
  roles: string[];
  /** Today's schedule (the company's with the employee's own values over it, or their schedule's day). */
  schedule: Schedule;
  /** ADR-0144: the week the employee follows — their schedule's days, else the hours above. */
  plan: WeekPlan;
  graceMinutes: number | null;
  /** The grace that applies (the own, else the company's). */
  grace: number;
}

/** The single-day schedule `summarizeDay` reads for this employee on a date (ADR-0144). */
export function scheduleFor(employee: Pick<Employee, 'plan' | 'grace'>, date: string): Schedule {
  return scheduleOnDate(employee.plan, weekdayIndex(date), employee.grace);
}

/**
 * The company schedule and each employee's terms (ADR-0131 #2): who is tracked, whose hours differ,
 * who may punch where. Read by the dashboard and the app; written by HR.
 */
@Injectable()
export class HrSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async schedule(executor: Db | Tx = this.db): Promise<CompanySchedule> {
    const [row] = await executor.select().from(hrSettings).where(eq(hrSettings.id, 1)).limit(1);
    if (!row) return { ...DEFAULT_SCHEDULE, updatedAt: null };
    return {
      workStart: row.workStart,
      workEnd: row.workEnd,
      graceMinutes: row.graceMinutes,
      workdays: row.workdays,
      updatedAt: row.updatedAt,
    };
  }

  async updateSchedule(ctx: AuthContext, input: Schedule): Promise<CompanySchedule> {
    this.assertManage(ctx);
    checkSchedule(input);
    return inTransaction(this.db, async (tx) => {
      const before = await this.schedule(tx);
      await tx
        .insert(hrSettings)
        .values({ id: 1, ...input, updatedBy: actorUserId(ctx) })
        .onConflictDoUpdate({
          target: hrSettings.id,
          set: { ...input, updatedBy: actorUserId(ctx), updatedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_settings',
        entityId: 1,
        before: { ...before, updatedAt: undefined },
        after: input,
      });
      return this.schedule(tx);
    });
  }

  /** Every staff record with its terms; the dashboard and the app keep only ACTIVE tracked ones. */
  async employees(executor: Db | Tx = this.db): Promise<Employee[]> {
    const [staff, company, terms, sites, schedules] = await Promise.all([
      this.names.allStaff(),
      this.schedule(executor),
      executor.select().from(hrEmployees),
      executor
        .select({ userId: hrEmployeeSites.userId, siteId: hrEmployeeSites.siteId })
        .from(hrEmployeeSites)
        .innerJoin(hrWorkSites, eq(hrWorkSites.id, hrEmployeeSites.siteId))
        .where(sql`${hrWorkSites.archivedAt} IS NULL`),
      executor
        .select({ id: hrSchedules.id, kind: hrSchedules.kind, days: hrSchedules.days })
        .from(hrSchedules),
    ]);
    const own = new Map(terms.map((row) => [row.userId, row]));
    const scheduleById = new Map(schedules.map((row) => [row.id, row]));
    const today = businessDate();
    const siteIds = new Map<number, number[]>();
    for (const row of sites)
      siteIds.set(row.userId, [...(siteIds.get(row.userId) ?? []), row.siteId]);
    return staff.map((user) => {
      const mine = own.get(user.id);
      const employee: EmployeeTerms = {
        tracked: mine?.tracked ?? true,
        workStart: mine?.workStart ?? null,
        workEnd: mine?.workEnd ?? null,
        graceMinutes: mine?.graceMinutes ?? null,
        workdays: mine?.workdays ?? null,
        siteIds: siteIds.get(user.id) ?? [],
      };
      const merged: Schedule = {
        workStart: employee.workStart ?? company.workStart,
        workEnd: employee.workEnd ?? company.workEnd,
        graceMinutes: employee.graceMinutes ?? company.graceMinutes,
        workdays: employee.workdays ?? company.workdays,
      };
      const assigned = mine?.scheduleId ? scheduleById.get(mine.scheduleId) : undefined;
      const plan = assigned ? planOfDays(assigned.kind, assigned.days) : planOfSchedule(merged);
      return {
        userId: user.id,
        fullName: user.fullName,
        phone: user.phone,
        status: user.status,
        roles: user.roles,
        lastLoginAt: user.lastLoginAt,
        lockedUntil: user.lockedUntil,
        passwordSet: user.passwordSet,
        ...employee,
        firstName: mine?.firstName ?? null,
        lastName: mine?.lastName ?? null,
        position: mine?.position ?? null,
        divisionId: mine?.divisionId ?? null,
        employmentType: mine?.employmentType ?? 'PERMANENT',
        gender: mine?.gender ?? null,
        employedOn: mine?.employedOn ?? null,
        leftOn: mine?.leftOn ?? null,
        leftReason: mine?.leftReason ?? null,
        photoFileId: mine?.photoFileId ?? null,
        scheduleId: mine?.scheduleId ?? null,
        externalRef: mine?.externalRef ?? null,
        birthDate: mine?.birthDate ?? null,
        education: mine?.education ?? null,
        maritalStatus: mine?.maritalStatus ?? null,
        district: mine?.district ?? null,
        jobLevel: mine?.jobLevel ?? null,
        leftReasonKind: mine?.leftReasonKind ?? null,
        plan,
        grace: merged.graceMinutes,
        schedule: scheduleOnDate(plan, weekdayIndex(today), merged.graceMinutes),
      };
    });
  }

  async employee(userId: number, executor: Db | Tx = this.db): Promise<Employee> {
    const found = (await this.employees(executor)).find((row) => row.userId === userId);
    if (!found) throw notFound('user', userId);
    return found;
  }

  async updateEmployee(ctx: AuthContext, userId: number, input: EmployeeTerms): Promise<Employee> {
    this.assertManage(ctx);
    checkOwnTerms(input);
    return inTransaction(this.db, async (tx) => {
      const before = await this.employee(userId, tx);
      if (input.siteIds.length > 0) {
        const live = await tx
          .select({ id: hrWorkSites.id })
          .from(hrWorkSites)
          .where(
            and(inArray(hrWorkSites.id, input.siteIds), sql`${hrWorkSites.archivedAt} IS NULL`),
          );
        if (live.length !== new Set(input.siteIds).size) {
          throw invalid('siteIds', 'exists', 'a site is archived or unknown');
        }
      }
      const values = {
        tracked: input.tracked,
        workStart: input.workStart,
        workEnd: input.workEnd,
        graceMinutes: input.graceMinutes,
        workdays: input.workdays,
        updatedBy: actorUserId(ctx),
      };
      await tx
        .insert(hrEmployees)
        .values({ userId, ...values })
        .onConflictDoUpdate({
          target: hrEmployees.userId,
          set: { ...values, updatedAt: sql`now()` },
        });
      await tx.delete(hrEmployeeSites).where(eq(hrEmployeeSites.userId, userId));
      if (input.siteIds.length > 0) {
        await tx
          .insert(hrEmployeeSites)
          .values([...new Set(input.siteIds)].map((siteId) => ({ userId, siteId })));
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_employee',
        entityId: userId,
        before: termsOf(before),
        after: termsOf(input),
      });
      return this.employee(userId, tx);
    });
  }

  private assertManage(ctx: AuthContext): void {
    if (!ctx.permissions.has(ATTENDANCE_MANAGE)) {
      throw new AppError('FORBIDDEN', `the attendance settings need ${ATTENDANCE_MANAGE}`, {
        permission: ATTENDANCE_MANAGE,
      });
    }
  }
}

function termsOf(terms: EmployeeTerms): EmployeeTerms {
  return {
    tracked: terms.tracked,
    workStart: terms.workStart,
    workEnd: terms.workEnd,
    graceMinutes: terms.graceMinutes,
    workdays: terms.workdays,
    siteIds: [...terms.siteIds].sort((a, b) => a - b),
  };
}

function checkTime(path: string, value: string): void {
  if (!TIME_PATTERN.test(value)) throw invalid(path, 'time', `${path} is HH:mm`);
}

function checkGrace(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > HR_LIMITS.maxGraceMinutes) {
    throw invalid('graceMinutes', 'range', `the grace is 0–${HR_LIMITS.maxGraceMinutes} minutes`);
  }
}

function checkWorkdays(value: string): void {
  if (!WORKDAYS_PATTERN.test(value)) throw invalid('workdays', 'pattern', 'seven 0/1 flags');
  if (!value.includes('1')) throw invalid('workdays', 'some', 'at least one workday');
}

function checkSchedule(input: Schedule): void {
  checkTime('workStart', input.workStart);
  checkTime('workEnd', input.workEnd);
  if (minutesOf(input.workEnd) <= minutesOf(input.workStart)) {
    throw invalid('workEnd', 'afterStart', 'the day ends after it starts');
  }
  checkGrace(input.graceMinutes);
  checkWorkdays(input.workdays);
}

function checkOwnTerms(input: EmployeeTerms): void {
  if (input.workStart !== null) checkTime('workStart', input.workStart);
  if (input.workEnd !== null) checkTime('workEnd', input.workEnd);
  if (
    input.workStart !== null &&
    input.workEnd !== null &&
    minutesOf(input.workEnd) <= minutesOf(input.workStart)
  ) {
    throw invalid('workEnd', 'afterStart', 'the day ends after it starts');
  }
  if (input.graceMinutes !== null) checkGrace(input.graceMinutes);
  if (input.workdays !== null) checkWorkdays(input.workdays);
}
