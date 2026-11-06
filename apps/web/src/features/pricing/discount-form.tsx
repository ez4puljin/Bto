import { Decimal } from '@tugeel/shared/money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  PRICE_ADJUSTS,
  type PriceAdjust,
  PROGRAM_APPLY_TYPES,
  programApplyType,
  type ProgramApplyType,
  type ProgramState,
  STEP_RULES,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { DateInput } from '@/components/date-input';
import { FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { type Crumb, PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProduct, useUoms } from '@/features/catalog/api';
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type DiscountProgram, useDiscountProgram, usePricingMutations } from './api';
import {
  canRound,
  type DraftIssue,
  draftIssue,
  effectsFor,
  emptyStep,
  fromBaseQty,
  isOneProduct,
  lastDayOf,
  nineFactorKey,
  type ProgramDraft,
  programBody,
  scopeOf,
} from './helpers';
import {
  useCategoryChoices,
  usePipelineChoices,
  useSegmentChoices,
  useTillChoices,
} from './program-choices';
import {
  ChoicesPicker,
  type NamedProduct,
  ProductsPicker,
  SuppliersPicker,
} from './program-targets';

const STEPS = ['GENERAL', 'PLACES', 'CONDITIONS'] as const;
type Step = (typeof STEPS)[number];

const STATES: readonly ProgramState[] = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
const MEASURES: readonly DiscountMeasure[] = ['QTY', 'AMOUNT'];
const ROUND_FACTORS = ['10', '50', '100', '500', '1000'] as const;
const NINE_FACTORS = ['10', '100', '1000'] as const;

/** The field a rule's refusal concerns, focused when Save names it (ADR-0066). */
const ISSUE_FIELDS: Partial<Record<DraftIssue, string>> = {
  NAME_REQUIRED: 'program-name',
  DATES: 'program-last-day',
  PRODUCT_REQUIRED: 'program-targets',
  CATEGORY_REQUIRED: 'program-targets',
  SUPPLIER_REQUIRED: 'program-targets',
  SEGMENT_REQUIRED: 'program-targets',
  UNIT_REQUIRED: 'program-unit',
  COUNT_UNIT_REQUIRED: 'program-count-uom',
  MEASURE_NOT_ALLOWED: 'program-measure',
  EFFECT_NOT_ALLOWED: 'program-effect',
  TARGET_NOT_ALLOWED: 'program-apply',
  PLACE_REQUIRED: 'program-wholesale',
  VALUE_REQUIRED: 'program-value',
  BONUS_REQUIRED: 'program-bonus-buy',
  ADJUST_FACTOR: 'program-adjust-factor',
  NO_STEPS: 'step-threshold-0',
  TOO_MANY_STEPS: 'step-threshold-0',
};

/** The step of the form a refusal sends the person to. */
function issueStep(issue: DraftIssue): Step {
  if (issue === 'PLACE_REQUIRED') return 'PLACES';
  const onConditions: readonly DraftIssue[] = [
    'COUNT_UNIT_REQUIRED',
    'MEASURE_NOT_ALLOWED',
    'NO_STEPS',
    'TOO_MANY_STEPS',
    'THRESHOLD_RANGE',
    'THRESHOLD_ORDER',
    'VALUE_RANGE',
  ];
  return onConditions.includes(issue) ? 'CONDITIONS' : 'GENERAL';
}

/** The id of the field to focus for an issue: a step's own box when a step is wrong. */
function issueField(found: { issue: DraftIssue; step?: number }, draft: ProgramDraft) {
  const index = (found.step ?? 1) - 1;
  if (draft.effect === 'BONUS' && found.issue === 'THRESHOLD_RANGE') return 'program-bonus-buy';
  if (draft.effect === 'BONUS' && found.issue === 'VALUE_RANGE') return 'program-bonus-free';
  if (found.issue === 'VALUE_RANGE') return `step-value-${index}`;
  if (found.issue === 'THRESHOLD_RANGE' || found.issue === 'THRESHOLD_ORDER') {
    return `step-threshold-${index}`;
  }
  return ISSUE_FIELDS[found.issue];
}

