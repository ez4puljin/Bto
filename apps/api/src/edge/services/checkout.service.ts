import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode, cleanBarcode } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeBarcodeHit,
  type EdgeCartLine,
  type EdgeCashier,
  type EdgeProductHit,
  type EdgeQuickGroup,
  type EdgeQuotedVoucher,
  type EdgeQuoteResponse,
  type EdgeReceipt,
  type EdgeSaleRequest,
  lineVat,
  POS_LIMITS,
  type PosVoucherFacts,
  posSaleNumber,
  type SaleDocWire,
  saleDocLinesOf,
  saleTotals,
  type SnapshotProduct,
  type SaleVoucherWire,
  type TenderWire,
  voucherPayments,
} from '@tugeel/shared/pos';
import {
  type QuoteCoupon,
  type QuoteLineInput,
  type QuoteResult,
  resolveQuote,
} from '@tugeel/shared/pricing';
import { matchesQuery, matchesStrictly, queryTerms } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq } from 'drizzle-orm';
import { AppError, notFound } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeSales, edgeVoucherUses } from '../db/schema';
import { EbarimtService } from '../ebarimt/ebarimt.service';
import { TaxpayerClient } from '../ebarimt/taxpayer.client';
import { CreditGate } from './credit-gate.service';
import { CustomerStore } from './customer.store';
import { KioskAuthService } from './kiosk-auth.service';
import { OutboxService } from './outbox.service';
import { nextSequence } from './sequences';
import { EdgeShiftsService } from './shifts.service';
import { type LoadedSnapshot, SnapshotStore } from './snapshot.store';
import { refused, VoucherStore, viewOf } from './voucher.store';

const SEARCH_LIMIT = 30;

