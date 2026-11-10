import { Inject, Injectable } from '@nestjs/common';
import {
  isoWeekdayOf,
  VISIT_NOTE_MAX,
  VISIT_PLAN_MAX,
  type VisitResult,
  WEEKDAYS,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gte, lt, lte, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, invalidCursor, toPage } from '../../../common/pagination/page';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { repVisitPlans, repVisits } from '../schema';

const REP = 'sales.orders.rep';

/** A store as a visit list shows it. */
export interface VisitCustomer {
  customerId: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditHold: boolean;
}

export interface RepPlanDay {
  weekday: number;
  customers: VisitCustomer[];
}

export interface RepVisit {
  id: number;
  userId: number;
  userName: string;
  customer: VisitCustomer;
  visitedOn: string;
  visitedAt: Date;
  result: VisitResult;
  note: string | null;
}

/** A store on the rep's list of today: planned or not, and the day's last visit there. */
export interface TodayStop extends VisitCustomer {
  planned: boolean;
  visit: { id: number; result: VisitResult; note: string | null; visitedAt: Date } | null;
}

export interface RepToday {
  date: string;
  weekday: number;
  stops: TodayStop[];
}

export interface VisitInput {
  customerId: number;
  result: VisitResult;
  note: string | null;
}

export interface VisitQuery {
  userId?: number;
  customerId?: number;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * A rep's visit plan and visit log (ADR-0183). The plan is a weekly round: the stores of each
 * weekday, set by the office or by the rep. A visit is one row — who, where, when and what it came
 * to — written once and never changed; the day's list joins the plan with the day's visits.
 */
@Injectable()
export class RepVisitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly users: UserNamesService,
  ) {}

  /** The active staff who hold the rep right, by name: whose plan the office edits. */
  async reps(): Promise<{ id: number; fullName: string }[]> {
    const staff = (await this.users.allStaff()).filter((user) => user.status === 'ACTIVE');
    const holders = await this.users.holdersOf(
      REP,
      staff.map((user) => user.id),
    );
    return staff
      .filter((user) => holders.has(user.id))
      .map((user) => ({ id: user.id, fullName: user.fullName }));
  }

  private async customersOf(ids: readonly number[]): Promise<Map<number, VisitCustomer>> {
    const rows = await this.customers.getMany([...new Set(ids)]);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          customerId: row.id,
          code: row.code,
          name: row.name,
          phone: row.phone,
          address: row.address,
          creditHold: row.creditHold,
        },
      ]),
    );
  }

  /** The seven days of a rep's round, Monday first; a day without stores is empty. */
  async plan(userId: number): Promise<RepPlanDay[]> {
    const rows = await this.db
      .select({ weekday: repVisitPlans.weekday, customerId: repVisitPlans.customerId })
      .from(repVisitPlans)
      .where(eq(repVisitPlans.userId, userId))
      .orderBy(asc(repVisitPlans.weekday), asc(repVisitPlans.id));
    const customers = await this.customersOf(rows.map((row) => row.customerId));
    return WEEKDAYS.map((weekday) => ({
      weekday,
      customers: rows
        .filter((row) => row.weekday === weekday)
        .flatMap((row) => customers.get(row.customerId) ?? []),
    }));
  }

  /** Replaces one weekday of a rep's round with these stores, in this order. */
  async setDay(
    ctx: AuthContext,
    userId: number,
    weekday: number,
    customerIds: readonly number[],
  ): Promise<RepPlanDay[]> {
    if (!WEEKDAYS.includes(weekday)) throw invalid('weekday', 'weekday', '1 (Monday) to 7');
    const ids = [...new Set(customerIds)];
    if (ids.length > VISIT_PLAN_MAX) {
      throw invalid('customerIds', 'maxItems', `at most ${VISIT_PLAN_MAX} stores a day`);
    }
    if (!(await this.users.namesOf([userId])).size) throw notFound('user', userId);
    const known = await this.customers.getMany(ids);
    const active = new Set(known.filter((row) => row.status === 'ACTIVE').map((row) => row.id));
    const missing = ids.find((id) => !active.has(id));
    if (missing !== undefined) {
      throw invalid('customerIds', 'active', `customer ${missing} is not an active customer`);
    }
    await inTransaction(this.db, async (tx) => {
      // One writer at a time per rep and weekday: the rows are replaced as a whole.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('rep_visit_plans'), ${userId * 10 + weekday})`,
      );
      const before = await tx
        .select({ customerId: repVisitPlans.customerId })
        .from(repVisitPlans)
        .where(and(eq(repVisitPlans.userId, userId), eq(repVisitPlans.weekday, weekday)))
        .orderBy(asc(repVisitPlans.id));
      const was = before.map((row) => row.customerId);
      if (was.length === ids.length && was.every((id, index) => id === ids[index])) return;
      await tx
        .delete(repVisitPlans)
        .where(and(eq(repVisitPlans.userId, userId), eq(repVisitPlans.weekday, weekday)));
      if (ids.length > 0) {
        await tx.insert(repVisitPlans).values(
          ids.map((customerId) => ({
            userId,
            weekday,
            customerId,
            createdBy: ctx.userId,
          })),
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'rep_visit_plans',
        entityId: userId,
        before: { weekday, customerIds: was },
        after: { weekday, customerIds: ids },
      });
    });
    return this.plan(userId);
  }

  /** The rep's list of a day: the weekday's stores, then the stores visited outside the plan. */
  async today(ctx: AuthContext, date: string = businessDate()): Promise<RepToday> {
    const weekday = isoWeekdayOf(date);
    const planned = await this.db
      .select({ customerId: repVisitPlans.customerId })
      .from(repVisitPlans)
      .where(and(eq(repVisitPlans.userId, ctx.userId), eq(repVisitPlans.weekday, weekday)))
      .orderBy(asc(repVisitPlans.id));
    const visits = await this.db
      .select()
      .from(repVisits)
      .where(and(eq(repVisits.userId, ctx.userId), eq(repVisits.visitedOn, date)))
      .orderBy(asc(repVisits.id));
    const last = new Map(visits.map((visit) => [visit.customerId, visit]));
    const plannedIds = planned.map((row) => row.customerId);
    const extraIds = [...last.keys()].filter((id) => !plannedIds.includes(id));
    const customers = await this.customersOf([...plannedIds, ...extraIds]);
    const stop = (customerId: number, isPlanned: boolean): TodayStop[] => {
      const customer = customers.get(customerId);
      if (!customer) return [];
      const visit = last.get(customerId);
      return [
        {
          ...customer,
          planned: isPlanned,
          visit: visit
            ? {
                id: visit.id,
                result: visit.result,
                note: visit.note,
                visitedAt: visit.visitedAt,
              }
            : null,
        },
      ];
    };
    return {
      date,
      weekday,
      stops: [
        ...plannedIds.flatMap((id) => stop(id, true)),
        ...extraIds.flatMap((id) => stop(id, false)),
      ],
    };
  }

  /** Writes a visit of the caller now; a store may be visited again the same day. */
  async visit(ctx: AuthContext, input: VisitInput): Promise<RepToday> {
    const note = input.note?.trim() || null;
    if (note !== null && note.length > VISIT_NOTE_MAX) {
      throw invalid('note', 'maxLength', `at most ${VISIT_NOTE_MAX} characters`);
    }
    const [customer] = await this.customers.getMany([input.customerId]);
    if (!customer) throw notFound('customer', input.customerId);
    const date = businessDate();
    await this.db.insert(repVisits).values({
      userId: ctx.userId,
      customerId: input.customerId,
      visitedOn: date,
      result: input.result,
      note,
    });
    return this.today(ctx, date);
  }

  /** The visit log, newest first: the office reads every rep's, by rep, store and days. */
  async visits(query: VisitQuery): Promise<{ data: RepVisit[]; nextCursor: string | null }> {
    const limit = query.limit ?? 50;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== undefined && typeof cursor.id !== 'number') throw invalidCursor();
    const where: (SQL | undefined)[] = [
      query.userId === undefined ? undefined : eq(repVisits.userId, query.userId),
      query.customerId === undefined ? undefined : eq(repVisits.customerId, query.customerId),
      query.from === undefined ? undefined : gte(repVisits.visitedOn, query.from),
      query.to === undefined ? undefined : lte(repVisits.visitedOn, query.to),
      cursor === undefined ? undefined : lt(repVisits.id, cursor.id as number),
    ];
    const rows = await this.db
      .select()
      .from(repVisits)
      .where(and(...where))
      .orderBy(desc(repVisits.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const customers = await this.customersOf(page.data.map((row) => row.customerId));
    const names = await this.users.namesOf(page.data.map((row) => row.userId));
    return {
      data: page.data.flatMap((row) => {
        const customer = customers.get(row.customerId);
        if (!customer) return [];
        return [
          {
            id: row.id,
            userId: row.userId,
            userName: names.get(row.userId) ?? '',
            customer,
            visitedOn: row.visitedOn,
            visitedAt: row.visitedAt,
            result: row.result,
            note: row.note,
          },
        ];
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** How many visits of each result the days hold, by rep: the log's summary row. */
  async summary(
    query: Pick<VisitQuery, 'userId' | 'from' | 'to'>,
  ): Promise<
    { userId: number; userName: string; result: VisitResult; visits: number; stores: number }[]
  > {
    const where: (SQL | undefined)[] = [
      query.userId === undefined ? undefined : eq(repVisits.userId, query.userId),
      query.from === undefined ? undefined : gte(repVisits.visitedOn, query.from),
      query.to === undefined ? undefined : lte(repVisits.visitedOn, query.to),
    ];
    const rows = await this.db
      .select({
        userId: repVisits.userId,
        result: repVisits.result,
        visits: sql<number>`count(*)::int`,
        stores: sql<number>`count(DISTINCT ${repVisits.customerId})::int`,
      })
      .from(repVisits)
      .where(and(...where))
      .groupBy(repVisits.userId, repVisits.result)
      .orderBy(asc(repVisits.userId), asc(repVisits.result));
    const names = await this.users.namesOf(rows.map((row) => row.userId));
    return rows.map((row) => ({ ...row, userName: names.get(row.userId) ?? '' }));
  }
}
