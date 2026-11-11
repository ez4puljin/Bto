import { Inject, Injectable } from '@nestjs/common';
import {
  checkRelayReceipt,
  DDTD_PATTERN,
  EbarimtBuildError,
  POSAPI_DATE_PATTERN,
  type ReceiptType,
  RELAY_STALE_MS,
  type RelayPayment,
  type RelayReceiptLine,
  type WholesaleBuyer,
  type WholesaleCancelStatus,
  type WholesaleErrorCode,
  type WholesaleReceiptStatus,
  wholesaleReceiptType,
} from '@tugeel/shared/mn';
import type { Decimal } from '@tugeel/shared/money';
import { businessInstant } from '@tugeel/shared/time';
import { and, desc, eq, ilike, isNotNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, actorUserId, AuditService, type AuthContext } from '../../identity';
import { ebarimtReceipts } from '../schema';
import { ReceiptSecretsCache, type ReceiptSecrets } from './receipt-secrets.cache';

export type ReceiptRow = typeof ebarimtReceipts.$inferSelect;

/** The source document a receipt belongs to (ADR-0074): `BO / BTO / SALES_INVOICE / <id> / 1`. */
export interface ReceiptSourceKey {
  companyCode: string;
  system: string;
  docType: string;
  docId: string;
}

/** A receipt request by value, as the caller built it from its own document (ADR-0074 #3). */
export interface PrepareRequest {
  source: ReceiptSourceKey;
  docNumber: string;
  orderNumber: string | null;
  buyerName: string;
  buyer: WholesaleBuyer;
  lines: RelayReceiptLine[];
  payments: RelayPayment[];
  total: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
}

export interface ReceiptView {
  id: number;
  sourceSystem: string;
  sourceDocType: string;
  sourceDocId: string;
  docNumber: string;
  orderNumber: string | null;
  buyerName: string;
  receiptType: ReceiptType;
  /** As a person sees it: a claim left unanswered for ten minutes reads INDETERMINATE. */
  status: WholesaleReceiptStatus;
  errorCode: WholesaleErrorCode | null;
  message: string | null;
  customerTin: string | null;
  consumerNo: string | null;
  total: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
  attempt: number;
  claimedAt: Date | null;
  claimedNodeCode: string | null;
  ddtd: string | null;
  posapiDate: string | null;
  issuedAt: Date | null;
  cancelStatus: WholesaleCancelStatus | null;
  cancelReason: string | null;
  cancelMessage: string | null;
  cancelledAt: Date | null;
  /** The lottery and QR are still in memory: the next print carries them. */
  printable: boolean;
  createdAt: Date;
}

export interface ReceiptDetail extends ReceiptView {
  lines: RelayReceiptLine[];
  payments: RelayPayment[];
  merchantTin: string | null;
  merchantName: string | null;
}

/** A receipt to print: with the secrets on its one print, else a copy («ХУУЛБАР»). */
export interface PrintableReceipt {
  receipt: ReceiptDetail;
  secrets: ReceiptSecrets | null;
  copy: boolean;
}

