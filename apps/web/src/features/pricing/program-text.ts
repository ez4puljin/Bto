import { Decimal } from '@tugeel/shared/money';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useUoms } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { formatMnt, plainDecimal } from '@/lib/money';
import type { DiscountProgram } from './api';
import { fromBaseQty, lastDayOf } from './helpers';

type Step = DiscountProgram['steps'][number];

/** How a program reads on screen: its target, its steps, its dates. */
export function useProgramText() {
  const { t } = useTranslation();
  const categories = useCategories();
  const uoms = useUoms();
  const paths = useMemo(() => categoryPaths(categories.data ?? []), [categories.data]);
  const uomNames = useMemo(
    () => new Map((uoms.data ?? []).map((uom) => [uom.id, uom.name])),
    [uoms.data],
  );

  return useMemo(() => {
    const value = (effect: DiscountProgram['effect'], amount: string) =>
      t(`pricing.programs.values.${effect}`, {
        value: effect === 'PERCENT' ? plainDecimal(amount) : formatMnt(amount),
      });
    return {
      target(program: DiscountProgram): string {
        switch (program.scope) {
          case 'PRODUCT':
            return program.productUnit
              ? t('pricing.programs.target.productUnit', {
                  name: program.product?.name ?? '',
                  unit: program.productUnit.uomName,
                })
              : t('pricing.programs.target.product', { name: program.product?.name ?? '' });
          case 'CATEGORY':
            return t('pricing.programs.target.category', {
              name: paths.get(program.categoryId ?? 0) ?? '',
            });
          case 'ORDER':
            return t('pricing.programs.target.order');
        }
      },
      value,
      step(program: DiscountProgram, step: Step): string {
        const shown = value(program.effect, step.value);
        if (new Decimal(step.threshold).isZero()) {
          return t('pricing.programs.stepSummary.always', { value: shown });
        }
        if (program.measure === 'AMOUNT') {
          return t('pricing.programs.stepSummary.amount', {
            threshold: formatMnt(step.threshold),
            value: shown,
          });
        }
        const unit = program.scope === 'PRODUCT' ? program.thresholdUnit : null;
        return t('pricing.programs.stepSummary.qty', {
          threshold: unit
            ? fromBaseQty(step.threshold, unit.factorToBase)
            : plainDecimal(step.threshold),
          unit:
            program.scope === 'CATEGORY'
              ? (uomNames.get(program.countUomId ?? 0) ?? '')
              : (unit?.uomName ?? ''),
          value: shown,
        });
      },
      period(program: DiscountProgram): string {
        if (program.validTo === null) {
          return t('pricing.programs.openEnded', { from: program.validFrom });
        }
        // Stopped on its first day: it never applied.
        if (program.validTo <= program.validFrom) return program.validFrom;
        return t('pricing.programs.period', {
          from: program.validFrom,
          to: lastDayOf(program.validTo),
        });
      },
    };
  }, [t, paths, uomNames]);
}
