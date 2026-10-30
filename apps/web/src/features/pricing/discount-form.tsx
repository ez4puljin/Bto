import { businessDate } from '@tugeel/shared/time';
import type { DiscountEffect, DiscountMeasure, DiscountScope } from '@tugeel/shared/pricing';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { type Crumb, PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
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
  type DraftIssue,
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

/** The field a rule's refusal concerns, focused when Save names it (ADR-0066). */
const ISSUE_FIELDS: Partial<Record<DraftIssue, string>> = {
  NAME_REQUIRED: 'program-name',
  DATES: 'program-last-day',
  PRODUCT_REQUIRED: 'program-product',
  UNIT_REQUIRED: 'program-unit',
  CATEGORY_REQUIRED: 'program-category',
  COUNT_UNIT_REQUIRED: 'program-count-uom',
  MEASURE_NOT_ALLOWED: 'program-measure',
  EFFECT_NOT_ALLOWED: 'program-effect',
  TARGET_NOT_ALLOWED: 'program-scope',
  NO_STEPS: 'step-threshold-0',
  TOO_MANY_STEPS: 'step-threshold-0',
};

/** The id of the field to focus for an issue: a step's own box when a step is wrong. */
function issueField(found: { issue: DraftIssue; step?: number }): string | undefined {
  const index = (found.step ?? 1) - 1;
  if (found.issue === 'VALUE_RANGE') return `step-value-${index}`;
  if (found.issue === 'THRESHOLD_RANGE' || found.issue === 'THRESHOLD_ORDER') {
    return `step-threshold-${index}`;
  }
  return ISSUE_FIELDS[found.issue];
}

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
  const saveButton = useRef<HTMLButtonElement>(null);
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
    if (issue) {
      // The message sits above the buttons; the field it concerns takes the focus.
      const field = issueField(issue);
      if (field) document.getElementById(field)?.focus();
      return;
    }
    const body = programBody(draft);
    await action.run(async () => {
      const saved =
        props.programId === null
          ? await mutations.createProgram.mutateAsync({ key, ...body })
          : await mutations.updateProgram.mutateAsync({ id: props.programId, body });
      void navigate(`/pricing/discounts/${saved.id}`);
    });
  };

  const thresholdUnitName = (() => {
    if (draft.measure === 'AMOUNT') return '';
    if (draft.scope === 'CATEGORY') {
      return uoms.data?.find((uom) => uom.id === draft.countUomId)?.name ?? '';
    }
    return draft.thresholdUnitName;
  })();

  return (
    // A form page: header and card in one 768px column, the buttons at the window's foot (ADR-0066).
    <div className="max-w-3xl">
      <PageHeader
        title={t(props.programId === null ? 'pricing.programs.new' : 'pricing.programs.edit')}
        crumbs={props.crumbs}
      />
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // The product search's buttons sit inside this form: only «Хадгалах» (or Enter) saves.
          const { submitter } = event.nativeEvent;
          if (submitter && submitter !== saveButton.current) return;
          void submit();
        }}
      >
        <Card>
          <CardContent className="flex flex-col gap-5">
            <FormSection title={t('pricing.programs.sectionGeneral')}>
              <FormRow label={t('pricing.programs.fields.name')} htmlFor="program-name">
                <Input
                  id="program-name"
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </FormRow>
              <FormRow label={t('pricing.programs.fields.list')} htmlFor="program-list">
                <NativeSelect
                  id="program-list"
                  className="sm:w-56"
                  value={draft.list}
                  onChange={(event) =>
                    update({ list: event.target.value === 'RETAIL' ? 'RETAIL' : 'WHOLESALE' })
                  }
                >
                  <option value="WHOLESALE">{t('pricing.lists.WHOLESALE')}</option>
                  <option value="RETAIL">{t('pricing.lists.RETAIL')}</option>
                </NativeSelect>
              </FormRow>
              <FormRow label={t('pricing.programs.fields.validFrom')} htmlFor="program-valid-from">
                <Input
                  id="program-valid-from"
                  type="date"
                  className="sm:w-44"
                  min={today}
                  value={draft.validFrom}
                  onChange={(event) => update({ validFrom: event.target.value })}
                />
              </FormRow>
              <FormRow label={t('pricing.programs.fields.validTo')} htmlFor="program-last-day">
                <Input
                  id="program-last-day"
                  type="date"
                  className="sm:w-44"
                  min={draft.validFrom}
                  value={draft.lastDay}
                  onChange={(event) => update({ lastDay: event.target.value })}
                />
              </FormRow>
            </FormSection>

            <FormSection title={t('pricing.programs.sectionWhat')}>
              <FormRow label={t('pricing.programs.fields.scope')} htmlFor="program-scope">
                <NativeSelect
                  id="program-scope"
                  className="sm:w-56"
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
              </FormRow>
              {draft.scope === 'PRODUCT' ? (
                <FormRow
                  label={t('pricing.programs.fields.product')}
                  {...(product ? {} : { htmlFor: 'program-product' })}
                >
                  {product ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm sm:pt-2">
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
                      id="program-product"
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
                </FormRow>
              ) : null}
              {draft.scope === 'PRODUCT' && draft.productId !== null ? (
                <ProductUnitFields draft={draft} productId={draft.productId} update={update} />
              ) : null}
              {draft.scope === 'CATEGORY' ? (
                <>
                  <FormRow label={t('pricing.programs.fields.category')} htmlFor="program-category">
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
                      <option value="">{t('catalog.product.chooseCategory')}</option>
                      {tree.map((node) => (
                        <option key={node.category.id} value={node.category.id}>
                          {node.path}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormRow>
                  <FormRow label={t('pricing.programs.fields.measure')} htmlFor="program-measure">
                    <NativeSelect
                      id="program-measure"
                      className="sm:w-56"
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
                  </FormRow>
                  {draft.measure === 'QTY' ? (
                    <FormRow
                      label={t('pricing.programs.fields.countUom')}
                      htmlFor="program-count-uom"
                    >
                      <NativeSelect
                        id="program-count-uom"
                        className="sm:w-56"
                        value={draft.countUomId ?? ''}
                        onChange={(event) =>
                          update({
                            countUomId: event.target.value
                              ? Number.parseInt(event.target.value, 10)
                              : null,
                          })
                        }
                      >
                        <option value="">{t('catalog.product.chooseUnit')}</option>
                        {(uoms.data ?? []).map((uom) => (
                          <option key={uom.id} value={uom.id}>
                            {uom.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormRow>
                  ) : null}
                </>
              ) : null}
              <FormRow label={t('pricing.programs.fields.effect')} htmlFor="program-effect">
                <NativeSelect
                  id="program-effect"
                  className="sm:w-56"
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
              </FormRow>
            </FormSection>

            <StepsEditor draft={draft} update={update} unitName={thresholdUnitName} />
          </CardContent>
        </Card>

        {shown ? (
          <p className="px-1 text-sm text-destructive" role="alert">
            {t(`pricing.programs.issues.${shown.issue}`, { step: shown.step ?? 0 })}
          </p>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <StickyActions>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              void navigate(
                props.programId === null
                  ? '/pricing/discounts'
                  : `/pricing/discounts/${props.programId}`,
              )
            }
          >
            {t('common.cancel')}
          </Button>
          <Button
            ref={saveButton}
            type="submit"
            disabled={mutations.createProgram.isPending || mutations.updateProgram.isPending}
          >
            {t('common.save')}
          </Button>
        </StickyActions>
      </form>
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
      <ProblemAlert problem={problemFromError(product.error)} onRetry={product.refetch} />
      <FormRow label={t('pricing.programs.fields.productUnit')} htmlFor="program-unit">
        <NativeSelect
          id="program-unit"
          className="sm:w-72"
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
      </FormRow>
      <FormRow
        label={t('pricing.programs.fields.thresholdUnit')}
        htmlFor="program-threshold-unit"
        hint={t('pricing.programs.thresholdUnitHint')}
      >
        <NativeSelect
          id="program-threshold-unit"
          className="sm:w-72"
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
      </FormRow>
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
      : props.unitName
        ? t('pricing.programs.stepHeads.qty', { unit: props.unitName })
        : t('pricing.programs.stepHeads.qtyAny');
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
    <FormSection
      title={t('pricing.programs.fields.steps')}
      description={t('pricing.programs.stepsHint')}
      action={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-link"
          onClick={() => props.update({ steps: [...draft.steps, { threshold: '', value: '' }] })}
        >
          <Plus />
          {t('pricing.programs.addStep')}
        </Button>
      }
    >
      {draft.steps.map((step, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3 px-3.5 py-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor={`step-threshold-${index}`}
              className="text-[0.8125rem] text-foreground/80"
            >
              {thresholdHead}
            </Label>
            <Input
              id={`step-threshold-${index}`}
              inputMode="decimal"
              autoComplete="off"
              className="w-40 font-mono"
              value={step.threshold}
              onChange={(event) => setStep(index, { threshold: event.target.value.trim() })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`step-value-${index}`} className="text-[0.8125rem] text-foreground/80">
              {valueHead}
            </Label>
            <Input
              id={`step-value-${index}`}
              inputMode="decimal"
              autoComplete="off"
              className="w-40 font-mono"
              value={step.value}
              onChange={(event) => setStep(index, { value: event.target.value.trim() })}
            />
          </div>
          {draft.steps.length > 1 ? (
            // A plain button: inside the form a row action would submit it.
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-7 text-muted-foreground hover:bg-danger-soft hover:text-destructive"
              aria-label={t('pricing.programs.removeStep')}
              title={t('pricing.programs.removeStep')}
              onClick={() => props.update({ steps: draft.steps.filter((_, at) => at !== index) })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
    </FormSection>
  );
}
