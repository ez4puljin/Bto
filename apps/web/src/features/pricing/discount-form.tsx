import { businessDate } from '@tugeel/shared/time';
import type { DiscountEffect, DiscountMeasure, DiscountScope } from '@tugeel/shared/pricing';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { NativeSelect } from '@/components/native-select';
import { type Crumb, PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCategories, useProduct, useUoms } from '@/features/catalog/api';
import { categoryTree } from '@/features/catalog/category-tree';
import { ProductSearch } from '@/features/inventory/shared';
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type DiscountProgram, useDiscountProgram, usePricingMutations } from './api';
import {
  draftIssue,
  effectsFor,
  fromBaseQty,
  lastDayOf,
  measureFor,
  type ProgramDraft,
  programBody,
} from './helpers';

const SCOPES: readonly DiscountScope[] = ['PRODUCT', 'CATEGORY', 'ORDER'];
const MEASURES: readonly DiscountMeasure[] = ['QTY', 'AMOUNT'];

interface PickedProduct {
  id: number;
  sku: string;
  name: string;
}

function emptyDraft(): ProgramDraft {
  return {
    name: '',
    list: 'WHOLESALE',
    scope: 'PRODUCT',
    measure: 'QTY',
    effect: 'PERCENT',
    productId: null,
    productUnitId: null,
    thresholdUnitId: null,
    thresholdFactor: '1',
    thresholdUnitName: '',
    categoryId: null,
    countUomId: null,
    validFrom: businessDate(),
    lastDay: '',
    steps: [{ threshold: '', value: '' }],
  };
}

function draftOf(program: DiscountProgram): ProgramDraft {
  const factor = program.thresholdUnit?.factorToBase ?? '1';
  const inBase = program.scope === 'PRODUCT' && program.measure === 'QTY';
  return {
    name: program.name,
    list: program.list,
    scope: program.scope,
    measure: program.measure,
    effect: program.effect,
    productId: program.product?.id ?? null,
    productUnitId: program.productUnit?.id ?? null,
    thresholdUnitId: program.thresholdUnit?.id ?? null,
    thresholdFactor: factor,
    thresholdUnitName: program.thresholdUnit?.uomName ?? '',
    categoryId: program.categoryId,
    countUomId: program.countUomId,
    validFrom: program.validFrom,
    lastDay: program.validTo ? lastDayOf(program.validTo) : '',
    steps: program.steps.map((step) => ({
      threshold: inBase ? fromBaseQty(step.threshold, factor) : plainDecimal(step.threshold),
      value: plainDecimal(step.value),
    })),
  };
}

/** «Шинэ хямдрал» (pricing.manage). */
export function DiscountProgramCreatePage() {
  return <ProgramForm initial={emptyDraft()} product={null} programId={null} />;
}

/** Editing a program that has not started (the API refuses the others). */
export function DiscountProgramEditPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const program = useDiscountProgram(id);
  const loadProblem = problemFromError(program.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!program.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return (
    <ProgramForm
      initial={draftOf(program.data)}
      product={program.data.product}
      programId={id}
      crumbs={[{ label: program.data.name, to: `/pricing/discounts/${id}` }]}
    />
  );
}

