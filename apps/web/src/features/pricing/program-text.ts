import { Decimal } from '@tugeel/shared/money';
import { programApplyType } from '@tugeel/shared/pricing';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories, useUoms } from '@/features/catalog/api';
import { categoryPaths } from '@/features/catalog/category-tree';
import { formatMnt, plainDecimal } from '@/lib/money';
import type { DiscountProgram } from './api';
import { fromBaseQty, lastDayOf } from './helpers';

type Step = DiscountProgram['steps'][number];

/** The summary of a step by its rule and what it counts. */
const STEP_SUMMARIES = {
  MINIMUM: { QTY: 'qty', AMOUNT: 'amount' },
  EXACT: { QTY: 'exactQty', AMOUNT: 'exactAmount' },
  EVERY: { QTY: 'everyQty', AMOUNT: 'everyAmount' },
} as const;

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
        value:
          effect === 'PERCENT' || effect === 'BONUS' ? plainDecimal(amount) : formatMnt(amount),
      });
    /** A quantity as it was typed: in the threshold unit, else as stored. */
    const typedQty = (program: DiscountProgram, qty: string) =>
      program.scope === 'PRODUCT' && program.thresholdUnit
        ? fromBaseQty(qty, program.thresholdUnit.factorToBase)
        : plainDecimal(qty);
    return {
      /** What it applies to: one product or category by name, a set by its kind and size. */
      target(program: DiscountProgram): string {
        const apply = programApplyType(program);
        const count = program.targetIds.length;
        switch (apply) {
          case 'PRODUCT':
            if (!program.product) {
              return count === 1 && program.namedProducts[0]
                ? t('pricing.programs.target.product', { name: program.namedProducts[0].name })
                : t('pricing.programs.target.products', { count });
            }
            return program.productUnit
              ? t('pricing.programs.target.productUnit', {
                  name: program.product.name,
                  unit: program.productUnit.uomName,
                })
              : t('pricing.programs.target.product', { name: program.product.name });
          case 'CATEGORY': {
            const only = program.categoryId ?? (count === 1 ? program.targetIds[0] : undefined);
            return only === undefined
              ? t('pricing.programs.target.categories', { count })
              : t('pricing.programs.target.category', { name: paths.get(only) ?? '' });
          }
          case 'SUPPLIER':
            return t('pricing.programs.target.suppliers', { count });
          case 'SEGMENT':
            return t('pricing.programs.target.segments', { count });
          case 'ORDER':
            return t('pricing.programs.target.order');
        }
      },
      value,
      step(program: DiscountProgram, step: Step): string {
        if (program.effect === 'BONUS') {
          return t('pricing.programs.stepSummary.bonus', {
            buy: typedQty(program, step.threshold),
            free: typedQty(program, step.value),
          });
        }
        const shown = value(program.effect, step.value);
        const rule = step.rule ?? 'MINIMUM';
        const amount = new Decimal(step.threshold);
        if (rule === 'MINIMUM') {
          // A product's threshold of one base unit always applies too.
          const always =
            amount.isZero() ||
            (program.scope === 'PRODUCT' && program.measure === 'QTY' && amount.lte(1));
          if (always) return t('pricing.programs.stepSummary.always', { value: shown });
        }
        const key = STEP_SUMMARIES[rule][program.measure];
        if (program.measure === 'AMOUNT') {
          return t(`pricing.programs.stepSummary.${key}`, {
            threshold: formatMnt(step.threshold),
            value: shown,
          });
        }
        return t(`pricing.programs.stepSummary.${key}`, {
          threshold: typedQty(program, step.threshold),
          unit:
            program.scope === 'CATEGORY'
              ? (uomNames.get(program.countUomId ?? 0) ?? '')
              : (program.thresholdUnit?.uomName ?? ''),
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
