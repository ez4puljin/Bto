import { Decimal, type DecimalInput, toMoney } from '../money';

/** The taxes a Mongolian sale may carry (ADR-0074 #2). */
export const TAX_KINDS = ['VAT', 'CITY_TAX'] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/**
 * The tax codes the Finance Core receives as data (`FinConfig.loadTaxCodes`, ADR-0074 #1). How
 * catalog's `vat_type` values map to them is the accountant's to set (TODO-VERIFY).
 */
export const VAT_TAX_CODES = ['MN.VAT.STD', 'MN.VAT.ZERO', 'MN.VAT.EXEMPT'] as const;
export type VatTaxCode = (typeof VAT_TAX_CODES)[number];

/** A city-tax code, `MN.CITY.<activity code>`; Erkhet lists hotel 6331000 and resort 6313000. */
export type CityTaxCode = `MN.CITY.${string}`;

const ACTIVITY_CODE = /^\d{7}$/;

export function cityTaxCode(activityCode: string): CityTaxCode {
  if (!ACTIVITY_CODE.test(activityCode)) {
    throw new RangeError(`city-tax activity code ${activityCode} is not seven digits`);
  }
  return `MN.CITY.${activityCode}`;
}

export interface TaxSplit {
  /** Two decimals (ADR-0010). */
  vat: Decimal;
  cityTax: Decimal;
  /** What is left of the tax-inclusive amount. */
  net: Decimal;
}

/**
 * The taxes inside a tax-inclusive amount (ADR-0010 #4): `vat = round2(total × r / (100 + r + c))`
 * and the same for the city tax, both rates in percent; never recomputed from a header.
 */
export function taxSplit(
  total: DecimalInput,
  vatRatePct: DecimalInput,
  cityTaxRatePct: DecimalInput,
): TaxSplit {
  const amount = new Decimal(total);
  const vatRate = new Decimal(vatRatePct);
  const cityRate = new Decimal(cityTaxRatePct);
  const divisor = new Decimal(100).plus(vatRate).plus(cityRate);
  const vat = vatRate.isZero() ? new Decimal(0) : toMoney(amount.times(vatRate).div(divisor));
  const cityTax = cityRate.isZero() ? new Decimal(0) : toMoney(amount.times(cityRate).div(divisor));
  return { vat, cityTax, net: amount.minus(vat).minus(cityTax) };
}
