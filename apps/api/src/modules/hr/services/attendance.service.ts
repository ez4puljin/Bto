import { Inject, Injectable } from '@nestjs/common';
import { type Coordinates, distanceMeters } from '@tugeel/shared/geo';
import {
  type AttendanceEventLike,
  type AttendanceKind,
  type DaySummary,
  HR_LIMITS,
  isWorkday,
  type Schedule,
  summarizeDay,
  ubMinutesOf,
} from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate, businessMonthStart, isIsoDate } from '@tugeel/shared/time';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { hrAttendanceEvents, hrEmployeeSites, hrWorkSites } from '../schema';
import { type Employee, HrSettingsService } from './hr-settings.service';
import { ATTENDANCE_MANAGE, WorkSitesService } from './work-sites.service';

export interface PunchInput {
  kind: AttendanceKind;
  lat: string;
  lng: string;
  accuracyM: number | null;
}

export interface AttendanceEvent {
  id: number;
  userId: number;
  kind: AttendanceKind;
  at: Date;
  businessDate: string;
  source: 'APP' | 'OFFICE';
  siteId: number | null;
  siteName: string | null;
  lat: string | null;
  lng: string | null;
  accuracyM: number | null;
  distanceM: number | null;
  note: string | null;
  createdBy: number;
  deletedAt: Date | null;
  deleteReason: string | null;
}

/** One person on one day: the summary plus the site of the first IN. */
export interface DayRow extends DaySummary {
  userId: number;
  date: string;
  siteName: string | null;
  /** The last live event's kind: IN = still there. */
  state: AttendanceKind | null;
}

export interface MyAttendance {
  today: string;
  now: Date;
  state: AttendanceKind | null;
  schedule: Schedule;
  tracked: boolean;
  sites: (Coordinates & { id: number; name: string; radiusM: number })[];
  todayEvents: AttendanceEvent[];
  day: DaySummary;
  month: MonthStats;
}

export interface MonthStats {
  from: string;
  to: string;
  workdays: number;
  presentDays: number;
  lateDays: number;
  lateMinutes: number;
  workedMinutes: number;
}

export interface DashboardRow extends DayRow {
  fullName: string;
  roles: string[];
  schedule: Schedule;
}

export interface Dashboard {
  date: string;
  now: Date;
  counts: {
    expected: number;
    present: number;
    inNow: number;
    late: number;
    absent: number;
    openIn: number;
    off: number;
  };
  rows: DashboardRow[];
  /** The last 14 days up to `date`: how many came, how many late, how many were expected. */
  trend: { date: string; expected: number; present: number; late: number }[];
  /** This month up to `date`, per tracked employee. */
  month: (MonthStats & { userId: number; fullName: string; avgArrivalMinutes: number | null })[];
}

const MAX_RANGE_DAYS = 62;
const TREND_DAYS = 14;

