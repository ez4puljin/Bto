import { STOCK_PROBLEM_NOTE_MAX, STOCK_PROBLEM_QTY_PATTERN } from '@tugeel/shared';
import { Decimal } from '@tugeel/shared/money';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIssueExpenseTypes } from '@/features/inventory/api';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { formatQty } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type StockProblem,
  type StockProblemSettings,
  useStockProblemMutations,
  useStockProblemSettings,
} from './api';

/** «Зүй ёсны»: the product leaves the list; the note is optional. */
export function LegitDialog(props: { row: StockProblem; onDone: () => void }) {
  const { t } = useTranslation();
  const mutations = useStockProblemMutations();
  const action = useAction();
  const [note, setNote] = useState('');
  const [key] = useState(randomUuid);
  const submit = () =>
    void action.run(async () => {
      const trimmed = note.trim();
      await mutations.legit.mutateAsync({
        key,
        warehouseId: props.row.warehouseId,
        productId: props.row.product.id,
        note: trimmed === '' ? null : trimmed,
      });
      toast.success(t('stockProblems.page.legit.done'));
      props.onDone();
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutations.legit.isPending) submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('stockProblems.page.legit.title')}</DialogTitle>
          <DialogDescription>
            {t('stockProblems.page.legit.text', { name: props.row.product.name })}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('stockProblems.page.legit.note')} htmlFor="legit-note">
          <Textarea
            id="legit-note"
            rows={3}
            maxLength={STOCK_PROBLEM_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFormFooter
          pending={mutations.legit.isPending}
          onCancel={props.onDone}
          submitLabel={t('stockProblems.action.legit')}
        />
      </form>
    </DialogContent>
  );
}

/** «Үлдэгдэл тэглэх»: a goods issue to the warehouse's fixed customer and account. */
export function ZeroOutDialog(props: { row: StockProblem; onDone: () => void }) {
  const { t } = useTranslation();
  const { row } = props;
  const mutations = useStockProblemMutations();
  const settings = useStockProblemSettings();
  const action = useAction();
  const [qty, setQty] = useState(row.onHand);
  const [key] = useState(randomUuid);
  const own = settings.data?.find((entry) => entry.warehouseId === row.warehouseId);
  const typed = qty.trim();
  const valid =
    STOCK_PROBLEM_QTY_PATTERN.test(typed) &&
    new Decimal(typed).gt(0) &&
    new Decimal(typed).lte(row.onHand);
  const missing = action.problem?.code === 'SETTING_MISSING';
  const submit = () =>
    void action.run(async () => {
      const done = await mutations.zeroOut.mutateAsync({
        key,
        warehouseId: row.warehouseId,
        productId: row.product.id,
        qty: new Decimal(typed).eq(row.onHand) ? null : typed,
      });
      toast.success(t('stockProblems.page.zero.done'));
      props.onDone();
      return done;
    });
  return (
    <DialogContent closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !mutations.zeroOut.isPending) submit();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('stockProblems.page.zero.title')}</DialogTitle>
          <DialogDescription>
            {t('stockProblems.page.zero.text', {
              name: row.product.name,
              onHand: formatQty(row.onHand),
              unit: row.product.baseUomName,
            })}
          </DialogDescription>
        </DialogHeader>
        {missing ? (
          <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-destructive">
            {t('stockProblems.page.zero.settingMissing')}
          </p>
        ) : (
          <ProblemAlert problem={action.problem} />
        )}
        <FormField
          label={t('stockProblems.page.zero.qty', { unit: row.product.baseUomName })}
          htmlFor="zero-qty"
          hint={!valid ? t('stockProblems.page.zero.qtyInvalid') : undefined}
        >
          <Input
            id="zero-qty"
            inputMode="decimal"
            autoComplete="off"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </FormField>
        <dl className="grid gap-2 rounded-lg bg-fill/50 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('stockProblems.page.zero.customer')}
            </dt>
            <dd>{own?.customerName ?? t('stockProblems.page.zero.notSet')}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('stockProblems.page.zero.expenseType')}
            </dt>
            <dd>{own?.expenseTypeName ?? t('stockProblems.page.zero.notSet')}</dd>
          </div>
        </dl>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('stockProblems.page.zero.explain')}
        </p>
        <DialogFormFooter
          pending={mutations.zeroOut.isPending}
          disabled={!valid}
          onCancel={props.onDone}
          submitLabel={t('stockProblems.page.zero.confirm')}
        />
      </form>
    </DialogContent>
  );
}