/**
 * Selling at a till (ADR-0063 #3–#5, ADR-0067): products found by name, SKU or barcode in the
 * snapshot, priced at RETAIL by the same pure resolver as the centre, a sale written with its
 * document and its outbox entry in one edge transaction under the till's own number. Payments are
 * taken as given (cash with change, card by hand). The e-Barimt (ADR-0065) is queued in the same
 * transaction and issued right after it (`EbarimtService.afterCommit`); a company's receipt needs
 * its TIN found by the online lookup first. ADR-0109: the cashier chooses the receipt
 * («Хувь хүн» or «Байгууллага») and the payment, a CREDIT part needing a registered customer and
 * the credit check (`CreditGate`); a sale with credit gets no e-Barimt (owner 2026-10-27).
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly shifts: EdgeShiftsService,
    private readonly outbox: OutboxService,
    private readonly ebarimt: EbarimtService,
    private readonly taxpayers: TaxpayerClient,
    private readonly customers: CustomerStore,
    private readonly credit: CreditGate,
    private readonly vouchers: VoucherStore,
    private readonly auth: KioskAuthService,
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
    return this.quoteOf(lines, []);
  }

  /** ADR-0110: the quote with the coupons and partner vouchers scanned, each checked first. */
  async quoteWithCodes(
    lines: readonly EdgeCartLine[],
    codes: readonly string[],
  ): Promise<EdgeQuoteResponse> {
    return this.quoteOf(lines, await this.vouchers.resolve(codes));
  }

  private quoteOf(
    lines: readonly EdgeCartLine[],
    facts: readonly PosVoucherFacts[],
  ): EdgeQuoteResponse {
    const loaded = this.store.get();
    const { inputs, result } = this.price(loaded, lines, couponsOf(facts));
    const vouchers = codesTaken(facts, result);
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
      vouchers: vouchers.quoted,
      voucherTotal: vouchers.paid.toFixed(2),
      due: result.total.minus(vouchers.paid).toFixed(2),
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
    const codes = request.codes ?? [];
    // ADR-0110: a supervisor's PIN once for the sale's codes (owner 2026-10-27), always.
    const approver = codes.length > 0 ? await this.voucherApprover(request) : null;
    const facts = await this.vouchers.resolve(codes);
    const { inputs, result } = this.price(loaded, request.lines, couponsOf(facts));
    const taken = codesTaken(facts, result);
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
    const tenders = this.tenders(request, totals.total.minus(taken.paid), taken.wire);
    if (tenders.credit.gt(0) && taken.paid.gt(0)) {
      throw new AppError('POS_VOUCHER_WITH_CREDIT', 'a partner voucher and credit together', {});
    }
    const customer = tenders.credit.gt(0)
      ? await this.creditCustomer(request, tenders.credit)
      : null;
    // A sale with credit has no e-Barimt; otherwise the cashier's choice, B2B with a found buyer.
    const wanted = request.receiptType ?? (request.buyer ? 'B2B' : 'B2C');
    if (!customer && wanted === 'B2B' && !request.buyer) {
      throw new AppError('POS_BUYER_REQUIRED', 'a company receipt needs the buyer', {});
    }
    // Offline there are no company receipts (owner 2026-10-26): the lookup refuses first.
    const buyer =
      !customer && wanted === 'B2B' && request.buyer
        ? await this.taxpayers.lookup(request.buyer.tin)
        : null;
    const receiptType = buyer ? 'B2B' : 'B2C';
    const issues = this.ebarimt.enabled && !customer;
    const settings = loaded.snapshot.settings;
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
        approvedByUserId: approver?.userId ?? null,
        number,
        soldAt: soldAt.toISOString(),
        receiptType,
        customerTin: buyer?.tin ?? null,
        customerName: buyer?.name ?? null,
        consumerNo: null,
        refundsSaleClientId: null,
        customerId: customer?.id ?? null,
        vouchers: taken.doc,
        lines,
        tenders: tenders.wire,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        total: totals.total.toFixed(2),
        vatTotal: totals.vatTotal.toFixed(2),
        note: null,
        snapshotVersion: loaded.snapshot.version,
        ebarimt: issues
          ? {
              status: 'PENDING',
              ddtd: null,
              posapiDate: null,
              billIdSuffix: null,
              inactiveId: null,
            }
          : null,
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
        vouchers: taken.quoted.map((voucher) => ({
          code: voucher.code,
          kind: voucher.kind,
          name: voucher.name,
          amount: voucher.amount,
        })),
        credit: customer
          ? {
              customerId: customer.id,
              customerCode: customer.code,
              customerName: customer.name,
              amount: tenders.credit.toFixed(2),
            }
          : null,
        title: settings.receiptTitle ?? null,
        footer: settings.receiptFooter ?? null,
        ebarimt: issues
          ? this.ebarimt.pendingFacts(receiptType, buyer?.tin ?? null, buyer?.name ?? null)
          : { mode: this.ebarimt.enabled ? 'REAL' : 'TEST', ddtd: null, status: 'NONE' },
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
        creditAmount: tenders.credit,
        customerId: customer?.id ?? null,
        voucherAmount: taken.paid,
        vatTotal: totals.vatTotal,
        doc,
        receipt,
      });
      if (codes.length > 0) await this.takeCodes(tx, request.clientId, codes, taken.doc);
      await this.outbox.enqueue(tx, { kind: 'SALE', clientId: request.clientId, sale: doc });
      if (issues) {
        await this.ebarimt.enqueueSale(tx, {
          ownerClientId: request.clientId,
          tillCode,
          receiptType,
          customerTin: buyer?.tin ?? null,
          customerName: buyer?.name ?? null,
          lines: this.ebarimt.linesOf(doc, loaded),
          cash: tenders.cash,
          card: tenders.card,
          voucher: taken.paid,
          total: totals.total,
          vatTotal: totals.vatTotal,
        });
      }
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
    coupons: readonly QuoteCoupon[] = [],
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
      coupons,
    });
    return { inputs, result };
  }

  /** The supervisor who approved the sale's codes: required for every sale with one. */
  private async voucherApprover(request: EdgeSaleRequest) {
    if (!request.voucherApproval) {
      throw new AppError('POS_SUPERVISOR_REQUIRED', 'a supervisor approves the codes', {});
    }
    return this.auth.approve(request.voucherApproval);
  }

  /**
   * The sale's codes, taken inside its transaction: read again (a code another till took meanwhile
   * is refused) and one use row each, whose key holds the code against a second sale.
   */
  private async takeCodes(
    tx: EdgeTx,
    clientId: string,
    codes: readonly string[],
    taken: readonly SaleVoucherWire[],
  ): Promise<void> {
    await this.vouchers.resolve(codes, tx);
    const uses = await tx
      .insert(edgeVoucherUses)
      .values(
        taken.map((voucher) => ({
          code: voucher.code,
          voucherId: voucher.voucherId,
          kind: voucher.kind,
          saleClientId: clientId,
          amount: new Decimal(voucher.amount),
        })),
      )
      .onConflictDoNothing()
      .returning({ code: edgeVoucherUses.code });
    const missing = taken.find((voucher) => !uses.some((use) => use.code === voucher.code));
    if (missing) {
      throw new AppError('POS_VOUCHER_USED', `code ${missing.code} was used meanwhile`, {
        code: missing.code,
      });
    }
  }

  /**
   * The customer a credit part charges (ADR-0109): named by the cashier, known to the feed, and
   * let through by the credit check.
   */
  private async creditCustomer(request: EdgeSaleRequest, credit: Decimal) {
    if (!request.customerId) {
      throw new AppError('POS_CUSTOMER_REQUIRED', 'a sale on credit names its customer', {});
    }
    const customer = this.customers.get(request.customerId);
    await this.credit.assert(customer.id, credit, request.acceptOverLimit === true);
    return customer;
  }

  /**
   * Cash, card and credit as entered: their amounts must make the total; cash may exceed it (the
   * change). At most one CREDIT part (ADR-0109).
   */
  private tenders(
    request: EdgeSaleRequest,
    total: Decimal,
    vouchers: readonly TenderWire[] = [],
  ): { wire: TenderWire[]; cash: Decimal; card: Decimal; credit: Decimal; change: Decimal } {
    // ADR-0110: nothing to tender when partner vouchers pay the whole sale.
    const none = request.tenders.length === 0 && total.isZero() && vouchers.length > 0;
    if (!none && (request.tenders.length === 0 || request.tenders.length > POS_LIMITS.maxTenders)) {
      throw new AppError('VALIDATION_FAILED', 'a sale is paid by one to a few tenders');
    }
    if (request.tenders.some((tender) => tender.kind === 'VOUCHER')) {
      throw new AppError('VALIDATION_FAILED', 'the edge makes the voucher tenders from the codes');
    }
    if (request.tenders.filter((tender) => tender.kind === 'CREDIT').length > 1) {
      throw new AppError('VALIDATION_FAILED', 'a sale has at most one credit part');
    }
    let cash = new Decimal(0);
    let card = new Decimal(0);
    let credit = new Decimal(0);
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
      if (tender.kind === 'CREDIT') {
        credit = credit.plus(amount);
        return {
          kind: 'CREDIT',
          amount: amount.toFixed(2),
          tendered: null,
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
    const paid = cash.plus(card).plus(credit);
    if (!paid.eq(total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'the tenders do not make the total', {
        total: total.toFixed(2),
        paid: paid.toFixed(2),
      });
    }
    // A zero part is no tender (the centre wants every amount positive).
    return {
      wire: [...wire.filter((tender) => new Decimal(tender.amount).gt(0)), ...vouchers],
      cash,
      card,
      credit,
      change: tendered.minus(cash),
    };
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

/** The coupons among a sale's codes, as the resolver takes them (ADR-0110). */
function couponsOf(facts: readonly PosVoucherFacts[]): QuoteCoupon[] {
  return facts
    .filter((facts) => facts.kind === 'COUPON')
    .map((coupon) => ({
      code: coupon.code,
      name: coupon.name,
      effect: coupon.effect,
      value: new Decimal(coupon.value),
    }));
}

/**
 * What each code of a priced cart does, in the order scanned: a coupon what it took off the lines,
 * a partner voucher what it pays of the total (its face value or what is left); a partner voucher
 * with nothing left to pay is refused.
 */
function codesTaken(
  facts: readonly PosVoucherFacts[],
  result: QuoteResult,
): {
  quoted: EdgeQuotedVoucher[];
  doc: SaleVoucherWire[];
  wire: TenderWire[];
  paid: Decimal;
} {
  const partners = facts.filter((one) => one.kind === 'PARTNER');
  const payments = voucherPayments(
    result.total,
    partners.map((partner) => partner.value),
  );
  const paidBy = new Map(partners.map((partner, index) => [partner.code, payments.amounts[index]]));
  const quoted: EdgeQuotedVoucher[] = [];
  const doc: SaleVoucherWire[] = [];
  const wire: TenderWire[] = [];
  for (const one of facts) {
    let amount: Decimal;
    if (one.kind === 'COUPON') {
      amount = result.lines.reduce(
        (sum, line) =>
          line.priced
            ? line.parts.reduce(
                (partSum, part) =>
                  part.applied
                    .filter((applied) => applied.code === one.code)
                    .reduce((appliedSum, applied) => appliedSum.plus(applied.amount ?? 0), partSum),
                sum,
              )
            : sum,
        new Decimal(0),
      );
    } else {
      amount = paidBy.get(one.code) ?? new Decimal(0);
      if (!amount.gt(0)) throw refused(one.code, 'NOTHING_DUE');
      wire.push({
        kind: 'VOUCHER',
        amount: amount.toFixed(2),
        tendered: null,
        terminalId: null,
        rrn: null,
        maskedPan: null,
        voucherCode: one.code,
      });
    }
    quoted.push({ ...viewOf(one), amount: amount.toFixed(2) });
    doc.push({
      voucherId: one.id,
      code: one.code,
      kind: one.kind,
      face: one.value,
      amount: amount.toFixed(2),
    });
  }
  return { quoted, doc, wire, paid: payments.paid };
}
