import { CLASSIFICATION_CODE_PATTERN, DISTRICT_CODE_PATTERN } from '@tugeel/shared/mn';
import { POS_LIMITS } from '@tugeel/shared/pos';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailCard, FieldList } from '@/components/detail';
import { FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useMoneyAccounts } from '@/features/finance/api';
import { useWarehouses } from '@/features/identity/api';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { type PosSettings, usePosMutations, usePosSettings } from './api';

/**
 * «Тохиргоо» of the supermarket (ADR-0063 #2): the store, the hand-over box, the rules; the printed
 * receipt's heading and closing line and the store's e-Barimt codes (ADR-0065).
 */
export function PosSettingsPage() {
  const { t } = useTranslation();
  const settings = usePosSettings();
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('pos.settings.title')} description={t('pos.settings.description')} />
      <ProblemAlert problem={problemFromError(settings.error)} />
      {settings.data ? (
        <DetailCard
          title={t('pos.settings.section')}
          canEdit
          view={<SettingsView settings={settings.data} />}
          edit={(close) => <SettingsForm settings={settings.data} onClose={close} />}
        />
      ) : null}
    </div>
  );
}

function SettingsView({ settings }: { settings: PosSettings }) {
  const { t } = useTranslation();
  return (
    <FieldList
      items={[
        { label: t('pos.fields.storeWarehouse'), value: settings.storeWarehouseName },
        { label: t('pos.fields.handoverMoneyAccount'), value: settings.handoverMoneyAccountName },
        { label: t('pos.fields.returnWindowDays'), value: String(settings.returnWindowDays) },
        { label: t('pos.fields.snapshotIntervalSec'), value: String(settings.snapshotIntervalSec) },
        {
          label: t('pos.fields.supervisorRequired'),
          value: settings.supervisorRequired ? t('common.yes') : t('common.no'),
        },
        { label: t('pos.fields.receiptTitle'), value: settings.receiptTitle },
        { label: t('pos.fields.receiptFooter'), value: settings.receiptFooter },
        { label: t('pos.fields.ebarimtDistrictCode'), value: settings.ebarimtDistrictCode },
        {
          label: t('pos.fields.ebarimtClassificationCode'),
          value: settings.ebarimtClassificationCode,
        },
      ]}
    />
  );
}

