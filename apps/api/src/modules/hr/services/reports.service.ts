import { Injectable } from '@nestjs/common';
import {
  minutesOf,
  type ReportStatus,
  reportDay,
  type RequestOnDay,
  summarizeDay,
  ubMinutesOf,
  weekdayIndex,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { invalid } from '../../../common/errors/app-error';
import { AttendanceService, type AttendanceEvent } from './attendance.service';
import { HrSettingsService, scheduleFor } from './hr-settings.service';
import { RequestsService } from './requests.service';
import { WorkforceService } from './workforce.service';

/** One employee on one day as «Цагийн тайлан» shows it (ADR-0144, after timely's «Өдрөөр»). */
export interface ReportRow {
  date: string;
  userId: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  divisionId: number | null;
  divisionName: string | null;
  position: string | null;
  status: ReportStatus;
  requestName: string | null;
  planStart: string | null;
  planEnd: string | null;
  flexible: boolean;
  firstIn: Date | null;
  lastOut: Date | null;
  /** Minutes the first IN came after the start (negative: before). */
  arrivalDiff: number | null;
  /** Minutes the last OUT came after the end (negative: before). */
  departureDiff: number | null;
  breakMinutes: number;
  scheduledMinutes: number;
  /** Worked inside the schedule's hours (a flexible day: up to its hours). */
  workedInSchedule: number;
  /** Worked in all, requests counted. */
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  siteName: string | null;
  openIn: boolean;
}

export interface ReportTotals {
  scheduledMinutes: number;
  absentDays: number;
  lateMinutes: number;
  lateDays: number;
  workedMinutes: number;
  workedInSchedule: number;
  earlyArrivalMinutes: number;
  lateDepartureMinutes: number;
  overtimeMinutes: number;
  leaveDays: number;
}

/**
 * The time reports (ADR-0144): every tracked employee on every day of a range (≤ 62 days) — the
 * day's schedule, the punches, the approved requests — with the period's totals. The web pivots
 * the rows into «Өдрөөр», «Ажилтнаар» and «Ерөнхий».
 */
@Injectable()
export class HrReportsService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly settings: HrSettingsService,
    private readonly requests: RequestsService,
    private readonly workforce: WorkforceService,
  ) {}

  async days(query: {
    from: string;
    to: string;
    userId?: number;
    divisionId?: number;
  }): Promise<{ rows: ReportRow[]; totals: ReportTotals }> {
    if (!isIsoDate(query.from)) throw invalid('from', 'isDate', 'YYYY-MM-DD');
    if (!isIsoDate(query.to)) throw invalid('to', 'isDate', 'YYYY-MM-DD');
    if (query.to < query.from) throw invalid('to', 'afterFrom', 'on or after from');
    if (addDays(query.from, WORKFORCE_LIMITS.maxReportDays) < query.to) {
      throw invalid('to', 'range', `at most ${WORKFORCE_LIMITS.maxReportDays} days`);
    }
    const today = businessDate();
    const to = query.to > today ? today : query.to;
    const [people, cards] = await Promise.all([
      this.settings.employees(),
      this.workforce.employees(),
    ]);
    const card = new Map(cards.map((row) => [row.userId, row]));
    const employees = people.filter((person) => {
      const mine = card.get(person.userId);
      if (query.userId !== undefined) return person.userId === query.userId;
      if (!person.tracked) return false;
      if (query.divisionId !== undefined && person.divisionId !== query.divisionId) return false;
      // Someone who left before the range is not in it; one who left inside it, up to that day.
      if (person.leftOn !== null) return person.leftOn >= query.from;
      return person.status === 'ACTIVE' && (mine?.leftOn ?? null) === null;
    });
    const userIds = employees.map((person) => person.userId);
    const [events, requests] =
      to < query.from
        ? [[], []]
        : await Promise.all([
            this.attendance.eventsOf({ from: query.from, to, userIds }),
            this.requests.approvedIn(query.from, to, userIds),
          ]);
    const grouped = new Map<string, AttendanceEvent[]>();
    for (const event of events) {
      const key = `${event.userId}:${event.businessDate}`;
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    const now = new Date();
    const rows: ReportRow[] = [];
    for (let date = query.from; date <= to; date = addDays(date, 1)) {
      for (const person of employees) {
        if (person.leftOn !== null && date > person.leftOn) continue;
        if (person.employedOn !== null && date < person.employedOn) continue;
        const mine = grouped.get(`${person.userId}:${date}`) ?? [];
        const plan = person.plan[weekdayIndex(date)] ?? null;
        const summary = summarizeDay(
          date,
          mine.map((event) => ({ kind: event.kind, at: event.at.toISOString() })),
          scheduleFor(person, date),
          now,
        );
        const onDay: RequestOnDay[] = requests
          .filter(
            (request) =>
              request.userId === person.userId &&
              request.fromDate <= date &&
              request.toDate >= date &&
              request.group !== 'PUNCH_CHOSEN' &&
              request.group !== 'PUNCH_SENT',
          )
          .map((request) => ({
            group: request.group,
            typeName: request.typeName,
            wholeDay: request.wholeDays,
            minutes: request.wholeDays ? (plan?.minutes ?? 0) : (request.minutes ?? 0),
          }));
        const day = reportDay({
          plan,
          status: summary.status,
          workedMinutes: summary.workedMinutes,
          lateMinutes: summary.lateMinutes,
          requests: onDay,
        });
        const inSchedule = plan
          ? plan.flexible
            ? Math.min(summary.workedMinutes, plan.minutes)
            : insideMinutes(mine, plan.start, plan.end) -
              Math.min(plan.breakMinutes, insideMinutes(mine, plan.start, plan.end))
          : 0;
        const firstIn = summary.firstIn ? new Date(summary.firstIn) : null;
        const lastOut = summary.lastOut ? new Date(summary.lastOut) : null;
        const arrivalDiff =
          firstIn && plan?.start ? ubMinutesOf(firstIn) - minutesOf(plan.start) : null;
        const departureDiff =
          lastOut && plan?.end && !summary.openIn
            ? ubMinutesOf(lastOut) - minutesOf(plan.end)
            : null;
        const info = card.get(person.userId);
        rows.push({
          date,
          userId: person.userId,
          fullName: person.fullName,
          firstName: person.firstName,
          lastName: person.lastName,
          photoUrl: info?.photoUrl ?? null,
          divisionId: person.divisionId,
          divisionName: info?.divisionName ?? null,
          position: person.position,
          status: summary.openIn && date < today && day.status === 'PRESENT' ? 'OPEN' : day.status,
          requestName: day.requestName,
          planStart: plan?.start ?? null,
          planEnd: plan?.end ?? null,
          flexible: plan?.flexible ?? false,
          firstIn,
          lastOut,
          arrivalDiff,
          departureDiff,
          breakMinutes: plan?.breakMinutes ?? 0,
          scheduledMinutes: day.scheduledMinutes,
          workedInSchedule: day.status === 'AWAY' ? day.scheduledMinutes : Math.max(0, inSchedule),
          workedMinutes: day.workedMinutes,
          lateMinutes: day.lateMinutes,
          earlyLeaveMinutes: departureDiff !== null && departureDiff < 0 ? -departureDiff : 0,
          overtimeMinutes: day.overtimeMinutes,
          siteName: mine.find((event) => event.kind === 'IN')?.siteName ?? null,
          openIn: summary.openIn,
        });
      }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.fullName.localeCompare(b.fullName, 'mn'));
    const totals: ReportTotals = {
      scheduledMinutes: 0,
      absentDays: 0,
      lateMinutes: 0,
      lateDays: 0,
      workedMinutes: 0,
      workedInSchedule: 0,
      earlyArrivalMinutes: 0,
      lateDepartureMinutes: 0,
      overtimeMinutes: 0,
      leaveDays: 0,
    };
    for (const row of rows) {
      totals.scheduledMinutes += row.scheduledMinutes;
      if (row.status === 'ABSENT') totals.absentDays += 1;
      if (row.status === 'LEAVE') totals.leaveDays += 1;
      if (row.lateMinutes > 0) totals.lateDays += 1;
      totals.lateMinutes += row.lateMinutes;
      totals.workedMinutes += row.workedMinutes;
      totals.workedInSchedule += row.workedInSchedule;
      if (row.arrivalDiff !== null && row.arrivalDiff < 0)
        totals.earlyArrivalMinutes -= row.arrivalDiff;
      if (row.departureDiff !== null && row.departureDiff > 0)
        totals.lateDepartureMinutes += row.departureDiff;
      totals.overtimeMinutes += row.overtimeMinutes;
    }
    return { rows, totals };
  }
}

/** The minutes of the IN–OUT spans that fall between a day's start and end (Ulaanbaatar time). */
function insideMinutes(
  events: readonly AttendanceEvent[],
  start: string | null,
  end: string | null,
): number {
  if (!start || !end) return 0;
  const from = minutesOf(start);
  const until = minutesOf(end);
  let total = 0;
  let open: number | null = null;
  for (const event of events) {
    const at = ubMinutesOf(event.at);
    if (event.kind === 'IN') open ??= at;
    else if (open !== null) {
      total += Math.max(0, Math.min(at, until) - Math.max(open, from));
      open = null;
    }
  }
  return total;
}
