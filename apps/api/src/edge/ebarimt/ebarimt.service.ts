import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { classifyBarcode } from '@tugeel/shared/gtin';
import {
  buildPosapiReceipt,
  DDTD_PATTERN,
  EbarimtBuildError,
  type EbarimtPaymentCode,
  type EbarimtStatus,
  POSAPI_DATE_PATTERN,
  VOUCHER_PAYMENT_CODE,
} from '@tugeel/shared/mn';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeEbarimtItem,
  EdgeEbarimtQueue,
  EdgeEbarimtSummary,
  EdgePrintableReceipt,
  EdgeReceiptEbarimt,
  PosapiInfoWire,
  ReceiptType,
  SaleDocWire,
} from '@tugeel/shared/pos';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AppError, notFound } from '../../common/errors/app-error';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import {
  type EdgeReceiptLine,
  type EdgeReceiptStatus,
  edgeReceipts,
  edgeSales,
  edgeState,
} from '../db/schema';
import { OutboxService } from '../services/outbox.service';
import type { LoadedSnapshot } from '../services/snapshot.store';
import { SnapshotStore } from '../services/snapshot.store';
import { PosapiClient } from './posapi.client';
import { PrintableCache } from './printable.cache';

type ReceiptRow = typeof edgeReceipts.$inferSelect;
type SaleRow = typeof edgeSales.$inferSelect;

/** The loop takes this many operations at a time, oldest first. */
const BATCH = 20;
/** A refused receipt is tried again for a day (lotteries running out, the 3-day window). */
const ERROR_RETRY_MS = 24 * 3_600_000;
const MAX_BACKOFF_MS = 30 * 60_000;
/** Waiting longer than this for PosAPI counts as needing a look. */
const STALE_MS = 60_000;

/** What a sale gives its receipt: the lines as sold, the payments, the buyer. */
export interface IssueInput {
  ownerClientId: string;
  tillCode: string;
  receiptType: ReceiptType;
  customerTin: string | null;
  customerName: string | null;
  lines: EdgeReceiptLine[];
  cash: Decimal;
  card: Decimal;
  /** ADR-0111: a bank transfer at the till (`BANK_TRANSFER`). */
  transfer: Decimal;
  /** ADR-0110: what partner vouchers paid, sent under VOUCHER_PAYMENT_CODE. */
  voucher?: Decimal;
  total: Decimal;
  vatTotal: Decimal;
}

/**
 * The store PosAPI on the edge (ADR-0065). The sale's transaction queues its receipt; right after
 * the commit the till waits for one try; what is left — PosAPI away, a refusal — the loop tries
 * again in order. Never an HTTP call inside a transaction; an operation is claimed (SENDING)
 * before its call so two callers never send it twice; an ISSUE that may have reached PosAPI and
 * went unanswered (INDETERMINATE) is never sent again until a supervisor has looked it up.
 * The facts PosAPI answered go on the sale's receipt and to the centre (`RECEIPT_STATUS`); the
 * lottery and the QR data only to the printable cache.
 */
