import { Inject, Injectable } from '@nestjs/common';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { addDays, businessInstant, isIsoDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { JobsService } from '../../../common/jobs/jobs.service';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type AuthContext, AuditService } from '../../identity';
import { CustomerAddressesService, CustomersService } from '../../partners';
import { SalesPipelinesService } from '../../sales';
import { PhoneError } from '../phone-agent.errors';
import {
  outcomeOf,
  type PhoneCallbackStatus,
  type PhoneCallOutcome,
  type PhoneDeclineReason,
  type PhoneEndReason,
  type PhoneMessageRole,
  PHONE_LIMITS,
} from '../phone-agent.rules';
import { phoneCallbacks, phoneCallMessages, phoneCalls, phoneLines } from '../schema';
import { type PhoneLine, staffAnswer } from './phone-lines.service';

export type CallRow = typeof phoneCalls.$inferSelect;
type MessageRow = typeof phoneCallMessages.$inferSelect;
type CallbackRow = typeof phoneCallbacks.$inferSelect;

/** What a stored message's `meta` may hold; unknown keys are kept as they came. */
export interface MessageMeta {
  source: 'BRIDGE' | 'RECONCILED';
  tool?: string;
  args?: unknown;
  ok?: boolean;
  /** A refused tool call's code and HTTP status. */
  code?: string;
  status?: number;
  answer?: unknown;
  no_hit?: boolean;
  /** A search that found only partial matches (no product holds every word). */
  partial_only?: boolean;
  /** How long the search took, milliseconds. */
  search_ms?: number;
  quote_id?: string;
  /** The provider's turn index a RECONCILED message came from. */
  turn?: number;
  [key: string]: unknown;
}

export function metaOf(value: unknown): MessageMeta {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MessageMeta)
    : { source: 'BRIDGE' };
}

/** A turn the bridge reports: the caller's or the agent's words. */
export interface CallEvent {
  seq: number;
  role: Exclude<PhoneMessageRole, 'TOOL'>;
  text: string;
  atMs: number;
}

export interface PhoneCallView {
  id: number;
  lineId: number;
  lineName: string;
  callRef: string;
  callerPhone: string | null;
  callerRaw: string | null;
  customerId: number | null;
  customerName: string | null;
  answered: boolean;
  declineReason: PhoneDeclineReason | null;
  startedAt: Date;
  endedAt: Date | null;
  endReason: PhoneEndReason | null;
  durationS: number | null;
  outcome: PhoneCallOutcome | null;
  salesOrderId: number | null;
  orderNumber: string | null;
  costEstimate: string | null;
  reconciled: boolean;
}

export interface PhoneMessageView {
  seq: number;
  role: PhoneMessageRole;
  text: string;
  atMs: number;
  meta: MessageMeta;
  createdAt: Date;
}

export interface PhoneCallbackView {
  id: number;
  callId: number;
  phone: string | null;
  customerId: number | null;
  customerName: string | null;
  reason: string;
  status: PhoneCallbackStatus;
  doneBy: number | null;
  doneAt: Date | null;
  createdAt: Date;
}

export interface NoHitSearch {
  callId: number;
  seq: number;
  query: string;
  createdAt: Date;
}

/** A call as `POST /calls` opened it. */
export interface OpenedCall {
  call: CallRow;
  /** The one ACTIVE store the number belongs to; null for none, several or a withheld number. */
  customer: { id: number; name: string } | null;
  /** Whether that store has a default address a delivery can go to. */
  canDeliver: boolean;
}