/**
 * Attendance (ADR-0131 #3): a punch from the staff app is accepted only inside one of the person's
 * work sites and only in turn (IN, OUT, IN …); HR types corrections beside the punches and strikes
 * wrong ones out. The day rows, the dashboard and the month figures are computed on read from the
 * live events with `@tugeel/shared/hr`.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sites: WorkSitesService,
    private readonly settings: HrSettingsService,
  ) {}

  /** The sites a person may punch at: their own, or every active one when none is assigned. */
  async sitesFor(userId: number, executor: Db | Tx = this.db) {
    const active = await this.sites.active(executor);
    const own = await executor
      .select({ siteId: hrEmployeeSites.siteId })
      .from(hrEmployeeSites)
      .where(eq(hrEmployeeSites.userId, userId));
    if (own.length === 0) return active;
    const ids = new Set(own.map((row) => row.siteId));
    return active.filter((site) => ids.has(site.id));
  }

  async punch(ctx: AuthContext, input: PunchInput): Promise<AttendanceEvent> {
    if (input.accuracyM !== null && input.accuracyM > HR_LIMITS.maxAccuracyM) {
      throw new AppError('ATTENDANCE_LOCATION_IMPRECISE', 'the fix is too loose', {
        accuracyM: Math.round(input.accuracyM),
        maxAccuracyM: HR_LIMITS.maxAccuracyM,
      });
    }
    const here: Coordinates = {
      lat: new Decimal(input.lat).toDecimalPlaces(6).toString(),
      lng: new Decimal(input.lng).toDecimalPlaces(6).toString(),
    };
    const sites = await this.sitesFor(ctx.userId);
    if (sites.length === 0) throw new AppError('ATTENDANCE_NO_SITE', 'no work site to punch at');
    const nearest = sites
      .map((site) => ({ site, distanceM: distanceMeters(here, site) }))
      .sort((a, b) => a.distanceM - b.distanceM)[0];
    if (!nearest) throw new AppError('ATTENDANCE_NO_SITE', 'no work site to punch at');
    if (nearest.distanceM > nearest.site.radiusM) {
      throw new AppError('ATTENDANCE_OUT_OF_RANGE', 'outside every work site', {
        site: nearest.site.name,
        distanceM: nearest.distanceM,
        radiusM: nearest.site.radiusM,
      });
    }
    return inTransaction(this.db, async (tx) => {
      await this.lockUser(tx, ctx.userId);
      const now = new Date();
      const today = businessDate(now);
      const last = await this.lastOf(tx, ctx.userId, today);
      this.assertTurn(input.kind, last);
      const [row] = await tx
        .insert(hrAttendanceEvents)
        .values({
          userId: ctx.userId,
          kind: input.kind,
          at: now,
          businessDate: today,
          source: 'APP',
          siteId: nearest.site.id,
          lat: new Decimal(here.lat),
          lng: new Decimal(here.lng),
          accuracyM: input.accuracyM === null ? null : Math.round(input.accuracyM),
          distanceM: nearest.distanceM,
          createdBy: ctx.userId,
        })
        .returning({ id: hrAttendanceEvents.id });
      if (!row) throw new Error('punch returned no row');
      await this.audit.record(tx, ctx, {
        action: 'PUNCH',
        entity: 'hr_attendance_event',
        entityId: row.id,
        after: { kind: input.kind, siteId: nearest.site.id, distanceM: nearest.distanceM },
      });
      return this.event(tx, row.id);
    });
  }

  /** The signed-in person's own picture: today, the sites, the schedule, this month. */
  async me(ctx: AuthContext): Promise<MyAttendance> {
    const now = new Date();
    const today = businessDate(now);
    const employee = await this.settings.employee(ctx.userId);
    const from = businessMonthStart(now);
    const [sites, events] = await Promise.all([
      this.sitesFor(ctx.userId),
      this.liveEvents({ from, to: today, userIds: [ctx.userId] }),
    ]);
    const todayEvents = events.filter((event) => event.businessDate === today);
    const day = summarizeDay(today, likes(todayEvents), employee.schedule, now);
    return {
      today,
      now,
      state: todayEvents.at(-1)?.kind ?? null,
      schedule: employee.schedule,
      tracked: employee.tracked,
      sites,
      todayEvents,
      day,
      month: monthStats(from, today, events, employee.schedule, now),
    };
  }

  /** The signed-in person's days of a month (`YYYY-MM`), newest first, up to today. */
  async myDays(ctx: AuthContext, month: string): Promise<DayRow[]> {
    const employee = await this.settings.employee(ctx.userId);
    const { from, to } = monthRange(month);
    const events = await this.liveEvents({ from, to, userIds: [ctx.userId] });
    return dayRows(from, to, [employee], events, new Date()).reverse();
  }

  /** Everyone's day on one date, the two-week trend and the month so far. */
  async dashboard(date: string): Promise<Dashboard> {
    if (!isIsoDate(date)) throw invalid('date', 'isDate', 'date is YYYY-MM-DD');
    const now = new Date();
    const today = businessDate(now);
    const employees = (await this.settings.employees()).filter(
      (employee) => employee.status === 'ACTIVE' && employee.tracked,
    );
    const trendFrom = addDays(date, -(TREND_DAYS - 1));
    const monthFrom = `${date.slice(0, 7)}-01`;
    const from = trendFrom < monthFrom ? trendFrom : monthFrom;
    const events = await this.liveEvents({
      from,
      to: date,
      userIds: employees.map((employee) => employee.userId),
    });
    const byUser = new Map(employees.map((employee) => [employee.userId, employee]));
    const rows: DashboardRow[] = dayRows(date, date, employees, events, now).map((row) => {
      const employee = byUser.get(row.userId);
      return {
        ...row,
        fullName: employee?.fullName ?? '',
        roles: employee?.roles ?? [],
        schedule: employee?.schedule ?? {
          workStart: '09:00',
          workEnd: '18:00',
          graceMinutes: 0,
          workdays: '1111110',
        },
      };
    });
    const past = date < today;
    const counts = {
      expected: rows.filter((row) => row.status !== 'OFF').length,
      present: rows.filter((row) => row.firstIn !== null).length,
      inNow: past ? 0 : rows.filter((row) => row.state === 'IN').length,
      late: rows.filter((row) => row.status === 'LATE').length,
      absent: rows.filter((row) => row.status === 'ABSENT').length,
      openIn: rows.filter((row) => row.openIn && past).length,
      off: rows.filter((row) => row.status === 'OFF').length,
    };
    const trend: Dashboard['trend'] = [];
    for (let day = trendFrom; day <= date; day = addDays(day, 1)) {
      const dayRowsOf = dayRows(day, day, employees, events, now);
      trend.push({
        date: day,
        expected: dayRowsOf.filter((row) => row.status !== 'OFF').length,
        present: dayRowsOf.filter((row) => row.firstIn !== null).length,
        late: dayRowsOf.filter((row) => row.status === 'LATE').length,
      });
    }
    const month = employees.map((employee) => {
      const mine = events.filter((event) => event.userId === employee.userId);
      const stats = monthStats(monthFrom, date, mine, employee.schedule, now);
      const arrivals = dayRows(monthFrom, date, [employee], mine, now)
        .map((row) => row.firstIn)
        .filter((at): at is string => at !== null)
        .map((at) => ubMinutesOf(at));
      return {
        userId: employee.userId,
        fullName: employee.fullName,
        ...stats,
        avgArrivalMinutes:
          arrivals.length === 0
            ? null
            : Math.round(arrivals.reduce((sum, value) => sum + value, 0) / arrivals.length),
      };
    });
    return { date, now, counts, rows, trend, month };
  }

  /** The day rows of a range (≤ 62 days), everyone tracked or one person; newest first. */
  async days(query: { from: string; to: string; userId?: number }): Promise<DayRow[]> {
    const { from, to } = checkedRange(query.from, query.to);
    const employees = (await this.settings.employees()).filter((employee) =>
      query.userId === undefined
        ? employee.status === 'ACTIVE' && employee.tracked
        : employee.userId === query.userId,
    );
    if (query.userId !== undefined && employees.length === 0) throw notFound('user', query.userId);
    const events = await this.liveEvents({
      from,
      to,
      userIds: employees.map((employee) => employee.userId),
    });
    return dayRows(from, to, employees, events, new Date()).sort(
      (a, b) => b.date.localeCompare(a.date) || a.userId - b.userId,
    );
  }

  /** One person's events of one date, struck-out ones included (the log's detail). */
  async events(userId: number, date: string): Promise<AttendanceEvent[]> {
    if (!isIsoDate(date)) throw invalid('date', 'isDate', 'date is YYYY-MM-DD');
    const rows = await this.db
      .select()
      .from(hrAttendanceEvents)
      .where(and(eq(hrAttendanceEvents.userId, userId), eq(hrAttendanceEvents.businessDate, date)))
      .orderBy(asc(hrAttendanceEvents.at), asc(hrAttendanceEvents.id));
    return this.withSites(rows);
  }

  /** HR types a punch the phone missed (ADR-0131 #4); it must keep the day's turns. */
  async addEvent(
    ctx: AuthContext,
    input: { userId: number; kind: AttendanceKind; at: Date; note: string },
  ): Promise<AttendanceEvent> {
    this.assertManage(ctx);
    const note = input.note.trim();
    if (note.length === 0) throw invalid('note', 'isNotEmpty', 'a correction needs a note');
    if ([...note].length > HR_LIMITS.maxNote) throw invalid('note', 'maxLength', 'note too long');
    if (input.at.getTime() > Date.now()) throw invalid('at', 'notFuture', 'not in the future');
    await this.settings.employee(input.userId);
    return inTransaction(this.db, async (tx) => {
      await this.lockUser(tx, input.userId);
      const date = businessDate(input.at);
      const live = await this.liveEvents({ from: date, to: date, userIds: [input.userId] }, tx);
      const turns = [...live, { kind: input.kind, at: input.at }].sort(
        (a, b) => a.at.getTime() - b.at.getTime(),
      );
      if (!alternates(turns)) {
        throw new AppError('ATTENDANCE_EVENT_ORDER', 'IN and OUT must alternate', {
          date,
          kind: input.kind,
        });
      }
      const [row] = await tx
        .insert(hrAttendanceEvents)
        .values({
          userId: input.userId,
          kind: input.kind,
          at: input.at,
          businessDate: date,
          source: 'OFFICE',
          note,
          createdBy: ctx.userId,
        })
        .returning({ id: hrAttendanceEvents.id });
      if (!row) throw new Error('event insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'hr_attendance_event',
        entityId: row.id,
        after: { userId: input.userId, kind: input.kind, at: input.at.toISOString(), note },
      });
      return this.event(tx, row.id);
    });
  }

  /** Strikes a punch out with a reason; the row stays for the record. */
  async strike(ctx: AuthContext, id: number, reason: string): Promise<AttendanceEvent> {
    this.assertManage(ctx);
    const text = reason.trim();
    if (text.length === 0) throw invalid('reason', 'isNotEmpty', 'a reason is needed');
    if ([...text].length > HR_LIMITS.maxNote) throw invalid('reason', 'maxLength', 'too long');
    return inTransaction(this.db, async (tx) => {
      const before = await this.event(tx, id);
      if (before.deletedAt !== null) return before;
      await this.lockUser(tx, before.userId);
      await tx
        .update(hrAttendanceEvents)
        .set({ deletedAt: sql`now()`, deletedBy: ctx.userId, deleteReason: text })
        .where(eq(hrAttendanceEvents.id, id));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'hr_attendance_event',
        entityId: id,
        before: { kind: before.kind, at: before.at.toISOString(), userId: before.userId },
        after: { reason: text },
      });
      return this.event(tx, id);
    });
  }

  private assertManage(ctx: AuthContext): void {
    if (!ctx.permissions.has(ATTENDANCE_MANAGE)) {
      throw new AppError('FORBIDDEN', `attendance corrections need ${ATTENDANCE_MANAGE}`, {
        permission: ATTENDANCE_MANAGE,
      });
    }
  }

  /** One person's punches are written one at a time (two taps, HR and the phone together). */
  private async lockUser(tx: Tx, userId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${HR_LOCK_SPACE}, ${userId})`);
  }

  private async lastOf(tx: Tx, userId: number, date: string) {
    const [last] = await tx
      .select({ kind: hrAttendanceEvents.kind, at: hrAttendanceEvents.at })
      .from(hrAttendanceEvents)
      .where(
        and(
          eq(hrAttendanceEvents.userId, userId),
          eq(hrAttendanceEvents.businessDate, date),
          isNull(hrAttendanceEvents.deletedAt),
        ),
      )
      .orderBy(sql`${hrAttendanceEvents.at} DESC`, sql`${hrAttendanceEvents.id} DESC`)
      .limit(1);
    return last ?? null;
  }

  private assertTurn(kind: AttendanceKind, last: { kind: AttendanceKind; at: Date } | null): void {
    if (kind === 'IN' && last?.kind === 'IN') {
      throw new AppError('ATTENDANCE_ALREADY_IN', 'already in', {
        at: ubTime(last.at),
      });
    }
    if (kind === 'OUT' && last?.kind !== 'IN') {
      throw new AppError('ATTENDANCE_NOT_IN', 'not in');
    }
  }

  private async liveEvents(
    query: { from: string; to: string; userIds: readonly number[] },
    executor: Db | Tx = this.db,
  ): Promise<AttendanceEvent[]> {
    if (query.userIds.length === 0) return [];
    const rows = await executor
      .select()
      .from(hrAttendanceEvents)
      .where(
        and(
          inArray(hrAttendanceEvents.userId, [...query.userIds]),
          gte(hrAttendanceEvents.businessDate, query.from),
          lte(hrAttendanceEvents.businessDate, query.to),
          isNull(hrAttendanceEvents.deletedAt),
        ),
      )
      .orderBy(asc(hrAttendanceEvents.at), asc(hrAttendanceEvents.id));
    return this.withSites(rows, executor);
  }

  private async event(executor: Db | Tx, id: number): Promise<AttendanceEvent> {
    const rows = await executor
      .select()
      .from(hrAttendanceEvents)
      .where(eq(hrAttendanceEvents.id, id))
      .limit(1);
    const [event] = await this.withSites(rows, executor);
    if (!event) throw notFound('attendance event', id);
    return event;
  }

  private async withSites(
    rows: (typeof hrAttendanceEvents.$inferSelect)[],
    executor: Db | Tx = this.db,
  ): Promise<AttendanceEvent[]> {
    const siteIds = [
      ...new Set(rows.map((row) => row.siteId).filter((id): id is number => id !== null)),
    ];
    const names = new Map(
      siteIds.length === 0
        ? []
        : (
            await executor
              .select({ id: hrWorkSites.id, name: hrWorkSites.name })
              .from(hrWorkSites)
              .where(inArray(hrWorkSites.id, siteIds))
          ).map((site) => [site.id, site.name]),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      at: row.at,
      businessDate: row.businessDate,
      source: row.source,
      siteId: row.siteId,
      siteName: row.siteId === null ? null : (names.get(row.siteId) ?? null),
      lat: row.lat?.toString() ?? null,
      lng: row.lng?.toString() ?? null,
      accuracyM: row.accuracyM,
      distanceM: row.distanceM,
      note: row.note,
      createdBy: row.createdBy,
      deletedAt: row.deletedAt,
      deleteReason: row.deleteReason,
    }));
  }
}

/** The advisory-lock space of this module's per-user locks. */
const HR_LOCK_SPACE = 72_026_130;

function likes(events: readonly AttendanceEvent[]): AttendanceEventLike[] {
  return events.map((event) => ({ kind: event.kind, at: event.at.toISOString() }));
}

function alternates(events: readonly { kind: AttendanceKind }[]): boolean {
  let expected: AttendanceKind = 'IN';
  for (const event of events) {
    if (event.kind !== expected) return false;
    expected = expected === 'IN' ? 'OUT' : 'IN';
  }
  return true;
}

/** `HH:mm` in Ulaanbaatar of an instant, for a refusal's text. */
function ubTime(at: Date): string {
  const minutes = ubMinutesOf(at);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function checkedRange(from: string, to: string): { from: string; to: string } {
  if (!isIsoDate(from)) throw invalid('from', 'isDate', 'from is YYYY-MM-DD');
  if (!isIsoDate(to)) throw invalid('to', 'isDate', 'to is YYYY-MM-DD');
  if (to < from) throw invalid('to', 'afterFrom', 'to is on or after from');
  if (addDays(from, MAX_RANGE_DAYS) < to) {
    throw invalid('to', 'range', `at most ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}

