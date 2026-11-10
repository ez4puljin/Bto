import { Inject, Injectable } from '@nestjs/common';
import {
  COLLECTION_NOTE_MAX,
  type CollectionMethod,
  type CollectionStatus,
} from '@tugeel/shared/finance';
import { type Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, gte, lt, lte, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, invalidCursor, toPage } from '../../../common/pagination/page';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { repCollections } from '../schema';
import { PaymentsService } from './payments.service';

type Row = typeof repCollections.$inferSelect;

const MONEY_SCALE = 2;
/** How far back a rep's own list reaches. */
const MINE_DAYS = 60;

/** Money a rep says a store handed over; the books change only when the accountant records it. */
export interface RepCollection {
  id: number;
  userId: number;
  userName: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  amount: Decimal;
  method: CollectionMethod;
  note: string | null;
  collectedOn: string;
  createdAt: Date;
  status: CollectionStatus;
  paymentId: number | null;
  paymentNumber: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface CollectionInput {
  customerId: number;
  amount: Decimal;
  method: CollectionMethod;
  note: string | null;
}

export interface CollectionQuery {
  status?: CollectionStatus;
  userId?: number;
  customerId?: number;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

const trimmed = (value: string | null | undefined, path: string): string | null => {
  const text = value?.trim() ?? '';
  if (text.length > COLLECTION_NOTE_MAX) {
    throw invalid(path, 'maxLength', `at most ${COLLECTION_NOTE_MAX} characters`);
  }
  return text === '' ? null : text;
};

/**
 * The money a rep collected at a store (ADR-0183). A rep's report is only a report: it changes
 * no balance and no book. The accountant either records it — one customer payment voucher in the
 * same transaction, the rep named as who collected, settling the oldest invoices first — or
 * refuses it with a reason. A decided report is never changed. Lock order: the report FOR UPDATE,
 * then what the voucher locks (the money account, the customer).
 */
@Injectable()
export class RepCollectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly users: UserNamesService,
    private readonly payments: PaymentsService,
  ) {}

  /** A rep reports money taken from a store today. */
  async create(ctx: AuthContext, input: CollectionInput): Promise<RepCollection> {
    if (!input.amount.gt(0) || input.amount.decimalPlaces() > MONEY_SCALE) {
      throw invalid('amount', 'money', 'a positive amount with 2 decimals');
    }
    const note = trimmed(input.note, 'note');
    const [customer] = await this.customers.getMany([input.customerId]);
    if (!customer) throw notFound('customer', input.customerId);
    const [row] = await this.db
      .insert(repCollections)
      .values({
        userId: ctx.userId,
        customerId: input.customerId,
        amount: input.amount,
        method: input.method,
        note,
        collectedOn: businessDate(),
      })
      .returning();
    if (!row) throw new Error('rep collection was not created');
    return this.one(row);
  }

  /** The caller's own reports of the last two months, newest first. */
  async mine(ctx: AuthContext): Promise<RepCollection[]> {
    const rows = await this.db
      .select()
      .from(repCollections)
      .where(
        and(
          eq(repCollections.userId, ctx.userId),
          gte(repCollections.createdAt, sql`now() - make_interval(days => ${MINE_DAYS})`),
        ),
      )
      .orderBy(desc(repCollections.id))
      .limit(200);
    return this.many(rows);
  }