/** «Тохиргоо»: a warehouse's fixed customer and expense type, for what leaves its list as a shortage. */
export function SettingsDialog(props: { warehouseId: number | undefined; onDone: () => void }) {
  const { t } = useTranslation();
  const settings = useStockProblemSettings();
  const rows = settings.data ?? [];
  const [chosen, setChosen] = useState<number | undefined>(props.warehouseId);
  const current = rows.find((row) => row.warehouseId === chosen) ?? rows[0];
  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <DialogHeader>
        <DialogTitle>{t('stockProblems.page.settingsDialog.title')}</DialogTitle>
        <DialogDescription>{t('stockProblems.page.settingsDialog.text')}</DialogDescription>
      </DialogHeader>
      <FormField label={t('stockProblems.page.settingsDialog.warehouse')} htmlFor="sp-warehouse">
        <NativeSelect
          id="sp-warehouse"
          value={current?.warehouseId ?? ''}
          onChange={(event) => setChosen(Number.parseInt(event.target.value, 10))}
        >
          {rows.map((row) => (
            <option key={row.warehouseId} value={row.warehouseId}>
              {row.warehouseName}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {current ? (
        <SettingsForm key={current.warehouseId} setting={current} onDone={props.onDone} />
      ) : null}
    </DialogContent>
  );
}

function SettingsForm(props: { setting: StockProblemSettings; onDone: () => void }) {
  const { t } = useTranslation();
  const { setting } = props;
  const mutations = useStockProblemMutations();
  const types = useIssueExpenseTypes();
  const action = useAction();
  const [customer, setCustomer] = useState<PickedCustomer | null>(
    setting.customerId !== null
      ? { id: setting.customerId, code: '', name: setting.customerName ?? '' }
      : null,
  );
  const [typeId, setTypeId] = useState<number | null>(setting.expenseTypeId);
  const choices = (types.data ?? []).filter((type) => type.active || type.id === typeId);
  const submit = () =>
    void action.run(async () => {
      await mutations.saveSettings.mutateAsync({
        warehouseId: setting.warehouseId,
        customerId: customer?.id ?? null,
        expenseTypeId: typeId,
      });
      toast.success(t('stockProblems.page.settingsDialog.saved'));
      props.onDone();
    });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mutations.saveSettings.isPending) submit();
      }}
    >
      <ProblemAlert problem={action.problem} />
      <FormField label={t('stockProblems.page.settingsDialog.customer')} htmlFor="sp-customer">
        <CustomerPicker id="sp-customer" value={customer} onChange={setCustomer} />
      </FormField>
      <FormField label={t('stockProblems.page.settingsDialog.expenseType')} htmlFor="sp-type">
        <NativeSelect
          id="sp-type"
          value={typeId ?? ''}
          onChange={(event) =>
            setTypeId(event.target.value === '' ? null : Number.parseInt(event.target.value, 10))
          }
        >
          <option value="">{t('stockProblems.page.settingsDialog.pickType')}</option>
          {choices.map((type) => (
            <option key={type.id} value={type.id}>
              {type.active
                ? type.name
                : t('stockProblems.page.settingsDialog.retired', { name: type.name })}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <DialogFormFooter pending={mutations.saveSettings.isPending} onCancel={props.onDone} />
    </form>
  );
}
