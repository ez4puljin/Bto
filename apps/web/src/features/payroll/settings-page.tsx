import { checkPayrollSettings, PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { Info, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type PayrollSettings, usePayrollMutations, usePayrollSettings } from './payroll-api';
import { cleanPercent } from './payroll-helpers';

type PercentKey = 'employeeSiPercent' | 'employerSiPercent' | 'pitPercent' | 'latePenaltyPercent';

function SettingsForm({ settings }: { settings: PayrollSettings }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.payroll.manage');
  const mutations = usePayrollMutations();
  const action = useAction();
  const [draft, setDraft] = useState<PayrollSettings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<PayrollSettings>) => {
    setErrors({});
    setDraft((current) => ({ ...current, ...patch }));
  };
  const percentRow = (key: PercentKey, label: string, hint?: string) => (
    <FormRow label={label} htmlFor={`pay-${key}`} hint={hint} error={errors[key]}>
      <Input
        id={`pay-${key}`}
        inputMode="decimal"
        className="sm:w-32"
        disabled={!canManage}
        value={draft[key]}
        onChange={(event) => set({ [key]: cleanPercent(event.target.value) })}
      />
    </FormRow>
  );
  const setCredit = (index: number, patch: Partial<PayrollSettings['pitCredits'][number]>) =>
    set({
      pitCredits: draft.pitCredits.map((step, at) => (at === index ? { ...step, ...patch } : step)),
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = checkPayrollSettings({
      ...draft,
      pitCredits: draft.pitCredits.map((step) => ({
        upTo: step.upTo === null || step.upTo === '' ? null : step.upTo,
        credit: step.credit === '' ? '0' : step.credit,
      })),
    });
    if (!checked.ok) {
      const key = checked.path.split('.')[0] ?? '';
      const field = key.startsWith('pitCredits') ? 'pitCredits' : key;
      setErrors({
        [field]:
          field === 'minimumWage' || field === 'pitCredits'
            ? 'validation.money'
            : field === 'siCapMultiplier'
              ? 'validation.weight'
              : 'validation.percent',
      });
      return;
    }
    const ok = await action.run(() => mutations.saveSettings.mutateAsync(checked.settings));
    if (ok) toast.success(t('payroll.web.settings.saved'));
  };

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <p className="flex items-start gap-2 rounded-xl bg-fill px-3.5 py-3 text-[0.8125rem] text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('payroll.web.settings.note')}
      </p>
      <ProblemAlert problem={action.problem} />
      <FormSection title={t('payroll.web.settings.insurance')}>
        {percentRow('employeeSiPercent', t('payroll.web.settings.employeeSi'))}
        {percentRow(
          'employerSiPercent',
          t('payroll.web.settings.employerSi'),
          t('payroll.web.settings.employerSiHint'),
        )}
        <FormRow
          label={t('payroll.web.settings.minimumWage')}
          htmlFor="pay-minimumWage"
          error={errors.minimumWage}
        >
          <MoneyInput
            id="pay-minimumWage"
            className="sm:w-44"
            suffix="₮"
            disabled={!canManage}
            value={draft.minimumWage}
            onValueChange={(raw) => set({ minimumWage: raw })}
          />
        </FormRow>
        <FormRow
          label={t('payroll.web.settings.siCap')}
          htmlFor="pay-siCapMultiplier"
          hint={t('payroll.web.settings.siCapHint')}
          error={errors.siCapMultiplier}
        >
          <Input
            id="pay-siCapMultiplier"
            inputMode="decimal"
            className="sm:w-32"
            disabled={!canManage}
            value={draft.siCapMultiplier}
            onChange={(event) => set({ siCapMultiplier: cleanPercent(event.target.value) })}
          />
        </FormRow>
      </FormSection>
      <FormSection title={t('payroll.web.settings.tax')}>
        {percentRow('pitPercent', t('payroll.web.settings.pit'))}
        <FormRow
          label={t('payroll.web.settings.credits')}
          hint={t('payroll.web.settings.creditsHint')}
          error={errors.pitCredits}
        >
          <ul className="flex flex-col gap-2">
            {draft.pitCredits.map((step, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <span className="text-[0.8125rem] text-muted-foreground">
                  {t('payroll.web.settings.upTo')}
                </span>
                <MoneyInput
                  aria-label={t('payroll.web.settings.upToFor', { index: index + 1 })}
                  className="w-40"
                  suffix="₮"
                  placeholder={t('payroll.web.settings.open')}
                  disabled={!canManage}
                  value={step.upTo ?? ''}
                  onValueChange={(raw) => setCredit(index, { upTo: raw === '' ? null : raw })}
                />
                <span className="text-[0.8125rem] text-muted-foreground">
                  {t('payroll.web.settings.credit')}
                </span>
                <MoneyInput
                  aria-label={t('payroll.web.settings.creditFor', { index: index + 1 })}
                  className="w-36"
                  suffix="₮"
                  disabled={!canManage}
                  value={step.credit}
                  onValueChange={(raw) => setCredit(index, { credit: raw })}
                />
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('payroll.web.settings.removeStep', { index: index + 1 })}
                    onClick={() =>
                      set({ pitCredits: draft.pitCredits.filter((_, at) => at !== index) })
                    }
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={draft.pitCredits.length >= PAYROLL_LIMITS.maxBrackets}
              onClick={() =>
                set({ pitCredits: [...draft.pitCredits, { upTo: null, credit: '0' }] })
              }
            >
              <Plus />
              {t('payroll.web.settings.addStep')}
            </Button>
          ) : null}
        </FormRow>
      </FormSection>
      <FormSection title={t('payroll.web.settings.attendance')}>
        {percentRow(
          'latePenaltyPercent',
          t('payroll.web.settings.latePenalty'),
          t('payroll.web.settings.latePenaltyHint'),
        )}
      </FormSection>
      {canManage ? (
        <FormFooter>
          <Button type="submit" pending={mutations.saveSettings.isPending}>
            {t('common.save')}
          </Button>
        </FormFooter>
      ) : null}
    </form>
  );
}

/**
 * «Цалингийн тохиргоо» (ADR-0235, hr.payroll.view): the insurance and tax rates, the minimum wage
 * and the cut for each late day. Read by a viewer, changed by hr.payroll.manage.
 */
export function PayrollSettingsPage() {
  const { t } = useTranslation();
  const settings = usePayrollSettings();
  return (
    <div>
      <PageHeader
        title={t('payroll.web.settings.title')}
        description={t('payroll.web.settings.description')}
      />
      <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
      {settings.data ? (
        <SettingsForm key={JSON.stringify(settings.data)} settings={settings.data} />
      ) : null}
    </div>
  );
}
