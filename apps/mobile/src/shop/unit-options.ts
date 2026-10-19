import { useTranslation } from 'react-i18next';
import type { RepUnit } from '../api/rep';
import { formatQty } from '../format/format';
import { useUnitWords } from './unit-words';
import { baseUnitOf } from './units';

/** A product's units for the unit switch: «Ширхэг», «Хайрцаг · 6 ш». */
export function useUnitOptions() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (units: readonly RepUnit[]): { value: string; label: string }[] => {
    const base = baseUnitOf(units);
    return units.map((unit) => ({
      value: String(unit.id),
      label:
        unit.isBase || !base
          ? words(unit).title
          : t('mobile.product.unitOption', {
              unit: words(unit).title,
              n: formatQty(unit.factorToBase),
              base: words(base).short,
            }),
    }));
  };
}
