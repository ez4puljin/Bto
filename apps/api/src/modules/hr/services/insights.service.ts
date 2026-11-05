import { Inject, Injectable } from '@nestjs/common';
import {
  AGE_BANDS,
  bandOfYears,
  CHILD_AGE_BANDS,
  EDUCATION_LEVELS,
  isEmployeeLeft,
  JOB_LEVELS,
  LEFT_REASON_KINDS,
  MARITAL_STATUSES,
  monthsBetween,
  TENURE_BANDS,
  tenureBand,
  yearsBetween,
} from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDateTime, isIsoDate } from '@tugeel/shared/time';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import { hrEmployeeChildren, hrRequests, hrRequestTypes } from '../schema';
import { HrReportsService, type ReportRow } from './reports.service';
import { type EmployeeRow, WorkforceService } from './workforce.service';

const UNKNOWN = 'UNKNOWN';

export interface Count {
  key: string;
  count: number;
}

export interface GenderCount {
  key: string;
  male: number;
  female: number;
  unknown: number;
}

export interface WorkforceInsights {
  from: string;
  to: string;
  total: number;
  totalBefore: number;
  joined: number;
  left: number;
  joinedBefore: number;
  leftBefore: number;
  /** One decimal; null without any birth date. */
  averageAge: string | null;
  averageAgeBefore: string | null;
  /** Years, one decimal; null without any employment date. */
  averageTenure: string | null;
  averageTenureBefore: string | null;
  matrix: { division: string; levels: Count[]; total: number }[];
  tenure: Count[];
  education: Count[];
  ageGender: GenderCount[];
  genders: Count[];
  districts: Count[];
  marital: Count[];
  children: GenderCount[];
  childrenTotal: number;
  employmentTypes: Count[];
  /** The twelve months of the range's end year. */
  movement: { month: string; joined: number; left: number }[];
  leftReasons: Count[];
  /** Of those employed now, how many have each detail still empty. */
  missing: {
    birthDate: number;
    gender: number;
    education: number;
    district: number;
    level: number;
  };
}

export interface AttendanceInsights {
  from: string;
  to: string;
  plannedMinutes: number;
  workedMinutes: number;
  /** Worked of planned, one decimal; null when nothing was planned. */
  performance: string | null;
  performanceBefore: string | null;
  averageArrival: string | null;
  averageDeparture: string | null;
  averageLateMinutes: number;
  averageEarlyMinutes: number;
  absentDays: number;
  lateDays: number;
  divisions: {
    division: string;
    plannedMinutes: number;
    workedMinutes: number;
    performance: string | null;
  }[];
  employees: {
    userId: number;
    fullName: string;
    photoUrl: string | null;
    division: string | null;
    plannedMinutes: number;
    workedMinutes: number;
    lateMinutes: number;
    absentDays: number;
    performance: string | null;
  }[];
  trend: {
    month: string;
    plannedMinutes: number;
    workedMinutes: number;
    performance: string | null;
  }[];
}

export interface RequestInsights {
  year: number;
  total: number;
  minutes: number;
  types: { typeId: number; name: string; color: string; count: number; days: number }[];
  employees: { userId: number; fullName: string; photoUrl: string | null; count: number }[];
  months: { month: string; count: number }[];
  statuses: Count[];
}

const percent = (part: number, whole: number): string | null =>
  whole <= 0 ? null : new Decimal(part).times(100).div(whole).toFixed(1);

const average = (values: readonly number[]): string | null =>
  values.length === 0
    ? null
    : values
        .reduce((sum, value) => sum.plus(value), new Decimal(0))
        .div(values.length)
        .toFixed(1);

/** The clock of an average minute of the day. */
const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

/** The Ulaanbaatar clock of a moment, in minutes of the day. */
const minutesOfClock = (at: Date): number => {
  const clock = businessDateTime(at).slice(11);
  return Number.parseInt(clock.slice(0, 2), 10) * 60 + Number.parseInt(clock.slice(3, 5), 10);
};

