import { Decimal } from '@tugeel/shared/money';
import { PRICE_ROUNDINGS, type PriceRounding, roundPrice } from '@tugeel/shared/pricing';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, FormSection } from '@/components/form';
import { SegmentedControl } from '@/components/list';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type LocationPriceRule,
  type LocationRuleInput,
  type SupplierPriceRule,
  type SupplierRuleInput,
  useSupplierPricingMutations,
} from './supplier-pricing-api';

type Rule = SupplierPriceRule | LocationPriceRule;
type Method = 'PERCENT' | 'AMOUNT' | 'COMBINED';
const METHODS: readonly Method[] = ['PERCENT', 'AMOUNT', 'COMBINED'];
const TYPES = ['BASE', 'ADDITIONAL'] as const;
interface Draft extends SupplierRuleInput {
  priceType: LocationPriceRule['priceType'];
}
const initial = (rule: Rule | null): Draft => ({
  expectedVersion: rule?.version ?? 0,
  enabled: rule?.enabled ?? true,
  markupPct: rule?.markupPct ?? '0',
  markupAmount: rule?.markupAmount ?? '0',
  rounding: rule?.rounding ?? 'WHOLE',
  priceType: rule && 'priceType' in rule ? rule.priceType : 'BASE',
});
const methodOf = (rule: Draft): Method =>
  new Decimal(rule.markupAmount).gt(0)
    ? new Decimal(rule.markupPct).gt(0)
      ? 'COMBINED'
      : 'AMOUNT'
    : 'PERCENT';
const validPct = (value: string) => /^\d{1,3}(\.\d{1,2})?$/.test(value.trim());
const validAmount = (value: string) => /^\d{1,12}$/.test(value.trim());