  /** The accountant's list, newest first. */
  async list(
    query: CollectionQuery,
  ): Promise<{ data: RepCollection[]; nextCursor: string | null; pending: PendingTotals }> {
    const limit = query.limit ?? 50;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== undefined && typeof cursor.id !== 'number') throw invalidCursor();
    const where: (SQL | undefined)[] = [
      query.status === undefined ? undefined : eq(repCollections.status, query.status),
      query.userId === undefined ? undefined : eq(repCollections.userId, query.userId),
      query.customerId === undefined ? undefined : eq(repCollections.customerId, query.customerId),
      query.from === undefined ? undefined : gte(repCollections.collectedOn, query.from),
      query.to === undefined ? undefined : lte(repCollections.collectedOn, query.to),
      cursor === undefined ? undefined : lt(repCollections.id, cursor.id as number),
    ];
    const rows = await this.db
      .select()
      .from(repCollections)
      .where(and(...where))
      .orderBy(desc(repCollections.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const [pending] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${repCollections.amount}), 0)::text`,
      })
      .from(repCollections)
      .where(eq(repCollections.status, 'PENDING'));
    return {
      data: await this.many(page.data),
      nextCursor: page.nextCursor,
      pending: { count: pending?.count ?? 0, amount: pending?.amount ?? '0' },
    };
  }

  /**
   * «Орлого бичих»: the accountant's voucher for a pending report, into the chosen cash or bank
   * account on the chosen day, and the report marked recorded — one transaction.
   */
  async record(
    ctx: AuthContext,
    id: number,
    input: { moneyAccountId: number; paidOn: string },
  ): Promise<RepCollection> {
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(repCollections)
        .where(eq(repCollections.id, id))
        .for('update');
      if (!row) throw notFound('rep collection', id);
      if (row.status !== 'PENDING') {
        throw new AppError('DOC_ALREADY_POSTED', `collection ${id} is already decided`, { id });
      }
      const voucher = await this.payments.recordInTx(tx, ctx, {
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: input.moneyAccountId,
        customerId: row.customerId,
        glAccountId: null,
        amount: row.amount,
        paidOn: input.paidOn,
        description: row.note,
        reference: null,
        counterpartyName: null,
        collectedBy: row.userId,
        key: `rep-collection:${id}`,
      });
      await tx
        .update(repCollections)
        .set({
          status: 'RECORDED',
          paymentId: voucher.id,
          paymentNumber: voucher.number,
          decidedBy: ctx.userId,
          decidedAt: sql`now()`,
        })
        .where(eq(repCollections.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'rep_collections',
        entityId: id,
        before: { status: 'PENDING' },
        after: { status: 'RECORDED', paymentId: voucher.id, paymentNumber: voucher.number },
      });
    });
    return this.get(id);
  }

  /** The accountant refuses a pending report; the reason is told to the rep. */
  async reject(ctx: AuthContext, id: number, reason: string): Promise<RepCollection> {
    const note = trimmed(reason, 'reason');
    if (note === null) throw invalid('reason', 'required', 'a refusal says why');
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(repCollections)
        .where(eq(repCollections.id, id))
        .for('update');
      if (!row) throw notFound('rep collection', id);
      if (row.status !== 'PENDING') {
        throw new AppError('DOC_ALREADY_POSTED', `collection ${id} is already decided`, { id });
      }
      await tx
        .update(repCollections)
        .set({
          status: 'REJECTED',
          decidedBy: ctx.userId,
          decidedAt: sql`now()`,
          decisionNote: note,
        })
        .where(eq(repCollections.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'rep_collections',
        entityId: id,
        before: { status: 'PENDING' },
        after: { status: 'REJECTED', decisionNote: note },
      });
    });
    return this.get(id);
  }

  async get(id: number): Promise<RepCollection> {
    const [row] = await this.db.select().from(repCollections).where(eq(repCollections.id, id));
    if (!row) throw notFound('rep collection', id);
    return this.one(row);
  }

  private async one(row: Row): Promise<RepCollection> {
    const [collection] = await this.many([row]);
    if (!collection) throw new Error('rep collection is missing');
    return collection;
  }

  private async many(rows: readonly Row[]): Promise<RepCollection[]> {
    const customers = new Map(
      (await this.customers.getMany([...new Set(rows.map((row) => row.customerId))])).map(
        (customer) => [customer.id, customer],
      ),
    );
    const names = await this.users.namesOf(
      rows.flatMap((row) => (row.decidedBy === null ? [row.userId] : [row.userId, row.decidedBy])),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: names.get(row.userId) ?? '',
      customerId: row.customerId,
      customerCode: customers.get(row.customerId)?.code ?? '',
      customerName: customers.get(row.customerId)?.name ?? '',
      amount: row.amount,
      method: row.method,
      note: row.note,
      collectedOn: row.collectedOn,
      createdAt: row.createdAt,
      status: row.status,
      paymentId: row.paymentId,
      paymentNumber: row.paymentNumber,
      decidedByName: row.decidedBy === null ? null : (names.get(row.decidedBy) ?? null),
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
    }));
  }
}

export interface PendingTotals {
  count: number;
  /** NUMERIC text. */
  amount: string;
}
