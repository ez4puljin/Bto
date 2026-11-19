import type { components } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { type QuoteUnit, splitWholesale, unitPriceOf } from '@tugeel/shared/pricing';
import type { KeptProduct } from './walk';

type Quote = components['schemas']['Quote'];
type QuoteLine = Quote['lines'][number];
type QuotePart = QuoteLine['parts'][number];

/**
 * A quote the phone estimated from the kept prices (ADR-0225 #4): shown only with «≈» and the
 * line that the server prices the order on arrival. Online the server's quote is shown as before.
 */
export type MaybeEstimated = Quote & { estimated?: true };

/** How many lines of an estimate have no kept price (counted as 0 in its total). */
export function unpricedCount(quote: MaybeEstimated | undefined): number {
  return quote?.estimated ? quote.lines.filter((line) => !line.priced).length : 0;
}

const ZERO = new Decimal(0);

/** The product's units as the shared quote helpers take them. */
function quoteUnits(product: KeptProduct): QuoteUnit[] {
  return product.units.map((unit) => ({
    unitId: unit.id,
    // The kept row has no unit-of-measure id; the unit's own id stands for it.
    uomId: unit.id,
    factor: new Decimal(unit.factorToBase),
    isBase: unit.isBase,
  }));
}

/**
 * The whole pack the server splits a line by: the smallest pack the shop prices at the warehouse
 * price (`basis` WAREHOUSE); none when the product has no packs.
 */
function wholeUnit(product: KeptProduct, units: readonly QuoteUnit[]): QuoteUnit | null {
  const packs = product.units
    .filter((unit) => !unit.isBase && unit.basis === 'WAREHOUSE')
    .map((unit) => units.find((one) => one.unitId === unit.id))
    .filter((unit): unit is QuoteUnit => unit !== undefined)
    .sort((a, b) => a.factor.comparedTo(b.factor));
  return packs[0] ?? null;
}

/**
 * One line priced from the kept row, split as the server splits it (`splitWholesale`): whole packs
 * at the warehouse price per base unit (the deal price when the product has one) times the pack
 * (`unitPriceOf`), the loose rest at its unit's WHOLESALE price. No order-amount programs and no
 * bonuses: those are the server's. Unpriced when the row has no price for a part.
 */
export function estimateLine(
  product: KeptProduct,
  productUnitId: number,
  qty: string,
): QuoteLine | null {
  const units = quoteUnits(product);
  const unit = units.find((one) => one.unitId === productUnitId);
  const base = units.find((one) => one.isBase);
  if (!unit || !base) return null;
  const amount = new Decimal(qty);
  const qtyBase = amount.times(unit.factor);
  const parts = splitWholesale({ unit, qty: amount, qtyBase }, wholeUnit(product, units), base);
  const list = product.basePrice === null ? null : new Decimal(product.basePrice);
  const deal = product.dealPrice === null ? null : new Decimal(product.dealPrice);
  const priced: QuotePart[] = [];
  for (const part of parts) {
    const row = product.units.find((one) => one.id === part.unitId);
    const partUnit = units.find((one) => one.unitId === part.unitId);
    if (!row || !partUnit) return unpriced(product, productUnitId, amount, qtyBase);
    let listPrice: Decimal | null;
    let unitPrice: Decimal | null;
    if (part.basis === 'WAREHOUSE') {
      listPrice = list === null ? null : unitPriceOf(list, partUnit.factor);
      unitPrice = deal !== null ? unitPriceOf(deal, partUnit.factor) : listPrice;
    } else {
      listPrice = row.wholesale === null ? null : new Decimal(row.wholesale);
      unitPrice = listPrice;
    }
    if (listPrice === null || unitPrice === null) {
      return unpriced(product, productUnitId, amount, qtyBase);
    }
    const subtotal = listPrice.times(part.qty);
    const total = unitPrice.times(part.qty);
    priced.push({
      productUnitId: part.unitId,
      uomName: row.uomName,
      factorSnapshot: row.factorToBase,
      qty: part.qty.toString(),
      qtyBase: part.qtyBase.toString(),
      basis: part.basis,
      listPrice: listPrice.toFixed(0),
      unitPrice: unitPrice.toFixed(0),
      subtotal: subtotal.toFixed(2),
      discountAmount: subtotal.minus(total).toFixed(2),
      total: total.toFixed(2),
      applied: [],
    });
  }
  const subtotal = priced.reduce((sum, part) => sum.plus(part.subtotal), ZERO);
  const total = priced.reduce((sum, part) => sum.plus(part.total), ZERO);
  return {
    productId: product.id,
    productUnitId,
    qty: amount.toString(),
    qtyBase: qtyBase.toString(),
    priced: true,
    problem: null,
    parts: priced,
    subtotal: subtotal.toFixed(2),
    discountAmount: subtotal.minus(total).toFixed(2),
    total: total.toFixed(2),
    bonus: null,
  };
}

function unpriced(
  product: KeptProduct,
  productUnitId: number,
  qty: Decimal,
  qtyBase: Decimal,
): QuoteLine {
  return {
    productId: product.id,
    productUnitId,
    qty: qty.toString(),
    qtyBase: qtyBase.toString(),
    priced: false,
    problem: 'PRICE_MISSING',
    parts: [],
    subtotal: null,
    discountAmount: null,
    total: null,
    bonus: null,
  };
}

/**
 * The cart estimated from the kept rows, in the server quote's shape with `estimated: true`; a line
 * whose product is not kept is unpriced. `today` is the phone's date in Ulaanbaatar.
 */
export function estimateQuote(
  products: readonly KeptProduct[],
  lines: readonly { productUnitId: number; qty: string }[],
  today: string,
): MaybeEstimated {
  const byUnit = new Map<number, KeptProduct>();
  for (const product of products) for (const unit of product.units) byUnit.set(unit.id, product);
  const out: QuoteLine[] = lines.map((line) => {
    const product = byUnit.get(line.productUnitId);
    const estimated = product ? estimateLine(product, line.productUnitId, line.qty) : null;
    return (
      estimated ?? {
        productId: product?.id ?? 0,
        productUnitId: line.productUnitId,
        qty: line.qty,
        qtyBase: line.qty,
        priced: false,
        problem: 'PRICE_MISSING',
        parts: [],
        subtotal: null,
        discountAmount: null,
        total: null,
        bonus: null,
      }
    );
  });
  const sum = (pick: (line: QuoteLine) => string | null) =>
    out.reduce((total, line) => total.plus(pick(line) ?? '0'), ZERO).toFixed(2);
  return {
    list: 'WHOLESALE',
    date: today,
    lines: out,
    subtotal: sum((line) => line.subtotal),
    discountTotal: sum((line) => line.discountAmount),
    total: sum((line) => line.total),
    estimated: true,
  };
}
