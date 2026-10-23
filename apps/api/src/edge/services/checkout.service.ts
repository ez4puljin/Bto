import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode, cleanBarcode } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeBarcodeHit,
  type EdgeCartLine,
  type EdgeCashier,
  type EdgeProductHit,
  type EdgeQuickGroup,
  type EdgeQuoteResponse,
  type EdgeReceipt,
  type EdgeSaleRequest,
  lineVat,
  POS_LIMITS,
  posSaleNumber,
  type SaleDocWire,
  saleDocLinesOf,
  saleTotals,
  type SnapshotProduct,
  type TenderWire,
} from '@tugeel/shared/pos';
import { type QuoteLineInput, type QuoteResult, resolveQuote } from '@tugeel/shared/pricing';
import { matchesQuery, matchesStrictly, queryTerms } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq } from 'drizzle-orm';
import { AppError, notFound } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../db/edge-db';
import { edgeSales } from '../db/schema';
import { OutboxService } from './outbox.service';
import { nextSequence } from './sequences';
import { EdgeShiftsService } from './shifts.service';
import { type LoadedSnapshot, SnapshotStore } from './snapshot.store';

const SEARCH_LIMIT = 30;

/**
 * Selling at a till (ADR-0063 #3–#5, ADR-0067): products found by name, SKU or barcode in the
 * snapshot, priced at RETAIL by the same pure resolver as the centre, a sale written with its
 * document and its outbox entry in one edge transaction under the till's own number. Payments are
 * taken as given (cash with change, card by hand); the e-Barimt is a test receipt for now.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly shifts: EdgeShiftsService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Products by name, SKU or barcode (ADR-0104): a typed barcode first, then an exact SKU, then
   * the names and SKUs that match strictly, then those that match by sound (Latin or Cyrillic).
   */
  search(query: string): EdgeProductHit[] {
    const loaded = this.store.get();
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const first: SnapshotProduct[] = [];
    const code = cleanBarcode(query);
    if (code) {
      const classified = classifyBarcode(code);
      const unitId = classified.ok ? loaded.barcodes.get(classified.value.lookupKey) : undefined;
      const found = unitId === undefined ? undefined : loaded.units.get(unitId);
      if (found) first.push(found.product);
    }
    const sku = query.trim().toUpperCase();
    const strict: SnapshotProduct[] = [];
    const loose: SnapshotProduct[] = [];
    for (const { product, keys } of loaded.search) {
      if (product.sku.toUpperCase() === sku) first.push(product);
      else if (matchesStrictly(keys, terms)) strict.push(product);
      else if (matchesQuery(keys, terms)) loose.push(product);
      if (strict.length >= SEARCH_LIMIT) break;
    }
    const seen = new Set<number>();
    return [...first, ...strict, ...loose]
      .filter((product) => !seen.has(product.id) && seen.add(product.id))
      .slice(0, SEARCH_LIMIT)
      .map((product) => this.hit(loaded, product));
  }

  /** The F7 panel (ADR-0104): the admin's groups with today's prices. */
  quickGroups(): EdgeQuickGroup[] {
    const loaded = this.store.get();
    return (loaded.snapshot.quickGroups ?? []).flatMap((group) => {
      const buttons = group.buttons.flatMap((button) => {
        const found = loaded.units.get(button.unitId);
        return found
          ? [
              {
                label: button.label,
                unitId: button.unitId,
                product: this.hit(loaded, found.product),
              },
            ]
          : [];
      });
      return buttons.length ? [{ id: group.id, name: group.name, buttons }] : [];
    });
  }

  barcode(code: string): EdgeBarcodeHit {
    const loaded = this.store.get();
    const classified = classifyBarcode(code);
    const unitId = classified.ok ? loaded.barcodes.get(classified.value.lookupKey) : undefined;
    const found = unitId === undefined ? undefined : loaded.units.get(unitId);
    if (!found || unitId === undefined) {
      throw new AppError('NOT_FOUND', `barcode ${code} not found`, { code });
    }
    return { product: this.hit(loaded, found.product), unitId };
  }

  quote(lines: readonly EdgeCartLine[]): EdgeQuoteResponse {
    const loaded = this.store.get();
    const { inputs, result } = this.price(loaded, lines);
    const vat = inputs.map((input, index) => {
      const line = result.lines[index];
      return line?.priced
        ? lineVat(line.total, this.vatRate(loaded, input.productId))
        : new Decimal(0);
    });
    return {
      lines: inputs.map((input, index) => {
        const line = result.lines[index];
        const found = loaded.units.get(input.unitId);
        const priced = line?.priced === true;
        return {
          productId: input.productId,
          productUnitId: input.unitId,
          sku: found?.product.sku ?? '',
          name: found?.product.name ?? '',
          uomName: found?.unit.uomName ?? '',
          qty: input.qty.toString(),
          priced,
          unitPrice:
            priced && input.qty.gt(0)
              ? line.total.dividedBy(input.qty).toDecimalPlaces(2).toFixed(2)
              : null,
          total: priced ? line.total.toFixed(2) : null,
          discount: priced ? line.discountAmount.toFixed(2) : null,
        };
      }),
      subtotal: result.subtotal.toFixed(2),
      discountTotal: result.discountTotal.toFixed(2),
      total: result.total.toFixed(2),
      vatTotal: vat.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed(2),
    };
  }

  /** The sale of a cart; a repeated client id returns the receipt it already made. */
  async sell(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeSaleRequest,
  ): Promise<EdgeReceipt> {
    const [existing] = await this.db
      .select({ receipt: edgeSales.receipt })
      .from(edgeSales)
      .where(eq(edgeSales.clientId, request.clientId));
    if (existing) return existing.receipt;
    const loaded = this.store.get();
    const { inputs, result } = this.price(loaded, request.lines);
    result.lines.forEach((line, index) => {
      if (!line.priced) {
        const productId = inputs[index]?.productId ?? null;
        throw new AppError('PRICE_MISSING', `product ${productId} has no price`, { productId });
      }
    });
    const lines = saleDocLinesOf(
      inputs,
      result,
      new Map([...loaded.units].map(([unitId, found]) => [unitId, { factor: found.unit.factor }])),
      (productId) => this.vatRate(loaded, productId),
      lineVat,
    );
    const totals = saleTotals(lines);
    const tenders = this.tenders(request, totals.total);
    return inEdgeTransaction(this.db, async (tx) => {
      const shift = await this.shifts.current(tillCode, tx);
      if (!shift) {
        throw new AppError('POS_SHIFT_STATE_INVALID', `till ${tillCode} has no open shift`, {
          tillCode,
        });
      }
      const soldAt = new Date();
      const day = businessDate(soldAt);
      const number = posSaleNumber(tillCode, day, await nextSequence(tx, `SALE:${tillCode}`, day));
      const doc: SaleDocWire = {
        clientId: request.clientId,
        kind: 'SALE',
        tillCode,
        shiftClientId: shift.clientId,
        cashierUserId: cashier.userId,
        approvedByUserId: null,
        number,
        soldAt: soldAt.toISOString(),
        receiptType: 'B2C',
        customerTin: null,
        customerName: null,
        consumerNo: null,
        refundsSaleClientId: null,
        lines,
        tenders: tenders.wire,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        total: totals.total.toFixed(2),
        vatTotal: totals.vatTotal.toFixed(2),
        note: null,
        snapshotVersion: loaded.snapshot.version,
        ebarimt: null,
      };
      const receipt: EdgeReceipt = {
        clientId: request.clientId,
        kind: 'SALE',
        refundsNumber: null,
        number,
        soldAt: doc.soldAt,
        tillCode,
        cashierName: cashier.fullName,
        companyName: loaded.snapshot.company.name,
        lines: lines.map((line) => {
          const found = loaded.units.get(line.productUnitId);
          return {
            name: found?.product.name ?? '',
            uomName: found?.unit.uomName ?? '',
            qty: new Decimal(line.qty).toString(),
            unitPrice: line.unitPrice,
            total: line.total,
          };
        }),
        subtotal: doc.subtotal,
        discountTotal: doc.discountTotal,
        total: doc.total,
        vatTotal: doc.vatTotal,
        tenders: tenders.wire.map((tender) => ({
          kind: tender.kind,
          amount: tender.amount,
          tendered: tender.tendered,
        })),
        change: tenders.change.toFixed(2),
        ebarimt: { mode: 'TEST', ddtd: null },
      };
      await tx.insert(edgeSales).values({
        clientId: request.clientId,
        shiftClientId: shift.clientId,
        tillCode,
        cashierUserId: cashier.userId,
        number,
        soldAt,
        total: totals.total,
        cashAmount: tenders.cash,
        cardAmount: tenders.card,
        vatTotal: totals.vatTotal,
        doc,
        receipt,
      });
      await this.outbox.enqueue(tx, { kind: 'SALE', clientId: request.clientId, sale: doc });
      return receipt;
    });
  }

  async recent(tillCode: string): Promise<EdgeReceipt[]> {
    const shift = await this.shifts.current(tillCode);
    if (!shift) return [];
    const rows = await this.db
      .select({ receipt: edgeSales.receipt })
      .from(edgeSales)
      .where(and(eq(edgeSales.tillCode, tillCode), eq(edgeSales.shiftClientId, shift.clientId)))
      .orderBy(desc(edgeSales.soldAt))
      .limit(20);
    return rows.map((row) => row.receipt);
  }

  private price(
    loaded: LoadedSnapshot,
    lines: readonly EdgeCartLine[],
  ): { inputs: QuoteLineInput[]; result: QuoteResult } {
    if (lines.length === 0 || lines.length > POS_LIMITS.maxLines) {
      throw new AppError('VALIDATION_FAILED', `a cart has 1 to ${POS_LIMITS.maxLines} lines`);
    }
    const inputs = lines.map((line): QuoteLineInput => {
      const found = loaded.units.get(line.productUnitId);
      if (!found) throw notFound('product_unit', line.productUnitId);
      const qty = new Decimal(line.qty);
      if (!qty.isFinite() || qty.lte(0) || qty.decimalPlaces() > 3) {
        throw new AppError('VALIDATION_FAILED', `bad quantity ${line.qty}`);
      }
      return {
        productId: found.product.id,
        unitId: line.productUnitId,
        qty,
        qtyBase: qty.times(found.unit.factor).toDecimalPlaces(3),
      };
    });
    const result = resolveQuote(inputs, {
      list: 'RETAIL',
      products: loaded.quote.products,
      programs: loaded.quote.programs,
    });
    return { inputs, result };
  }

  /** Cash and card as entered: their amounts must make the total; cash may exceed it (change). */
  private tenders(
    request: EdgeSaleRequest,
    total: Decimal,
  ): { wire: TenderWire[]; cash: Decimal; card: Decimal; change: Decimal } {
    if (request.tenders.length === 0 || request.tenders.length > POS_LIMITS.maxTenders) {
      throw new AppError('VALIDATION_FAILED', 'a sale is paid by one to a few tenders');
    }
    let cash = new Decimal(0);
    let card = new Decimal(0);
    let tendered = new Decimal(0);
    const wire = request.tenders.map((tender): TenderWire => {
      const amount = new Decimal(tender.amount);
      if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2) {
        throw new AppError('VALIDATION_FAILED', `bad tender amount ${tender.amount}`);
      }
      if (tender.kind === 'CASH') {
        const given = tender.tendered ? new Decimal(tender.tendered) : amount;
        if (!given.isFinite() || given.lt(amount)) {
          throw new AppError('VALIDATION_FAILED', 'the cash handed over is less than its amount');
        }
        cash = cash.plus(amount);
        tendered = tendered.plus(given);
        return {
          kind: 'CASH',
          amount: amount.toFixed(2),
          tendered: given.toFixed(2),
          terminalId: null,
          rrn: null,
          maskedPan: null,
        };
      }
      card = card.plus(amount);
      return {
        kind: 'CARD',
        amount: amount.toFixed(2),
        tendered: null,
        terminalId: tender.terminalId?.trim() || null,
        rrn: tender.rrn?.trim() || null,
        maskedPan: null,
      };
    });
    if (!cash.plus(card).eq(total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'the tenders do not make the total', {
        total: total.toFixed(2),
        paid: cash.plus(card).toFixed(2),
      });
    }
    return { wire, cash, card, change: tendered.minus(cash) };
  }

  private hit(loaded: LoadedSnapshot, product: SnapshotProduct): EdgeProductHit {
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      units: product.units.map((unit) => {
        const { result } = this.price(loaded, [{ productUnitId: unit.unitId, qty: '1' }]);
        const line = result.lines[0];
        return {
          unitId: unit.unitId,
          uomName: unit.uomName,
          factor: unit.factor,
          isBase: unit.isBase,
          price: line?.priced ? line.total.toFixed(2) : null,
          barcodes: unit.codes ?? [],
        };
      }),
    };
  }

  private vatRate(loaded: LoadedSnapshot, productId: number): Decimal {
    return loaded.vatRates.get(productId) ?? new Decimal(0);
  }
}
