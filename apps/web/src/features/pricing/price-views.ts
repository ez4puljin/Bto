import { useTranslation } from 'react-i18next';
import { plainDecimal } from '@/lib/money';
import type { PriceList, ProductPrices, UnitPriceView } from './api';

/** The two price lists, wholesale first (ADR-0041). */
export const LISTS: readonly PriceList[] = ['WHOLESALE', 'RETAIL'];

export const viewsOf = (prices: ProductPrices, list: PriceList) =>
  list === 'WHOLESALE' ? prices.wholesale : prices.retail;

/** «24 ш-тэй хайрцаг» for a unit, its name for the base unit. */
export function useUnitLabel(prices: ProductPrices | undefined) {
  const { t } = useTranslation();
  const base = prices?.wholesale.find((unit) => unit.isBase);
  return (unit: UnitPriceView) =>
    unit.isBase || !base
      ? unit.uomName
      : t('catalog.units.factorOf', {
          unit: unit.uomName,
          factor: plainDecimal(unit.factorToBase),
          base: base.uomName,
        });
}
