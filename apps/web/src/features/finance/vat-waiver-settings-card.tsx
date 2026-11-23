import { isVatWaiverPct, VAT_WAIVER_DESCRIPTION_MAX } from '@tugeel/shared/finance';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useFinanceMutations, useVatWaiverSettings, type VatWaiverSettings } from './api';

/**
 * «НӨАТ хасуулах» on «Санхүү → Тохиргоо» (ADR-0240 #1): the percent a waiver takes of a sale and
 * the words of its entry. A waiver freezes both, so a change reaches only the waivers made after.
 */
export function VatWaiverSettingsCard() {
  const { t } = useTranslation();
  const settings = useVatWaiverSettings();
  if (!settings.data) {
    return <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />;
  }
  const current = settings.data;
  return (
    <DetailCard
      title={t('finance.vatWaiver.settings.title')}
      canEdit
      view={
        <FieldList
          description={t('finance.vatWaiver.settings.description')}
          items={[
            {
              label: t('finance.vatWaiver.settings.pct'),
              value: (
                <span className="font-mono">
                  {t('finance.vatWaiver.settings.pctValue', { pct: current.pct })}
                </span>
              ),
            },
            {
              label: t('finance.vatWaiver.settings.descriptionField'),
              value: current.description,
            },
          ]}
        />
      }
      edit={(close) => <SettingsForm settings={current} onClose={close} />}
    />
  );
}

function SettingsForm({ settings, onClose }: { settings: VatWaiverSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [pct, setPct] = useState(settings.pct);
  const [description, setDescription] = useState(settings.description);
  const [checked, setChecked] = useState(false);
  const pctText = pct.trim().replace(',', '.');
  const pctValid = /^\d{1,3}(\.\d{1,2})?$/.test(pctText) && isVatWaiverPct(pctText);
  const descriptionValid =
    description.trim().length > 0 && description.trim().length <= VAT_WAIVER_DESCRIPTION_MAX;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!pctValid || !descriptionValid) return;
    void action
      .run(async () => {
        await mutations.setVatWaiverSettings.mutateAsync({
          pct: pctText,
          description: description.trim(),
        });
        toast.success(t('finance.vatWaiver.settings.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <FormSection description={t('finance.vatWaiver.settings.description')}>
        <FormRow
          label={t('finance.vatWaiver.settings.pct')}
          htmlFor="vat-waiver-pct"
          hint={
            // The page's own words; FieldError reads only `validation.*` keys.
            checked && !pctValid ? (
              <span role="alert" className="text-destructive">
                {t('finance.vatWaiver.settings.pctInvalid')}
              </span>
            ) : undefined
          }
        >
          <Input
            id="vat-waiver-pct"
            className="font-mono sm:w-28"
            inputMode="decimal"
            value={pct}
            maxLength={6}
            onChange={(event) => setPct(event.target.value)}
          />
        </FormRow>
        <FormRow
          label={t('finance.vatWaiver.settings.descriptionField')}
          htmlFor="vat-waiver-description"
          hint={
            checked && !descriptionValid ? (
              <span role="alert" className="text-destructive">
                {t('finance.vatWaiver.settings.descriptionInvalid')}
              </span>
            ) : undefined
          }
        >
          <Input
            id="vat-waiver-description"
            value={description}
            maxLength={VAT_WAIVER_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormRow>
      </FormSection>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" pending={mutations.setVatWaiverSettings.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