/** A draft keeps its version and typed values until save or explicit review of newer settings. */
export function SupplierPriceRuleForm(props: {
  kind: 'supplier' | 'location';
  targetId: number;
  name: string;
  saved: Rule | null;
  canSave: boolean;
  onDirty: (dirty: boolean) => void;
  reload: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const { onDirty } = props;
  const [baseline, setBaseline] = useState(() => initial(props.saved));
  const [draft, setDraft] = useState(baseline);
  const [method, setMethod] = useState<Method>(() => methodOf(baseline));
  const [example, setExample] = useState('10000');
  const mutations = useSupplierPricingMutations();
  const action = useAction();
  const location = props.kind === 'location';
  const values: Draft = {
    ...draft,
    markupPct:
      method === 'AMOUNT' || (location && draft.priceType === 'BASE') ? '0' : draft.markupPct,
    markupAmount:
      method === 'PERCENT' || (location && draft.priceType === 'BASE') ? '0' : draft.markupAmount,
    rounding: location && draft.priceType === 'BASE' ? 'WHOLE' : draft.rounding,
  };
  const dirty =
    props.canSave && (props.saved === null || JSON.stringify(values) !== JSON.stringify(baseline));
  const stale = (props.saved?.version ?? 0) !== draft.expectedVersion;
  const invalid = !validPct(values.markupPct) || !validAmount(values.markupAmount);
  const pending = mutations.supplier.isPending || mutations.location.isPending;
  const preview = (() => {
    if (invalid || !validAmount(example) || new Decimal(example).lte(0)) return null;
    const base = new Decimal(example);
    const price = roundPrice(
      base.times(new Decimal(100).plus(values.markupPct)).div(100).plus(values.markupAmount),
      values.rounding,
    );
    return (location ? Decimal.max(base, price) : price).toFixed(0);
  })();
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || stale || !props.canSave) return;
    void action.run(async () => {
      try {
        const body: SupplierRuleInput = {
          expectedVersion: values.expectedVersion,
          enabled: values.enabled,
          markupPct: values.markupPct.trim(),
          markupAmount: values.markupAmount.trim(),
          rounding: values.rounding,
        };
        const result = location
          ? await mutations.location.mutateAsync({
              warehouseId: props.targetId,
              body: { ...body, priceType: values.priceType } satisfies LocationRuleInput,
            })
          : await mutations.supplier.mutateAsync({ supplierId: props.targetId, body });
        const next = initial(result);
        setBaseline(next);
        setDraft(next);
        setMethod(methodOf(next));
        toast.success(t('pricing.settings.saved'));
      } catch (error) {
        if (problemFromError(error)?.status === 409) await props.reload();
        throw error;
      }
    });
  };
  const hasIncrement = !location || draft.priceType === 'ADDITIONAL';
  return (
    <form onSubmit={save} className="flex min-w-0 flex-col gap-4">
      <FormSection title={props.name} description={t(`pricing.settings.${props.kind}Hint`)} plain>
        <FormField label={t('pricing.settings.enabled')} htmlFor={`${ids}-enabled`}>
          <Switch
            id={`${ids}-enabled`}
            checked={draft.enabled}
            onCheckedChange={(v) => set('enabled', v)}
            disabled={!props.canSave || pending}
          />
        </FormField>
        {location ? (
          <FormField label={t('pricing.settings.priceType')}>
            {props.canSave ? (
              <fieldset disabled={pending} className="min-w-0">
                <SegmentedControl
                  options={TYPES}
                  value={draft.priceType}
                  label={(v) => t(`pricing.settings.types.${v}`)}
                  onChange={(v) => set('priceType', v)}
                  size="field"
                />
              </fieldset>
            ) : (
              <p>{t(`pricing.settings.types.${draft.priceType}`)}</p>
            )}
          </FormField>
        ) : null}
        {hasIncrement ? (
          <div className="@container flex flex-col gap-3">
            <FormField label={t('pricing.settings.method')} htmlFor={`${ids}-method`}>
              <NativeSelect
                id={`${ids}-method`}
                value={method}
                onChange={(event) => {
                  const value = event.target.value;
                  const next = METHODS.find((v) => v === value);
                  if (next) setMethod(next);
                }}
                disabled={!props.canSave || pending}
              >
                {METHODS.map((v) => (
                  <option key={v} value={v}>
                    {t(`pricing.settings.methods.${v}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="grid gap-3 @xl:grid-cols-2">
              {method !== 'AMOUNT' ? (
                <FormField label={t('pricing.settings.markupPct')} htmlFor={`${ids}-pct`}>
                  <Input
                    id={`${ids}-pct`}
                    value={draft.markupPct}
                    onChange={(event) => set('markupPct', event.target.value)}
                    inputMode="decimal"
                    disabled={!props.canSave || pending}
                  />
                </FormField>
              ) : null}
              {method !== 'PERCENT' ? (
                <FormField label={t('pricing.settings.markupAmount')} htmlFor={`${ids}-amount`}>
                  <MoneyInput
                    id={`${ids}-amount`}
                    value={draft.markupAmount}
                    onValueChange={(v) => set('markupAmount', v)}
                    disabled={!props.canSave || pending}
                  />
                </FormField>
              ) : null}
            </div>
            <FormField label={t('pricing.settings.rounding')} htmlFor={`${ids}-rounding`}>
              <NativeSelect
                id={`${ids}-rounding`}
                value={draft.rounding}
                onChange={(event) => {
                  const next: PriceRounding | undefined = PRICE_ROUNDINGS.find(
                    (v) => v === event.target.value,
                  );
                  if (next) set('rounding', next);
                }}
                disabled={!props.canSave || pending}
              >
                {PRICE_ROUNDINGS.map((v) => (
                  <option key={v} value={v}>
                    {t(`pricing.roundings.${v}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
        ) : null}
      </FormSection>
      <div className="rounded-xl bg-muted/50 p-3">
        <FormField
          label={t(location ? 'pricing.settings.exampleBase' : 'pricing.settings.exampleInvoice')}
          htmlFor={`${ids}-example`}
        >
          <MoneyInput id={`${ids}-example`} value={example} onValueChange={setExample} />
        </FormField>
        <p className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span>{t(location ? 'pricing.settings.resultSale' : 'pricing.settings.resultBase')}</span>
          <strong className="font-mono">
            {preview === null ? t('common.none') : formatTugrik(preview)}
          </strong>
        </p>
      </div>
      {invalid ? (
        <p role="alert" className="text-sm text-destructive">
          {t('pricing.settings.invalidRule')}
        </p>
      ) : null}
      {stale || action.problem?.status === 409 ? (
        <div role="alert" className="rounded-xl bg-warning-soft p-3 text-sm">
          <p>{t('pricing.settings.changedElsewhere')}</p>
          {props.saved ? (
            <p className="mt-1 font-mono">
              {t('pricing.settings.currentRule', {
                percent: props.saved.markupPct,
                amount: formatTugrik(props.saved.markupAmount),
                rounding: t(`pricing.roundings.${props.saved.rounding}`),
              })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={pending}
            onClick={() => {
              set('expectedVersion', props.saved?.version ?? 0);
              mutations.resetIntent(location ? 'location' : 'supplier');
              action.clear();
            }}
          >
            {t('pricing.settings.reviewCurrent')}
          </Button>
        </div>
      ) : null}
      <ProblemAlert problem={action.problem} />
      {props.canSave ? (
        <div className="flex justify-end">
          <Button type="submit" pending={pending} disabled={!dirty || invalid || stale}>
            {t('common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