function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('month', 'isMonth', 'month is YYYY-MM');
  const from = `${month}-01`;
  const today = businessDate();
  const nextMonth = addDays(from, 31).slice(0, 7);
  const end = addDays(`${nextMonth}-01`, -1);
  return { from, to: end < today ? end : today };
}

/** One row per tracked employee per day of the range, from their live events (oldest first). */
function dayRows(
  from: string,
  to: string,
  employees: readonly Employee[],
  events: readonly AttendanceEvent[],
  now: Date,
): DayRow[] {
  const rows: DayRow[] = [];
  const grouped = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    const key = `${event.userId}:${event.businessDate}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const employee of employees) {
      const mine = grouped.get(`${employee.userId}:${date}`) ?? [];
      const summary = summarizeDay(date, likes(mine), employee.schedule, now);
      rows.push({
        ...summary,
        userId: employee.userId,
        date,
        siteName: mine.find((event) => event.kind === 'IN')?.siteName ?? null,
        state: mine.at(-1)?.kind ?? null,
      });
    }
  }
  return rows;
}

function monthStats(
  from: string,
  to: string,
  events: readonly AttendanceEvent[],
  schedule: Schedule,
  now: Date,
): MonthStats {
  const stats: MonthStats = {
    from,
    to,
    workdays: 0,
    presentDays: 0,
    lateDays: 0,
    lateMinutes: 0,
    workedMinutes: 0,
  };
  const byDate = new Map<string, AttendanceEvent[]>();
  for (const event of events) {
    byDate.set(event.businessDate, [...(byDate.get(event.businessDate) ?? []), event]);
  }
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWorkday(schedule.workdays, date)) stats.workdays += 1;
    const summary = summarizeDay(date, likes(byDate.get(date) ?? []), schedule, now);
    if (summary.firstIn !== null) stats.presentDays += 1;
    if (summary.status === 'LATE') stats.lateDays += 1;
    stats.lateMinutes += summary.lateMinutes;
    stats.workedMinutes += summary.workedMinutes;
  }
  return stats;
}
