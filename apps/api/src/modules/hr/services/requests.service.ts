import { Inject, Injectable } from '@nestjs/common';
import {
  type AttendanceKind,
  HR_LIMITS,
  PUNCH_GROUPS,
  REQUEST_GROUPS,
  type RequestGroup,
  type RequestStatus,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { hrRequests, hrRequestTypes } from '../schema';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_MANAGE, ATTENDANCE_VIEW } from './work-sites.service';

export interface RequestType {
  id: number;
  name: string;
  group: RequestGroup;
  color: string;
  wholeDays: boolean;
  active: boolean;
  sort: number;
}

export interface TimeRequest {
  id: number;
  userId: number;
  fullName: string;
  typeId: number;
  typeName: string;
  group: RequestGroup;
  color: string;
  wholeDays: boolean;
  fromDate: string;
  toDate: string;
  startsAt: Date | null;
  endsAt: Date | null;
  punchKind: AttendanceKind | null;
  /** The hours asked (an hour request) or the days (whole days), for the list. */
  minutes: number | null;
  days: number;
  note: string | null;
  status: RequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export interface RequestInput {
  userId: number;
  typeId: number;
  fromDate: string;
  toDate: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  punchKind: AttendanceKind | null;
  note: string | null;
  lat: string | null;
  lng: string | null;
  accuracyM: number | null;
}

export interface RequestFilter {
  status?: RequestStatus;
  userId?: number;
  typeId?: number;
  from?: string;
  to?: string;
}

const LIST_LIMIT = 500;

/**
 * Time requests (ADR-0144, «Цагийн хүсэлт»): an employee asks from the staff app for leave, a
 * trip, overtime or a missed punch; HR approves or rejects; the employee may cancel a pending one.
 * An approved punch request writes the punch (source REQUEST); the others count in the reports.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly attendance: AttendanceService,
  ) {}

  async types(includeInactive = true): Promise<RequestType[]> {
    const rows = await this.db
      .select()
      .from(hrRequestTypes)
      .where(includeInactive ? undefined : eq(hrRequestTypes.active, true))
      .orderBy(asc(hrRequestTypes.sort), asc(hrRequestTypes.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      group: row.group,
      color: row.color,
      wholeDays: row.wholeDays,
      active: row.active,
      sort: row.sort,
    }));
  }

  async saveType(
    ctx: AuthContext,
    id: number | null,
    input: {
      name: string;
      group: RequestGroup;
      color: string;
      wholeDays: boolean;
      active: boolean;
      sort: number;
    },
  ): Promise<RequestType> {
    this.assertRight(ctx, ATTENDANCE_MANAGE);
    const name = input.name.replace(/\s+/g, ' ').trim();
    if (name.length === 0 || [...name].length > WORKFORCE_LIMITS.maxName) {
      throw invalid('name', 'length', `1 to ${WORKFORCE_LIMITS.maxName}`);
    }
    if (!REQUEST_GROUPS.includes(input.group))
      throw invalid('group', 'enum', REQUEST_GROUPS.join(', '));
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) throw invalid('color', 'pattern', '#rrggbb');
    const savedId = await inTransaction(this.db, async (tx) => {
      const [taken] = await tx
        .select({ id: hrRequestTypes.id })
        .from(hrRequestTypes)
        .where(sql`lower(${hrRequestTypes.name}) = lower(${name})`);
      if (taken && taken.id !== id) {
        throw new AppError('DUPLICATE_VALUE', 'a type of that name exists', { field: 'name' });
      }
      const values = { ...input, name };
      if (id === null) {
        const [row] = await tx
          .insert(hrRequestTypes)
          .values(values)
          .returning({ id: hrRequestTypes.id });
        if (!row) throw new Error('type insert returned no row');
        await this.audit.record(tx, ctx, {
          action: 'CREATE',
          entity: 'hr_request_type',
          entityId: row.id,
          after: values,
        });
        return row.id;
      }
      const [before] = await tx
        .select()
        .from(hrRequestTypes)
        .where(eq(hrRequestTypes.id, id))
        .for('update');
      if (!before) throw notFound('hr_request_type', id);
      // A type with requests keeps its group: its past requests meant that.
      if (before.group !== input.group) {
        const [used] = await tx
          .select({ id: hrRequests.id })
          .from(hrRequests)
          .where(eq(hrRequests.typeId, id))
          .limit(1);
        if (used) throw new AppError('IN_USE', 'requests of this type exist', { id });
      }
      await tx
        .update(hrRequestTypes)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(hrRequestTypes.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_request_type',
        entityId: id,
        after: values,
      });
      return id;
    });
    const found = (await this.types()).find((type) => type.id === savedId);
    if (!found) throw notFound('hr_request_type', savedId);
    return found;
  }

  /** HR's list: newest first, at most 500, narrowed by status, person, type and dates. */
  async list(ctx: AuthContext, filter: RequestFilter): Promise<TimeRequest[]> {
    this.assertRight(ctx, ATTENDANCE_VIEW);
    return this.query(filter);
  }

