import { Decimal } from '../money';
import type { QuoteProduct, QuoteTerms } from './cart';
import { type PriceRounding, roundPrice } from './profile';

export const LOCATION_PRICE_TYPES = ['BASE', 'ADDITIONAL'] as const;
export type LocationPriceType = (typeof LOCATION_PRICE_TYPES)[number];

/** The same explicit location rule travels to an offline till without acquisition information. */
export interface LocationPriceSettings {
  warehouseId: number;
  priceType: LocationPriceType;
  markupPct: string;
  markupAmount: string;
  rounding: PriceRounding;
}

export function markedUpPrice(
  base: Decimal,
  markupPct: Decimal,
  markupAmount: Decimal,
  rounding: PriceRounding,
): Decimal {
  return roundPrice(
    base.times(new Decimal(100).plus(markupPct)).div(100).plus(markupAmount),
    rounding,
  );
}

/** Keep the printed amount/quantity ratio exact until the final selling-price rounding. */
export function markedUpRatioPrice(
  amount: Decimal,
  qtyBase: Decimal,
  markupPct: Decimal,
  markupAmount: Decimal,
  rounding: PriceRounding,
): Decimal {
  if (!qtyBase.isFinite() || !qtyBase.gt(0))
    throw new RangeError('a positive printed-price quantity is required');
  const numerator = amount
    .times(new Decimal(100).plus(markupPct))
    .plus(markupAmount.times(qtyBase).times(100));
  return roundPrice(numerator.div(qtyBase.times(100)), rounding);
}

/** A location's normal price never rounds below the canonical base selling price. */
export function locationBasePrice(base: Decimal, settings: LocationPriceSettings): Decimal {
  const result =
    settings.priceType === 'BASE'
      ? base
      : Decimal.max(
          base,
          markedUpPrice(
            base,
            new Decimal(settings.markupPct),
            new Decimal(settings.markupAmount),
            settings.rounding,
          ),
        );
  if (!result.isFinite() || !result.gt(0) || !result.isInteger() || result.gt('999999999999'))
    throw new RangeError('location price exceeds the supported selling-price range');
  return result;
}

export function locationTerms(terms: QuoteTerms, settings: LocationPriceSettings): QuoteTerms {
  const base = terms.minimumBasePrice ?? terms.warehousePrice;
  return {
    warehousePrice: locationBasePrice(base, settings),
    wholeUomId: null,
    minimumBasePrice: terms.minimumBasePrice ?? terms.warehousePrice,
    profile: {
      looseMarkupPct: new Decimal(0),
      retailMarkupPct: new Decimal(0),
      retailMarkupAmount: new Decimal(0),
      retailBulkMinQty: null,
      retailBulkMarkupPct: null,
      rounding: 'WHOLE',
    },
  };
}

export function tryLocationTerms(
  terms: QuoteTerms,
  settings: LocationPriceSettings,
): QuoteTerms | null {
  try {
    return locationTerms(terms, settings);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function applyLocationPricing(
  products: ReadonlyMap<number, QuoteProduct>,
  settings: LocationPriceSettings | null,
): ReadonlyMap<number, QuoteProduct> {
  if (!settings) return products;
  return new Map(
    [...products].map(([id, product]) => [
      id,
      { ...product, terms: product.terms ? tryLocationTerms(product.terms, settings) : null },
    ]),
  );
}
