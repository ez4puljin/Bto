import { Decimal } from '@tugeel/shared/money';
import {
  type PriceProfileValues as ProfileValues,
  type QuoteUnit,
  type UnitPrices,
  unitPriceTable,
} from '@tugeel/shared/pricing';
import { useTranslation } from 'react-i18next';
import { plainDecimal } from '@/lib/money';
import type { PricedUnit, PriceProfileValues } from './api';

/** The two sales channels, wholesale first (ADR-0041, ADR-0048 #7). */
export const LISTS = ['WHOLESALE', 'RETAIL'] as const;

/** «хайрцаг (24 ш)» for a unit, its name for the base unit. */
export function useUnitLabel(units: readonly PricedUnit[]) {
  const { t } = useTranslation();
  const base = units.find((unit) => unit.isBase);
  return (unit: PricedUnit) =>
    unit.isBase || !base
      ? unit.uomName
      : t('catalog.units.factorOf', {
          unit: unit.uomName,
          factor: plainDecimal(unit.factorToBase),
          base: base.uomName,
        });
}

/** «Задгай +15% · Супермаркет +30% · Супермаркет бөөний (24+) +20% · Бүхэл төгрөг». */
export function useProfileSummary() {
  const { t } = useTranslation();
  return (values: PriceProfileValues) =>
    [
      t('pricing.profiles.summary.loose', { pct: plainDecimal(values.looseMarkupPct) }),
      t('pricing.profiles.summary.retail', { pct: plainDecimal(values.retailMarkupPct) }),
      values.retailBulkMinQty !== null && values.retailBulkMarkupPct !== null
        ? t('pricing.profiles.summary.bulk', {
            qty: plainDecimal(values.retailBulkMinQty),
            pct: plainDecimal(values.retailBulkMarkupPct),
          })
        : null,
      t(`pricing.roundings.${values.rounding}`),
    ]
      .filter((part) => part !== null)
      .join(' · ');
}

/** The API's units as the shared pricing functions take them. */
export function quoteUnitsOf(units: readonly PricedUnit[]): QuoteUnit[] {
  return units.map((unit) => ({
    unitId: unit.productUnitId,
    uomId: unit.uomId,
    factor: new Decimal(unit.factorToBase),
    isBase: unit.isBase,
  }));
}

export function profileValuesOf(values: PriceProfileValues): ProfileValues {
  return {
    looseMarkupPct: new Decimal(values.looseMarkupPct),
    retailMarkupPct: new Decimal(values.retailMarkupPct),
    retailBulkMinQty:
      values.retailBulkMinQty === null ? null : new Decimal(values.retailBulkMinQty),
    retailBulkMarkupPct:
      values.retailBulkMarkupPct === null ? null : new Decimal(values.retailBulkMarkupPct),
    rounding: values.rounding,
  };
}

/**
 * Each unit's prices for a warehouse price, a profile and a whole pack, computed in the browser
 * with the api's own functions (the price dialog's preview, ADR-0048); null while incomplete.
 */
export function previewTable(
  units: readonly PricedUnit[],
  warehousePrice: string,
  values: PriceProfileValues | null,
  wholeUomId: number | null,
): UnitPrices[] | null {
  if (!values || !/^[1-9]\d{0,11}$/.test(warehousePrice)) return null;
  return unitPriceTable(
    { warehousePrice: new Decimal(warehousePrice), wholeUomId, profile: profileValuesOf(values) },
    quoteUnitsOf(units),
  );
}