function SettingsForm({ settings, onClose }: { settings: PosSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const accounts = useMoneyAccounts();
  const mutations = usePosMutations();
  const action = useAction();
  const [storeWarehouseId, setStoreWarehouseId] = useState(settings.storeWarehouseId);
  const [handoverMoneyAccountId, setHandoverMoneyAccountId] = useState(
    settings.handoverMoneyAccountId,
  );
  const [returnWindowDays, setReturnWindowDays] = useState(String(settings.returnWindowDays));
  const [snapshotIntervalSec, setSnapshotIntervalSec] = useState(
    String(settings.snapshotIntervalSec),
  );
  const [supervisorRequired, setSupervisorRequired] = useState(settings.supervisorRequired);
  const [receiptTitle, setReceiptTitle] = useState(settings.receiptTitle ?? '');
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter ?? '');
  const [districtCode, setDistrictCode] = useState(settings.ebarimtDistrictCode ?? '');
  const [classificationCode, setClassificationCode] = useState(
    settings.ebarimtClassificationCode ?? '',
  );
  const [checked, setChecked] = useState(false);
  const districtOk = districtCode === '' || DISTRICT_CODE_PATTERN.test(districtCode);
  const classificationOk =
    classificationCode === '' || CLASSIFICATION_CODE_PATTERN.test(classificationCode);
  const days = Number.parseInt(returnWindowDays, 10);
  const daysOk = Number.isInteger(days) && days >= 0 && days <= POS_LIMITS.maxReturnWindowDays;
  const seconds = Number.parseInt(snapshotIntervalSec, 10);
  const secondsOk =
    Number.isInteger(seconds) &&
    seconds >= POS_LIMITS.minSnapshotIntervalSec &&
    seconds <= POS_LIMITS.maxSnapshotIntervalSec;
  const stores = (warehouses.data ?? []).filter((warehouse) => warehouse.kind === 'STORE');
  const cashBoxes = (accounts.data ?? []).filter(
    (account) => account.kind === 'CASH' && account.status === 'ACTIVE',
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!daysOk || !secondsOk || !districtOk || !classificationOk) return;
    void action
      .run(async () => {
        await mutations.saveSettings.mutateAsync({
          storeWarehouseId,
          handoverMoneyAccountId,
          returnWindowDays: days,
          snapshotIntervalSec: seconds,
          supervisorRequired,
          receiptTitle: receiptTitle.trim() || null,
          receiptFooter: receiptFooter.trim() || null,
          ebarimtDistrictCode: districtCode || null,
          ebarimtClassificationCode: classificationCode || null,
        });
        toast.success(t('pos.settings.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <FormSection>
        <FormRow
          label={t('pos.fields.storeWarehouse')}
          htmlFor="pos-store"
          hint={t('pos.settings.storeHint')}
        >
          <NativeSelect
            id="pos-store"
            value={storeWarehouseId ?? ''}
            onChange={(event) =>
              setStoreWarehouseId(Number.parseInt(event.target.value, 10) || null)
            }
          >
            <option value="">{t('pos.settings.chooseWarehouse')}</option>
            {stores.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
        <FormRow
          label={t('pos.fields.handoverMoneyAccount')}
          htmlFor="pos-handover-account"
          hint={t('pos.settings.accountHint')}
        >
          <NativeSelect
            id="pos-handover-account"
            value={handoverMoneyAccountId ?? ''}
            onChange={(event) =>
              setHandoverMoneyAccountId(Number.parseInt(event.target.value, 10) || null)
            }
          >
            <option value="">{t('pos.settings.chooseAccount')}</option>
            {cashBoxes.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </NativeSelect>
        </FormRow>
      </FormSection>
      <FormSection title={t('pos.settings.rules')}>
        <FormRow
          label={t('pos.fields.returnWindowDays')}
          htmlFor="pos-return-days"
          error={checked && !daysOk ? 'validation.integerRange' : undefined}
        >
          <Input
            id="pos-return-days"
            inputMode="numeric"
            className="w-32 font-mono"
            value={returnWindowDays}
            onChange={(event) => setReturnWindowDays(event.target.value.trim())}
          />
        </FormRow>
        <FormRow
          label={t('pos.fields.snapshotIntervalSec')}
          htmlFor="pos-snapshot"
          hint={t('pos.settings.snapshotHint')}
          error={checked && !secondsOk ? 'validation.integerRange' : undefined}
        >
          <Input
            id="pos-snapshot"
            inputMode="numeric"
            className="w-32 font-mono"
            value={snapshotIntervalSec}
            onChange={(event) => setSnapshotIntervalSec(event.target.value.trim())}
          />
        </FormRow>
        <FormRow label={t('pos.fields.supervisorRequired')} htmlFor="pos-supervisor" align="center">
          <Switch
            id="pos-supervisor"
            checked={supervisorRequired}
            onCheckedChange={setSupervisorRequired}
          />
        </FormRow>
      </FormSection>
      <FormSection title={t('pos.settings.receipt')}>
        <FormRow
          label={t('pos.fields.receiptTitle')}
          htmlFor="pos-receipt-title"
          hint={t('pos.settings.receiptTitleHint')}
        >
          <Input
            id="pos-receipt-title"
            maxLength={POS_LIMITS.maxReceiptText}
            value={receiptTitle}
            onChange={(event) => setReceiptTitle(event.target.value)}
          />
        </FormRow>
        <FormRow
          label={t('pos.fields.receiptFooter')}
          htmlFor="pos-receipt-footer"
          hint={t('pos.settings.receiptFooterHint')}
        >
          <Input
            id="pos-receipt-footer"
            maxLength={POS_LIMITS.maxReceiptText}
            value={receiptFooter}
            onChange={(event) => setReceiptFooter(event.target.value)}
          />
        </FormRow>
        <FormRow
          label={t('pos.fields.ebarimtDistrictCode')}
          htmlFor="pos-district"
          hint={t('pos.settings.districtHint')}
          error={checked && !districtOk ? 'validation.districtCode' : undefined}
        >
          <Input
            id="pos-district"
            inputMode="numeric"
            maxLength={4}
            className="w-32 font-mono"
            value={districtCode}
            onChange={(event) => setDistrictCode(event.target.value.trim())}
          />
        </FormRow>
        <FormRow
          label={t('pos.fields.ebarimtClassificationCode')}
          htmlFor="pos-classification"
          hint={t('pos.settings.classificationHint')}
          error={checked && !classificationOk ? 'validation.classificationCode' : undefined}
        >
          <Input
            id="pos-classification"
            inputMode="numeric"
            maxLength={7}
            className="w-32 font-mono"
            value={classificationCode}
            onChange={(event) => setClassificationCode(event.target.value.trim())}
          />
        </FormRow>
      </FormSection>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutations.saveSettings.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}
