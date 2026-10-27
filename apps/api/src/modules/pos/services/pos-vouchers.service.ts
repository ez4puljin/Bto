import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type PosVoucherFacts,
  type PosVoucherFeed,
  VOUCHER_LIMITS,
  VOUCHER_RANDOM_DIGITS,
  type VoucherBatchStatus,
  type VoucherEffect,
  type VoucherIssue,
  type VoucherKind,
  type VoucherStatus,
  voucherBatchNumber,
  voucherCodeOf,
  voucherDateRefusal,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { PosVoucherBillingService } from '../../finance';
import { type Actor, AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import type { SaleDoc } from '../sale-doc';
import { posSaleVouchers, posSales, posVoucherBatches, posVouchers } from '../schema';

type BatchRow = typeof posVoucherBatches.$inferSelect;
type VoucherRow = typeof posVouchers.$inferSelect;

export interface VoucherBatchInput {
  kind: VoucherKind;
  name: string;
  /** A partner voucher is always AMOUNT. */
  effect: VoucherEffect;
  value: Decimal;
  customerId: number | null;
  validFrom: string;
  validTo: string;
  qty: number;
  note: string | null;
}

export interface VoucherBatchView {
  id: number;
  number: string;
  kind: VoucherKind;
  name: string;
  effect: VoucherEffect;
  value: Decimal;
  customerId: number | null;
  customerName: string | null;
  validFrom: string;
  validTo: string;
  qty: number;
  redeemed: number;
  status: VoucherBatchStatus;
  note: string | null;
  createdAt: Date;
  createdByName: string | null;
  stoppedAt: Date | null;
}

export interface VoucherCodeView {
  id: number;
  seq: number;
  code: string;
  status: VoucherStatus;
  saleId: number | null;
  saleNumber: string | null;
  redeemedAt: Date | null;
  amount: Decimal | null;
}

export interface VoucherUseView {
  id: number;
  saleId: number;
  saleNumber: string;
  soldAt: Date;
  voucherId: number;
  batchId: number;
  batchNumber: string;
  kind: VoucherKind;
  code: string;
  face: Decimal;
  amount: Decimal;
  issue: VoucherIssue | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

/** What a sale's codes are, once locked: rows to write after the sale's row exists. */
export interface LockedVouchers {
  uses: {
    voucher: VoucherRow;
    batch: BatchRow;
    kind: VoucherKind;
    code: string;
    face: Decimal;
    amount: Decimal;
    issue: VoucherIssue | null;
  }[];
}

const MONEY_SCALE = 2;

/**
 * The till's coupons and partner vouchers on the centre (ADR-0110): the admin's batches and their
 * printed codes, the feed every edge pulls, and the codes a replayed sale took — kept even when one
 * was used twice, stopped or past its dates (an offline till has sold), each listed for the office.
 * A partner's vouchers on a sale are billed to the partner at their face value.
 */
@Injectable()
export class PosVouchersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly customers: CustomersService,
    private readonly billing: PosVoucherBillingService,
  ) {}

  async createBatch(ctx: AuthContext, input: VoucherBatchInput): Promise<VoucherBatchView> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > VOUCHER_LIMITS.maxName) {
      throw invalid('name', 'length', `1 to ${VOUCHER_LIMITS.maxName} characters`);
    }
    if (input.kind === 'PARTNER' && input.effect !== 'AMOUNT') {
      throw invalid('effect', 'kind', 'a partner voucher has a face value in tugriks');
    }
    if ((input.kind === 'PARTNER') !== (input.customerId !== null)) {
      throw invalid('customerId', 'kind', 'a partner voucher names its partner, and only it');
    }
    if (input.effect === 'PERCENT') {
      if (!input.value.gt(0) || input.value.gt(100) || input.value.decimalPlaces() > MONEY_SCALE) {
        throw invalid('value', 'percent', 'more than 0 and at most 100');
      }
    } else if (
      !input.value.gt(0) ||
      !input.value.isInteger() ||
      input.value.gt(VOUCHER_LIMITS.maxAmount)
    ) {
      throw invalid('value', 'money', `whole tugriks up to ${VOUCHER_LIMITS.maxAmount}`);
    }
    if (input.validTo < input.validFrom) {
      throw invalid('validTo', 'dates', 'the last day is not before the first');
    }
    if (input.validTo < businessDate()) throw invalid('validTo', 'past', 'a last day not past');
    if (
      !Number.isInteger(input.qty) ||
      input.qty < 1 ||
      input.qty > VOUCHER_LIMITS.maxBatchQty
    ) {
      throw invalid('qty', 'count', `1 to ${VOUCHER_LIMITS.maxBatchQty} codes`);
    }
    const note = input.note?.trim() || null;
    const id = await inTransaction(this.db, async (tx) => {
      if (input.customerId !== null) await this.customers.assertActive(tx, input.customerId);
      const [batch] = await tx
        .insert(posVoucherBatches)
        .values({
          kind: input.kind,
          name,
          effect: input.effect,
          value: input.value,
          customerId: input.customerId,
          validFrom: input.validFrom,
          validTo: input.validTo,
          qty: input.qty,
          note,
          createdBy: ctx.userId,
        })
        .returning({ id: posVoucherBatches.id });
      if (!batch) throw new Error('pos_voucher_batches insert returned no row');
      await this.issueCodes(tx, batch.id, input.kind, input.qty);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'pos_voucher_batches',
        entityId: batch.id,
        after: {
          kind: input.kind,
          name,
          effect: input.effect,
          value: input.value.toFixed(MONEY_SCALE),
          customerId: input.customerId,
          validFrom: input.validFrom,
          validTo: input.validTo,
          qty: input.qty,
        },
      });
      return batch.id;
    });
    return this.getBatch(id);
  }

  /** Stops a batch: its unused codes leave the tills' feed. Stopping it again changes nothing. */
  async stopBatch(ctx: AuthContext, id: number): Promise<VoucherBatchView> {
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ status: posVoucherBatches.status })
        .from(posVoucherBatches)
        .where(eq(posVoucherBatches.id, id))
        .for('update');
      if (!row) throw notFound('pos_voucher_batch', id);
      if (row.status === 'STOPPED') return;
      await tx
        .update(posVoucherBatches)
        .set({
          status: 'STOPPED',
          stoppedAt: sql`now()`,
          stoppedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(posVoucherBatches.id, id));
      await this.audit.record(tx, ctx, {
        action: 'STOP',
        entity: 'pos_voucher_batches',
        entityId: id,
        after: { status: 'STOPPED' },
      });
    });
    return this.getBatch(id);
  }

  async listBatches(query: {
    kind?: VoucherKind;
    status?: VoucherBatchStatus;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: VoucherBatchView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.kind) filters.push(eq(posVoucherBatches.kind, query.kind));
    if (query.status) filters.push(eq(posVoucherBatches.status, query.status));
    const q = query.q?.trim();
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      filters.push(
        sql`(${posVoucherBatches.name} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM ${posVouchers} WHERE ${posVouchers.batchId} = ${posVoucherBatches.id} AND ${posVouchers.code} = ${q.replace(/[\s-]/g, '')}))`,
      );
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(posVoucherBatches.id, after.id));
    const rows = await this.db
      .select()
      .from(posVoucherBatches)
      .where(and(...filters))
      .orderBy(desc(posVoucherBatches.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data), nextCursor: page.nextCursor };
  }

  async getBatch(id: number): Promise<VoucherBatchView> {
    const [row] = await this.db
      .select()
      .from(posVoucherBatches)
      .where(eq(posVoucherBatches.id, id));
    if (!row) throw notFound('pos_voucher_batch', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('pos_voucher_batch', id);
    return view;
  }

  /** A batch's codes in print order, with the sale that took each. */
  async codesOf(batchId: number): Promise<VoucherCodeView[]> {
    await this.getBatch(batchId);
    const rows = await this.db
      .select({
        id: posVouchers.id,
        seq: posVouchers.seq,
        code: posVouchers.code,
        status: posVouchers.status,
        saleId: posVouchers.saleId,
        saleNumber: posSales.number,
        redeemedAt: posVouchers.redeemedAt,
        amount: posVouchers.amount,
      })
      .from(posVouchers)
      .leftJoin(posSales, eq(posSales.id, posVouchers.saleId))
      .where(eq(posVouchers.batchId, batchId))
      .orderBy(asc(posVouchers.seq));
    return rows.map((row) => ({ ...row, saleNumber: row.saleNumber ?? null }));
  }

  /** The uses of a batch's codes, or the uses the office has to check (`issue`). */
  async uses(query: {
    batchId?: number;
    saleId?: number;
    toCheck?: boolean;
    limit?: number;
  }): Promise<VoucherUseView[]> {
    const filters: SQL[] = [];
    if (query.batchId) filters.push(eq(posVouchers.batchId, query.batchId));
    if (query.saleId) filters.push(eq(posSaleVouchers.saleId, query.saleId));
    if (query.toCheck) {
      filters.push(sql`${posSaleVouchers.issue} IS NOT NULL`, isNull(posSaleVouchers.reviewedAt));
    }
    const rows = await this.db
      .select({
        id: posSaleVouchers.id,
        saleId: posSaleVouchers.saleId,
        saleNumber: posSales.number,
        soldAt: posSales.soldAt,
        voucherId: posSaleVouchers.voucherId,
        batchId: posVouchers.batchId,
        kind: posSaleVouchers.kind,
        code: posSaleVouchers.code,
        face: posSaleVouchers.face,
        amount: posSaleVouchers.amount,
        issue: posSaleVouchers.issue,
        invoiceId: posSaleVouchers.invoiceId,
        invoiceNumber: posSaleVouchers.invoiceNumber,
        reviewedAt: posSaleVouchers.reviewedAt,
        reviewNote: posSaleVouchers.reviewNote,
      })
      .from(posSaleVouchers)
      .innerJoin(posSales, eq(posSales.id, posSaleVouchers.saleId))
      .innerJoin(posVouchers, eq(posVouchers.id, posSaleVouchers.voucherId))
      .where(and(...filters))
      .orderBy(desc(posSaleVouchers.id))
      .limit(query.limit ?? 1000);
    return rows.map((row) => ({ ...row, batchNumber: voucherBatchNumber(row.batchId) }));
  }

  async toCheckCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSaleVouchers)
      .where(and(sql`${posSaleVouchers.issue} IS NOT NULL`, isNull(posSaleVouchers.reviewedAt)));
    return Number.parseInt(row?.count ?? '0', 10);
  }

  /** «Шалгасан» on a use the centre found wrong (a code used twice, stopped or out of date). */
  async reviewUse(ctx: AuthContext, id: number, note: string | null): Promise<VoucherUseView> {
    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) throw invalid('note', 'length', 'at most 300 characters');
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ issue: posSaleVouchers.issue, reviewedAt: posSaleVouchers.reviewedAt })
        .from(posSaleVouchers)
        .where(eq(posSaleVouchers.id, id))
        .for('update');
      if (!row) throw notFound('pos_sale_voucher', id);
      if (row.issue === null) {
        throw new AppError('POS_VOUCHER_NOTHING_TO_CHECK', `use ${id} has nothing to check`, { id });
      }
      if (row.reviewedAt) return;
      await tx
        .update(posSaleVouchers)
        .set({ reviewedAt: sql`now()`, reviewedBy: ctx.userId, reviewNote: trimmed })
        .where(eq(posSaleVouchers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'REVIEW',
        entity: 'pos_sale_vouchers',
        entityId: id,
        after: { issue: row.issue, note: trimmed },
      });
    });
    const [view] = (await this.uses({ limit: 1000 })).filter((use) => use.id === id);
    if (!view) throw notFound('pos_sale_voucher', id);
    return view;
  }

  /**
   * The codes a till may take (`GET /pos/sync/vouchers`): every ISSUED code of an ACTIVE batch not
   * past its last day, with a content-hash version so an unchanged feed is not sent again.
   */
  async feed(): Promise<PosVoucherFeed> {
    const today = businessDate();
    const rows = await this.db
      .select({ voucher: posVouchers, batch: posVoucherBatches })
      .from(posVouchers)
      .innerJoin(posVoucherBatches, eq(posVoucherBatches.id, posVouchers.batchId))
      .where(
        and(
          eq(posVouchers.status, 'ISSUED'),
          eq(posVoucherBatches.status, 'ACTIVE'),
          gte(posVoucherBatches.validTo, today),
        ),
      )
      .orderBy(asc(posVouchers.id));
    const partners = await this.partnerNames(rows.map((row) => row.batch));
    const vouchers: PosVoucherFacts[] = rows.map(({ voucher, batch }) => ({
      id: voucher.id,
      code: voucher.code,
      kind: batch.kind,
      batchId: batch.id,
      batchNumber: voucherBatchNumber(batch.id),
      name: batch.name,
      effect: batch.effect,
      value: batch.value.toFixed(MONEY_SCALE),
      validFrom: batch.validFrom,
      validTo: batch.validTo,
      customerId: batch.customerId,
      customerName: batch.customerId === null ? null : (partners.get(batch.customerId) ?? null),
    }));
    const version = createHash('sha256').update(JSON.stringify(vouchers)).digest('hex');
    return { version: version.slice(0, 20), generatedAt: new Date().toISOString(), vouchers };
  }

  /**
   * The shape of a sale's codes (ADR-0110), before anything is read: a return takes none; every
   * VOUCHER tender is one partner voucher of the list, for its amount; no credit beside a voucher;
   * a coupon's amount is what its code took off the lines.
   */
  checkShape(doc: SaleDoc): void {
    const voucherTenders = doc.tenders.filter((tender) => tender.kind === 'VOUCHER');
    if (doc.kind === 'RETURN') {
      if (doc.vouchers.length > 0 || voucherTenders.length > 0) {
        throw invalid('vouchers', 'return', 'a return takes no codes; it pays back in cash');
      }
      return;
    }
    if (doc.vouchers.length > VOUCHER_LIMITS.maxPerSale) {
      throw invalid('vouchers', 'count', `at most ${VOUCHER_LIMITS.maxPerSale} codes`);
    }
    const seen = new Set<string>();
    for (const [index, voucher] of doc.vouchers.entries()) {
      if (seen.has(voucher.code)) throw invalid(`vouchers[${index}].code`, 'unique', 'repeated');
      seen.add(voucher.code);
      if (voucher.amount.isNegative() || voucher.amount.decimalPlaces() > MONEY_SCALE) {
        throw invalid(`vouchers[${index}].amount`, 'money', 'a non-negative amount');
      }
      if (voucher.kind === 'PARTNER' && voucher.amount.gt(voucher.face)) {
        throw invalid(`vouchers[${index}].amount`, 'face', 'at most the face value');
      }
    }
    const partners = doc.vouchers.filter((voucher) => voucher.kind === 'PARTNER');
    if (partners.length > 0 && doc.tenders.some((tender) => tender.kind === 'CREDIT')) {
      throw invalid('tenders', 'voucher', 'a partner voucher and credit do not go together');
    }
    if (partners.length !== voucherTenders.length) {
      throw invalid('tenders', 'voucher', 'one VOUCHER tender per partner voucher');
    }
    for (const [index, tender] of voucherTenders.entries()) {
      const voucher = partners.find((candidate) => candidate.code === tender.voucherCode);
      if (!voucher || !voucher.amount.eq(tender.amount)) {
        throw invalid(`tenders[${index}].voucherCode`, 'voucher', 'a partner voucher, its amount');
      }
    }
    for (const tender of doc.tenders) {
      if (tender.kind !== 'VOUCHER' && tender.voucherCode !== null) {
        throw invalid('tenders', 'voucher', 'only a VOUCHER tender names a code');
      }
    }
    for (const [index, coupon] of doc.vouchers.entries()) {
      if (coupon.kind !== 'COUPON') continue;
      const took = doc.lines.reduce(
        (sum, line) => sum.plus(couponAmountOf(line.applied, coupon.code)),
        new Decimal(0),
      );
      if (!took.eq(coupon.amount)) {
        throw new AppError('POS_TOTALS_MISMATCH', `coupon ${coupon.code}: amount differs`, {
          lineNo: null,
          field: `vouchers[${index}].amount`,
          expected: took.toFixed(MONEY_SCALE),
          got: coupon.amount.toFixed(MONEY_SCALE),
        });
      }
    }
  }

  /**
   * Locks a sale's codes and their batches (by id) and the partners they bill (by id), after the
   * shift and before the shelf, and decides what is wrong with each: a code the till took is kept
   * (it has sold), but one already REDEEMED is USED, a stopped batch STOPPED, a sold day outside
   * its dates NOT_YET or EXPIRED. A code the centre does not know, or whose terms differ from its
   * batch's, is refused for good.
   */
  async lockForSaleInTx(tx: Tx, doc: SaleDoc, soldDay: string): Promise<LockedVouchers> {
    if (doc.vouchers.length === 0) return { uses: [] };
    const ids = [...new Set(doc.vouchers.map((voucher) => voucher.voucherId))].sort((a, b) => a - b);
    const rows = await tx
      .select()
      .from(posVouchers)
      .where(inArray(posVouchers.id, ids))
      .orderBy(asc(posVouchers.id))
      .for('update');
    const byId = new Map(rows.map((row) => [row.id, row]));
    const batchIds = [...new Set(rows.map((row) => row.batchId))].sort((a, b) => a - b);
    const batches = new Map(
      (
        await tx
          .select()
          .from(posVoucherBatches)
          .where(inArray(posVoucherBatches.id, batchIds))
          .orderBy(asc(posVoucherBatches.id))
          .for('share')
      ).map((row) => [row.id, row]),
    );
    const uses: LockedVouchers['uses'] = doc.vouchers.map((voucher, index) => {
      const row = byId.get(voucher.voucherId);
      if (!row || row.code !== voucher.code) throw notFound('pos_voucher', voucher.voucherId);
      const batch = batches.get(row.batchId);
      if (!batch) throw notFound('pos_voucher_batch', row.batchId);
      if (batch.kind !== voucher.kind) {
        throw invalid(`vouchers[${index}].kind`, 'batch', 'the kind of its batch');
      }
      if (!batch.value.eq(voucher.face)) {
        throw new AppError('POS_TOTALS_MISMATCH', `code ${voucher.code}: face value differs`, {
          lineNo: null,
          field: `vouchers[${index}].face`,
          expected: batch.value.toFixed(MONEY_SCALE),
          got: voucher.face.toFixed(MONEY_SCALE),
        });
      }
      const issue: VoucherIssue | null =
        row.status === 'REDEEMED'
          ? 'USED'
          : batch.status === 'STOPPED'
            ? 'STOPPED'
            : voucherDateRefusal(soldDay, batch.validFrom, batch.validTo);
      return {
        voucher: row,
        batch,
        kind: voucher.kind,
        code: voucher.code,
        face: voucher.face,
        amount: voucher.amount,
        issue,
      };
    });
    const partners = [
      ...new Set(
        uses
          .filter((use) => use.kind === 'PARTNER' && use.issue === null)
          .map((use) => use.batch.customerId)
          .filter((id): id is number => id !== null),
      ),
    ].sort((a, b) => a - b);
    for (const customerId of partners) await this.customers.lockForUpdate(tx, customerId);
    return { uses };
  }

  /**
   * After the sale's row: each code's use, the first use marking the code REDEEMED, and per partner
   * one invoice for the face value of its codes without an issue (a code with one is left in the
   * clearing for the office to settle).
   */
  async recordInTx(
    tx: Tx,
    actor: Actor,
    sale: { id: number; number: string; branchId: number | null },
    locked: LockedVouchers,
  ): Promise<{ invoices: string[] }> {
    if (locked.uses.length === 0) return { invoices: [] };
    const inserted = await tx
      .insert(posSaleVouchers)
      .values(
        locked.uses.map((use) => ({
          saleId: sale.id,
          voucherId: use.voucher.id,
          kind: use.kind,
          code: use.code,
          face: use.face,
          amount: use.amount,
          issue: use.issue,
        })),
      )
      .returning({ id: posSaleVouchers.id, voucherId: posSaleVouchers.voucherId });
    const useIds = new Map(inserted.map((row) => [row.voucherId, row.id]));
    for (const use of locked.uses) {
      if (use.voucher.status !== 'ISSUED') continue;
      await tx
        .update(posVouchers)
        .set({ status: 'REDEEMED', saleId: sale.id, redeemedAt: sql`now()`, amount: use.amount })
        .where(eq(posVouchers.id, use.voucher.id));
    }
    const byPartner = new Map<number, LockedVouchers['uses']>();
    for (const use of locked.uses) {
      if (use.kind !== 'PARTNER' || use.issue !== null || use.batch.customerId === null) continue;
      byPartner.set(use.batch.customerId, [...(byPartner.get(use.batch.customerId) ?? []), use]);
    }
    const numbers: string[] = [];
    for (const [customerId, uses] of [...byPartner].sort(([a], [b]) => a - b)) {
      const invoice = await this.billing.chargeInTx(tx, actor, {
        saleNumber: sale.number,
        customerId,
        branchId: sale.branchId,
        vouchers: uses.map((use) => ({ code: use.code, face: use.face, amount: use.amount })),
      });
      numbers.push(invoice.number);
      const ids = uses.flatMap((use) => {
        const id = useIds.get(use.voucher.id);
        return id === undefined ? [] : [id];
      });
      await tx
        .update(posSaleVouchers)
        .set({ invoiceId: invoice.invoiceId, invoiceNumber: invoice.number })
        .where(inArray(posSaleVouchers.id, ids));
    }
    return { invoices: numbers };
  }

  /** Codes of a batch, drawn at random; a code that clashes with an existing one is drawn again. */
  private async issueCodes(tx: Tx, batchId: number, kind: VoucherKind, qty: number): Promise<void> {
    const wanted = Array.from({ length: qty }, (_, index) => ({
      batchId,
      seq: index + 1,
      code: voucherCodeOf(kind, randomDigits()),
    }));
    const created = await tx
      .insert(posVouchers)
      .values(wanted)
      .onConflictDoNothing({ target: posVouchers.code })
      .returning({ seq: posVouchers.seq });
    const placed = new Set(created.map((row) => row.seq));
    for (const row of wanted) {
      for (let attempt = 0; !placed.has(row.seq); attempt += 1) {
        if (attempt > 20) throw new Error('could not draw a unique voucher code');
        const [again] = await tx
          .insert(posVouchers)
          .values({ batchId, seq: row.seq, code: voucherCodeOf(kind, randomDigits()) })
          .onConflictDoNothing({ target: posVouchers.code })
          .returning({ seq: posVouchers.seq });
        if (again) placed.add(again.seq);
      }
    }
  }

  private async views(rows: readonly BatchRow[]): Promise<VoucherBatchView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const counts = new Map(
      (
        await this.db
          .select({ batchId: posVouchers.batchId, count: sql<string>`count(*)` })
          .from(posVouchers)
          .where(and(inArray(posVouchers.batchId, ids), eq(posVouchers.status, 'REDEEMED')))
          .groupBy(posVouchers.batchId)
      ).map((row) => [row.batchId, Number.parseInt(row.count, 10)]),
    );
    const [partners, users] = await Promise.all([
      this.partnerNames(rows),
      this.names.namesOf(rows.map((row) => row.createdBy)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      number: voucherBatchNumber(row.id),
      kind: row.kind,
      name: row.name,
      effect: row.effect,
      value: row.value,
      customerId: row.customerId,
      customerName: row.customerId === null ? null : (partners.get(row.customerId) ?? null),
      validFrom: row.validFrom,
      validTo: row.validTo,
      qty: row.qty,
      redeemed: counts.get(row.id) ?? 0,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt,
      createdByName: users.get(row.createdBy) ?? null,
      stoppedAt: row.stoppedAt,
    }));
  }

  private async partnerNames(rows: readonly { customerId: number | null }[]) {
    const ids = [
      ...new Set(rows.map((row) => row.customerId).filter((id): id is number => id !== null)),
    ];
    return new Map((await this.customers.getMany(ids)).map((row) => [row.id, row.name]));
  }
}

/** What a coupon's code took off one line: the sum of its applied entries' amounts. */
export function couponAmountOf(applied: readonly unknown[], code: string): Decimal {
  let sum = new Decimal(0);
  for (const entry of applied) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { code?: unknown; amount?: unknown };
    if (record.code !== code) continue;
    if (typeof record.amount === 'string' || typeof record.amount === 'number') {
      sum = sum.plus(record.amount);
    }
  }
  return sum;
}

function randomDigits(): string {
  let digits = '';
  while (digits.length < VOUCHER_RANDOM_DIGITS) digits += String(randomInt(0, 10));
  return digits;
}
