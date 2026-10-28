import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  lineVat,
  posSaleNumber,
  posShiftNumber,
  type ReceiptType,
  saleTotals,
  type TenderKind,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, TaxService } from '../../catalog';
import { type AuthContext, NumberingService } from '../../identity';
import { PriceQuoteService } from '../../pricing';
import type { SaleDoc, SaleDocLine } from '../sale-doc';
import { posShifts } from '../schema';
import { PosAcceptService } from './pos-accept.service';
import { PosEdgeNodesService } from './pos-edge-nodes.service';
import { PosShiftsService } from './pos-shifts.service';
import { PosTillsService } from './pos-tills.service';

export interface DevSaleInput {
  shiftId: number;
  cashierUserId: number;
  approvedByUserId: number | null;
  lines: { productUnitId: number; qty: Decimal }[];
  tenders: { kind: TenderKind; amount: Decimal; tendered: Decimal | null }[];
  receiptType: ReceiptType;
  customerTin: string | null;
  customerName: string | null;
  note: string | null;
}

/**
 * The «Туршилтын касс» of the admin (ADR-0063 #8, development only): prices a cart at RETAIL on
 * the centre, builds the same document a till would and runs it through the accept path, so the
 * owner sees shifts, sales, shortfalls and the close before the edge exists (S2).
 */
@Injectable()
export class PosDevService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly numbering: NumberingService,
    private readonly catalog: CatalogService,
    private readonly tax: TaxService,
    private readonly quotes: PriceQuoteService,
    private readonly nodes: PosEdgeNodesService,
    private readonly tills: PosTillsService,
    private readonly shifts: PosShiftsService,
    private readonly accept: PosAcceptService,
  ) {}

  assertEnabled(): void {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new AppError('POS_DEV_ONLY', 'the test till exists only in development');
    }
  }

  async openShift(
    ctx: AuthContext,
    input: { tillId: number; cashierUserId: number; openingFloat: Decimal },
  ): Promise<number> {
    this.assertEnabled();
    return inTransaction(this.db, async (tx) => {
      const till = await this.tills.get(input.tillId, tx);
      const node = await this.nodes.get(till.edgeNodeId, tx);
      const today = businessDate();
      const seq = await this.numbering.next(tx, `POS_SHIFT:${node.id}:${till.code}`, today);
      const accepted = await this.shifts.acceptOpen(tx, ctx, node, {
        clientId: randomUUID(),
        tillCode: till.code,
        cashierUserId: input.cashierUserId,
        number: posShiftNumber(till.code, today, seq),
        openedAt: new Date(),
        openingFloat: input.openingFloat,
      });
      return accepted.id;
    });
  }

  async sell(ctx: AuthContext, input: DevSaleInput): Promise<number> {
    this.assertEnabled();
    if (input.lines.length === 0) throw invalid('lines', 'count', 'at least one line');
    return inTransaction(this.db, async (tx) => {
      const [shift] = await tx.select().from(posShifts).where(eq(posShifts.id, input.shiftId));
      if (!shift) throw notFound('pos_shift', input.shiftId);
      const till = await this.tills.get(shift.tillId, tx);
      const node = await this.nodes.get(till.edgeNodeId, tx);
      const soldAt = new Date();
      const today = businessDate(soldAt);
      const lines = await this.priceLines(tx, input.lines, today);
      const totals = saleTotals(lines);
      const seq = await this.numbering.next(tx, `POS_SALE:${node.id}:${till.code}`, today);
      const doc: SaleDoc = {
        clientId: randomUUID(),
        kind: 'SALE',
        tillCode: till.code,
        shiftClientId: shift.clientId,
        cashierUserId: input.cashierUserId,
        approvedByUserId: input.approvedByUserId,
        number: posSaleNumber(till.code, today, seq),
        soldAt,
        receiptType: input.receiptType,
        customerTin: input.customerTin,
        customerName: input.customerName,
        consumerNo: null,
        refundsSaleClientId: null,
        customerId: null,
        vouchers: [],
        loyalty: null,
        lines,
        tenders: input.tenders.map((tender) => ({
          kind: tender.kind,
          paymentTypeId: null,
          paymentTypeName: null,
          amount: tender.amount,
          tendered: tender.kind === 'CASH' ? tender.tendered : null,
          terminalId: null,
          rrn: null,
          maskedPan: null,
          voucherCode: null,
        })),
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        vatTotal: totals.vatTotal,
        note: input.note,
        snapshotVersion: null,
        ebarimt: null,
      };
      return (await this.accept.acceptSale(tx, ctx, node, doc)).id;
    });
  }

  async closeShift(
    ctx: AuthContext,
    shiftId: number,
    input: { countedCash: Decimal; floatKept: Decimal; note: string | null },
  ): Promise<number> {
    this.assertEnabled();
    return inTransaction(this.db, async (tx) => {
      const [shift] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId));
      if (!shift) throw notFound('pos_shift', shiftId);
      const node = await this.nodes.get(shift.edgeNodeId, tx);
      await this.shifts.acceptClose(tx, ctx, node, {
        clientId: shift.clientId,
        closedAt: new Date(),
        countedCash: input.countedCash,
        floatKept: input.floatKept,
        note: input.note,
      });
      return shiftId;
    });
  }

  /** The cart at RETAIL today, the VAT per line as the company's rates say. */
  private async priceLines(
    tx: Tx,
    lines: { productUnitId: number; qty: Decimal }[],
    today: string,
  ): Promise<SaleDocLine[]> {
    const quote = await this.quotes.quote({ list: 'RETAIL', date: today, lines }, tx);
    const company = await this.tax.companyRates(today, tx);
    const products = new Map(
      (
        await this.catalog.getMany(
          quote.lines.map((line) => line.productId),
          tx,
        )
      ).map((product) => [product.id, product]),
    );
    const result: SaleDocLine[] = [];
    quote.lines.forEach((line, index) => {
      if (!line.result.priced) {
        throw new AppError('PRICE_MISSING', `product ${line.productId} has no price`, {
          productId: line.productId,
        });
      }
      const product = products.get(line.productId);
      if (!product) throw notFound('product', line.productId);
      const rates = this.tax.ratesFor(product, company);
      for (const part of line.result.parts) {
        result.push({
          lineNo: result.length + 1,
          productId: line.productId,
          productUnitId: part.unitId,
          qty: part.qty,
          factorSnapshot: part.factorSnapshot,
          basis: part.basis,
          listPrice: part.listPrice,
          unitPrice: part.unitPrice,
          discountAmount: part.discountAmount,
          subtotal: part.subtotal,
          total: part.total,
          vatRatePct: rates.vatRatePct,
          vatAmount: lineVat(part.total, rates.vatRatePct),
          applied: part.applied,
          refundsLineNo: null,
          damaged: false,
        });
      }
      if (line.result.parts.length === 0) {
        throw invalid(`lines[${index}]`, 'parts', 'the quote returned no part');
      }
    });
    return result;
  }
}