@Injectable()
export class EbarimtService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EbarimtService.name);
  private merchant: { tin: string; name: string; posNo: string | null } | null = null;
  private running: Promise<number> | null = null;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly config: EdgeConfig,
    private readonly posapi: PosapiClient,
    private readonly cache: PrintableCache,
    private readonly outbox: OutboxService,
    private readonly store: SnapshotStore,
  ) {}

  get enabled(): boolean {
    return this.config.get('EBARIMT_PROVIDER') === 'posapi';
  }

  /** A call cut short by a restart may have reached PosAPI: an ISSUE waits for a supervisor. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.db
      .update(edgeReceipts)
      .set({ status: 'INDETERMINATE', message: 'the edge restarted during the call' })
      .where(and(eq(edgeReceipts.status, 'SENDING'), eq(edgeReceipts.op, 'ISSUE')));
    await this.db
      .update(edgeReceipts)
      .set({ status: 'PENDING' })
      .where(and(eq(edgeReceipts.status, 'SENDING'), eq(edgeReceipts.op, 'CANCEL')));
  }

  // ------------------------------------------------------------- building (inside a sale's tx)

  /** The receipt's lines from the sale's document and the snapshot it was priced from. */
  linesOf(doc: SaleDocWire, loaded: LoadedSnapshot): EdgeReceiptLine[] {
    const fallback = loaded.snapshot.settings.ebarimtClassificationCode ?? null;
    return doc.lines.map((line) => {
      const found = loaded.units.get(line.productUnitId);
      const printed = found?.unit.codes?.[0] ?? null;
      const classified = printed ? classifyBarcode(printed) : null;
      const product = found?.product;
      return {
        name: product?.name ?? `#${line.productId}`,
        barCode: classified?.ok ? classified.value.code : null,
        barCodeType: classified?.ok ? classified.value.barcodeType : 'UNDEFINED',
        classificationCode: product?.classificationCode ?? fallback,
        taxType: product?.vatType ?? (new Decimal(line.vatRatePct).gt(0) ? 'VAT_ABLE' : 'VAT_FREE'),
        taxProductCode: product?.taxProductCode ?? null,
        measureUnit: found?.unit.uomName ?? '',
        qty: line.qty,
        total: line.total,
        vat: line.vatAmount,
      };
    });
  }

  /** The facts a new sale's receipt starts with. */
  pendingFacts(type: ReceiptType, tin: string | null, name: string | null): EdgeReceiptEbarimt {
    return {
      mode: 'REAL',
      ddtd: null,
      status: 'PENDING',
      posapiDate: null,
      receiptType: type,
      customerTin: tin,
      customerName: name,
      merchantTin: this.merchant?.tin ?? null,
      merchantName: this.merchant?.name ?? null,
      inactiveId: null,
      message: null,
    };
  }

  /** Queues a sale's receipt in the sale's own transaction. */
  async enqueueSale(tx: EdgeTx, input: IssueInput): Promise<void> {
    await tx.insert(edgeReceipts).values({
      op: 'ISSUE',
      ownerClientId: input.ownerClientId,
      chainClientId: input.ownerClientId,
      tillCode: input.tillCode,
      receiptType: input.receiptType,
      customerTin: input.customerTin,
      customerName: input.customerName,
      lines: input.lines,
      payments: payments(input.cash, input.card, input.transfer, input.voucher),
      total: input.total,
      vatTotal: input.vatTotal,
    });
  }

  /**
   * Queues what a return does to its sale's receipt, in the return's transaction after its row:
   * nothing left of the sale → cancel the receipt in force; something left → a new receipt for what
   * the customer keeps, replacing it (`inactiveId`). A sale made before the provider was PosAPI has
   * no receipt to change.
   */
  async enqueueReturn(tx: EdgeTx, ret: { clientId: string; tillCode: string }, sale: SaleRow) {
    const ops = await tx
      .select()
      .from(edgeReceipts)
      .where(and(eq(edgeReceipts.chainClientId, sale.clientId), eq(edgeReceipts.op, 'ISSUE')))
      .orderBy(desc(edgeReceipts.id));
    const latest = ops[0];
    const first = ops[ops.length - 1];
    if (!latest || !first?.lines) return;
    const returns = await tx
      .select({ doc: edgeSales.doc })
      .from(edgeSales)
      .where(and(eq(edgeSales.refundsClientId, sale.clientId), eq(edgeSales.kind, 'RETURN')));
    const back = new Map<number, { qty: Decimal; total: Decimal; vat: Decimal }>();
    for (const row of returns) {
      for (const line of row.doc.lines) {
        if (line.refundsLineNo === null) continue;
        const was = back.get(line.refundsLineNo) ?? zeroes();
        back.set(line.refundsLineNo, {
          qty: was.qty.plus(line.qty),
          total: was.total.plus(line.total),
          vat: was.vat.plus(line.vatAmount),
        });
      }
    }
    const kept: EdgeReceiptLine[] = [];
    sale.doc.lines.forEach((sold, index) => {
      const line = first.lines?.[index];
      if (!line) return;
      const gone = back.get(sold.lineNo) ?? zeroes();
      const qty = new Decimal(sold.qty).minus(gone.qty);
      if (qty.lte(0)) return;
      kept.push({
        ...line,
        qty: qty.toFixed(3),
        total: new Decimal(sold.total).minus(gone.total).toFixed(2),
        vat: new Decimal(sold.vatAmount).minus(gone.vat).toFixed(2),
      });
    });
    const common = {
      ownerClientId: ret.clientId,
      chainClientId: sale.clientId,
      targetClientId: latest.ownerClientId,
      tillCode: ret.tillCode,
      receiptType: first.receiptType,
      customerTin: first.customerTin,
      customerName: first.customerName,
    };
    if (kept.length === 0) {
      await tx.insert(edgeReceipts).values({
        ...common,
        op: 'CANCEL',
        total: new Decimal(latest.total),
        vatTotal: new Decimal(latest.vatTotal),
      });
      return;
    }
    const total = kept.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
    const vat = kept.reduce((sum, line) => sum.plus(line.vat), new Decimal(0));
    // The card and transfer parts are kept up to the new total, the rest is cash.
    const paidBy = (code: EbarimtPaymentCode) =>
      new Decimal(first.payments?.find((payment) => payment.code === code)?.amount ?? 0);
    const card = Decimal.min(paidBy('PAYMENT_CARD'), total);
    const transfer = Decimal.min(paidBy('BANK_TRANSFER'), total.minus(card));
    await tx.insert(edgeReceipts).values({
      ...common,
      op: 'ISSUE',
      lines: kept,
      payments: payments(total.minus(card).minus(transfer), card, transfer),
      total,
      vatTotal: vat,
    });
  }

  // ------------------------------------------------------------- sending

  /**
   * Right after a sale's (or a return's) commit: one try of its operations while the cashier
   * waits; what is not done is late from now on and left to the loop. Answers the receipt to print.
   */
  async afterCommit(tillCode: string, ownerClientId: string): Promise<EdgePrintableReceipt> {
    if (this.enabled) {
      this.cache.newSale(tillCode);
      const ops = await this.db
        .select()
        .from(edgeReceipts)
        .where(eq(edgeReceipts.ownerClientId, ownerClientId))
        .orderBy(asc(edgeReceipts.id));
      for (const op of ops) {
        if (op.status !== 'PENDING') continue;
        const done = await this.process(op, 'now');
        if (!done) {
          await this.db.update(edgeReceipts).set({ late: true }).where(eq(edgeReceipts.id, op.id));
        }
      }
    }
    return this.printable(tillCode, ownerClientId);
  }

  /** The receipt as stored, with the secrets while this process still holds them. */
  async printable(tillCode: string, clientId: string): Promise<EdgePrintableReceipt> {
    const [row] = await this.db
      .select({ receipt: edgeSales.receipt })
      .from(edgeSales)
      .where(eq(edgeSales.clientId, clientId));
    if (!row) throw notFound('edge_sale', 0);
    const print = this.enabled ? this.cache.take(tillCode, clientId) : null;
    const real = row.receipt.ebarimt.mode === 'REAL' && row.receipt.ebarimt.ddtd !== null;
    return { receipt: row.receipt, print, copy: real && print === null };
  }

  /** The loop's step: due operations in order, one run at a time. Answers how many it tried. */
  runDue(): Promise<number> {
    if (!this.enabled) return Promise.resolve(0);
    if (!this.running) {
      this.running = this.due().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async due(): Promise<number> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(edgeReceipts)
      .where(
        or(
          and(
            eq(edgeReceipts.status, 'PENDING'),
            or(isNull(edgeReceipts.nextAttemptAt), lte(edgeReceipts.nextAttemptAt, now)),
          ),
          and(
            eq(edgeReceipts.status, 'ERROR'),
            or(isNull(edgeReceipts.nextAttemptAt), lte(edgeReceipts.nextAttemptAt, now)),
            gte(edgeReceipts.createdAt, new Date(now.getTime() - ERROR_RETRY_MS)),
          ),
        ),
      )
      .orderBy(asc(edgeReceipts.id))
      .limit(BATCH);
    for (const op of rows) await this.process(op, 'late');
    return rows.length;
  }

  /** One operation: its dependency, the claim, the call, the result. True when it is done. */
  private async process(op: ReceiptRow, when: 'now' | 'late'): Promise<boolean> {
    const target = op.targetClientId ? await this.issued(op.targetClientId) : null;
    if (target?.state === 'waiting') {
      await this.note(op.id, 'waits for the receipt it changes');
      return false;
    }
    if (op.op === 'CANCEL' && target?.state !== 'issued') {
      // The receipt it would cancel was never issued: nothing to tell PosAPI.
      await this.settle(op, { status: 'DONE', message: 'nothing was issued to cancel' });
      return true;
    }
    let request: ReturnType<typeof buildPosapiReceipt> | null = null;
    if (op.op === 'ISSUE') {
      const merchant = await this.merchantOrNull();
      if (!merchant) {
        await this.retryLater(op, 'PENDING', 'PosAPI did not name its merchant (GET /rest/info)');
        return false;
      }
      try {
        request = buildPosapiReceipt({
          type: op.receiptType,
          merchantTin: merchant.tin,
          districtCode: this.store.peek()?.snapshot.settings.ebarimtDistrictCode ?? '',
          branchNo: this.config.get('EBARIMT_BRANCH_NO') ?? null,
          posNo: merchant.posNo,
          customerTin: op.customerTin,
          consumerNo: null,
          inactiveId: target?.state === 'issued' ? target.ddtd : null,
          lines: (op.lines ?? []).map((line) => ({
            ...line,
            classificationCode: line.classificationCode ?? '',
            cityTax: '0',
          })),
          payments: (op.payments ?? []).map((payment) => ({
            code: payment.code,
            amount: payment.amount,
          })),
        });
      } catch (error) {
        if (!(error instanceof EbarimtBuildError)) throw error;
        await this.retryLater(op, 'ERROR', `${error.code}: ${error.message}`);
        return false;
      }
    }
    const [claimed] = await this.db
      .update(edgeReceipts)
      .set({ status: 'SENDING', attempts: sql`${edgeReceipts.attempts} + 1` })
      .where(and(eq(edgeReceipts.id, op.id), inArray(edgeReceipts.status, ['PENDING', 'ERROR'])))
      .returning();
    if (!claimed) return false;
    if (request) {
      const result = await this.posapi.issue(request);
      switch (result.kind) {
        case 'ISSUED':
          await this.settle(claimed, {
            status: 'DONE',
            ddtd: result.ddtd,
            posapiDate: result.posapiDate,
            inactiveId: request.inactiveId,
            message: null,
          });
          if (when === 'now')
            this.cache.rememberLast(op.tillCode, op.ownerClientId, result.secrets);
          else this.cache.rememberLate(op.tillCode, op.ownerClientId, result.secrets);
          return true;
        case 'REFUSED':
          await this.retryLater(claimed, 'ERROR', result.message);
          return false;
        case 'NOT_SENT':
          await this.retryLater(claimed, 'PENDING', result.error);
          return false;
        case 'INDETERMINATE':
          this.logger.warn({ op: op.id }, 'a receipt went unanswered; a supervisor checks it');
          await this.settle(claimed, { status: 'INDETERMINATE', message: result.error });
          return false;
      }
    }
    if (!target || target.state !== 'issued') return false;
    // A cancellation can be sent again safely: it never makes a receipt.
    const result = await this.posapi.cancel(target.ddtd, target.posapiDate);
    switch (result.kind) {
      case 'CANCELLED':
        await this.settle(claimed, { status: 'DONE', inactiveId: target.ddtd, message: null });
        return true;
      case 'REFUSED':
        await this.retryLater(claimed, 'ERROR', result.message);
        return false;
      case 'NOT_SENT':
      case 'INDETERMINATE':
        await this.retryLater(claimed, 'PENDING', result.error);
        return false;
    }
  }

  /** The receipt in force of a sale or a return: issued, never issued, or not known yet. */
  private async issued(
    clientId: string,
  ): Promise<
    { state: 'issued'; ddtd: string; posapiDate: string } | { state: 'none' } | { state: 'waiting' }
  > {
    const ops = await this.db
      .select()
      .from(edgeReceipts)
      .where(and(eq(edgeReceipts.ownerClientId, clientId), eq(edgeReceipts.op, 'ISSUE')))
      .orderBy(desc(edgeReceipts.id));
    const live = ops.find((op) => op.status !== 'ABANDONED');
    if (!live) return { state: 'none' };
    if (live.status === 'DONE' && live.ddtd && live.posapiDate) {
      return { state: 'issued', ddtd: live.ddtd, posapiDate: live.posapiDate };
    }
    return { state: 'waiting' };
  }

  private async note(id: number, message: string): Promise<void> {
    await this.db
      .update(edgeReceipts)
      .set({ message, nextAttemptAt: new Date(Date.now() + 5_000) })
      .where(and(eq(edgeReceipts.id, id), eq(edgeReceipts.status, 'PENDING')));
  }

  private async retryLater(
    op: ReceiptRow,
    status: 'PENDING' | 'ERROR',
    message: string,
  ): Promise<void> {
    const wait = Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.min(op.attempts, 10));
    await this.settle(op, {
      status,
      message: message.slice(0, 300),
      nextAttemptAt: new Date(Date.now() + wait),
    });
  }

  /** An operation's new state, its sale's receipt facts, and the centre told, in one transaction. */
  private async settle(
    op: ReceiptRow,
    change: {
      status: EdgeReceiptStatus;
      ddtd?: string | null;
      posapiDate?: string | null;
      inactiveId?: string | null;
      message?: string | null;
      nextAttemptAt?: Date | null;
      resolvedByUserId?: number | null;
    },
  ): Promise<void> {
    await inEdgeTransaction(this.db, async (tx) => {
      const final = change.status === 'DONE' || change.status === 'ABANDONED';
      await tx
        .update(edgeReceipts)
        .set({ ...change, ...(final ? { settledAt: new Date() } : {}) })
        .where(eq(edgeReceipts.id, op.id));
      const owners = [op.ownerClientId, ...(op.targetClientId ? [op.targetClientId] : [])];
      for (const clientId of owners) await this.refreshFacts(tx, clientId);
    });
  }

  /**
   * A sale's (or a return's) receipt facts from its operations, kept on its receipt; when they
   * change for a row with a receipt of its own, the centre hears it (`RECEIPT_STATUS`).
   */
  private async refreshFacts(tx: EdgeTx, clientId: string): Promise<void> {
    const [sale] = await tx
      .select()
      .from(edgeSales)
      .where(eq(edgeSales.clientId, clientId))
      .for('update');
    if (!sale) return;
    const own = await tx
      .select()
      .from(edgeReceipts)
      .where(eq(edgeReceipts.ownerClientId, clientId))
      .orderBy(desc(edgeReceipts.id));
    const [replaced] = await tx
      .select({ id: edgeReceipts.id })
      .from(edgeReceipts)
      .where(and(eq(edgeReceipts.targetClientId, clientId), eq(edgeReceipts.status, 'DONE')))
      .limit(1);
    const issue = own.find((op) => op.op === 'ISSUE' && op.status !== 'ABANDONED');
    const cancel = own.find((op) => op.op === 'CANCEL');
    const shown = issue ?? cancel;
    if (!shown) return;
    let status: EbarimtStatus = statusOf(shown.status);
    if (shown.op === 'CANCEL' && shown.status === 'DONE') status = 'CANCELLED';
    if (issue && replaced) status = 'CANCELLED';
    const before = sale.receipt.ebarimt;
    const facts: EdgeReceiptEbarimt = {
      ...before,
      mode: 'REAL',
      status,
      ddtd: issue?.ddtd ?? null,
      posapiDate: issue?.posapiDate ?? null,
      inactiveId: issue ? issue.inactiveId : (cancel?.inactiveId ?? null),
      receiptType: shown.receiptType,
      customerTin: shown.customerTin,
      customerName: shown.customerName,
      merchantTin: before.merchantTin ?? this.merchant?.tin ?? null,
      merchantName: before.merchantName ?? this.merchant?.name ?? null,
      message: shown.status === 'DONE' ? null : shown.message,
    };
    await tx
      .update(edgeSales)
      .set({ receipt: { ...sale.receipt, ebarimt: facts } })
      .where(eq(edgeSales.clientId, clientId));
    const changed =
      before.status !== facts.status ||
      before.ddtd !== facts.ddtd ||
      (before.inactiveId ?? null) !== facts.inactiveId;
    // A full return has no receipt of its own: the centre hears of the sale's cancellation.
    if (!issue || !changed) return;
    const eventId = randomUUID();
    await this.outbox.enqueue(tx, {
      kind: 'RECEIPT_STATUS',
      clientId: eventId,
      receiptStatus: {
        saleClientId: clientId,
        ebarimt: {
          status: facts.status ?? 'PENDING',
          ddtd: facts.ddtd,
          posapiDate: facts.posapiDate ?? null,
          billIdSuffix: null,
          inactiveId: facts.inactiveId ?? null,
        },
      },
    });
  }

  // ------------------------------------------------------------- the supervisor

  /**
   * A supervisor's decision on a receipt left to be checked (or refused): ISSUED with the ДДТД and
   * date ebarimt.mn shows, or NOT_ISSUED — the operation is abandoned and a new one queued.
   */
  async resolve(
    id: number,
    outcome: 'ISSUED' | 'NOT_ISSUED',
    found: { ddtd: string | null; posapiDate: string | null },
    approverUserId: number | null,
  ): Promise<void> {
    const [op] = await this.db.select().from(edgeReceipts).where(eq(edgeReceipts.id, id));
    if (!op) throw notFound('edge_receipt', id);
    const open = op.status === 'INDETERMINATE' || op.status === 'ERROR';
    if (!open || (outcome === 'ISSUED' && op.op !== 'ISSUE')) {
      throw new AppError('EBARIMT_RECEIPT_STATE_INVALID', `receipt ${id} is ${op.status}`, {
        status: op.status,
      });
    }
    if (outcome === 'ISSUED') {
      if (!DDTD_PATTERN.test(found.ddtd ?? '')) {
        throw new AppError('VALIDATION_FAILED', 'the ДДТД as ebarimt.mn shows it', {
          field: 'ddtd',
        });
      }
      if (!POSAPI_DATE_PATTERN.test(found.posapiDate ?? '')) {
        throw new AppError('VALIDATION_FAILED', 'the date as yyyy-MM-dd HH:mm:ss', {
          field: 'posapiDate',
        });
      }
      await this.settle(op, {
        status: 'DONE',
        ddtd: found.ddtd,
        posapiDate: found.posapiDate,
        message: null,
        resolvedByUserId: approverUserId,
      });
      return;
    }
    await inEdgeTransaction(this.db, async (tx) => {
      const [abandoned] = await tx
        .update(edgeReceipts)
        .set({
          status: 'ABANDONED',
          settledAt: new Date(),
          resolvedByUserId: approverUserId,
          message: 'not issued (checked by a supervisor)',
        })
        .where(
          and(eq(edgeReceipts.id, id), inArray(edgeReceipts.status, ['INDETERMINATE', 'ERROR'])),
        )
        .returning();
      if (!abandoned) {
        throw new AppError('EBARIMT_RECEIPT_STATE_INVALID', `receipt ${id} changed`, {
          status: op.status,
        });
      }
      await tx.insert(edgeReceipts).values({
        op: op.op,
        ownerClientId: op.ownerClientId,
        chainClientId: op.chainClientId,
        targetClientId: op.targetClientId,
        tillCode: op.tillCode,
        receiptType: op.receiptType,
        customerTin: op.customerTin,
        customerName: op.customerName,
        lines: op.lines,
        payments: op.payments,
        total: new Decimal(op.total),
        vatTotal: new Decimal(op.vatTotal),
        late: true,
      });
      await this.refreshFacts(tx, op.ownerClientId);
    });
  }

  /** «Татвар руу илгээх»: PosAPI sends its stored receipts now; answers its facts after. */
  async sendData(): Promise<PosapiInfoWire> {
    try {
      await this.posapi.sendData();
    } catch (error) {
      throw new AppError('EBARIMT_POSAPI_UNAVAILABLE', 'PosAPI did not send', {
        reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
    return this.refreshInfo();
  }

  // ------------------------------------------------------------- PosAPI's own facts

  /** `GET /rest/info` into the state row (the heartbeat carries it to the centre). */
  async refreshInfo(): Promise<PosapiInfoWire> {
    const checkedAt = new Date();
    let info: PosapiInfoWire;
    try {
      const answer = await this.posapi.info();
      const only = answer.merchants.length === 1 ? answer.merchants[0] : undefined;
      this.merchant = only ? { tin: only.tin, name: only.name, posNo: answer.posNo } : null;
      info = {
        version: answer.version,
        lastSentDate: answer.lastSentDate,
        leftLotteries: answer.leftLotteries,
        checkedAt: checkedAt.toISOString(),
        error: only ? null : `PosAPI lists ${answer.merchants.length} merchants`,
      };
    } catch (error) {
      info = {
        version: null,
        lastSentDate: null,
        leftLotteries: null,
        checkedAt: checkedAt.toISOString(),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      };
    }
    await this.db
      .insert(edgeState)
      .values({
        id: 1,
        posapiVersion: info.version,
        posapiLastSent: info.lastSentDate,
        posapiLeftLotteries: info.leftLotteries,
        posapiCheckedAt: checkedAt,
        posapiError: info.error,
      })
      .onConflictDoUpdate({
        target: edgeState.id,
        set:
          info.error && !info.version
            ? { posapiCheckedAt: checkedAt, posapiError: info.error }
            : {
                posapiVersion: info.version,
                posapiLastSent: info.lastSentDate,
                posapiLeftLotteries: info.leftLotteries,
                posapiCheckedAt: checkedAt,
                posapiError: info.error,
              },
      });
    return info;
  }

  /** What the state row holds of PosAPI (null on the fake provider or before the first read). */
  async info(): Promise<PosapiInfoWire | null> {
    if (!this.enabled) return null;
    const [state] = await this.db.select().from(edgeState).where(eq(edgeState.id, 1));
    if (!state?.posapiCheckedAt) return null;
    return {
      version: state.posapiVersion,
      lastSentDate: state.posapiLastSent,
      leftLotteries: state.posapiLeftLotteries,
      checkedAt: state.posapiCheckedAt.toISOString(),
      error: state.posapiError,
    };
  }

  private async merchantOrNull(): Promise<{
    tin: string;
    name: string;
    posNo: string | null;
  } | null> {
    if (!this.merchant) await this.refreshInfo();
    return this.merchant;
  }

  // ------------------------------------------------------------- the supervisor's list

  async summary(): Promise<EdgeEbarimtSummary> {
    const provider = this.config.get('EBARIMT_PROVIDER');
    if (!this.enabled) return { provider, ready: 0, attention: 0 };
    const stale = new Date(Date.now() - STALE_MS);
    const [row] = await this.db
      .select({
        attention: sql<string>`count(*) FILTER (WHERE ${edgeReceipts.status} IN ('ERROR', 'INDETERMINATE') OR (${edgeReceipts.status} = 'PENDING' AND ${edgeReceipts.createdAt} < ${stale}))`,
      })
      .from(edgeReceipts);
    return {
      provider,
      ready: this.cache.ready().length,
      attention: Number.parseInt(row?.attention ?? '0', 10),
    };
  }

  async queue(): Promise<EdgeEbarimtQueue> {
    const provider = this.config.get('EBARIMT_PROVIDER');
    if (!this.enabled) return { provider, posapi: null, items: [] };
    const ready = new Map(this.cache.ready().map((entry) => [entry.clientId, entry]));
    const rows = await this.db
      .select({ op: edgeReceipts, sale: edgeSales })
      .from(edgeReceipts)
      .innerJoin(edgeSales, eq(edgeSales.clientId, edgeReceipts.ownerClientId))
      .where(
        or(
          inArray(edgeReceipts.status, ['PENDING', 'SENDING', 'ERROR', 'INDETERMINATE']),
          ready.size > 0
            ? and(
                eq(edgeReceipts.status, 'DONE'),
                inArray(edgeReceipts.ownerClientId, [...ready.keys()]),
              )
            : sql`false`,
        ),
      )
      .orderBy(asc(edgeReceipts.id))
      .limit(200);
    const items: EdgeEbarimtItem[] = rows.map(({ op, sale }) => ({
      id: op.id,
      group:
        op.status === 'DONE'
          ? 'READY'
          : op.status === 'INDETERMINATE'
            ? 'CHECK'
            : op.status === 'ERROR'
              ? 'ERROR'
              : 'WAITING',
      op: op.op,
      saleClientId: op.ownerClientId,
      number: sale.number,
      kind: sale.kind,
      tillCode: op.tillCode,
      soldAt: sale.soldAt.toISOString(),
      total: new Decimal(op.total).toFixed(2),
      receiptType: op.receiptType,
      status: op.status,
      ddtd: op.ddtd,
      message: op.message,
      attempts: op.attempts,
      createdAt: op.createdAt.toISOString(),
    }));
    return { provider, posapi: await this.info(), items };
  }
}

function payments(
  cash: Decimal,
  card: Decimal,
  transfer: Decimal,
  voucher: Decimal = new Decimal(0),
): { code: EbarimtPaymentCode; amount: string }[] {
  const sums = new Map<EbarimtPaymentCode, Decimal>([
    ['CASH', cash],
    ['PAYMENT_CARD', card],
    ['BANK_TRANSFER', transfer],
  ]);
  sums.set(VOUCHER_PAYMENT_CODE, (sums.get(VOUCHER_PAYMENT_CODE) ?? new Decimal(0)).plus(voucher));
  return [...sums]
    .filter(([, amount]) => amount.gt(0))
    .map(([code, amount]) => ({ code, amount: amount.toFixed(2) }));
}

function zeroes() {
  return { qty: new Decimal(0), total: new Decimal(0), vat: new Decimal(0) };
}

function statusOf(status: EdgeReceiptStatus): EbarimtStatus {
  switch (status) {
    case 'PENDING':
    case 'SENDING':
      return 'PENDING';
    case 'DONE':
      return 'CONFIRMED';
    case 'ERROR':
      return 'ERROR';
    case 'INDETERMINATE':
      return 'INDETERMINATE';
    case 'ABANDONED':
      return 'NONE';
  }
}