function ProgramForm(props: {
  initial: ProgramDraft;
  product: PickedProduct | null;
  programId: number | null;
  /** The program being edited, between «Хямдрал» and the title (ADR-0042). */
  crumbs?: readonly Crumb[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePricingMutations();
  const action = useAction();
  const categories = useCategories();
  const uoms = useUoms();
  const [key] = useState(randomUuid);
  const [draft, setDraft] = useState<ProgramDraft>(props.initial);
  const [product, setProduct] = useState<PickedProduct | null>(props.product);
  const [shown, setShown] = useState<ReturnType<typeof draftIssue>>(null);
  const today = businessDate();
  const tree = useMemo(() => categoryTree(categories.data ?? []), [categories.data]);
  const update = (patch: Partial<ProgramDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const setScope = (scope: DiscountScope) => {
    const effects = effectsFor(scope);
    const box = uoms.data?.find((uom) => uom.code === 'BOX')?.id ?? null;
    setDraft((current) => ({
      ...current,
      scope,
      measure: measureFor(scope, current.measure),
      effect: effects.includes(current.effect) ? current.effect : (effects[0] ?? 'PERCENT'),
      productId: null,
      productUnitId: null,
      thresholdUnitId: null,
      thresholdFactor: '1',
      thresholdUnitName: '',
      categoryId: null,
      countUomId: scope === 'CATEGORY' ? box : null,
    }));
    setProduct(null);
  };

  const submit = async () => {
    const issue = draftIssue(draft);
    setShown(issue);
    if (issue) return;
    const body = programBody(draft);
    const ok = await action.run(async () => {
      const saved =
        props.programId === null
          ? await mutations.createProgram.mutateAsync({ key, ...body })
          : await mutations.updateProgram.mutateAsync({ id: props.programId, body });
      void navigate(`/pricing/discounts/${saved.id}`);
    });
    if (!ok) window.scrollTo({ top: 0 });
  };

  const thresholdUnitName = (() => {
    if (draft.measure === 'AMOUNT') return '';
    if (draft.scope === 'CATEGORY') {
      return uoms.data?.find((uom) => uom.id === draft.countUomId)?.name ?? '';
    }
    return draft.thresholdUnitName;
  })();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t(props.programId === null ? 'pricing.programs.new' : 'pricing.programs.edit')}
        crumbs={props.crumbs}
      />
      <ProblemAlert problem={action.problem} />
      {shown ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`pricing.programs.issues.${shown.issue}`, { step: shown.step ?? 0 })}
        </p>
      ) : null}
      <Card className="max-w-3xl">
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="program-name">{t('pricing.programs.fields.name')}</Label>
              <Input
                id="program-name"
                maxLength={120}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="program-list">{t('pricing.programs.fields.list')}</Label>
              <NativeSelect
                id="program-list"
                value={draft.list}
                onChange={(event) =>
                  update({ list: event.target.value === 'RETAIL' ? 'RETAIL' : 'WHOLESALE' })
                }
              >
                <option value="WHOLESALE">{t('pricing.lists.WHOLESALE')}</option>
                <option value="RETAIL">{t('pricing.lists.RETAIL')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="program-scope">{t('pricing.programs.fields.scope')}</Label>
              <NativeSelect
                id="program-scope"
                value={draft.scope}
                onChange={(event) =>
                  setScope(SCOPES.find((scope) => scope === event.target.value) ?? 'PRODUCT')
                }
              >
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {t(`pricing.programs.scopes.${scope}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {draft.scope === 'PRODUCT' ? (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label>{t('pricing.programs.fields.product')}</Label>
                {product ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-muted-foreground">{product.sku}</span>
                    <span className="font-medium">{product.name}</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setProduct(null);
                        update({ productId: null, productUnitId: null, thresholdUnitId: null });
                      }}
                    >
                      {t('pricing.programs.changeProduct')}
                    </Button>
                  </div>
                ) : (
                  <ProductSearch
                    pickLabel={t('pricing.programs.pickProduct')}
                    onPick={(picked) => {
                      setProduct({ id: picked.id, sku: picked.sku, name: picked.name });
                      update({
                        productId: picked.id,
                        productUnitId: null,
                        thresholdUnitId: picked.baseUnit.id,
                        thresholdFactor: '1',
                        thresholdUnitName: picked.baseUnit.uomName,
                      });
                    }}
                  />
                )}
              </div>
            ) : null}
            {draft.scope === 'PRODUCT' && draft.productId !== null ? (
              <ProductUnitFields draft={draft} productId={draft.productId} update={update} />
            ) : null}

            {draft.scope === 'CATEGORY' ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="program-category">{t('pricing.programs.fields.category')}</Label>
                  <NativeSelect
                    id="program-category"
                    value={draft.categoryId ?? ''}
                    onChange={(event) =>
                      update({
                        categoryId: event.target.value
                          ? Number.parseInt(event.target.value, 10)
                          : null,
                      })
                    }
                  >
                    <option value="" />
                    {tree.map((node) => (
                      <option key={node.category.id} value={node.category.id}>
                        {node.path}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="program-measure">{t('pricing.programs.fields.measure')}</Label>
                  <NativeSelect
                    id="program-measure"
                    value={draft.measure}
                    onChange={(event) =>
                      update({
                        measure:
                          MEASURES.find((measure) => measure === event.target.value) ?? 'QTY',
                      })
                    }
                  >
                    {MEASURES.map((measure) => (
                      <option key={measure} value={measure}>
                        {t(`pricing.programs.measures.${measure}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {draft.measure === 'QTY' ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="program-count-uom">
                      {t('pricing.programs.fields.countUom')}
                    </Label>
                    <NativeSelect
                      id="program-count-uom"
                      value={draft.countUomId ?? ''}
                      onChange={(event) =>
                        update({
                          countUomId: event.target.value
                            ? Number.parseInt(event.target.value, 10)
                            : null,
                        })
                      }
                    >
                      <option value="" />
                      {(uoms.data ?? []).map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="program-effect">{t('pricing.programs.fields.effect')}</Label>
              <NativeSelect
                id="program-effect"
                value={draft.effect}
                onChange={(event) =>
                  update({
                    effect:
                      effectsFor(draft.scope).find((effect) => effect === event.target.value) ??
                      'PERCENT',
                  })
                }
              >
                {effectsFor(draft.scope).map((effect: DiscountEffect) => (
                  <option key={effect} value={effect}>
                    {t(`pricing.programs.effects.${effect}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="program-valid-from">{t('pricing.programs.fields.validFrom')}</Label>
              <Input
                id="program-valid-from"
                type="date"
                min={today}
                value={draft.validFrom}
                onChange={(event) => update({ validFrom: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="program-last-day">{t('pricing.programs.fields.validTo')}</Label>
              <Input
                id="program-last-day"
                type="date"
                min={draft.validFrom}
                value={draft.lastDay}
                onChange={(event) => update({ lastDay: event.target.value })}
              />
            </div>

            <StepsEditor draft={draft} update={update} unitName={thresholdUnitName} />

            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={mutations.createProgram.isPending || mutations.updateProgram.isPending}
              >
                {t('common.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** The product's units: which one the program applies to, and the one thresholds are typed in. */
function ProductUnitFields(props: {
  draft: ProgramDraft;
  productId: number;
  update: (patch: Partial<ProgramDraft>) => void;
}) {
  const { t } = useTranslation();
  const product = useProduct(props.productId);
  const units = (product.data?.units ?? []).filter((unit) => unit.supersededAt === null);
  const base = units.find((unit) => unit.isBase);
  const label = (unit: (typeof units)[number]) =>
    unit.isBase || !base
      ? unit.uomName
      : t('catalog.units.factorOf', {
          unit: unit.uomName,
          factor: plainDecimal(unit.factorToBase),
          base: base.uomName,
        });
  return (
    <>
      <ProblemAlert problem={problemFromError(product.error)} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="program-unit">{t('pricing.programs.fields.productUnit')}</Label>
        <NativeSelect
          id="program-unit"
          value={props.draft.productUnitId ?? ''}
          onChange={(event) =>
            props.update({
              productUnitId: event.target.value ? Number.parseInt(event.target.value, 10) : null,
            })
          }
        >
          <option value="">{t('pricing.programs.fields.everyUnit')}</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {label(unit)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="program-threshold-unit">{t('pricing.programs.fields.thresholdUnit')}</Label>
        <NativeSelect
          id="program-threshold-unit"
          value={props.draft.thresholdUnitId ?? base?.id ?? ''}
          onChange={(event) => {
            const unit = units.find((row) => String(row.id) === event.target.value);
            if (unit) {
              props.update({
                thresholdUnitId: unit.id,
                thresholdFactor: unit.factorToBase,
                thresholdUnitName: unit.uomName,
              });
            }
          }}
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {label(unit)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </>
  );
}

function StepsEditor(props: {
  draft: ProgramDraft;
  update: (patch: Partial<ProgramDraft>) => void;
  unitName: string;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const thresholdHead =
    draft.measure === 'AMOUNT'
      ? t('pricing.programs.stepHeads.amount')
      : t('pricing.programs.stepHeads.qty', { unit: props.unitName });
  const valueHead = t(
    draft.effect === 'AMOUNT'
      ? draft.scope === 'PRODUCT'
        ? 'pricing.programs.stepHeads.AMOUNT_UNIT'
        : 'pricing.programs.stepHeads.AMOUNT_TOTAL'
      : `pricing.programs.stepHeads.${draft.effect}`,
  );
  const setStep = (index: number, patch: Partial<ProgramDraft['steps'][number]>) =>
    props.update({
      steps: draft.steps.map((step, at) => (at === index ? { ...step, ...patch } : step)),
    });

  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="mb-2 text-sm font-medium">{t('pricing.programs.fields.steps')}</legend>
      {draft.steps.map((step, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`step-threshold-${index}`} className="text-xs">
              {thresholdHead}
            </Label>
            <Input
              id={`step-threshold-${index}`}
              inputMode="decimal"
              autoComplete="off"
              className="w-40"
              value={step.threshold}
              onChange={(event) => setStep(index, { threshold: event.target.value.trim() })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`step-value-${index}`} className="text-xs">
              {valueHead}
            </Label>
            <Input
              id={`step-value-${index}`}
              inputMode="decimal"
              autoComplete="off"
              className="w-40"
              value={step.value}
              onChange={(event) => setStep(index, { value: event.target.value.trim() })}
            />
          </div>
          {draft.steps.length > 1 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('pricing.programs.removeStep')}
              onClick={() => props.update({ steps: draft.steps.filter((_, at) => at !== index) })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => props.update({ steps: [...draft.steps, { threshold: '', value: '' }] })}
        >
          <Plus />
          {t('pricing.programs.addStep')}
        </Button>
      </div>
    </fieldset>
  );
}