function counted(keys: readonly string[], values: readonly (string | null)[]): Count[] {
  const counts = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const value of values) {
    const key = value ?? UNKNOWN;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

const lastOfMonth = (month: string): string => {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const number = Number.parseInt(month.slice(5, 7), 10);
  const next =
    number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
};

/**
 * The HR dashboard's figures (ADR-0146 #5, after timely.mn's «Хянах самбар»): worked out from the
 * cards, the punches and the requests each time, nothing stored. The web draws them.
 */
@Injectable()
export class HrInsightsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly workforce: WorkforceService,
    private readonly reports: HrReportsService,
  ) {}

  async workforceFigures(query: { from: string; to: string }): Promise<WorkforceInsights> {
    this.checkRange(query.from, query.to);
    const staff = await this.workforce.employees();
    const span = this.spanDays(query.from, query.to);
    const beforeTo = addDays(query.from, -1);
    const beforeFrom = addDays(beforeTo, -span);
    const on = (date: string) => staff.filter((person) => employedOn(person, date));
    const current = on(query.to);
    const before = on(beforeTo);
    const joinedIn = (from: string, to: string) =>
      staff.filter(
        (person) =>
          person.employedOn !== null && person.employedOn >= from && person.employedOn <= to,
      );
    const leftIn = (from: string, to: string) =>
      staff.filter(
        (person) => person.leftOn !== null && person.leftOn >= from && person.leftOn <= to,
      );

    const ages = (people: readonly EmployeeRow[], date: string) =>
      people.flatMap((person) => (person.birthDate ? [yearsBetween(person.birthDate, date)] : []));
    const tenures = (people: readonly EmployeeRow[], date: string) =>
      people.flatMap((person) =>
        person.employedOn ? [monthsBetween(person.employedOn, date) / 12] : [],
      );

    const levels = [...JOB_LEVELS, UNKNOWN];
    const divisions = new Map<string, EmployeeRow[]>();
    for (const person of current) {
      const key = person.divisionName ?? UNKNOWN;
      divisions.set(key, [...(divisions.get(key) ?? []), person]);
    }

    const ageGender = new Map<string, GenderCount>(
      [...AGE_BANDS.map((band) => band.key), UNKNOWN].map((key) => [
        key,
        { key, male: 0, female: 0, unknown: 0 },
      ]),
    );
    for (const person of current) {
      const band = person.birthDate
        ? bandOfYears(AGE_BANDS, yearsBetween(person.birthDate, query.to))
        : null;
      const row = ageGender.get(band ?? UNKNOWN);
      if (!row) continue;
      if (person.gender === 'MALE') row.male += 1;
      else if (person.gender === 'FEMALE') row.female += 1;
      else row.unknown += 1;
    }

    const ids = current.map((person) => person.userId);
    const childRows =
      ids.length === 0
        ? []
        : await this.db
            .select({
              gender: hrEmployeeChildren.gender,
              birthDate: hrEmployeeChildren.birthDate,
            })
            .from(hrEmployeeChildren)
            .where(inArray(hrEmployeeChildren.userId, ids));
    const children = new Map<string, GenderCount>(
      CHILD_AGE_BANDS.map((band) => [band.key, { key: band.key, male: 0, female: 0, unknown: 0 }]),
    );
    for (const child of childRows) {
      const band = bandOfYears(CHILD_AGE_BANDS, yearsBetween(child.birthDate, query.to));
      const row = band ? children.get(band) : undefined;
      if (!row) continue;
      if (child.gender === 'MALE') row.male += 1;
      else if (child.gender === 'FEMALE') row.female += 1;
      else row.unknown += 1;
    }

    const year = query.to.slice(0, 4);
    const movement = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      return {
        month,
        joined: staff.filter((person) => person.employedOn?.startsWith(month)).length,
        left: staff.filter((person) => person.leftOn?.startsWith(month)).length,
      };
    });

    return {
      from: query.from,
      to: query.to,
      total: current.length,
      totalBefore: before.length,
      joined: joinedIn(query.from, query.to).length,
      left: leftIn(query.from, query.to).length,
      joinedBefore: joinedIn(beforeFrom, beforeTo).length,
      leftBefore: leftIn(beforeFrom, beforeTo).length,
      averageAge: average(ages(current, query.to)),
      averageAgeBefore: average(ages(before, beforeTo)),
      averageTenure: average(tenures(current, query.to)),
      averageTenureBefore: average(tenures(before, beforeTo)),
      matrix: [...divisions.entries()]
        .map(([division, people]) => ({
          division,
          levels: counted(
            levels,
            people.map((person) => person.jobLevel),
          ),
          total: people.length,
        }))
        .sort((a, b) => b.total - a.total),
      tenure: counted(
        [...TENURE_BANDS.map((band) => band.key), UNKNOWN],
        current.map((person) =>
          person.employedOn ? tenureBand(monthsBetween(person.employedOn, query.to)) : null,
        ),
      ),
      education: counted(
        [UNKNOWN, ...EDUCATION_LEVELS],
        current.map((person) => person.education),
      ),
      ageGender: [...ageGender.values()],
      genders: counted(
        ['MALE', 'FEMALE', UNKNOWN],
        current.map((person) => person.gender),
      ),
      districts: counted(
        [],
        current.map((person) => person.district),
      ).sort((a, b) => b.count - a.count),
      marital: counted(
        [...MARITAL_STATUSES, UNKNOWN],
        current.map((person) => person.maritalStatus),
      ),
      children: [...children.values()],
      childrenTotal: childRows.length,
      employmentTypes: counted(
        [],
        current.map((person) => person.employmentType),
      ).sort((a, b) => b.count - a.count),
      movement,
      leftReasons: counted(
        LEFT_REASON_KINDS,
        leftIn(query.from, query.to).map((person) => person.leftReasonKind),
      ).filter((row) => row.count > 0),
      missing: {
        birthDate: current.filter((person) => person.birthDate === null).length,
        gender: current.filter((person) => person.gender === null).length,
        education: current.filter((person) => person.education === null).length,
        district: current.filter((person) => person.district === null).length,
        level: current.filter((person) => person.jobLevel === null).length,
      },
    };
  }

  async attendanceFigures(query: { from: string; to: string }): Promise<AttendanceInsights> {
    this.checkRange(query.from, query.to);
    const [staff, report] = await Promise.all([
      this.workforce.employees(),
      this.reports.days(query),
    ]);
    const span = this.spanDays(query.from, query.to);
    const beforeTo = addDays(query.from, -1);
    const before = await this.reports.days({ from: addDays(beforeTo, -span), to: beforeTo });
    const card = new Map(staff.map((person) => [person.userId, person]));
    const rows = report.rows;
    const planned = (row: ReportRow) => row.scheduledMinutes;
    const totalPlanned = rows.reduce((sum, row) => sum + planned(row), 0);
    const totalWorked = rows.reduce((sum, row) => sum + row.workedInSchedule, 0);
    const beforePlanned = before.rows.reduce((sum, row) => sum + planned(row), 0);
    const beforeWorked = before.rows.reduce((sum, row) => sum + row.workedInSchedule, 0);

    const arrivals = rows.flatMap((row) => (row.firstIn ? [minutesOfClock(row.firstIn)] : []));
    const departures = rows.flatMap((row) => (row.lastOut ? [minutesOfClock(row.lastOut)] : []));
    const late = rows.filter((row) => row.lateMinutes > 0);
    const early = rows.filter((row) => row.earlyLeaveMinutes > 0);
    const mean = (values: readonly number[]) =>
      values.length === 0
        ? 0
        : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

    const perDivision = new Map<string, { plannedMinutes: number; workedMinutes: number }>();
    const perEmployee = new Map<
      number,
      { plannedMinutes: number; workedMinutes: number; lateMinutes: number; absentDays: number }
    >();
    for (const row of rows) {
      const person = card.get(row.userId);
      const division = person?.divisionName ?? UNKNOWN;
      const entry = perDivision.get(division) ?? { plannedMinutes: 0, workedMinutes: 0 };
      entry.plannedMinutes += planned(row);
      entry.workedMinutes += row.workedInSchedule;
      perDivision.set(division, entry);
      const mine = perEmployee.get(row.userId) ?? {
        plannedMinutes: 0,
        workedMinutes: 0,
        lateMinutes: 0,
        absentDays: 0,
      };
      mine.plannedMinutes += planned(row);
      mine.workedMinutes += row.workedInSchedule;
      mine.lateMinutes += row.lateMinutes;
      if (row.status === 'ABSENT') mine.absentDays += 1;
      perEmployee.set(row.userId, mine);
    }

    const year = query.to.slice(0, 4);
    const lastMonth = Number.parseInt(query.to.slice(5, 7), 10);
    const trend = await Promise.all(
      Array.from({ length: lastMonth }, async (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`;
        const end = lastOfMonth(month);
        const days = await this.reports.days({
          from: `${month}-01`,
          to: end < query.to ? end : query.to,
        });
        const plannedMinutes = days.rows.reduce((sum, row) => sum + planned(row), 0);
        const workedMinutes = days.rows.reduce((sum, row) => sum + row.workedInSchedule, 0);
        return {
          month,
          plannedMinutes,
          workedMinutes,
          performance: percent(workedMinutes, plannedMinutes),
        };
      }),
    );

    return {
      from: query.from,
      to: query.to,
      plannedMinutes: totalPlanned,
      workedMinutes: totalWorked,
      performance: percent(totalWorked, totalPlanned),
      performanceBefore: percent(beforeWorked, beforePlanned),
      averageArrival: arrivals.length === 0 ? null : clockOf(mean(arrivals)),
      averageDeparture: departures.length === 0 ? null : clockOf(mean(departures)),
      averageLateMinutes: mean(late.map((row) => row.lateMinutes)),
      averageEarlyMinutes: mean(early.map((row) => row.earlyLeaveMinutes)),
      absentDays: rows.filter((row) => row.status === 'ABSENT').length,
      lateDays: late.length,
      divisions: [...perDivision.entries()]
        .map(([division, entry]) => ({
          division,
          ...entry,
          performance: percent(entry.workedMinutes, entry.plannedMinutes),
        }))
        .sort((a, b) => b.plannedMinutes - a.plannedMinutes),
      employees: [...perEmployee.entries()]
        .map(([userId, entry]) => {
          const person = card.get(userId);
          return {
            userId,
            fullName: person?.fullName ?? '',
            photoUrl: person?.photoUrl ?? null,
            division: person?.divisionName ?? null,
            ...entry,
            performance: percent(entry.workedMinutes, entry.plannedMinutes),
          };
        })
        .sort(
          (a, b) =>
            new Decimal(b.performance ?? '0').comparedTo(a.performance ?? '0') ||
            a.fullName.localeCompare(b.fullName, 'mn'),
        ),
      trend,
    };
  }

  async requestFigures(year: number): Promise<RequestInsights> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw invalid('year', 'range', 'a year');
    }
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [rows, staff] = await Promise.all([
      this.db
        .select({
          userId: hrRequests.userId,
          typeId: hrRequests.typeId,
          name: hrRequestTypes.name,
          color: hrRequestTypes.color,
          fromDate: hrRequests.fromDate,
          toDate: hrRequests.toDate,
          startsAt: hrRequests.startsAt,
          endsAt: hrRequests.endsAt,
          status: hrRequests.status,
        })
        .from(hrRequests)
        .innerJoin(hrRequestTypes, eq(hrRequestTypes.id, hrRequests.typeId))
        .where(and(gte(hrRequests.fromDate, from), lte(hrRequests.fromDate, to)))
        .orderBy(asc(hrRequests.fromDate)),
      this.workforce.employees(),
    ]);
    const card = new Map(staff.map((person) => [person.userId, person]));
    const approved = rows.filter((row) => row.status === 'APPROVED');
    const dayMinutes = 8 * 60;
    const minutesOf = (row: (typeof rows)[number]): number => {
      if (row.startsAt && row.endsAt) {
        return Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
      }
      if (row.startsAt) return 0;
      return (daysBetween(row.fromDate, row.toDate) + 1) * dayMinutes;
    };
    const types = new Map<number, RequestInsights['types'][number]>();
    for (const row of approved) {
      const entry = types.get(row.typeId) ?? {
        typeId: row.typeId,
        name: row.name,
        color: row.color,
        count: 0,
        days: 0,
      };
      entry.count += 1;
      entry.days += daysBetween(row.fromDate, row.toDate) + 1;
      types.set(row.typeId, entry);
    }
    const employees = new Map<number, number>();
    for (const row of approved) employees.set(row.userId, (employees.get(row.userId) ?? 0) + 1);
    return {
      year,
      total: approved.length,
      minutes: approved.reduce((sum, row) => sum + minutesOf(row), 0),
      types: [...types.values()].sort((a, b) => b.count - a.count),
      employees: [...employees.entries()]
        .map(([userId, count]) => ({
          userId,
          count,
          fullName: card.get(userId)?.fullName ?? '',
          photoUrl: card.get(userId)?.photoUrl ?? null,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      months: Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`;
        return { month, count: approved.filter((row) => row.fromDate.startsWith(month)).length };
      }),
      statuses: counted(
        ['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'],
        rows.map((row) => row.status),
      ),
    };
  }

  private checkRange(from: string, to: string): void {
    if (!isIsoDate(from)) throw invalid('from', 'isDate', 'YYYY-MM-DD');
    if (!isIsoDate(to)) throw invalid('to', 'isDate', 'YYYY-MM-DD');
    if (to < from) throw invalid('to', 'afterFrom', 'on or after from');
  }

  private spanDays(from: string, to: string): number {
    return daysBetween(from, to);
  }
}

function employedOn(person: EmployeeRow, date: string): boolean {
  if (person.employedOn !== null && person.employedOn > date) return false;
  if (person.leftOn !== null) return person.leftOn >= date;
  return !isEmployeeLeft(person);
}

function daysBetween(from: string, to: string): number {
  let days = 0;
  for (let date = from; date < to; date = addDays(date, 1)) days += 1;
  return days;
}