function emptyDraft(): ProgramDraft {
  return {
    name: '',
    state: 'ACTIVE',
    priority: false,
    apply: 'PRODUCT',
    targetIds: [],
    excludeTargetIds: [],
    excludeProductIds: [],
    together: false,
    measure: 'QTY',
    effect: 'PERCENT',
    productUnitId: null,
    thresholdUnitId: null,
    thresholdFactor: '1',
    thresholdUnitName: '',
    countUomId: null,
    adjustKind: 'NONE',
    adjustFactor: '10',
    wholesale: true,
    retail: false,
    pipelineIds: [],
    tillIds: [],
    validFrom: businessDate(),
    lastDay: '',
    conditioned: false,
    value: '',
    bonusBuy: '1',
    bonusFree: '1',
    steps: [emptyStep()],
  };
}

function draftOf(program: DiscountProgram): ProgramDraft {
  const factor = program.thresholdUnit?.factorToBase ?? '1';
  const inBase = program.scope === 'PRODUCT' && program.measure === 'QTY';
  const [first] = program.steps;
  const bonus = program.effect === 'BONUS';
  // One step that always applies reads as one value; a product's first unit always counts.
  const plain =
    !bonus &&
    program.steps.length === 1 &&
    first !== undefined &&
    (first.rule ?? 'MINIMUM') === 'MINIMUM' &&
    new Decimal(first.threshold).lte(inBase ? 1 : 0);
  let targetIds = program.targetIds;
  if (!program.targetKind) {
    if (program.product) targetIds = [program.product.id];
    else if (program.categoryId !== null) targetIds = [program.categoryId];
  }
  return {
    name: program.name,
    state: program.state,
    priority: program.priority,
    apply: programApplyType(program),
    targetIds,
    excludeTargetIds: program.excludeTargetIds,
    excludeProductIds: program.excludeProductIds,
    together: program.scope === 'CATEGORY',
    measure: program.measure,
    effect: program.effect,
    productUnitId: program.productUnit?.id ?? null,
    thresholdUnitId: program.thresholdUnit?.id ?? null,
    thresholdFactor: factor,
    thresholdUnitName: program.thresholdUnit?.uomName ?? '',
    countUomId: program.countUomId,
    adjustKind: program.adjustKind,
    adjustFactor: program.adjustKind === 'NONE' ? '10' : String(program.adjustFactor),
    wholesale: program.list !== 'RETAIL',
    retail: program.list !== 'WHOLESALE',
    pipelineIds: program.pipelineIds,
    tillIds: program.tillIds,
    validFrom: program.validFrom,
    lastDay: program.validTo ? lastDayOf(program.validTo) : '',
    conditioned: !bonus && !plain,
    value: plain && first ? plainDecimal(first.value) : '',
    bonusBuy: bonus && first ? fromBaseQty(first.threshold, factor) : '1',
    bonusFree: bonus && first ? fromBaseQty(first.value, factor) : '1',
    steps:
      bonus || plain
        ? [emptyStep()]
        : program.steps.map((step) => ({
            rule: step.rule ?? 'MINIMUM',
            threshold: inBase ? fromBaseQty(step.threshold, factor) : plainDecimal(step.threshold),
            value: plainDecimal(step.value),
          })),
  };
}

/** «Шинэ хямдрал» (pricing.manage). */
export function DiscountProgramCreatePage() {
  return <ProgramForm initial={emptyDraft()} products={[]} programId={null} />;
}

/** Editing a program at any time: orders keep what they froze, the audit what it was (ADR-0159). */
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
      products={[
        ...(program.data.product ? [program.data.product] : []),
        ...program.data.namedProducts,
      ]}
      programId={id}
      crumbs={[{ label: program.data.name, to: `/pricing/discounts/${id}` }]}
    />
  );
}