export interface ReceiptListQuery {
  status?: WholesaleReceiptStatus;
  /** Only receipts whose cancellation is still open (asked, not done). */
  cancelOpen?: boolean;
  type?: ReceiptType;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ReceiptAttention {
  pending: number;
  error: number;
  indeterminate: number;
  cancelOpen: number;
}

const t = ebarimtReceipts;
const STALE_SECONDS = RELAY_STALE_MS / 1_000;
/** A claim nobody answered within the limit: the receipt may or may not exist. */
export const staleIssue = sql`(${t.status} = 'SENDING' AND ${t.claimedAt} < now() - make_interval(secs => ${STALE_SECONDS}))`;
export const staleCancel = sql`(${t.cancelStatus} = 'SENDING' AND ${t.cancelClaimedAt} < now() - make_interval(secs => ${STALE_SECONDS}))`;
const effectiveStatus = sql<WholesaleReceiptStatus>`CASE WHEN ${staleIssue} THEN 'INDETERMINATE' ELSE ${t.status} END`;

/**
 * The wholesale e-Barimt receipts at the centre (ADR-0185, docs/modules/ebarimt.md). `prepareInTx`
 * writes a receipt request in its caller's transaction, keyed by the source document; the store
 * edge issues it (`EbarimtRelayService`); a person resolves what PosAPI left unanswered. A data
 * problem never throws out of `prepareInTx`: the row is written ERROR with its reason. The module
 * reads no business table: every fact arrives by value.
 */
@Injectable()
export class EbarimtReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly secrets: ReceiptSecretsCache,
  ) {}

  // ----------------------------------------------------------------- inside the caller's tx

  /**
   * Writes the receipt of a source document: PENDING for an edge to issue, or ERROR with the
   * reason when the buyer or a line cannot make a receipt (a company without a TIN, a VAT-free
   * line without its tax product code). A document whose receipt is ERROR is prepared again in
   * place; any other state refuses (409 `EBARIMT_RECEIPT_STATE_INVALID`).
   */
  async prepareInTx(
    tx: Tx,
    actor: Actor,
    request: PrepareRequest,
  ): Promise<{ id: number; status: WholesaleReceiptStatus }> {
    const plan = wholesaleReceiptType(request.buyer);
    let status: WholesaleReceiptStatus = 'PENDING';
    let errorCode: WholesaleErrorCode | null = null;
    let message: string | null = null;
    if (plan.tinPending) {
      status = 'ERROR';
      errorCode = 'TIN_PENDING';
      message = 'the company has no TIN yet';
    } else {
      try {
        const { total } = checkRelayReceipt({
          type: plan.type,
          customerTin: plan.customerTin,
          consumerNo: plan.consumerNo,
          lines: request.lines,
          payments: request.payments,
        });
        if (!total.eq(request.total)) {
          throw new EbarimtBuildError('PAYMENTS_MISMATCH', 'the lines do not make the total');
        }
      } catch (error) {
        if (!(error instanceof EbarimtBuildError)) throw error;
        status = 'ERROR';
        errorCode = error.code === 'DISTRICT_CODE_INVALID' ? 'EDGE_BUILD' : error.code;
        message = error.message.slice(0, 300);
      }
    }
    const values = {
      docNumber: request.docNumber,
      orderNumber: request.orderNumber,
      buyerName: request.buyerName.slice(0, 200),
      receiptType: plan.type,
      status,
      errorCode,
      message,
      customerTin: plan.customerTin,
      consumerNo: plan.consumerNo,
      lines: request.lines,
      payments: request.payments,
      total: request.total,
      vatTotal: request.vatTotal,
      cityTaxTotal: request.cityTaxTotal,
    };
    const existing = await this.bySourceInTx(tx, request.source, true);
    if (existing) {
      if (existing.status !== 'ERROR' || existing.cancelStatus !== null) {
        throw new AppError(
          'EBARIMT_RECEIPT_STATE_INVALID',
          `receipt ${existing.id} is ${existing.status}`,
          { status: existing.status },
        );
      }
      await tx
        .update(t)
        .set({ ...values, nextAttemptAt: null, updatedAt: sql`now()` })
        .where(eq(t.id, existing.id));
      await this.audit.record(tx, actor, {
        action: 'PREPARE_AGAIN',
        entity: 'ebarimt_receipts',
        entityId: existing.id,
        before: { status: existing.status, errorCode: existing.errorCode },
        after: { status, errorCode, type: plan.type, total: request.total.toFixed(2) },
      });
      return { id: existing.id, status };
    }
    const [row] = await tx
      .insert(t)
      .values({
        ...values,
        companyCode: request.source.companyCode,
        sourceSystem: request.source.system,
        sourceDocType: request.source.docType,
        sourceDocId: request.source.docId,
        createdBy: actorUserId(actor),
      })
      .returning({ id: t.id });
    if (!row) throw new Error('ebarimt_receipts insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'PREPARE',
      entity: 'ebarimt_receipts',
      entityId: row.id,
      after: {
        source: `${request.source.system}/${request.source.docType}/${request.source.docId}`,
        docNumber: request.docNumber,
        status,
        errorCode,
        type: plan.type,
        total: request.total.toFixed(2),
      },
    });
    return { id: row.id, status };
  }

  /**
   * The source document was voided: a receipt never issued is cancelled at once; one issued, or
   * one that may have been, gets a cancellation for the edge to relay once its ДДТД is known.
   * Answers the receipt's id, or null when the document has none.
   */
  async requestCancelInTx(
    tx: Tx,
    actor: Actor,
    source: ReceiptSourceKey,
    reason: string,
  ): Promise<number | null> {
    const row = await this.bySourceInTx(tx, source, true);
    if (!row || row.status === 'CANCELLED' || row.cancelStatus !== null) return row?.id ?? null;
    const neverIssued = row.status === 'PENDING' || row.status === 'ERROR';
    await tx
      .update(t)
      .set(
        neverIssued
          ? {
              status: 'CANCELLED',
              cancelStatus: 'DONE',
              cancelReason: reason.slice(0, 300),
              cancelRequestedAt: sql`now()`,
              cancelledAt: sql`now()`,
              cancelMessage: 'never issued',
              updatedAt: sql`now()`,
            }
          : {
              cancelStatus: 'PENDING',
              cancelReason: reason.slice(0, 300),
              cancelRequestedAt: sql`now()`,
              updatedAt: sql`now()`,
            },
      )
      .where(eq(t.id, row.id));
    await this.audit.record(tx, actor, {
      action: 'CANCEL_REQUEST',
      entity: 'ebarimt_receipts',
      entityId: row.id,
      before: { status: row.status, ddtd: row.ddtd },
      after: {
        status: neverIssued ? 'CANCELLED' : row.status,
        cancel: neverIssued ? 'DONE' : 'PENDING',
      },
    });
    if (neverIssued) this.secrets.forget(row.id);
    return row.id;
  }

  /** The latest receipt of a source document; locked when the caller will change it. */
  async bySourceInTx(
    executor: Db | Tx,
    source: ReceiptSourceKey,
    lock = false,
  ): Promise<ReceiptRow | null> {
    const query = executor
      .select()
      .from(t)
      .where(
        and(
          eq(t.companyCode, source.companyCode),
          eq(t.sourceSystem, source.system),
          eq(t.sourceDocType, source.docType),
          eq(t.sourceDocId, source.docId),
        ),
      )
      .orderBy(desc(t.sourceRevision))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    return row ?? null;
  }

  /** A source document's receipt for its own screen (an invoice's panel); null when it has none. */
  async stateOf(
    source: ReceiptSourceKey,
    executor: Db | Tx = this.db,
  ): Promise<ReceiptView | null> {
    const row = await this.bySourceInTx(executor, source);
    return row ? this.view(row) : null;
  }

  // ----------------------------------------------------------------- reads

  async list(query: ReceiptListQuery): Promise<{ data: ReceiptView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.status) filters.push(sql`${effectiveStatus} = ${query.status}`);
    if (query.cancelOpen) {
      filters.push(and(isNotNull(t.cancelStatus), sql`${t.cancelStatus} <> 'DONE'`) as SQL);
    }
    if (query.type) filters.push(eq(t.receiptType, query.type));
    const q = query.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      filters.push(
        or(
          ilike(t.docNumber, like),
          ilike(t.orderNumber, like),
          ilike(t.buyerName, like),
          ilike(t.ddtd, like),
          ilike(t.customerTin, like),
        ) as SQL,
      );
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      const before = typeof cursor.id === 'number' ? cursor.id : Number.NaN;
      if (!Number.isSafeInteger(before)) throw invalid('cursor', 'isCursor', 'cursor is not valid');
      filters.push(lt(t.id, before));
    }
    const rows = await this.db
      .select()
      .from(t)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(t.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: page.data.map((row) => this.view(row)), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<ReceiptDetail> {
    const [row] = await this.db.select().from(t).where(eq(t.id, id));
    if (!row) throw notFound('ebarimt_receipt', id);
    return this.detail(row);
  }

  /** What waits for a person: receipts to fix or to look up, cancellations not through. */
  async attention(): Promise<ReceiptAttention> {
    const [row] = await this.db
      .select({
        pending: sql<string>`count(*) FILTER (WHERE ${t.status} = 'PENDING' OR (${t.status} = 'SENDING' AND NOT ${staleIssue}))`,
        error: sql<string>`count(*) FILTER (WHERE ${t.status} = 'ERROR')`,
        indeterminate: sql<string>`count(*) FILTER (WHERE ${t.status} = 'INDETERMINATE' OR ${staleIssue})`,
        cancelOpen: sql<string>`count(*) FILTER (WHERE ${t.cancelStatus} IS NOT NULL AND ${t.cancelStatus} <> 'DONE')`,
      })
      .from(t);
    const int = (value: string | undefined) => Number.parseInt(value ?? '0', 10);
    return {
      pending: int(row?.pending),
      error: int(row?.error),
      indeterminate: int(row?.indeterminate),
      cancelOpen: int(row?.cancelOpen),
    };
  }

  /**
   * The receipt for printing (`finance.read`): the lottery and QR data on the one print while the
   * api still holds them, a copy otherwise. Only a CONFIRMED receipt prints.
   */
  async printable(id: number): Promise<PrintableReceipt> {
    const receipt = await this.get(id);
    if (receipt.status !== 'CONFIRMED') {
      throw new AppError('EBARIMT_RECEIPT_STATE_INVALID', `receipt ${id} is ${receipt.status}`, {
        status: receipt.status,
      });
    }
    let merchantTin = receipt.merchantTin;
    let merchantName = receipt.merchantName;
    if (!merchantTin) {
      // Typed in by the accountant: the seller is the one every other receipt names.
      const [known] = await this.db
        .select({ tin: t.merchantTin, name: t.merchantName })
        .from(t)
        .where(isNotNull(t.merchantTin))
        .orderBy(desc(t.id))
        .limit(1);
      merchantTin = known?.tin ?? null;
      merchantName = known?.name ?? null;
    }
    const secrets = this.secrets.take(id);
    return {
      receipt: { ...receipt, merchantTin, merchantName, printable: false },
      secrets,
      copy: secrets === null,
    };
  }

  // ----------------------------------------------------------------- a person's decisions

  /**
   * An INDETERMINATE receipt looked up on ebarimt.mn (`finance.invoices.manage`): ISSUED with the
   * ДДТД and date shown there, or NOT_ISSUED — it waits for an edge again (cancelled instead when
   * its document was voided meanwhile). Never an automatic re-send (ADR-0017).
   */
  async resolve(
    ctx: AuthContext,
    id: number,
    input: { outcome: 'ISSUED' | 'NOT_ISSUED'; ddtd?: string | null; posapiDate?: string | null },
  ): Promise<ReceiptDetail> {
    if (input.outcome === 'ISSUED') {
      if (!DDTD_PATTERN.test(input.ddtd ?? '')) {
        throw invalid('ddtd', 'matches', 'the ДДТД as ebarimt.mn shows it');
      }
      if (!POSAPI_DATE_PATTERN.test(input.posapiDate ?? '')) {
        throw invalid('posapiDate', 'matches', 'the date as yyyy-MM-dd HH:mm:ss');
      }
    }
    await inTransaction(this.db, async (tx) => {
      await this.sweepInTx(tx, id);
      const [row] = await tx.select().from(t).where(eq(t.id, id)).for('update');
      if (!row) throw notFound('ebarimt_receipt', id);
      if (row.status !== 'INDETERMINATE') {
        throw new AppError('EBARIMT_RECEIPT_STATE_INVALID', `receipt ${id} is ${row.status}`, {
          status: row.status,
        });
      }
      const who = { resolvedBy: ctx.userId, resolvedAt: sql`now()`, updatedAt: sql`now()` };
      let after: WholesaleReceiptStatus;
      if (input.outcome === 'ISSUED') {
        after = 'CONFIRMED';
        await tx
          .update(t)
          .set({
            ...who,
            status: 'CONFIRMED',
            ddtd: input.ddtd,
            posapiDate: input.posapiDate,
            issuedAt: businessInstant(input.posapiDate ?? ''),
            errorCode: null,
            message: null,
          })
          .where(eq(t.id, id));
      } else if (row.cancelStatus !== null) {
        after = 'CANCELLED';
        await tx
          .update(t)
          .set({
            ...who,
            status: 'CANCELLED',
            cancelStatus: 'DONE',
            cancelledAt: sql`now()`,
            cancelMessage: 'never issued',
            message: null,
          })
          .where(eq(t.id, id));
      } else {
        after = 'PENDING';
        await tx
          .update(t)
          .set({ ...who, status: 'PENDING', nextAttemptAt: null, message: null })
          .where(eq(t.id, id));
      }
      await this.audit.record(tx, ctx, {
        action: 'RESOLVE',
        entity: 'ebarimt_receipts',
        entityId: id,
        before: { status: 'INDETERMINATE', attempt: row.attempt },
        after: { status: after, outcome: input.outcome, ddtd: input.ddtd ?? null },
      });
    });
    return this.get(id);
  }

  /**
   * A cancellation PosAPI refused or left unanswered (`finance.invoices.manage`): RETRY hands it to
   * an edge again (a `DELETE` never makes a receipt, so repeating it is safe); CANCELLED records
   * that ebarimt.mn already shows the receipt as cancelled.
   */
  async resolveCancel(
    ctx: AuthContext,
    id: number,
    outcome: 'RETRY' | 'CANCELLED',
  ): Promise<ReceiptDetail> {
    await inTransaction(this.db, async (tx) => {
      await this.sweepInTx(tx, id);
      const [row] = await tx.select().from(t).where(eq(t.id, id)).for('update');
      if (!row) throw notFound('ebarimt_receipt', id);
      if (row.cancelStatus !== 'ERROR' && row.cancelStatus !== 'INDETERMINATE') {
        throw new AppError(
          'EBARIMT_RECEIPT_STATE_INVALID',
          `receipt ${id} cancellation is ${row.cancelStatus ?? 'not asked'}`,
          { status: row.cancelStatus ?? row.status },
        );
      }
      await tx
        .update(t)
        .set(
          outcome === 'RETRY'
            ? {
                cancelStatus: 'PENDING',
                cancelNextAttemptAt: null,
                cancelMessage: null,
                updatedAt: sql`now()`,
              }
            : {
                status: 'CANCELLED',
                cancelStatus: 'DONE',
                cancelledAt: sql`now()`,
                cancelMessage: 'recorded by hand',
                updatedAt: sql`now()`,
              },
        )
        .where(eq(t.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CANCEL_RESOLVE',
        entity: 'ebarimt_receipts',
        entityId: id,
        before: { status: row.status, cancel: row.cancelStatus },
        after: { outcome },
      });
      if (outcome === 'CANCELLED') this.secrets.forget(id);
    });
    return this.get(id);
  }

  // ----------------------------------------------------------------- shared with the relay

  /**
   * Claims no edge answered within ten minutes become INDETERMINATE (issue and cancel alike): the
   * call may have reached PosAPI. One receipt, or every one. Audited as the system.
   */
  async sweepInTx(tx: Tx, id?: number): Promise<number> {
    const one = id === undefined ? undefined : eq(t.id, id);
    const issues = await tx
      .update(t)
      .set({
        status: 'INDETERMINATE',
        message: 'no answer from the store edge within ten minutes',
        updatedAt: sql`now()`,
      })
      .where(and(staleIssue, one))
      .returning({ id: t.id, attempt: t.attempt });
    const cancels = await tx
      .update(t)
      .set({
        cancelStatus: 'INDETERMINATE',
        cancelMessage: 'no answer from the store edge within ten minutes',
        updatedAt: sql`now()`,
      })
      .where(and(staleCancel, one))
      .returning({ id: t.id, attempt: t.cancelAttempt });
    const system: Actor = { kind: 'SYSTEM', label: 'ebarimt:sweep' };
    for (const row of issues) {
      await this.audit.record(tx, system, {
        action: 'RESULT',
        entity: 'ebarimt_receipts',
        entityId: row.id,
        before: { status: 'SENDING', attempt: row.attempt },
        after: { status: 'INDETERMINATE', reason: 'STALE' },
      });
    }
    for (const row of cancels) {
      await this.audit.record(tx, system, {
        action: 'CANCEL_RESULT',
        entity: 'ebarimt_receipts',
        entityId: row.id,
        before: { cancel: 'SENDING', attempt: row.attempt },
        after: { cancel: 'INDETERMINATE', reason: 'STALE' },
      });
    }
    return issues.length + cancels.length;
  }

  view(row: ReceiptRow): ReceiptView {
    const staleAt = Date.now() - RELAY_STALE_MS;
    const stale = (status: string | null, claimedAt: Date | null) =>
      status === 'SENDING' && claimedAt !== null && claimedAt.getTime() < staleAt;
    const status = stale(row.status, row.claimedAt) ? 'INDETERMINATE' : row.status;
    const cancelStatus = stale(row.cancelStatus, row.cancelClaimedAt)
      ? 'INDETERMINATE'
      : row.cancelStatus;
    return {
      id: row.id,
      sourceSystem: row.sourceSystem,
      sourceDocType: row.sourceDocType,
      sourceDocId: row.sourceDocId,
      docNumber: row.docNumber,
      orderNumber: row.orderNumber,
      buyerName: row.buyerName,
      receiptType: row.receiptType,
      status,
      errorCode: row.errorCode as WholesaleErrorCode | null,
      message: row.message,
      customerTin: row.customerTin,
      consumerNo: row.consumerNo,
      total: row.total,
      vatTotal: row.vatTotal,
      cityTaxTotal: row.cityTaxTotal,
      attempt: row.attempt,
      claimedAt: row.claimedAt,
      claimedNodeCode: row.claimedNodeCode,
      ddtd: row.ddtd,
      posapiDate: row.posapiDate,
      issuedAt: row.issuedAt,
      cancelStatus,
      cancelReason: row.cancelReason,
      cancelMessage: row.cancelMessage,
      cancelledAt: row.cancelledAt,
      printable: status === 'CONFIRMED' && this.secrets.has(row.id),
      createdAt: row.createdAt,
    };
  }

  private detail(row: ReceiptRow): ReceiptDetail {
    return {
      ...this.view(row),
      lines: row.lines,
      payments: row.payments,
      merchantTin: row.merchantTin,
      merchantName: row.merchantName,
    };
  }
}