/** The digits, `+`, `*` and `#` of what the phone showed, at most 32; null when nothing is left. */
function rawNumber(value: string | null | undefined): string | null {
  const kept = (value ?? '').replace(/[^0-9+*#]/g, '').slice(0, 32);
  return kept.length > 0 ? kept : null;
}

/**
 * The phone AI line's calls, their transcripts and the callback tasks (ADR-0232 #2, #3): what the
 * station writes during a call and what the office reads afterwards. It talks to the database
 * only; the provider is called by the flow services around it.
 */
@Injectable()
export class PhoneCallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly pipelines: SalesPipelinesService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stores an incoming call and decides whether the AI may answer it (ADR-0232 #3): never while
   * the line is off, in the line's working hours, without a configured agent, or while no stage
   * takes PHONE_AI orders. The server's clock decides. A call reported twice (the same `callRef`)
   * is the same row: the decision of the first report stands.
   */
  async open(
    line: PhoneLine,
    input: { callRef: string; callerPhone: string | null },
    agentReady: boolean,
    now: Date = new Date(),
  ): Promise<OpenedCall> {
    const callerPhone = input.callerPhone ? normalizeMnPhone(input.callerPhone) : null;
    return inTransaction(this.db, async (tx) => {
      const matches = callerPhone ? await this.customers.findByPhone(callerPhone, tx) : [];
      const customer = matches.length === 1 ? (matches[0] ?? null) : null;
      const decline: PhoneDeclineReason | null = !line.active
        ? 'LINE_INACTIVE'
        : staffAnswer(line, now)
          ? 'WORKING_HOURS'
          : !agentReady
            ? 'AGENT_UNAVAILABLE'
            : (await this.pipelines.phoneAiOpen(tx))
              ? null
              : 'AI_CLOSED';
      const [inserted] = await tx
        .insert(phoneCalls)
        .values({
          lineId: line.id,
          callRef: input.callRef,
          callerPhone,
          callerRaw: rawNumber(input.callerPhone),
          customerId: customer?.id ?? null,
          answered: decline === null,
          declineReason: decline,
          startedAt: now,
          // A call the AI leaves to staff is over for Bto at once.
          endedAt: decline === null ? null : now,
        })
        .onConflictDoNothing({ target: [phoneCalls.lineId, phoneCalls.callRef] })
        .returning();
      const call = inserted ?? (await this.byRef(tx, line.id, input.callRef));
      const known =
        call.customerId === null
          ? null
          : (customer ?? (await this.customerName(call.customerId, tx)));
      const canDeliver =
        known !== null && (await this.addresses.defaultAddress(known.id, tx)) !== null;
      return { call, customer: known, canDeliver };
    });
  }

  /** The agent gave no signed URL in time: the phone rings for staff and the call is filed FAILED. */
  async failToAnswer(callId: number): Promise<void> {
    await this.db
      .update(phoneCalls)
      .set({
        answered: false,
        declineReason: 'AGENT_UNAVAILABLE',
        endedAt: sql`now()`,
        outcome: 'FAILED',
      })
      .where(and(eq(phoneCalls.id, callId), isNull(phoneCalls.endedAt)));
  }

  /** This line's call, or PHONE_CALL_NOT_FOUND: another line's call does not exist for it. */
  async own(
    lineId: number,
    callId: number,
    executor: Db | Tx = this.db,
    lock = false,
  ): Promise<CallRow> {
    const query = executor
      .select()
      .from(phoneCalls)
      .where(and(eq(phoneCalls.id, callId), eq(phoneCalls.lineId, lineId)));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new PhoneError('PHONE_CALL_NOT_FOUND', `phone call ${callId}`, { id: callId });
    return row;
  }

  /** This line's call that the AI answered; a declined call takes no events and no tools. */
  async ownAnswered(
    lineId: number,
    callId: number,
    executor: Db | Tx = this.db,
    lock = false,
  ): Promise<CallRow> {
    const call = await this.own(lineId, callId, executor, lock);
    if (!call.answered) {
      throw new PhoneError('PHONE_CALL_NOT_ANSWERED', `phone call ${callId} was not answered`, {
        id: callId,
      });
    }
    return call;
  }

  /**
   * Appends the turns the bridge delivers (ADR-0232 #3): a sequence number already stored is left
   * as it is, so a batch sent twice changes nothing. Late turns of an ended call are taken too.
   */
  async appendEvents(
    line: PhoneLine,
    callId: number,
    input: { events: readonly CallEvent[]; conversationId?: string | null },
  ): Promise<{ stored: number; lastSeq: number }> {
    return inTransaction(this.db, async (tx) => {
      const call = await this.ownAnswered(line.id, callId, tx);
      await this.keepConversation(tx, call, input.conversationId);
      const written =
        input.events.length === 0
          ? []
          : await tx
              .insert(phoneCallMessages)
              .values(
                input.events.map((event) => ({
                  callId,
                  seq: event.seq,
                  role: event.role,
                  text: event.text,
                  atMs: event.atMs,
                  meta: { source: 'BRIDGE' } satisfies MessageMeta,
                })),
              )
              .onConflictDoNothing()
              .returning({ seq: phoneCallMessages.seq });
      return { stored: written.length, lastSeq: await this.lastSeq(tx, callId) };
    });
  }

  /**
   * Closes a call (ADR-0232 #3): its outcome from what it left behind, its length, and the job
   * that fills the turns the bridge never delivered, in one transaction. A call already closed
   * stays as it was.
   */
  async end(
    line: PhoneLine,
    callId: number,
    input: { reason: PhoneEndReason; durationS: number | null; conversationId?: string | null },
  ): Promise<CallRow> {
    return inTransaction(this.db, async (tx) => {
      const call = await this.own(line.id, callId, tx, true);
      if (call.endedAt !== null) return call;
      await this.keepConversation(tx, call, input.conversationId);
      return this.closeInTx(tx, call.id, input.reason, input.durationS);
    });
  }

  /**
   * Closes the answered calls the bridge never ended (it died, ADR-0232 #3) once they are
   * `abandonedAfterMinutes` old, each with its reconcile job. Answers how many it closed.
   */
  async closeAbandoned(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - PHONE_LIMITS.abandonedAfterMinutes * 60_000);
    const open = await this.db
      .select({ id: phoneCalls.id })
      .from(phoneCalls)
      .where(and(isNull(phoneCalls.endedAt), lt(phoneCalls.startedAt, before)))
      .orderBy(asc(phoneCalls.id))
      .limit(200);
    let closed = 0;
    for (const { id } of open) {
      const done = await inTransaction(this.db, async (tx) => {
        const [call] = await tx
          .select()
          .from(phoneCalls)
          .where(eq(phoneCalls.id, id))
          .for('update');
        if (!call || call.endedAt !== null) return false;
        await this.closeInTx(tx, id, null, null);
        return true;
      });
      if (done) closed += 1;
    }
    return closed;
  }

  private async closeInTx(
    tx: Tx,
    callId: number,
    reason: PhoneEndReason | null,
    durationS: number | null,
  ): Promise<CallRow> {
    const [call] = await tx.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    if (!call) throw new PhoneError('PHONE_CALL_NOT_FOUND', `phone call ${callId}`, { id: callId });
    const [callback] = await tx
      .select({ id: phoneCallbacks.id })
      .from(phoneCallbacks)
      .where(eq(phoneCallbacks.callId, callId))
      .limit(1);
    const [status] = await tx
      .select({ seq: phoneCallMessages.seq })
      .from(phoneCallMessages)
      .where(
        and(
          eq(phoneCallMessages.callId, callId),
          eq(phoneCallMessages.role, 'TOOL'),
          sql`${phoneCallMessages.meta} ->> 'tool' = 'order_status'`,
          sql`${phoneCallMessages.meta} ->> 'ok' = 'true'`,
        ),
      )
      .limit(1);
    const [closed] = await tx
      .update(phoneCalls)
      .set({
        endedAt: sql`now()`,
        endReason: reason,
        durationS,
        outcome: outcomeOf({
          ordered: call.salesOrderId !== null,
          callback: callback !== undefined,
          recognised: call.customerId !== null,
          statusTold: status !== undefined,
          failed: reason === 'ERROR',
        }),
      })
      .where(eq(phoneCalls.id, callId))
      .returning();
    if (!closed) throw new Error('phone call not closed');
    if (closed.answered) {
      // The provider needs a moment to finish the conversation; the queue retries a read too early.
      await this.jobs.enqueue(
        tx,
        'phoneagent.reconcile',
        { callId },
        { singletonKey: String(callId), startAfter: 20 },
      );
    }
    return closed;
  }

  /** The provider's conversation id, kept the first time the bridge names it. */
  private async keepConversation(
    tx: Tx,
    call: CallRow,
    conversationId: string | null | undefined,
  ): Promise<void> {
    const id = conversationId?.trim() ?? '';
    if (id === '' || call.elConversationId !== null) return;
    await tx
      .update(phoneCalls)
      .set({ elConversationId: id })
      .where(and(eq(phoneCalls.id, call.id), isNull(phoneCalls.elConversationId)));
  }

  async lastSeq(executor: Db | Tx, callId: number): Promise<number> {
    const [row] = await executor
      .select({ last: sql<number>`coalesce(max(${phoneCallMessages.seq}), 0)::int` })
      .from(phoneCallMessages)
      .where(eq(phoneCallMessages.callId, callId));
    return row?.last ?? 0;
  }

  /** A call's stored messages by sequence number, optionally only up to one. */
  async messages(
    callId: number,
    executor: Db | Tx = this.db,
    upTo?: number,
  ): Promise<MessageRow[]> {
    return executor
      .select()
      .from(phoneCallMessages)
      .where(
        and(
          eq(phoneCallMessages.callId, callId),
          upTo === undefined ? undefined : sql`${phoneCallMessages.seq} <= ${upTo}`,
        ),
      )
      .orderBy(asc(phoneCallMessages.seq));
  }

  private async byRef(tx: Tx, lineId: number, callRef: string): Promise<CallRow> {
    const [row] = await tx
      .select()
      .from(phoneCalls)
      .where(and(eq(phoneCalls.lineId, lineId), eq(phoneCalls.callRef, callRef)));
    if (!row) throw new Error('phone call neither inserted nor found');
    return row;
  }

  async customerName(
    customerId: number,
    executor: Db | Tx = this.db,
  ): Promise<{ id: number; name: string } | null> {
    const [customer] = await this.customers.getMany([customerId], executor);
    return customer ? { id: customer.id, name: customer.name } : null;
  }

  // ----------------------------------------------------------------------------------------------
  // The office's reads (`phone.calls.read`).

  /** The calls newest first, keyset by id. */
  async page(query: {
    outcome?: PhoneCallOutcome;
    answered?: boolean;
    /** Started on or after this Ulaanbaatar day, `YYYY-MM-DD`. */
    from?: string;
    /** Started on or before this Ulaanbaatar day, `YYYY-MM-DD`. */
    to?: string;
    /** Only calls that placed an order (true) or only those that did not (false). */
    hasOrder?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: PhoneCallView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    for (const field of ['from', 'to'] as const) {
      const day = query[field];
      if (day !== undefined && !isIsoDate(day))
        throw invalid(field, 'date', `${field}: no such day`);
    }
    const filters: (SQL | undefined)[] = [
      query.outcome ? eq(phoneCalls.outcome, query.outcome) : undefined,
      query.answered === undefined ? undefined : eq(phoneCalls.answered, query.answered),
      query.from === undefined
        ? undefined
        : gte(phoneCalls.startedAt, businessInstant(`${query.from} 00:00:00`)),
      query.to === undefined
        ? undefined
        : lt(phoneCalls.startedAt, businessInstant(`${addDays(query.to, 1)} 00:00:00`)),
      query.hasOrder === undefined
        ? undefined
        : query.hasOrder
          ? isNotNull(phoneCalls.salesOrderId)
          : isNull(phoneCalls.salesOrderId),
      after === null ? undefined : lt(phoneCalls.id, after),
    ];
    const rows = await this.db
      .select({ call: phoneCalls, lineName: phoneLines.name })
      .from(phoneCalls)
      .innerJoin(phoneLines, eq(phoneLines.id, phoneCalls.lineId))
      .where(and(...filters))
      .orderBy(desc(phoneCalls.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.call.id }));
    const names = await this.names(page.data.map((row) => row.call.customerId));
    return {
      data: page.data.map((row) => callView(row.call, row.lineName, names)),
      nextCursor: page.nextCursor,
    };
  }

  /** One call with its whole transcript, in the order the turns were spoken. */
  async detail(id: number): Promise<{ call: PhoneCallView; messages: PhoneMessageView[] }> {
    const [row] = await this.db
      .select({ call: phoneCalls, lineName: phoneLines.name })
      .from(phoneCalls)
      .innerJoin(phoneLines, eq(phoneLines.id, phoneCalls.lineId))
      .where(eq(phoneCalls.id, id));
    if (!row) throw new PhoneError('PHONE_CALL_NOT_FOUND', `phone call ${id}`, { id });
    const names = await this.names([row.call.customerId]);
    const messages = await this.db
      .select()
      .from(phoneCallMessages)
      .where(eq(phoneCallMessages.callId, id))
      // A reconciled turn is appended at the end of the numbering but belongs where it was said.
      .orderBy(asc(phoneCallMessages.atMs), asc(phoneCallMessages.seq));
    return {
      call: callView(row.call, row.lineName, names),
      messages: messages.map((message) => ({
        seq: message.seq,
        role: message.role,
        text: message.text,
        atMs: message.atMs,
        meta: metaOf(message.meta),
        createdAt: message.createdAt,
      })),
    };
  }

  /** The callback tasks newest first, keyset by id; OPEN ones unless another status is asked. */
  async callbacks(query: {
    status?: PhoneCallbackStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: PhoneCallbackView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after = typeof cursor?.id === 'number' ? cursor.id : null;
    const rows = await this.db
      .select()
      .from(phoneCallbacks)
      .where(
        and(
          eq(phoneCallbacks.status, query.status ?? 'OPEN'),
          after === null ? undefined : lt(phoneCallbacks.id, after),
        ),
      )
      .orderBy(desc(phoneCallbacks.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const names = await this.names(page.data.map((row) => row.customerId));
    return {
      data: page.data.map((row) => callbackView(row, names)),
      nextCursor: page.nextCursor,
    };
  }

  /** A staff member rang back (DONE) or left the task (DROPPED); only an OPEN one closes. */
  async closeCallback(
    ctx: AuthContext,
    id: number,
    status: Exclude<PhoneCallbackStatus, 'OPEN'>,
  ): Promise<PhoneCallbackView> {
    const closed = await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(phoneCallbacks)
        .where(eq(phoneCallbacks.id, id))
        .for('update');
      if (!before) {
        throw new PhoneError('PHONE_CALLBACK_NOT_FOUND', `phone callback ${id}`, { id });
      }
      if (before.status !== 'OPEN') {
        throw new PhoneError('PHONE_CALLBACK_STATE', `phone callback ${id} is ${before.status}`, {
          id,
          status: before.status,
        });
      }
      const [after] = await tx
        .update(phoneCallbacks)
        .set({ status, doneBy: ctx.userId, doneAt: sql`now()` })
        .where(eq(phoneCallbacks.id, id))
        .returning();
      if (!after) throw new Error('phone callback not updated');
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'phone_callbacks',
        entityId: id,
        before: { status: before.status },
        after: { status },
      });
      return after;
    });
    return callbackView(closed, await this.names([closed.customerId]));
  }

  /**
   * «Олдоогүй хайлтууд» (ADR-0232 #6): what callers asked for and the catalog did not find,
   * newest first, so staff add product aliases. Keyset by call and sequence number.
   */
  async noHits(query: {
    cursor?: string;
    limit?: number;
  }): Promise<{ data: NoHitSearch[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = decodeCursor(query.cursor);
    const after =
      typeof cursor?.c === 'number' && typeof cursor.s === 'number'
        ? { callId: cursor.c, seq: cursor.s }
        : null;
    const rows = await this.db
      .select({
        callId: phoneCallMessages.callId,
        seq: phoneCallMessages.seq,
        query: sql<string | null>`${phoneCallMessages.meta} #>> '{args,query}'`,
        createdAt: phoneCallMessages.createdAt,
      })
      .from(phoneCallMessages)
      .where(
        and(
          eq(phoneCallMessages.role, 'TOOL'),
          sql`(${phoneCallMessages.meta} ->> 'no_hit') = 'true'`,
          after === null
            ? undefined
            : sql`(${phoneCallMessages.callId}, ${phoneCallMessages.seq}) < (${after.callId}, ${after.seq})`,
        ),
      )
      .orderBy(desc(phoneCallMessages.callId), desc(phoneCallMessages.seq))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ c: row.callId, s: row.seq }));
    return {
      data: page.data.map((row) => ({ ...row, query: row.query ?? '' })),
      nextCursor: page.nextCursor,
    };
  }

  private async names(ids: readonly (number | null)[]): Promise<Map<number, string>> {
    const known = [...new Set(ids.filter((id): id is number => id !== null))];
    return new Map((await this.customers.getMany(known)).map((row) => [row.id, row.name]));
  }
}

function callView(call: CallRow, lineName: string, names: Map<number, string>): PhoneCallView {
  return {
    id: call.id,
    lineId: call.lineId,
    lineName,
    callRef: call.callRef,
    callerPhone: call.callerPhone,
    callerRaw: call.callerRaw,
    customerId: call.customerId,
    customerName: call.customerId === null ? null : (names.get(call.customerId) ?? null),
    answered: call.answered,
    declineReason: call.declineReason,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    endReason: call.endReason,
    durationS: call.durationS,
    outcome: call.outcome,
    salesOrderId: call.salesOrderId,
    orderNumber: call.orderNumber,
    costEstimate: call.costEstimate,
    reconciled: call.reconciledAt !== null,
  };
}

function callbackView(row: CallbackRow, names: Map<number, string>): PhoneCallbackView {
  return {
    id: row.id,
    callId: row.callId,
    phone: row.phone,
    customerId: row.customerId,
    customerName: row.customerId === null ? null : (names.get(row.customerId) ?? null),
    reason: row.reason,
    status: row.status,
    doneBy: row.doneBy,
    doneAt: row.doneAt,
    createdAt: row.createdAt,
  };
}