function ProgramForm(props: {
  initial: ProgramDraft;
  /** The products it names, for their names: chosen and excluded. */
  products: readonly NamedProduct[];
  programId: number | null;
  /** The program being edited, between «Хямдрал» and the title (ADR-0042). */
  crumbs?: readonly Crumb[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePricingMutations();
  const action = useAction();
  const uoms = useUoms();
  const [key] = useState(randomUuid);
  const [draft, setDraft] = useState<ProgramDraft>(props.initial);
  const [products, setProducts] = useState<readonly NamedProduct[]>(props.products);
  const [step, setStep] = useState<Step>('GENERAL');
  const [shown, setShown] = useState<ReturnType<typeof draftIssue>>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const update = (patch: Partial<ProgramDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const scope = scopeOf(draft);

  /** What it applies to changed: its targets go, and what the new shape cannot have. */
  const setApply = (apply: ProgramApplyType) => {
    setDraft((current) => {
      const next = { ...current, apply, together: apply === 'ORDER' ? false : current.together };
      const effects = effectsFor(scopeOf(next));
      return {
        ...next,
        targetIds: [],
        excludeTargetIds: [],
        excludeProductIds: [],
        productUnitId: null,
        thresholdUnitId: null,
        thresholdFactor: '1',
        thresholdUnitName: '',
        effect: effects.includes(current.effect) ? current.effect : 'PERCENT',
      };
    });
  };

  const setTogether = (together: boolean) => {
    const box = uoms.data?.find((uom) => uom.code === 'BOX')?.id ?? null;
    setDraft((current) => {
      const next = { ...current, together };
      const effects = effectsFor(scopeOf(next));
      return {
        ...next,
        effect: effects.includes(current.effect) ? current.effect : 'PERCENT',
        countUomId: together ? (current.countUomId ?? box) : null,
        productUnitId: together ? null : current.productUnitId,
      };
    });
  };

  const remember = (chosen: readonly NamedProduct[]) =>
    setProducts((current) => [...new Map([...current, ...chosen].map((p) => [p.id, p])).values()]);

  /** One product counts in its base unit until another is chosen; a set always does. */
  const chooseProducts = (chosen: NamedProduct[]) => {
    remember(chosen);
    const [only] = chosen;
    const base = chosen.length === 1 ? only?.baseUnit : undefined;
    update({
      targetIds: chosen.map((product) => product.id),
      productUnitId: null,
      thresholdUnitId: base?.id ?? null,
      thresholdFactor: '1',
      thresholdUnitName: base?.uomName ?? '',
    });
  };
  const productsOf = (ids: readonly number[]): NamedProduct[] =>
    ids.flatMap((id) => {
      const found = products.find((product) => product.id === id);
      return found ? [found] : [];
    });

  const submit = async () => {
    const issue = draftIssue(draft);
    setShown(issue);
    if (issue) {
      // The message sits above the buttons; the field it concerns takes the focus.
      flushSync(() => setStep(issueStep(issue.issue)));
      const field = issueField(issue, draft);
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

  const at = STEPS.indexOf(step);

  return (
    // A form page: header and card in one column, the buttons at the window's foot (ADR-0066).
    <div>
      <PageHeader
        title={t(props.programId === null ? 'pricing.programs.new' : 'pricing.programs.edit')}
        crumbs={props.crumbs}
      />
      <nav aria-label={t('pricing.programs.steps.label')} className="mb-3 flex gap-1.5">
        {STEPS.map((own, index) => (
          <button
            key={own}
            type="button"
            aria-current={own === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[0.8125rem] hover:bg-accent',
              own === step && 'border-primary bg-primary/10 font-medium text-foreground',
            )}
            onClick={() => setStep(own)}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums',
                own === step && 'bg-primary text-primary-foreground',
              )}
            >
              {index + 1}
            </span>
            {t(`pricing.programs.steps.${own}`)}
          </button>
        ))}
      </nav>
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
            {step === 'GENERAL' ? (
              <>
                <FormSection title={t('pricing.programs.sectionGeneral')}>
                  <FormRow label={t('pricing.programs.fields.name')} htmlFor="program-name">
                    <Input
                      id="program-name"
                      maxLength={120}
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </FormRow>
                  <FormRow label={t('pricing.programs.fields.state')} htmlFor="program-state">
                    <NativeSelect
                      id="program-state"
                      className="sm:w-56"
                      value={draft.state}
                      onChange={(event) =>
                        update({
                          state: STATES.find((own) => own === event.target.value) ?? 'ACTIVE',
                        })
                      }
                    >
                      {STATES.map((own) => (
                        <option key={own} value={own}>
                          {t(`pricing.programs.states.${own}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormRow>
                  {scope === 'PRODUCT' ? (
                    <FormRow
                      label={t('pricing.programs.fields.priority')}
                      htmlFor="program-priority"
                      hint={t('pricing.programs.priorityHint')}
                    >
                      <Checkbox
                        id="program-priority"
                        className="sm:mt-2"
                        checked={draft.priority}
                        onCheckedChange={(checked) => update({ priority: checked === true })}
                      />
                    </FormRow>
                  ) : null}
                  <FormRow
                    label={t('pricing.programs.fields.validFrom')}
                    htmlFor="program-valid-from"
                  >
                    <DateInput
                      id="program-valid-from"
                      className="sm:w-44"
                      {...(props.programId === null ? { min: businessDate() } : {})}
                      value={draft.validFrom}
                      onChange={(value) => update({ validFrom: value })}
                    />
                  </FormRow>
                  <FormRow label={t('pricing.programs.fields.validTo')} htmlFor="program-last-day">
                    <DateInput
                      id="program-last-day"
                      className="sm:w-44"
                      min={draft.validFrom}
                      value={draft.lastDay}
                      onChange={(value) => update({ lastDay: value })}
                    />
                  </FormRow>
                </FormSection>

                <AppliesTo
                  draft={draft}
                  productsOf={productsOf}
                  update={update}
                  setApply={setApply}
                  setTogether={setTogether}
                  setChosenProducts={chooseProducts}
                  setExcludedProducts={(chosen) => {
                    remember(chosen);
                    update({ excludeProductIds: chosen.map((product) => product.id) });
                  }}
                />

                <Discount draft={draft} update={update} />
              </>
            ) : null}
            {step === 'PLACES' ? <Places draft={draft} update={update} /> : null}
            {step === 'CONDITIONS' ? <Conditions draft={draft} update={update} /> : null}
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
          {at < STEPS.length - 1 ? (
            <Button type="button" variant="outline" onClick={() => setStep(STEPS[at + 1] ?? step)}>
              {t('pricing.programs.steps.next')}
            </Button>
          ) : null}
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

/** Applies to: its kind, what is chosen, what is left out and how it is counted. */
function AppliesTo(props: {
  draft: ProgramDraft;
  productsOf: (ids: readonly number[]) => NamedProduct[];
  update: (patch: Partial<ProgramDraft>) => void;
  setApply: (apply: ProgramApplyType) => void;
  setTogether: (together: boolean) => void;
  setChosenProducts: (chosen: NamedProduct[]) => void;
  setExcludedProducts: (chosen: NamedProduct[]) => void;
}) {
  const { t } = useTranslation();
  const { draft, update } = props;
  const categories = useCategoryChoices();
  const segments = useSegmentChoices();
  const { apply } = draft;
  const picker = (id: string, ids: readonly number[], onChange: (next: number[]) => void) => {
    switch (apply) {
      case 'CATEGORY':
        return <ChoicesPicker id={id} options={categories} ids={ids} onChange={onChange} />;
      case 'SEGMENT':
        return <ChoicesPicker id={id} options={segments} ids={ids} onChange={onChange} />;
      case 'SUPPLIER':
        return <SuppliersPicker id={id} ids={ids} onChange={onChange} />;
      default:
        return null;
    }
  };
  return (
    <FormSection title={t('pricing.programs.sectionApplies')}>
      <FormRow label={t('pricing.programs.fields.apply')} htmlFor="program-apply">
        <NativeSelect
          id="program-apply"
          className="sm:w-56"
          value={apply}
          onChange={(event) =>
            props.setApply(
              PROGRAM_APPLY_TYPES.find((own) => own === event.target.value) ?? 'PRODUCT',
            )
          }
        >
          {PROGRAM_APPLY_TYPES.map((own) => (
            <option key={own} value={own}>
              {t(`pricing.programs.applyTypes.${own}`)}
            </option>
          ))}
        </NativeSelect>
      </FormRow>
      {apply === 'PRODUCT' ? (
        <FormRow label={t('pricing.programs.fields.product')} htmlFor="program-targets">
          <ProductsPicker
            id="program-targets"
            products={props.productsOf(draft.targetIds)}
            onChange={props.setChosenProducts}
          />
        </FormRow>
      ) : null}
      {apply === 'CATEGORY' || apply === 'SUPPLIER' || apply === 'SEGMENT' ? (
        <>
          <FormRow label={t(`pricing.programs.fields.targets.${apply}`)} htmlFor="program-targets">
            {picker('program-targets', draft.targetIds, (targetIds) => update({ targetIds }))}
          </FormRow>
          <FormRow
            label={t(`pricing.programs.fields.excludeTargets.${apply}`)}
            htmlFor="program-exclude-targets"
          >
            {picker('program-exclude-targets', draft.excludeTargetIds, (excludeTargetIds) =>
              update({ excludeTargetIds }),
            )}
          </FormRow>
          <FormRow
            label={t('pricing.programs.fields.excludeProducts')}
            htmlFor="program-exclude-products"
          >
            <ProductsPicker
              id="program-exclude-products"
              products={props.productsOf(draft.excludeProductIds)}
              onChange={props.setExcludedProducts}
            />
          </FormRow>
        </>
      ) : null}
      {isOneProduct(draft) && draft.targetIds[0] !== undefined ? (
        <ProductUnitFields draft={draft} productId={draft.targetIds[0]} update={update} />
      ) : null}
      {apply === 'ORDER' ? null : (
        <FormRow
          label={t('pricing.programs.fields.count')}
          htmlFor="program-count"
          hint={t(
            draft.together
              ? 'pricing.programs.countHint.TOGETHER'
              : 'pricing.programs.countHint.EACH',
          )}
        >
          <NativeSelect
            id="program-count"
            className="sm:w-56"
            value={draft.together ? 'TOGETHER' : 'EACH'}
            onChange={(event) => props.setTogether(event.target.value === 'TOGETHER')}
          >
            <option value="EACH">{t('pricing.programs.counts.EACH')}</option>
            <option value="TOGETHER">{t('pricing.programs.counts.TOGETHER')}</option>
          </NativeSelect>
        </FormRow>
      )}
    </FormSection>
  );
}

/** What it takes off: a kind and a value, N+M, or the rounding of the price it leaves. */
function Discount(props: { draft: ProgramDraft; update: (patch: Partial<ProgramDraft>) => void }) {
  const { t } = useTranslation();
  const { draft, update } = props;
  const scope = scopeOf(draft);
  const valueLabel = t(
    draft.effect === 'AMOUNT'
      ? scope === 'PRODUCT'
        ? 'pricing.programs.stepHeads.AMOUNT_UNIT'
        : 'pricing.programs.stepHeads.AMOUNT_TOTAL'
      : `pricing.programs.stepHeads.${draft.effect === 'PRICE' ? 'PRICE' : 'PERCENT'}`,
  );
  const perBase =
    scope === 'PRODUCT' &&
    (draft.effect === 'PRICE' || draft.effect === 'AMOUNT') &&
    draft.productUnitId === null;
  const factors = draft.adjustKind === 'ENDS_9' ? NINE_FACTORS : ROUND_FACTORS;
  return (
    <FormSection title={t('pricing.programs.sectionDiscount')}>
      <FormRow label={t('pricing.programs.fields.effect')} htmlFor="program-effect">
        <NativeSelect
          id="program-effect"
          className="sm:w-56"
          value={draft.effect}
          onChange={(event) =>
            update({
              effect:
                effectsFor(scope).find((effect) => effect === event.target.value) ?? 'PERCENT',
            })
          }
        >
          {effectsFor(scope).map((effect: DiscountEffect) => (
            <option key={effect} value={effect}>
              {t(`pricing.programs.effects.${effect}`)}
            </option>
          ))}
        </NativeSelect>
      </FormRow>
      {draft.effect === 'BONUS' ? (
        <FormRow
          label={t('pricing.programs.fields.bonus')}
          hint={t('pricing.programs.bonusHint')}
          align="start"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="program-bonus-buy" className="text-[0.8125rem] text-foreground/80">
                {t('pricing.programs.fields.bonusBuy')}
              </Label>
              <Input
                id="program-bonus-buy"
                inputMode="decimal"
                autoComplete="off"
                className="w-24 font-mono"
                value={draft.bonusBuy}
                onChange={(event) => update({ bonusBuy: event.target.value.trim() })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="program-bonus-free" className="text-[0.8125rem] text-foreground/80">
                {t('pricing.programs.fields.bonusFree')}
              </Label>
              <Input
                id="program-bonus-free"
                inputMode="decimal"
                autoComplete="off"
                className="w-24 font-mono"
                value={draft.bonusFree}
                onChange={(event) => update({ bonusFree: event.target.value.trim() })}
              />
            </div>
          </div>
        </FormRow>
      ) : null}
      {draft.effect !== 'BONUS' && !draft.conditioned ? (
        <FormRow
          label={valueLabel}
          htmlFor="program-value"
          {...(perBase ? { hint: t('pricing.programs.perBaseHint') } : {})}
        >
          <Input
            id="program-value"
            inputMode="decimal"
            autoComplete="off"
            className="w-40 font-mono"
            value={draft.value}
            onChange={(event) => update({ value: event.target.value.trim() })}
          />
        </FormRow>
      ) : null}
      {canRound(draft) ? (
        <FormRow
          label={t('pricing.programs.fields.adjust')}
          htmlFor="program-adjust"
          hint={t('pricing.programs.adjustHint')}
        >
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              id="program-adjust"
              className="sm:w-56"
              value={draft.adjustKind}
              onChange={(event) => {
                const kind: PriceAdjust =
                  PRICE_ADJUSTS.find((own) => own === event.target.value) ?? 'NONE';
                update({
                  adjustKind: kind,
                  // «Ends in 9» has no 50 or 500.
                  adjustFactor:
                    kind === 'ENDS_9' && !NINE_FACTORS.some((own) => own === draft.adjustFactor)
                      ? '10'
                      : draft.adjustFactor,
                });
              }}
            >
              {PRICE_ADJUSTS.map((own) => (
                <option key={own} value={own}>
                  {t(`pricing.programs.adjusts.${own}`)}
                </option>
              ))}
            </NativeSelect>
            {draft.adjustKind === 'NONE' ? null : (
              <NativeSelect
                id="program-adjust-factor"
                aria-label={t('pricing.programs.fields.adjustFactor')}
                className="sm:w-40"
                value={draft.adjustFactor}
                onChange={(event) => update({ adjustFactor: event.target.value })}
              >
                {factors.map((factor) => (
                  <option key={factor} value={factor}>
                    {draft.adjustKind === 'ENDS_9'
                      ? t(nineFactorKey(factor))
                      : t('pricing.programs.roundFactor', { factor })}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        </FormRow>
      ) : null}
    </FormSection>
  );
}

/** Options: the channels and, within each, the pipelines or tills it serves. */
function Places(props: { draft: ProgramDraft; update: (patch: Partial<ProgramDraft>) => void }) {
  const { t } = useTranslation();
  const { draft, update } = props;
  const pipelines = usePipelineChoices();
  const tills = useTillChoices();
  return (
    <FormSection
      title={t('pricing.programs.sectionPlaces')}
      description={t('pricing.programs.placesHint')}
    >
      <FormRow
        label={t('pricing.programs.fields.wholesale')}
        htmlFor="program-wholesale"
        hint={t('pricing.programs.wholesaleHint')}
      >
        <Checkbox
          id="program-wholesale"
          className="sm:mt-2"
          checked={draft.wholesale}
          onCheckedChange={(checked) => update({ wholesale: checked === true })}
        />
      </FormRow>
      {draft.wholesale ? (
        <FormRow label={t('pricing.programs.fields.pipelines')} htmlFor="program-pipelines">
          <ChoicesPicker
            id="program-pipelines"
            options={pipelines}
            ids={draft.pipelineIds}
            placeholder={t('pricing.programs.everyPipeline')}
            onChange={(pipelineIds) => update({ pipelineIds })}
          />
        </FormRow>
      ) : null}
      <FormRow
        label={t('pricing.programs.fields.retail')}
        htmlFor="program-retail"
        hint={t('pricing.programs.retailHint')}
      >
        <Checkbox
          id="program-retail"
          className="sm:mt-2"
          checked={draft.retail}
          onCheckedChange={(checked) => update({ retail: checked === true })}
        />
      </FormRow>
      {draft.retail ? (
        <FormRow label={t('pricing.programs.fields.tills')} htmlFor="program-tills">
          <ChoicesPicker
            id="program-tills"
            options={tills}
            ids={draft.tillIds}
            placeholder={t('pricing.programs.everyTill')}
            onChange={(tillIds) => update({ tillIds })}
          />
        </FormRow>
      ) : null}
    </FormSection>
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
      {props.draft.effect === 'BONUS' ? null : (
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
      )}
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

/** The quantity and amount rows: when each value applies. */
function Conditions(props: {
  draft: ProgramDraft;
  update: (patch: Partial<ProgramDraft>) => void;
}) {
  const { t } = useTranslation();
  const { draft, update } = props;
  const uoms = useUoms();
  const scope = scopeOf(draft);
  const measure = scope === 'ORDER' ? 'AMOUNT' : draft.measure;
  if (draft.effect === 'BONUS') {
    return (
      <FormSection title={t('pricing.programs.sectionConditions')}>
        <p className="px-3.5 py-3 text-sm text-muted-foreground">
          {t('pricing.programs.bonusNoConditions')}
        </p>
      </FormSection>
    );
  }
  const unitName =
    measure === 'AMOUNT'
      ? ''
      : scope === 'CATEGORY'
        ? (uoms.data?.find((uom) => uom.id === draft.countUomId)?.name ?? '')
        : draft.thresholdUnitName;
  const thresholdHead =
    measure === 'AMOUNT'
      ? t('pricing.programs.stepHeads.amount')
      : unitName
        ? t('pricing.programs.stepHeads.qty', { unit: unitName })
        : t('pricing.programs.stepHeads.qtyAny');
  const valueHead = t(
    draft.effect === 'AMOUNT'
      ? scope === 'PRODUCT'
        ? 'pricing.programs.stepHeads.AMOUNT_UNIT'
        : 'pricing.programs.stepHeads.AMOUNT_TOTAL'
      : `pricing.programs.stepHeads.${draft.effect}`,
  );
  const setRow = (index: number, patch: Partial<ProgramDraft['steps'][number]>) =>
    update({ steps: draft.steps.map((row, at) => (at === index ? { ...row, ...patch } : row)) });

  return (
    <>
      <FormSection title={t('pricing.programs.sectionConditions')}>
        <FormRow
          label={t('pricing.programs.fields.conditioned')}
          htmlFor="program-conditioned"
          hint={t('pricing.programs.conditionedHint')}
        >
          <Checkbox
            id="program-conditioned"
            className="sm:mt-2"
            checked={draft.conditioned}
            onCheckedChange={(checked) => update({ conditioned: checked === true })}
          />
        </FormRow>
        {draft.conditioned && scope !== 'ORDER' ? (
          <FormRow label={t('pricing.programs.fields.measure')} htmlFor="program-measure">
            <NativeSelect
              id="program-measure"
              className="sm:w-56"
              value={draft.measure}
              onChange={(event) =>
                update({
                  measure: MEASURES.find((own) => own === event.target.value) ?? 'QTY',
                })
              }
            >
              {MEASURES.map((own) => (
                <option key={own} value={own}>
                  {t(`pricing.programs.measures.${own}`)}
                </option>
              ))}
            </NativeSelect>
          </FormRow>
        ) : null}
        {draft.conditioned && scope === 'CATEGORY' && measure === 'QTY' ? (
          <FormRow label={t('pricing.programs.fields.countUom')} htmlFor="program-count-uom">
            <NativeSelect
              id="program-count-uom"
              className="sm:w-56"
              value={draft.countUomId ?? ''}
              onChange={(event) =>
                update({
                  countUomId: event.target.value ? Number.parseInt(event.target.value, 10) : null,
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
      </FormSection>
      {draft.conditioned ? (
        <FormSection
          title={t('pricing.programs.fields.steps')}
          description={t('pricing.programs.stepsHint')}
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-link"
              onClick={() => update({ steps: [...draft.steps, emptyStep()] })}
            >
              <Plus />
              {t('pricing.programs.addStep')}
            </Button>
          }
        >
          {draft.steps.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3 px-3.5 py-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`step-rule-${index}`}
                  className="text-[0.8125rem] text-foreground/80"
                >
                  {t('pricing.programs.stepHeads.rule')}
                </Label>
                <NativeSelect
                  id={`step-rule-${index}`}
                  className="w-40"
                  value={row.rule}
                  onChange={(event) =>
                    setRow(index, {
                      rule: STEP_RULES.find((own) => own === event.target.value) ?? 'MINIMUM',
                    })
                  }
                >
                  {STEP_RULES.map((own) => (
                    <option key={own} value={own}>
                      {t(`pricing.programs.rules.${own}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
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
                  value={row.threshold}
                  onChange={(event) => setRow(index, { threshold: event.target.value.trim() })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`step-value-${index}`}
                  className="text-[0.8125rem] text-foreground/80"
                >
                  {valueHead}
                </Label>
                <Input
                  id={`step-value-${index}`}
                  inputMode="decimal"
                  autoComplete="off"
                  className="w-40 font-mono"
                  value={row.value}
                  onChange={(event) => setRow(index, { value: event.target.value.trim() })}
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
                  onClick={() => update({ steps: draft.steps.filter((_, at) => at !== index) })}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          ))}
        </FormSection>
      ) : null}
    </>
  );
}
