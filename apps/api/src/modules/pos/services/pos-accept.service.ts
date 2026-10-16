import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  CONSUMER_NO_PATTERN,
  lineMoney,
  lineVat,
  POS_LIMITS,
  saleTotals,
  tendersTotal,
  withinReturnWindow,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound, type ProblemParams } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import {
  CatalogService,
  type ProductSummary,
  TaxService,
  UnitConversionService,
} from '../../catalog';
import { type Actor, AuditService, UserNamesService } from '../../identity';
import {
  AdjustmentsService,
  BinsService,
  type Movement,
  StockPostingService,
  StockQueryService,
  type SystemAdjustmentLine,
} from '../../inventory';
import { encodeEvent } from '../event-codec';
import type {
  Accepted,
  ReceiptStatusDoc,
  SaleDoc,
  SaleDocLine,
  SyncEvent,
  SyncOutcome,
  TillBoundDoc,
} from '../sale-doc';
import {
  posSaleLines,
  posSales,
  posShortfalls,
  posSyncRejections,
  posTenders,
  posTillDevices,
} from '../schema';
import { PosCashiersService } from './pos-cashiers.service';
import type { EdgeNode } from './pos-edge-nodes.service';
import { PosSettingsService } from './pos-settings.service';
import { PosShiftsService } from './pos-shifts.service';
import { PosTillsService } from './pos-tills.service';

type SaleRow = typeof posSales.$inferSelect;
type LineRow = typeof posSaleLines.$inferSelect;

const MONEY_SCALE = 2;
const QTY_SCALE = 3;
/** Failures the edge should try again later rather than park (a shelf under count, a lock). */
const RETRYABLE = new Set<string>(['BIN_LOCKED_FOR_COUNT', 'STOCK_INSUFFICIENT']);

/**
 * Accepts the documents a till produced (ADR-0063 #4, #5): each in its own transaction, once per
 * `client_id`; a sale posts `POS_SALE` from SALESFLOOR after an automatic `POS_SHORTFALL`
 * adjustment filled what the shelf lacked; a return posts `RETURN_IN` onto the shelf (or DAMAGED).
 * The money is as the till computed it: the centre checks the arithmetic and the tax rates and
 * refuses, never re-prices.
 */
