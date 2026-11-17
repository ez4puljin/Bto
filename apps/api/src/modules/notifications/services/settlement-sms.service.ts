import { Inject, Injectable } from '@nestjs/common';
import {
  isSettlementGroup,
  type SettlementGroup,
  type SettlementPeriod,
  settlementPeriodOf,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import {
  renderSmsTemplate,
  SMS_LIMITS,
  type SmsBatchStatus,
  type SmsErrorCode,
  type SmsMessageStatus,
  type SmsPurpose,
  smsSize,
  unknownSmsPlaceholders,
} from '@tugeel/shared/notifications';
import { MN_PHONE_E164 } from '@tugeel/shared/phone';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { JobsService } from '../../../common/jobs/jobs.service';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { ArLedgerService } from '../../finance';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { smsBatches, smsMessages } from '../schema';
import { SmsSettingsFlowService } from './sms-settings-flow.service';

/** Customers read per statement while a group's whole list is gathered. */
const CUSTOMER_PAGE = 500;

export interface SettlementSmsCustomer {
  customerId: number;
  code: string;
  name: string;
  phone: string | null;
  settlementGroup: SettlementGroup;
  /** The receivable balance now, as «Харилцагчийн үлдэгдэл» shows it. */
  balance: Decimal;
  /** The last SMS of this feature WeSend accepted for the customer. */
  lastSentAt: Date | null;
}

export interface SettlementSmsCustomersQuery {
  group: SettlementGroup;
  q?: string;
  /** Only customers whose balance is above zero. */
  withBalance?: boolean;
}

export interface SettlementSmsCustomers {
  group: SettlementGroup;
  /** The group's current settlement period, Ulaanbaatar today. */
  period: SettlementPeriod;
  data: SettlementSmsCustomer[];
}

export interface CreateSmsBatchInput {
  group: SettlementGroup;
  customerIds: number[];
  template: string;
  /** Skip a customer whose balance is no longer above zero (`no_balance`). */
  onlyWithBalance?: boolean;
}

export interface SmsBatchView {
  id: number;
  purpose: SmsPurpose;
  settlementGroup: SettlementGroup | null;
  template: string;
  status: SmsBatchStatus;
  totalCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  creditsUsed: number;
  stoppedCode: string | null;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface SmsMessageView {
  id: number;
  customerId: number;
  customerCode: string;
  customerName: string;
  phone: string | null;
  text: string;
  balance: Decimal;
  status: SmsMessageStatus;
  parts: number | null;
  credits: number | null;
  errorCode: string | null;
  sentAt: Date | null;
}

/**
 * «Тооцооны SMS» (ADR-0216): a settlement group's customers with their phone, balance and last
 * SMS; a batch whose every text is rendered and frozen with the customer's own balance at the
 * press of «Илгээх», sent afterwards by the worker (`notifications.sendSms`); the batches' history.
 * Reads customers and balances only through partners' and finance's public services.
 */
@Injectable()
export class SettlementSmsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly ledger: ArLedgerService,
    private readonly settings: SmsSettingsFlowService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async customerList(
    ctx: AuthContext,
    query: SettlementSmsCustomersQuery,
    today: string = businessDate(),
  ): Promise<SettlementSmsCustomers> {
    const found: { id: number; code: string; name: string; phone: string | null }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.customers.list(ctx, {
        settlementGroup: query.group,
        ...(query.q ? { q: query.q } : {}),
        limit: CUSTOMER_PAGE,
        ...(cursor ? { cursor } : {}),
      });
      found.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && found.length < SMS_LIMITS.batchMax * 5);
    const ids = found.map((customer) => customer.id);
    const balances = await this.ledger.balancesOfCustomers(ids);
    const lastSent = await this.lastSentOf(ids);
    const data = found.flatMap((customer) => {
      const balance = balances.get(customer.id) ?? new Decimal(0);
      if (query.withBalance && !balance.greaterThan(0)) return [];
      return [
        {
          customerId: customer.id,
          code: customer.code,
          name: customer.name,
          phone: customer.phone,
          settlementGroup: query.group,
          balance,
          lastSentAt: lastSent.get(customer.id) ?? null,
        },
      ];
    });
    return { group: query.group, period: settlementPeriodOf(query.group, today), data };
  }

  /**
   * Freezes one text per customer with the name, phone and balance read now, and enqueues the
   * sending in the same transaction. A customer without a valid phone (or, with
   * `onlyWithBalance`, without a balance) is kept as SKIPPED, so the result counts it.
   */
  async createBatch(
    ctx: AuthContext,
    input: CreateSmsBatchInput,
    today: string = businessDate(),
  ): Promise<SmsBatchView> {
    const template = input.template.trim();
    if (template.length === 0) throw invalid('template', 'required', 'the text is empty');
    if ([...template].length > SMS_LIMITS.templateMax) {
      throw invalid('template', 'maxLength', `at most ${SMS_LIMITS.templateMax} characters`);
    }
    const unknown = unknownSmsPlaceholders(template);
    if (unknown.length > 0) {
      throw new AppError('SMS_TEMPLATE_INVALID', 'the text names an unknown placeholder', {
        placeholders: unknown.map((name) => `{${name}}`).join(', '),
      });
    }
    const ids = [...new Set(input.customerIds)];
    if (ids.length === 0) throw invalid('customerIds', 'required', 'no customer is ticked');
    if (ids.length > SMS_LIMITS.batchMax) {
      throw invalid('customerIds', 'maxItems', `at most ${SMS_LIMITS.batchMax} customers`);
    }
    const key = await this.settings.savedKey();
    if (key.failure !== null) {
      throw new AppError('SMS_NOT_CONFIGURED', `SMS cannot be sent: ${key.failure}`, {
        reason: key.failure,
      });
    }
    const rows = await this.customers.findByIds(ids);
    if (rows.length !== ids.length) {
      const known = new Set(rows.map((row) => row.id));
      throw notFound('customer', ids.find((id) => !known.has(id)) ?? 0);
    }
    const balances = await this.ledger.balancesOfCustomers(ids);
    const messages = rows.map((customer) => {
      const balance = balances.get(customer.id) ?? new Decimal(0);
      const group = isSettlementGroup(customer.settlementGroup)
        ? customer.settlementGroup
        : input.group;
      const text = renderSmsTemplate(template, {
        name: customer.name,
        code: customer.code,
        balance,
        dueDate: settlementPeriodOf(group, today).dueDate,
      });
      const phone = customer.phone && MN_PHONE_E164.test(customer.phone) ? customer.phone : null;
      const skip: SmsErrorCode | null =
        phone === null
          ? 'no_phone'
          : input.onlyWithBalance && !balance.greaterThan(0)
            ? 'no_balance'
            : null;
      const status: SmsMessageStatus = skip ? 'SKIPPED' : 'QUEUED';
      return {
        customerId: customer.id,
        customerCode: customer.code,
        customerName: customer.name,
        phone,
        text,
        balance,
        status,
        errorCode: skip,
      };
    });
    const tooLong = messages.find(
      (message) => message.status === 'QUEUED' && smsSize(message.text).tooLong,
    );
    if (tooLong) {
      throw new AppError('SMS_TOO_LONG', 'a rendered text takes more parts than WeSend sends', {
        code: tooLong.customerCode,
        parts: smsSize(tooLong.text).parts,
        max: SMS_LIMITS.maxParts,
      });
    }
    const queued = messages.filter((message) => message.status === 'QUEUED').length;
    const skipped = messages.length - queued;
    const batchId = await inTransaction(this.db, async (tx) => {
      const [batch] = await tx
        .insert(smsBatches)
        .values({
          purpose: 'SETTLEMENT',
          settlementGroup: input.group,
          template,
          status: queued === 0 ? 'DONE' : 'QUEUED',
          totalCount: messages.length,
          skippedCount: skipped,
          createdBy: ctx.userId,
          ...(queued === 0 ? { finishedAt: sql`now()` } : {}),
        })
        .returning({ id: smsBatches.id });
      if (!batch) throw new Error('the batch was not inserted');
      await tx
        .insert(smsMessages)
        .values(messages.map((message) => ({ ...message, batchId: batch.id })));
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'sms_batches',
        entityId: batch.id,
        after: {
          purpose: 'SETTLEMENT',
          settlementGroup: input.group,
          template,
          customers: messages.length,
          queued,
          skipped,
        },
      });
      if (queued > 0) {
        await this.jobs.enqueue(
          tx,
          'notifications.sendSms',
          { batchId: batch.id },
          { singletonKey: `sms-batch-${batch.id}` },
        );
      }
      return batch.id;
    });
    return this.batch(batchId);
  }

  /** The batches newest first. */
  async batches(query: {
    cursor?: string;
    limit?: number;
  }): Promise<{ data: SmsBatchView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const where =
      typeof after?.id === 'number' && typeof after.at === 'string'
        ? or(
            lt(smsBatches.createdAt, new Date(after.at)),
            and(eq(smsBatches.createdAt, new Date(after.at)), lt(smsBatches.id, after.id)),
          )
        : undefined;
    const rows = await this.db
      .select()
      .from(smsBatches)
      .where(where)
      .orderBy(desc(smsBatches.createdAt), desc(smsBatches.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const views = await this.views(page);
    const last = page.at(-1);
    return {
      data: views,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async batch(id: number): Promise<SmsBatchView> {
    const [row] = await this.db.select().from(smsBatches).where(eq(smsBatches.id, id));
    if (!row) throw notFound('sms batch', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('sms batch', id);
    return view;
  }

  /** Every message of a batch: failed first, then queued, skipped and sent, each by customer. */
  async messages(batchId: number): Promise<SmsMessageView[]> {
    await this.batch(batchId);
    const rows = await this.db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.batchId, batchId))
      .orderBy(
        sql`CASE ${smsMessages.status} WHEN 'FAILED' THEN 0 WHEN 'QUEUED' THEN 1 WHEN 'SKIPPED' THEN 2 ELSE 3 END`,
        smsMessages.customerName,
        smsMessages.id,
      );
    return rows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      customerCode: row.customerCode,
      customerName: row.customerName,
      phone: row.phone,
      text: row.text,
      balance: row.balance,
      status: row.status,
      parts: row.parts,
      credits: row.credits,
      errorCode: row.errorCode,
      sentAt: row.sentAt,
    }));
  }

  // ---------------------------------------------------------------------------------------------

  /** Batches with their counts read live from the messages, so a batch being sent shows progress. */
  private async views(rows: (typeof smsBatches.$inferSelect)[]): Promise<SmsBatchView[]> {
    if (rows.length === 0) return [];
    const names = await this.names.namesOf([...new Set(rows.map((row) => row.createdBy))]);
    const counted = await this.db
      .select({
        batchId: smsMessages.batchId,
        status: smsMessages.status,
        count: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${smsMessages.credits}), 0)::int`,
      })
      .from(smsMessages)
      .where(
        inArray(
          smsMessages.batchId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(smsMessages.batchId, smsMessages.status);
    const countOf = (batchId: number, status: SmsMessageStatus) =>
      counted.find((row) => row.batchId === batchId && row.status === status)?.count ?? 0;
    return rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      settlementGroup: row.settlementGroup,
      template: row.template,
      status: row.status,
      totalCount: row.totalCount,
      queuedCount: countOf(row.id, 'QUEUED'),
      sentCount: countOf(row.id, 'SENT'),
      failedCount: countOf(row.id, 'FAILED'),
      skippedCount: countOf(row.id, 'SKIPPED'),
      creditsUsed: counted
        .filter((count) => count.batchId === row.id)
        .reduce((sum, count) => sum + count.credits, 0),
      stoppedCode: row.stoppedCode,
      createdBy: names.get(row.createdBy) ?? '',
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    }));
  }

  private async lastSentOf(customerIds: readonly number[]): Promise<Map<number, Date>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        customerId: smsMessages.customerId,
        at: sql<Date>`max(${smsMessages.sentAt})`.mapWith(smsMessages.sentAt),
      })
      .from(smsMessages)
      .where(and(inArray(smsMessages.customerId, [...customerIds]), eq(smsMessages.status, 'SENT')))
      .groupBy(smsMessages.customerId);
    return new Map(rows.flatMap((row) => (row.at ? [[row.customerId, row.at] as const] : [])));
  }
}