  /** The employee's own requests, newest first. */
  async mine(ctx: AuthContext): Promise<TimeRequest[]> {
    return this.query({ userId: ctx.userId });
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(hrRequests)
      .where(eq(hrRequests.status, 'PENDING'));
    return row?.count ?? 0;
  }

  /**
   * A new request: the employee for themselves (the staff app), or HR for anyone. Whole-day types
   * take a date range; the others hours on one date (a punch request one moment and IN or OUT).
   */
  async create(ctx: AuthContext, input: RequestInput): Promise<TimeRequest> {
    if (input.userId !== ctx.userId) this.assertRight(ctx, ATTENDANCE_MANAGE);
    const type = (await this.types()).find((entry) => entry.id === input.typeId);
    if (!type || !type.active) throw invalid('typeId', 'exists', 'no such active type');
    const values = this.checked(type, input);
    const id = await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(hrRequests)
        .values({ ...values, userId: input.userId, typeId: type.id, createdBy: ctx.userId })
        .returning({ id: hrRequests.id });
      if (!row) throw new Error('request insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'hr_request',
        entityId: row.id,
        after: {
          userId: input.userId,
          type: type.name,
          fromDate: values.fromDate,
          toDate: values.toDate,
        },
      });
      return row.id;
    });
    return this.one(id);
  }

  /** HR decides a pending request; an approved punch request writes its punch in the same step. */
  async decide(
    ctx: AuthContext,
    id: number,
    input: { approve: boolean; note: string | null },
  ): Promise<TimeRequest> {
    this.assertRight(ctx, ATTENDANCE_MANAGE);
    const note = input.note?.trim() || null;
    if (note !== null && [...note].length > WORKFORCE_LIMITS.maxDecisionNote) {
      throw invalid('note', 'maxLength', `at most ${WORKFORCE_LIMITS.maxDecisionNote}`);
    }
    await inTransaction(this.db, async (tx) => {
      const request = await this.lock(tx, id);
      if (request.status !== 'PENDING') {
        throw new AppError('CONFLICT', `request ${id} is ${request.status}`, {
          status: request.status,
        });
      }
      let eventId: number | null = null;
      if (input.approve) {
        const [type] = await tx
          .select()
          .from(hrRequestTypes)
          .where(eq(hrRequestTypes.id, request.typeId));
        if (type && PUNCH_GROUPS.includes(type.group) && request.startsAt && request.punchKind) {
          eventId = await this.attendance.addRequestEventInTx(tx, ctx, {
            userId: request.userId,
            kind: request.punchKind,
            at: request.startsAt,
            note: `${type.name}${request.note ? `: ${request.note}` : ''}`.slice(
              0,
              HR_LIMITS.maxNote,
            ),
            lat: request.lat?.toString() ?? null,
            lng: request.lng?.toString() ?? null,
            accuracyM: request.accuracyM,
          });
        }
      }
      await tx
        .update(hrRequests)
        .set({
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedBy: ctx.userId,
          decidedAt: sql`now()`,
          decisionNote: note,
          eventId,
          updatedAt: sql`now()`,
        })
        .where(eq(hrRequests.id, id));
      await this.audit.record(tx, ctx, {
        action: input.approve ? 'APPROVE' : 'REJECT',
        entity: 'hr_request',
        entityId: id,
        after: { note, eventId },
      });
    });
    return this.one(id);
  }

  /** The employee takes back a pending request of their own. */
  async cancel(ctx: AuthContext, id: number): Promise<TimeRequest> {
    await inTransaction(this.db, async (tx) => {
      const request = await this.lock(tx, id);
      if (request.userId !== ctx.userId && !ctx.permissions.has(ATTENDANCE_MANAGE)) {
        throw notFound('hr_request', id);
      }
      if (request.status !== 'PENDING') {
        throw new AppError('CONFLICT', `request ${id} is ${request.status}`, {
          status: request.status,
        });
      }
      await tx
        .update(hrRequests)
        .set({ status: 'CANCELLED', updatedAt: sql`now()` })
        .where(eq(hrRequests.id, id));
      await this.audit.record(tx, ctx, { action: 'CANCEL', entity: 'hr_request', entityId: id });
    });
    return this.one(id);
  }

  /** The approved requests touching a range (the reports). */
  async approvedIn(from: string, to: string, userIds: readonly number[]): Promise<TimeRequest[]> {
    if (userIds.length === 0) return [];
    return (await this.query({ status: 'APPROVED', from, to })).filter((request) =>
      userIds.includes(request.userId),
    );
  }

  async one(id: number): Promise<TimeRequest> {
    const [found] = await this.query({}, id);
    if (!found) throw notFound('hr_request', id);
    return found;
  }

  private async query(filter: RequestFilter, id?: number): Promise<TimeRequest[]> {
    const conditions = [
      id === undefined ? undefined : eq(hrRequests.id, id),
      filter.status ? eq(hrRequests.status, filter.status) : undefined,
      filter.userId === undefined ? undefined : eq(hrRequests.userId, filter.userId),
      filter.typeId === undefined ? undefined : eq(hrRequests.typeId, filter.typeId),
      // A request touches the range when it starts on or before its end and ends on or after its start.
      filter.to ? lte(hrRequests.fromDate, filter.to) : undefined,
      filter.from ? gte(hrRequests.toDate, filter.from) : undefined,
    ];
    const rows = await this.db
      .select({ request: hrRequests, type: hrRequestTypes })
      .from(hrRequests)
      .innerJoin(hrRequestTypes, eq(hrRequestTypes.id, hrRequests.typeId))
      .where(and(...conditions))
      .orderBy(desc(hrRequests.createdAt), desc(hrRequests.id))
      .limit(LIST_LIMIT);
    const people = await this.names.namesOf([
      ...rows.map((row) => row.request.userId),
      ...rows.flatMap((row) => (row.request.decidedBy === null ? [] : [row.request.decidedBy])),
    ]);
    return rows.map(({ request, type }) => ({
      id: request.id,
      userId: request.userId,
      fullName: people.get(request.userId) ?? '',
      typeId: type.id,
      typeName: type.name,
      group: type.group,
      color: type.color,
      wholeDays: type.wholeDays,
      fromDate: request.fromDate,
      toDate: request.toDate,
      startsAt: request.startsAt,
      endsAt: request.endsAt,
      punchKind: request.punchKind,
      minutes:
        request.startsAt && request.endsAt
          ? Math.round((request.endsAt.getTime() - request.startsAt.getTime()) / 60_000)
          : null,
      days: daysBetween(request.fromDate, request.toDate),
      note: request.note,
      status: request.status,
      decidedBy: request.decidedBy === null ? null : (people.get(request.decidedBy) ?? null),
      decidedAt: request.decidedAt,
      decisionNote: request.decisionNote,
      createdAt: request.createdAt,
    }));
  }

  private checked(type: RequestType, input: RequestInput) {
    if (!isIsoDate(input.fromDate)) throw invalid('fromDate', 'isDate', 'YYYY-MM-DD');
    const note = input.note?.trim() || null;
    if (note !== null && [...note].length > WORKFORCE_LIMITS.maxRequestNote) {
      throw invalid('note', 'maxLength', `at most ${WORKFORCE_LIMITS.maxRequestNote}`);
    }
    const gps = input.lat !== null && input.lng !== null;
    const base = {
      note,
      lat: gps && input.lat !== null ? new Decimal(input.lat) : null,
      lng: gps && input.lng !== null ? new Decimal(input.lng) : null,
      accuracyM: gps ? input.accuracyM : null,
    };
    if (PUNCH_GROUPS.includes(type.group)) {
      if (!input.punchKind) throw invalid('punchKind', 'required', 'IN or OUT');
      // «Зайнаас цаг бүртгүүлэх» is the moment it is sent; «Цаг нөхөх» the moment chosen.
      const at = type.group === 'PUNCH_SENT' ? new Date() : input.startsAt;
      if (!at) throw invalid('startsAt', 'required', 'the moment of the punch');
      if (at.getTime() > Date.now() + 60_000)
        throw invalid('startsAt', 'notFuture', 'not in the future');
      const date = businessDate(at);
      return {
        ...base,
        fromDate: date,
        toDate: date,
        startsAt: at,
        endsAt: null,
        punchKind: input.punchKind,
      };
    }
    if (type.wholeDays) {
      const toDate = input.toDate ?? input.fromDate;
      if (!isIsoDate(toDate)) throw invalid('toDate', 'isDate', 'YYYY-MM-DD');
      if (toDate < input.fromDate) throw invalid('toDate', 'afterFrom', 'on or after fromDate');
      if (addDays(input.fromDate, WORKFORCE_LIMITS.maxRequestDays) < toDate) {
        throw invalid('toDate', 'range', `at most ${WORKFORCE_LIMITS.maxRequestDays} days`);
      }
      return {
        ...base,
        fromDate: input.fromDate,
        toDate,
        startsAt: null,
        endsAt: null,
        punchKind: null,
      };
    }
    if (!input.startsAt || !input.endsAt) throw invalid('startsAt', 'required', 'the hours asked');
    if (input.endsAt <= input.startsAt) throw invalid('endsAt', 'afterStart', 'after the start');
    const date = businessDate(input.startsAt);
    if (businessDate(new Date(input.endsAt.getTime() - 1)) !== date) {
      throw invalid('endsAt', 'sameDay', 'on the same day');
    }
    return {
      ...base,
      fromDate: date,
      toDate: date,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      punchKind: null,
    };
  }

  private async lock(tx: Tx, id: number) {
    const [row] = await tx.select().from(hrRequests).where(eq(hrRequests.id, id)).for('update');
    if (!row) throw notFound('hr_request', id);
    return row;
  }

  private assertRight(
    ctx: AuthContext,
    permission: typeof ATTENDANCE_MANAGE | typeof ATTENDANCE_VIEW,
  ): void {
    if (!ctx.permissions.has(permission)) {
      throw new AppError('FORBIDDEN', `time requests need ${permission}`, { permission });
    }
  }
}

function daysBetween(from: string, to: string): number {
  let days = 0;
  for (let date = from; date <= to && days < 400; date = addDays(date, 1)) days += 1;
  return days;
}