@Injectable()
export class PosAcceptService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly tax: TaxService,
    private readonly bins: BinsService,
    private readonly posting: StockPostingService,
    private readonly adjustments: AdjustmentsService,
    private readonly stock: StockQueryService,
    private readonly tills: PosTillsService,
    private readonly cashiers: PosCashiersService,
    private readonly shifts: PosShiftsService,
    private readonly settings: PosSettingsService,
  ) {}

  /**
   * One replayed document: APPLIED or DUPLICATE on success; REJECTED (and logged) on a refusal the
   * edge cannot cure by trying again; anything else is thrown so the edge resends the batch.
   */
  async applyEvent(node: EdgeNode, actor: Actor, event: SyncEvent): Promise<SyncOutcome> {
    const outcome = (
      status: SyncOutcome['status'],
      rest: Partial<Pick<SyncOutcome, 'id' | 'number' | 'code' | 'params'>>,
    ): SyncOutcome => ({
      clientId: event.clientId,
      kind: event.kind,
      status,
      id: null,
      number: null,
      code: null,
      params: null,
      ...rest,
    });
    try {
      const accepted = await inTransaction(this.db, (tx) => this.apply(tx, actor, node, event));
      return outcome(accepted.created ? 'APPLIED' : 'DUPLICATE', {
        id: accepted.id,
        number: accepted.number,
      });
    } catch (error) {
      if (!(error instanceof AppError) || RETRYABLE.has(error.code)) throw error;
      const params: ProblemParams | null =
        error.params ??
        (error.errors?.[0]
          ? { path: error.errors[0].path, constraint: error.errors[0].constraint }
          : null);
      await this.db.insert(posSyncRejections).values({
        edgeNodeId: node.id,
        clientId: event.clientId,
        kind: event.kind,
        payload: encodeEvent(event),
        code: error.code,
        params,
      });
      return outcome('REJECTED', { code: error.code, params });
    }
  }

  async apply(tx: Tx, actor: Actor, node: EdgeNode, event: SyncEvent): Promise<Accepted> {
    switch (event.kind) {
      case 'SALE':
      case 'RETURN':
        return this.acceptSale(tx, actor, node, event.payload);
      case 'SHIFT_OPENED':
        return this.shifts.acceptOpen(tx, actor, node, event.payload);
      case 'SHIFT_CLOSED':
        return this.shifts.acceptClose(tx, actor, node, event.payload);
      case 'RECEIPT_STATUS':
        return this.recordReceiptStatus(tx, node, event.payload);
      case 'TILL_BOUND':
        return this.recordTillBound(tx, actor, node, event.payload);
    }
  }

  async acceptSale(tx: Tx, actor: Actor, node: EdgeNode, doc: SaleDoc): Promise<Accepted> {
    const existing = await this.saleByClientId(tx, node.id, doc.clientId);
    if (existing) return { id: existing.id, number: existing.number, created: false };
    this.checkShape(doc);
    const till = await this.tills.activeByCode(node.id, doc.tillCode, tx);
    const shift = await this.shifts.lockOpen(tx, node.id, doc.shiftClientId);
    if (shift.tillId !== till.id) {
      throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${shift.number} is of another till`, {
        status: 'OTHER_TILL',
        number: shift.number,
      });
    }
    await this.cashiers.assertActive(doc.cashierUserId, tx);
    const settings = await this.settings.get(tx);
    if (doc.kind === 'RETURN' && settings.supervisorRequired && doc.approvedByUserId === null) {
      throw invalid('approvedByUserId', 'required', 'a return needs a supervisor');
    }
    if (doc.approvedByUserId !== null) {
      if (!(await this.names.namesOf([doc.approvedByUserId])).size) {
        throw invalid('approvedByUserId', 'exists', `user ${doc.approvedByUserId} does not exist`);
      }
    }
    const soldDay = businessDate(doc.soldAt);
    const products = await this.productsOf(tx, doc.lines);
    await this.checkUnits(tx, doc.lines);
    await this.checkMoney(tx, doc, soldDay, products);
    const original =
      doc.kind === 'RETURN' ? await this.checkReturn(tx, node, doc, soldDay, settings) : null;

    const [sale] = await tx
      .insert(posSales)
      .values({
        clientId: doc.clientId,
        edgeNodeId: node.id,
        tillId: till.id,
        shiftId: shift.id,
        cashierUserId: doc.cashierUserId,
        approvedBy: doc.approvedByUserId,
        number: doc.number,
        kind: doc.kind,
        refundsSaleId: original?.sale.id ?? null,
        soldAt: doc.soldAt,
        soldDay,
        subtotal: doc.subtotal,
        discountTotal: doc.discountTotal,
        total: doc.total,
        vatTotal: doc.vatTotal,
        receiptType: doc.receiptType,
        customerTin: doc.customerTin,
        customerName: doc.customerName,
        consumerNo: doc.consumerNo,
        ebarimtStatus: doc.ebarimt?.status ?? 'NONE',
        ddtd: doc.ebarimt?.ddtd ?? null,
        posapiDate: doc.ebarimt?.posapiDate ?? null,
        billIdSuffix: doc.ebarimt?.billIdSuffix ?? null,
        inactiveId: doc.ebarimt?.inactiveId ?? null,
        snapshotVersion: doc.snapshotVersion,
        note: doc.note,
      })
      .onConflictDoNothing({ target: [posSales.edgeNodeId, posSales.clientId] })
      .returning({ id: posSales.id, number: posSales.number })
      .catch((error: unknown) => {
        const database = databaseErrorOf(error);
        if (database?.code === '23505' && database.constraint === 'pos_sales_number') {
          throw new AppError('POS_NUMBER_TAKEN', `number ${doc.number} is taken on this edge`, {
            number: doc.number,
          });
        }
        throw error;
      });
    if (!sale) {
      const raced = await this.saleByClientId(tx, node.id, doc.clientId);
      if (!raced) throw new Error('pos_sales insert returned no row');
      return { id: raced.id, number: raced.number, created: false };
    }
    const lines = await tx
      .insert(posSaleLines)
      .values(
        doc.lines.map((line) => {
          const product = products.get(line.productId);
          if (!product) throw notFound('product', line.productId);
          return {
            saleId: sale.id,
            lineNo: line.lineNo,
            productId: line.productId,
            productUnitId: line.productUnitId,
            productSku: product.sku,
            productName: product.name,
            uomName: product.unitNames.get(line.productUnitId) ?? product.baseUnit.uomName,
            qty: line.qty,
            factorSnapshot: line.factorSnapshot,
            qtyBase: line.qty.times(line.factorSnapshot),
            basis: line.basis,
            listPrice: line.listPrice,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount,
            subtotal: line.subtotal,
            total: line.total,
            vatType: product.vatType,
            vatRatePct: line.vatRatePct,
            vatAmount: line.vatAmount,
            applied: line.applied,
            refundsLineId:
              line.refundsLineNo === null
                ? null
                : (original?.lines.get(line.refundsLineNo)?.id ?? null),
            damaged: line.damaged,
          };
        }),
      )
      .returning();
    await tx.insert(posTenders).values(
      doc.tenders.map((tender, index) => ({
        saleId: sale.id,
        tenderNo: index + 1,
        kind: tender.kind,
        amount: tender.amount,
        tendered: tender.tendered,
        terminalId: tender.terminalId,
        rrn: tender.rrn,
        maskedPan: tender.maskedPan,
      })),
    );
    if (original) await this.takeBack(tx, original.lines, doc.lines);

    const salesfloor = await this.bins.systemBin(node.warehouseId, 'SALESFLOOR', tx);
    let shortfall: { id: number; number: string } | null = null;
    if (doc.kind === 'SALE') {
      shortfall = await this.fillShortfalls(
        tx,
        actor,
        node,
        doc.number,
        sale.id,
        lines,
        products,
        salesfloor.id,
      );
    }
    const damaged = lines.some((line) => line.damaged)
      ? await this.bins.systemBin(node.warehouseId, 'DAMAGED', tx)
      : null;
    const movements: Movement[] = lines.map((line) => ({
      docType: 'POS' as const,
      docId: sale.id,
      docLineId: line.id,
      movementType: doc.kind === 'SALE' ? ('POS_SALE' as const) : ('RETURN_IN' as const),
      leg: 1,
      warehouseId: node.warehouseId,
      binId: line.damaged && damaged ? damaged.id : salesfloor.id,
      productId: line.productId,
      qtyBase: doc.kind === 'SALE' ? line.qtyBase.negated() : line.qtyBase,
      enteredQty: line.qty,
      productUnitId: line.productUnitId,
      factorSnapshot: line.factorSnapshot,
    }));
    await this.posting.post(tx, actor, {
      docs: [{ docType: 'POS', docId: sale.id, external: true }],
      movements,
    });
    await this.tills.touchSale(till.id, doc.soldAt, tx);
    await this.audit.record(tx, actor, {
      action: 'ACCEPT',
      entity: 'pos_sales',
      entityId: sale.id,
      after: {
        number: doc.number,
        kind: doc.kind,
        tillCode: till.code,
        shiftNumber: shift.number,
        cashierUserId: doc.cashierUserId,
        total: doc.total.toFixed(MONEY_SCALE),
        lines: lines.length,
        shortfall: shortfall?.number ?? null,
        refunds: original?.sale.number ?? null,
      },
    });
    return { id: sale.id, number: sale.number, created: true };
  }

  /** The edge learnt more about a receipt (confirmed, cancelled, …) after it replayed the sale. */
  async recordReceiptStatus(tx: Tx, node: EdgeNode, doc: ReceiptStatusDoc): Promise<Accepted> {
    const [sale] = await tx
      .select({ id: posSales.id, number: posSales.number, status: posSales.ebarimtStatus })
      .from(posSales)
      .where(and(eq(posSales.edgeNodeId, node.id), eq(posSales.clientId, doc.saleClientId)))
      .for('update');
    if (!sale) throw notFound('pos_sale', 0);
    await tx
      .update(posSales)
      .set({
        ebarimtStatus: doc.ebarimt.status,
        ddtd: doc.ebarimt.ddtd,
        posapiDate: doc.ebarimt.posapiDate,
        billIdSuffix: doc.ebarimt.billIdSuffix,
        inactiveId: doc.ebarimt.inactiveId,
        updatedAt: sql`now()`,
      })
      .where(eq(posSales.id, sale.id));
    return { id: sale.id, number: sale.number, created: sale.status !== doc.ebarimt.status };
  }

  /** A manager bound a browser to a till on the edge; the centre lists it. */
  async recordTillBound(
    tx: Tx,
    actor: Actor,
    node: EdgeNode,
    doc: TillBoundDoc,
  ): Promise<Accepted> {
    const till = await this.tills.activeByCode(node.id, doc.tillCode, tx);
    const [row] = await tx
      .insert(posTillDevices)
      .values({
        tillId: till.id,
        deviceTokenHash: doc.deviceTokenHash,
        userAgent: doc.userAgent?.slice(0, 300) ?? null,
        boundBy: doc.boundByUserId,
        boundAt: doc.boundAt,
      })
      .onConflictDoNothing({ target: posTillDevices.deviceTokenHash })
      .returning({ id: posTillDevices.id });
    if (!row) return { id: till.id, number: till.code, created: false };
    await this.audit.record(tx, actor, {
      action: 'BIND',
      entity: 'pos_tills',
      entityId: till.id,
      after: { tillCode: till.code, boundByUserId: doc.boundByUserId },
    });
    return { id: row.id, number: till.code, created: true };
  }

  private async saleByClientId(tx: Tx, nodeId: number, clientId: string): Promise<SaleRow | null> {
    const [row] = await tx
      .select()
      .from(posSales)
      .where(and(eq(posSales.edgeNodeId, nodeId), eq(posSales.clientId, clientId)));
    return row ?? null;
  }

  private checkShape(doc: SaleDoc): void {
    if (doc.lines.length === 0 || doc.lines.length > POS_LIMITS.maxLines) {
      throw invalid('lines', 'count', `1 to ${POS_LIMITS.maxLines} lines`);
    }
    if (doc.tenders.length === 0 || doc.tenders.length > POS_LIMITS.maxTenders) {
      throw invalid('tenders', 'count', `1 to ${POS_LIMITS.maxTenders} tenders`);
    }
    if (doc.number.trim().length === 0 || doc.number.length > 40) {
      throw invalid('number', 'length', '1 to 40 characters');
    }
    if ((doc.kind === 'RETURN') !== (doc.refundsSaleClientId !== null)) {
      throw invalid('refundsSaleClientId', 'kind', 'a return names the sale it refunds');
    }
    if (doc.receiptType === 'B2B' && !/^[0-9]{11,14}$/.test(doc.customerTin ?? '')) {
      throw invalid('customerTin', 'tin', 'a B2B receipt needs the buyer’s TIN');
    }
    if (doc.consumerNo !== null && !CONSUMER_NO_PATTERN.test(doc.consumerNo)) {
      throw invalid('consumerNo', 'pattern', '8 digits or 11******');
    }
    if (doc.note !== null && doc.note.length > POS_LIMITS.maxNote) {
      throw invalid('note', 'length', `at most ${POS_LIMITS.maxNote} characters`);
    }
    const numbers = new Set<number>();
    doc.lines.forEach((line, index) => {
      if (numbers.has(line.lineNo)) throw invalid(`lines[${index}].lineNo`, 'unique', 'repeated');
      numbers.add(line.lineNo);
      if ((doc.kind === 'RETURN') !== (line.refundsLineNo !== null)) {
        throw invalid(`lines[${index}].refundsLineNo`, 'kind', 'return lines name the sold line');
      }
      if (!line.qty.gt(0) || line.qty.decimalPlaces() > QTY_SCALE) {
        throw invalid(`lines[${index}].qty`, 'qty', 'a positive quantity with 3 decimals');
      }
      if (line.qty.times(line.factorSnapshot).decimalPlaces() > QTY_SCALE) {
        throw invalid(`lines[${index}].qty`, 'base', 'base units with 3 decimals');
      }
      for (const [field, value] of [
        ['listPrice', line.listPrice],
        ['unitPrice', line.unitPrice],
        ['discountAmount', line.discountAmount],
        ['subtotal', line.subtotal],
        ['total', line.total],
        ['vatAmount', line.vatAmount],
      ] as const) {
        if (value.isNegative() || value.decimalPlaces() > MONEY_SCALE) {
          throw invalid(`lines[${index}].${field}`, 'money', 'a non-negative amount, 2 decimals');
        }
      }
    });
    doc.tenders.forEach((tender, index) => {
      if (!tender.amount.gt(0) || tender.amount.decimalPlaces() > MONEY_SCALE) {
        throw invalid(`tenders[${index}].amount`, 'money', 'a positive amount with 2 decimals');
      }
      if (tender.kind === 'CASH') {
        if (tender.tendered !== null && tender.tendered.lt(tender.amount)) {
          throw invalid(`tenders[${index}].tendered`, 'min', 'at least the amount');
        }
      } else if (tender.tendered !== null) {
        throw invalid(`tenders[${index}].tendered`, 'kind', 'only cash is tendered');
      }
    });
  }

  private async productsOf(
    tx: Tx,
    lines: readonly SaleDocLine[],
  ): Promise<Map<number, ProductSummary & { unitNames: Map<number, string> }>> {
    const ids = [...new Set(lines.map((line) => line.productId))];
    const products = new Map(
      (await this.catalog.getMany(ids, tx)).map((product) => [product.id, product]),
    );
    for (const id of ids) if (!products.has(id)) throw notFound('product', id);
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      tx,
    );
    const result = new Map<number, ProductSummary & { unitNames: Map<number, string> }>();
    for (const product of products.values()) {
      const unitNames = new Map<number, string>();
      for (const unit of units.values()) {
        if (unit.productId === product.id) unitNames.set(unit.unitId, unit.uomName);
      }
      result.set(product.id, { ...product, unitNames });
    }
    return result;
  }

  /** Every unit belongs to its line's product and the frozen factor is the unit's. */
  private async checkUnits(tx: Tx, lines: readonly SaleDocLine[]): Promise<void> {
    const units = await this.units.describe(
      [...new Set(lines.map((line) => line.productUnitId))],
      tx,
    );
    lines.forEach((line, index) => {
      const unit = units.get(line.productUnitId);
      if (!unit || unit.productId !== line.productId) {
        throw invalid(`lines[${index}].productUnitId`, 'product', 'a unit of the line’s product');
      }
      if (!unit.factorToBase.eq(line.factorSnapshot)) {
        throw new AppError('POS_TOTALS_MISMATCH', `line ${line.lineNo}: factor differs`, {
          lineNo: line.lineNo,
          field: 'factorSnapshot',
          expected: unit.factorToBase.toFixed(),
          got: line.factorSnapshot.toFixed(),
        });
      }
    });
  }

  /** The till's arithmetic and tax rates, checked line by line and on the header. */
  private async checkMoney(
    tx: Tx,
    doc: SaleDoc,
    soldDay: string,
    products: ReadonlyMap<number, ProductSummary>,
  ): Promise<void> {
    const company = await this.tax.companyRates(soldDay, tx);
    const mismatch = (lineNo: number | null, field: string, expected: Decimal, got: Decimal) =>
      new AppError('POS_TOTALS_MISMATCH', `${field} differs${lineNo ? ` on line ${lineNo}` : ''}`, {
        lineNo,
        field,
        expected: expected.toFixed(MONEY_SCALE),
        got: got.toFixed(MONEY_SCALE),
      });
    for (const line of doc.lines) {
      const product = products.get(line.productId);
      if (!product) throw notFound('product', line.productId);
      const rates = this.tax.ratesFor(product, company);
      if (!rates.vatRatePct.eq(line.vatRatePct)) {
        throw new AppError('POS_TAX_MISMATCH', `line ${line.lineNo}: VAT rate differs`, {
          lineNo: line.lineNo,
          expected: rates.vatRatePct.toFixed(),
          got: line.vatRatePct.toFixed(),
        });
      }
      const money = lineMoney(line.qty, line.unitPrice, line.discountAmount);
      if (!money.subtotal.eq(line.subtotal)) {
        throw mismatch(line.lineNo, 'subtotal', money.subtotal, line.subtotal);
      }
      if (!money.total.eq(line.total))
        throw mismatch(line.lineNo, 'total', money.total, line.total);
      const vat = lineVat(line.total, line.vatRatePct);
      if (!vat.eq(line.vatAmount)) throw mismatch(line.lineNo, 'vatAmount', vat, line.vatAmount);
    }
    const totals = saleTotals(doc.lines);
    for (const [field, expected, got] of [
      ['subtotal', totals.subtotal, doc.subtotal],
      ['discountTotal', totals.discountTotal, doc.discountTotal],
      ['total', totals.total, doc.total],
      ['vatTotal', totals.vatTotal, doc.vatTotal],
      ['tenders', doc.total, tendersTotal(doc.tenders)],
    ] as const) {
      if (!expected.eq(got)) throw mismatch(null, field, expected, got);
    }
  }

  /** A return takes back what one sale sold, within the window, at the sold prices. */
  private async checkReturn(
    tx: Tx,
    node: EdgeNode,
    doc: SaleDoc,
    soldDay: string,
    settings: { returnWindowDays: number },
  ): Promise<{ sale: SaleRow; lines: Map<number, LineRow> }> {
    const [sale] = await tx
      .select()
      .from(posSales)
      .where(
        and(eq(posSales.edgeNodeId, node.id), eq(posSales.clientId, doc.refundsSaleClientId ?? '')),
      )
      .for('update');
    if (!sale || sale.kind !== 'SALE') {
      throw invalid('refundsSaleClientId', 'sale', 'the sale to refund is unknown');
    }
    if (!withinReturnWindow(sale.soldDay, soldDay, settings.returnWindowDays)) {
      throw new AppError('POS_RETURN_WINDOW', `sale ${sale.number} is outside the return window`, {
        number: sale.number,
        soldDay: sale.soldDay,
        windowDays: settings.returnWindowDays,
      });
    }
    const soldLines = await tx
      .select()
      .from(posSaleLines)
      .where(eq(posSaleLines.saleId, sale.id))
      .for('update');
    const byLineNo = new Map(soldLines.map((line) => [line.lineNo, line]));
    const taking = new Map<number, Decimal>();
    doc.lines.forEach((line, index) => {
      const sold = line.refundsLineNo === null ? undefined : byLineNo.get(line.refundsLineNo);
      if (!sold) throw invalid(`lines[${index}].refundsLineNo`, 'exists', 'a line of the sale');
      if (sold.productId !== line.productId || sold.productUnitId !== line.productUnitId) {
        throw invalid(`lines[${index}].productUnitId`, 'sold', 'the sold product and unit');
      }
      if (!sold.unitPrice.eq(line.unitPrice)) {
        throw new AppError('POS_TOTALS_MISMATCH', `line ${line.lineNo}: refund price differs`, {
          lineNo: line.lineNo,
          field: 'unitPrice',
          expected: sold.unitPrice.toFixed(MONEY_SCALE),
          got: line.unitPrice.toFixed(MONEY_SCALE),
        });
      }
      const sum = (taking.get(sold.id) ?? new Decimal(0)).plus(line.qty.times(line.factorSnapshot));
      taking.set(sold.id, sum);
      const remaining = sold.qtyBase.minus(sold.returnedBase);
      if (sum.gt(remaining)) {
        throw new AppError('POS_RETURN_EXCEEDS', `line ${line.lineNo}: more than was sold`, {
          lineNo: line.lineNo,
          remaining: remaining.toFixed(QTY_SCALE),
          requested: sum.toFixed(QTY_SCALE),
        });
      }
    });
    return { sale, lines: byLineNo };
  }

  private async takeBack(
    tx: Tx,
    soldLines: ReadonlyMap<number, LineRow>,
    lines: readonly SaleDocLine[],
  ): Promise<void> {
    const taken = new Map<number, Decimal>();
    for (const line of lines) {
      const sold = line.refundsLineNo === null ? undefined : soldLines.get(line.refundsLineNo);
      if (!sold) continue;
      taken.set(
        sold.id,
        (taken.get(sold.id) ?? new Decimal(0)).plus(line.qty.times(line.factorSnapshot)),
      );
    }
    for (const [lineId, qtyBase] of taken) {
      await tx
        .update(posSaleLines)
        .set({
          returnedBase: sql`${posSaleLines.returnedBase} + ${qtyBase.toFixed(QTY_SCALE)}::numeric`,
        })
        .where(eq(posSaleLines.id, lineId));
    }
  }

  /**
   * The shortfall rule (ADR-0063 #5): the shelf's balances of the sold products are locked; what
   * the sale needs beyond them is adjusted in first (`POS_SHORTFALL`, one line per product), so the
   * sale posts in full and the storekeeper sees exactly what was missing.
   */
  private async fillShortfalls(
    tx: Tx,
    actor: Actor,
    node: EdgeNode,
    number: string,
    saleId: number,
    lines: readonly LineRow[],
    products: ReadonlyMap<number, ProductSummary>,
    salesfloorId: number,
  ): Promise<{ id: number; number: string } | null> {
    const needed = new Map<number, Decimal>();
    const firstLine = new Map<number, number>();
    for (const line of lines) {
      needed.set(line.productId, (needed.get(line.productId) ?? new Decimal(0)).plus(line.qtyBase));
      if (!firstLine.has(line.productId)) firstLine.set(line.productId, line.id);
    }
    const productIds = [...needed.keys()].sort((a, b) => a - b);
    const onHand = await this.stock.lockOnHandInBin(tx, salesfloorId, productIds);
    const shorts: { productId: number; qtyBase: Decimal }[] = [];
    for (const productId of productIds) {
      const short = (needed.get(productId) ?? new Decimal(0)).minus(
        onHand.get(productId) ?? new Decimal(0),
      );
      if (short.gt(0)) shorts.push({ productId, qtyBase: short });
    }
    if (shorts.length === 0) return null;
    const adjustmentLines: SystemAdjustmentLine[] = shorts.map((short) => {
      const product = products.get(short.productId);
      if (!product) throw notFound('product', short.productId);
      return {
        productId: short.productId,
        productUnitId: product.baseUnit.id,
        enteredQty: short.qtyBase,
        factorSnapshot: new Decimal(1),
        binId: salesfloorId,
        unitCost: null,
      };
    });
    const adjustment = await this.adjustments.postSystemInTx(tx, actor, {
      warehouseId: node.warehouseId,
      reason: 'POS_SHORTFALL',
      note: `POS ${number}`,
      lines: adjustmentLines,
    });
    await tx.insert(posShortfalls).values(
      shorts.map((short) => ({
        saleId,
        saleLineId: firstLine.get(short.productId) ?? 0,
        productId: short.productId,
        warehouseId: node.warehouseId,
        qtyBase: short.qtyBase,
        adjustmentId: adjustment.id,
        adjustmentNumber: adjustment.number,
      })),
    );
    return adjustment;
  }
}
