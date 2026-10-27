import { Decimal } from '@tugeel/shared/money';
import { handoverAmount } from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { HandCoins } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet, TotalsGrid } from '@/components/record-sheet';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useMoneyAccounts } from '@/features/finance/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type Shift, usePosMutations, useShift } from './api';
import { ShiftStatusBadge } from './badges';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** One shift in the panel (`?shift=`): facts, the Z totals, the cash reckoning, the books. */
export function ShiftPanel({ shiftId, onClose }: { shiftId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const shift = useShift(shiftId);
  const detail = shift.data;
  return (
    <RecordSheet
      open={shiftId !== null}
      onClose={onClose}
      title={detail ? t('pos.shifts.panelTitle', { number: detail.number }) : ''}
      description={detail ? [detail.tillName, detail.cashierName].filter(Boolean).join(' · ') : ''}
      badges={detail ? <ShiftStatusBadge status={detail.status} /> : null}
      actions={detail ? <PanelActions shift={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(shift.error)} />
      {detail ? <ShiftBody shift={detail} /> : null}
    </RecordSheet>
  );
}

function PanelActions({ shift }: { shift: Shift }) {
  const { t } = useTranslation();
  const canReceive = useHasPermission('finance.payments.record');
  const [handing, setHanding] = useState(false);
  if (!canReceive || shift.status !== 'CLOSED') return null;
  return (
    <>
      <Button size="sm" onClick={() => setHanding(true)}>
        <HandCoins />
        {t('pos.actions.handover')}
      </Button>
      <HandoverDialog open={handing} shift={shift} onClose={() => setHanding(false)} />
    </>
  );
}

function ShiftBody({ shift }: { shift: Shift }) {
  const { t } = useTranslation();
  const none = t('pos.fields.none');
  const stamp = (value: string | null) => (value ? formatUbDateTime(Date.parse(value)) : none);
  const money = (value: string | null) => (value === null ? none : formatTugrik(value));
  const facts = [
    { label: t('pos.fields.till'), value: `${shift.tillCode} · ${shift.tillName}` },
    { label: t('pos.fields.cashier'), value: shift.cashierName ?? none },
    { label: t('pos.fields.openedAt'), value: stamp(shift.openedAt) },
    ...(shift.closedAt ? [{ label: t('pos.fields.closedAt'), value: stamp(shift.closedAt) }] : []),
  ];
  const variance = shift.variance === null ? null : new Decimal(shift.variance);
  const varianceLabel =
    variance === null
      ? ''
      : variance.isZero()
        ? t('pos.shifts.exact')
        : variance.gt(0)
          ? t('pos.shifts.over')
          : t('pos.shifts.short');
  const varianceTone =
    variance === null || variance.isZero()
      ? undefined
      : variance.isNegative()
        ? 'text-destructive'
        : 'text-warning';
  const link = 'font-mono text-link underline-offset-2 hover:underline';
  const books = [
    {
      label: t('pos.fields.journalEntry'),
      value:
        shift.journalEntryId && shift.journalNumber ? (
          <Link className={link} to={`/finance/journal?entry=${shift.journalEntryId}`}>
            {shift.journalNumber}
          </Link>
        ) : shift.status === 'OPEN' ? (
          none
        ) : (
          <span className="text-muted-foreground">{t('pos.shifts.noEntry')}</span>
        ),
    },
    {
      label: t('pos.fields.handover'),
      value:
        shift.handoverPaymentId && shift.handoverNumber ? (
          <Link className={link} to={`/finance/payments?payment=${shift.handoverPaymentId}`}>
            {shift.handoverNumber}
          </Link>
        ) : (
          <span className="text-muted-foreground">{t('pos.shifts.notHandedOver')}</span>
        ),
    },
    ...(shift.handedOverAt
      ? [
          {
            label: t('pos.fields.handedOverBy'),
            value: `${shift.handedOverByName ?? none} · ${stamp(shift.handedOverAt)}`,
          },
        ]
      : []),
    {
      label: t('pos.sales.title'),
      value: (
        <Link
          className="text-link underline-offset-2 hover:underline"
          to={`/pos/sales?shiftId=${shift.id}`}
        >
          {t('pos.sales.count', {
            count: formatCount(shift.salesCount + shift.returnsCount),
          })}
        </Link>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <FactChips facts={facts} />
      {shift.status === 'OPEN' ? (
        <p className="text-sm text-muted-foreground">{t('pos.shifts.liveTotals')}</p>
      ) : null}
      <PanelSection title={t('pos.shifts.sections.totals')}>
        <TotalsGrid
          items={[
            [t('pos.fields.salesCount'), formatCount(shift.salesCount)],
            [t('pos.fields.salesTotal'), formatTugrik(shift.salesTotal)],
            [t('pos.fields.salesVat'), formatTugrik(shift.salesVat)],
            [t('pos.fields.cardSales'), formatTugrik(shift.cardSales)],
            [t('pos.fields.creditSales'), formatTugrik(shift.creditSales)],
            [t('pos.fields.returnsCount'), formatCount(shift.returnsCount)],
            [t('pos.fields.returnsTotal'), formatTugrik(shift.returnsTotal)],
            [t('pos.fields.returnsVat'), formatTugrik(shift.returnsVat)],
            [t('pos.fields.cardRefunds'), formatTugrik(shift.cardRefunds)],
            [t('pos.fields.creditRefunds'), formatTugrik(shift.creditRefunds)],
          ]}
        />
      </PanelSection>
      <PanelSection title={t('pos.shifts.sections.cash')}>
        <TotalsGrid
          items={[
            [t('pos.fields.openingFloat'), formatTugrik(shift.openingFloat)],
            [t('pos.fields.cashSales'), formatTugrik(shift.cashSales)],
            [t('pos.fields.cashRefunds'), formatTugrik(shift.cashRefunds)],
            [t('pos.fields.expectedCash'), money(shift.expectedCash)],
            [t('pos.fields.countedCash'), money(shift.countedCash)],
            [t('pos.fields.floatKept'), money(shift.floatKept)],
            [
              t('pos.fields.variance'),
              shift.variance === null ? (
                none
              ) : (
                <span className={varianceTone}>
                  {formatTugrik(shift.variance)} · {varianceLabel}
                </span>
              ),
            ],
          ]}
        />
        {shift.note ? (
          <p className="rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap">
            <span className="mr-2 text-[12px] text-muted-foreground">{t('pos.fields.note')}</span>
            {shift.note}
          </p>
        ) : null}
      </PanelSection>
      <PanelSection title={t('pos.shifts.sections.books')}>
        <FactChips facts={books} />
      </PanelSection>
    </div>
  );
}

/** «Бэлэн мөнгө хүлээн авах» (ADR-0064 #3): the accountant books the shift's cash into a box. */
function HandoverDialog({
  open,
  shift,
  onClose,
}: {
  open: boolean;
  shift: Shift;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const accounts = useMoneyAccounts();
  const mutations = usePosMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [moneyAccountId, setMoneyAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState(() =>
    handoverAmount(shift.countedCash ?? '0', shift.floatKept ?? '0').toFixed(2),
  );
  const [paidOn, setPaidOn] = useState(businessDate());
  const [checked, setChecked] = useState(false);
  const cashBoxes = (accounts.data ?? []).filter(
    (account) => account.kind === 'CASH' && account.status === 'ACTIVE',
  );
  useEffect(() => {
    if (moneyAccountId === null && cashBoxes[0]) setMoneyAccountId(cashBoxes[0].id);
  }, [cashBoxes, moneyAccountId]);
  const amountValue = MONEY.test(amount) ? new Decimal(amount) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (moneyAccountId === null || amountValue === null || !amountValue.gt(0)) return;
    void action
      .run(async () => {
        const handed = await mutations.handOver.mutateAsync({
          id: shift.id,
          key,
          moneyAccountId,
          amount: amountValue.toFixed(),
          paidOn,
        });
        toast.success(t('pos.shifts.handedOver', { number: handed.handoverNumber ?? '' }));
      })
      .then((ok) => {
        if (ok) {
          setKey(randomUuid());
          onClose();
        }
      });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pos.shifts.handoverTitle')}</DialogTitle>
          <DialogDescription>
            {t('pos.shifts.handoverDescription', { number: shift.number })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField
            label={t('pos.fields.moneyAccount')}
            htmlFor="handover-account"
            error={checked && moneyAccountId === null ? 'validation.required' : undefined}
          >
            <NativeSelect
              id="handover-account"
              value={moneyAccountId ?? ''}
              onChange={(event) =>
                setMoneyAccountId(Number.parseInt(event.target.value, 10) || null)
              }
            >
              <option value="">{t('pos.shifts.chooseAccount')}</option>
              {cashBoxes.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {formatTugrik(account.balance)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('pos.fields.amount')}
              htmlFor="handover-amount"
              error={
                checked && (amountValue === null || !amountValue.gt(0))
                  ? 'validation.money'
                  : undefined
              }
            >
              <Input
                id="handover-amount"
                inputMode="decimal"
                className="font-mono"
                value={amount}
                onChange={(event) => setAmount(event.target.value.trim())}
              />
            </FormField>
            <FormField label={t('pos.fields.paidOn')} htmlFor="handover-date">
              <Input
                id="handover-date"
                type="date"
                className="font-mono"
                value={paidOn}
                max={businessDate()}
                onChange={(event) => setPaidOn(event.target.value)}
              />
            </FormField>
          </div>
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={mutations.handOver.isPending}
            onCancel={onClose}
            submitLabel={t('pos.shifts.handoverSubmit')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
