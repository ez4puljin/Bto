import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeSession,
  type EdgeShiftCloseRequest,
  type EdgeShiftSummary,
  POS_LIMITS,
  cashVariance,
  handoverAmount,
} from '@tugeel/shared/pos';
import { cn } from 'cn';
import { LogOut } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { fieldMoney, parseMoney, wireMoney } from '../amounts';
import { KioskHeader } from '../components/kiosk-header';
import { KioskAlert } from '../components/layout';
import { useCredentials, useKiosk } from '../kiosk-context';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { kioskKeys, useParked } from '../queries';

function Figure(props: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={cn('text-[15px]', props.strong ? 'font-semibold' : 'text-muted-foreground')}>
        {props.label}
      </dt>
      <dd
        className={cn(
          'text-right font-mono',
          props.strong ? 'text-xl font-semibold' : 'text-[15px] font-medium',
        )}
      >
        {props.value}
      </dd>
    </div>
  );
}

/** Counted − expected: red when the drawer is short, amber when over, green when even. */
function VarianceTile({ variance }: { variance: Decimal | null }) {
  const { t } = useTranslation();
  const tone =
    variance === null || variance.isZero()
      ? 'bg-success-soft text-success'
      : variance.isNegative()
        ? 'bg-danger-soft text-destructive'
        : 'bg-warning-soft text-warning';
  const text =
    variance === null
      ? t('common.none')
      : variance.isZero()
        ? t('posKiosk.shiftClose.even')
        : variance.isNegative()
          ? t('posKiosk.shiftClose.short', { amount: formatTugrik(variance.abs().toFixed(2)) })
          : t('posKiosk.shiftClose.over', { amount: formatTugrik(variance.toFixed(2)) });
  return (
    <div
      role="status"
      className={cn('flex items-baseline justify-between rounded-xl px-4 py-3', tone)}
    >
      <span className="text-[15px] font-medium">{t('pos.fields.variance')}</span>
      <span className="font-mono text-2xl font-semibold tracking-tight">{text}</span>
    </div>
  );
}

/**
 * «Ээлж хаах»: the shift's expected figures, the cash counted in the drawer, the change kept for
 * the next shift and a note; the variance follows the count. The answer is the Z summary.
 */
export function ShiftCloseScreen(props: {
  session: EdgeSession;
  shift: EdgeShiftSummary;
  cartCount: number;
  onCancel: () => void;
  onClosed: (summary: EdgeShiftSummary) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const { shift } = props;
  const parked = useParked();
  const [counted, setCounted] = useState('');
  const [floatKept, setFloatKept] = useState(() => fieldMoney(shift.openingFloat));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const close = useMutation({
    mutationFn: (body: EdgeShiftCloseRequest) => client.closeShift(body),
    onSuccess: (summary) => {
      setAsking(false);
      props.onClosed(summary);
    },
  });

  // The figures as the edge has them now, not as they were at the last sale.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: kioskKeys.session(epoch) });
  }, [queryClient, epoch]);

  const countedAmount = parseMoney(counted);
  const keptAmount = parseMoney(floatKept);
  const keptTooMuch = countedAmount !== null && keptAmount !== null && keptAmount.gt(countedAmount);
  const variance = countedAmount ? cashVariance(countedAmount, shift.expectedCash) : null;
  const blocked = props.cartCount > 0;
  const valid = countedAmount !== null && keptAmount !== null && !keptTooMuch && !blocked;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (valid) setAsking(true);
  };
  const confirm = () => {
    if (!valid || close.isPending || countedAmount === null || keptAmount === null) return;
    close.mutate({
      countedCash: wireMoney(countedAmount),
      floatKept: wireMoney(keptAmount),
      note: note.trim() || null,
    });
  };

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <KioskHeader session={props.session} />
      <main className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-5xl space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('posKiosk.shiftClose.title')}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {t('posKiosk.shiftClose.description', { number: shift.number })}
            </p>
          </div>
          {blocked ? (
            <KioskAlert tone="warning">
              {t('posKiosk.shiftClose.cartNotEmpty', { count: props.cartCount })}
            </KioskAlert>
          ) : null}
          {parked.data?.length ? (
            <KioskAlert tone="info">
              {t('posKiosk.shiftClose.parkedWaiting', { count: parked.data.length })}
            </KioskAlert>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <section
              aria-labelledby="close-expected"
              className="rounded-xl bg-card p-5 shadow-card ring-1 ring-black/[0.06]"
            >
              <h2 id="close-expected" className="mb-2 text-[15px] font-semibold">
                {t('posKiosk.shiftClose.expected')}
              </h2>
              <dl className="divide-y divide-border">
                <Figure
                  label={t('pos.fields.openingFloat')}
                  value={formatTugrik(shift.openingFloat)}
                />
                <Figure label={t('pos.fields.salesCount')} value={formatCount(shift.salesCount)} />
                <Figure label={t('pos.fields.cashSales')} value={formatTugrik(shift.cashSales)} />
                <Figure label={t('pos.fields.cardSales')} value={formatTugrik(shift.cardSales)} />
                {shift.creditSales && shift.creditSales !== '0.00' ? (
                  <Figure
                    label={t('posKiosk.z.creditSales')}
                    value={formatTugrik(shift.creditSales)}
                  />
                ) : null}
                <Figure label={t('pos.fields.salesTotal')} value={formatTugrik(shift.total)} />
                {shift.returnsCount ? (
                  <Figure
                    label={t('posKiosk.z.returns', { count: shift.returnsCount })}
                    value={`−${formatTugrik(shift.cashRefunds)}`}
                  />
                ) : null}
                <Figure
                  strong
                  label={t('pos.fields.expectedCash')}
                  value={formatTugrik(shift.expectedCash)}
                />
              </dl>
            </section>
            <form
              aria-labelledby="close-count"
              className="space-y-4 rounded-xl bg-card p-5 shadow-card ring-1 ring-black/[0.06]"
              onSubmit={submit}
              noValidate
            >
              <h2 id="close-count" className="text-[15px] font-semibold">
                {t('posKiosk.shiftClose.count')}
              </h2>
              <div className="space-y-1.5">
                <Label htmlFor="close-counted" className="text-[15px]">
                  {t('pos.fields.countedCash')}
                </Label>
                <Input
                  id="close-counted"
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-14 text-right font-mono text-2xl md:text-2xl"
                  value={counted}
                  aria-invalid={tried && countedAmount === null}
                  aria-describedby={
                    tried && countedAmount === null ? 'close-counted-error' : undefined
                  }
                  onChange={(event) => setCounted(event.target.value)}
                  onKeyDown={(event) => typeDigits(event, counted, setCounted)}
                />
                {tried && countedAmount === null ? (
                  <p id="close-counted-error" className="text-sm text-destructive">
                    {t('validation.money')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="close-float" className="text-[15px]">
                  {t('pos.fields.floatKept')}
                </Label>
                <Input
                  id="close-float"
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-12 text-right font-mono text-xl md:text-xl"
                  value={floatKept}
                  aria-invalid={keptAmount === null || keptTooMuch}
                  aria-describedby={
                    keptTooMuch || keptAmount === null ? 'close-float-error' : undefined
                  }
                  onChange={(event) => setFloatKept(event.target.value)}
                  onKeyDown={(event) => typeDigits(event, floatKept, setFloatKept)}
                />
                {keptAmount === null || keptTooMuch ? (
                  <p id="close-float-error" className="text-sm text-destructive">
                    {keptTooMuch ? t('posKiosk.shiftClose.floatTooMuch') : t('validation.money')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="close-note" className="text-[15px]">
                  {t('pos.fields.note')}
                </Label>
                <Textarea
                  id="close-note"
                  rows={2}
                  maxLength={POS_LIMITS.maxNote}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <VarianceTile variance={variance} />
              <div className="flex justify-end gap-2 border-t border-border/80 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-12"
                  onClick={props.onCancel}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" size="lg" className="h-12 px-6 text-base" disabled={blocked}>
                  {t('posKiosk.shiftClose.submit')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </main>
      <ConfirmDialog
        open={asking}
        variant="default"
        title={t('posKiosk.shiftClose.confirmTitle')}
        description={t('posKiosk.shiftClose.confirmDescription')}
        confirmLabel={t('posKiosk.shiftClose.submit')}
        pending={close.isPending}
        onConfirm={confirm}
        onClose={() => {
          setAsking(false);
          close.reset();
        }}
      >
        <VarianceTile variance={variance} />
        {close.isError ? <KioskAlert>{problemText(close.error)}</KioskAlert> : null}
      </ConfirmDialog>
    </div>
  );
}

/** The Z summary the edge answered for the closed shift; «Гарах» signs the cashier out. */
export function ShiftSummaryScreen(props: {
  session: EdgeSession;
  summary: EdgeShiftSummary;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const { summary } = props;
  const variance = summary.variance === null ? null : new Decimal(summary.variance);
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <KioskHeader session={props.session} />
      <main className="flex-1 overflow-y-auto p-4">
        <section
          aria-labelledby="z-title"
          className="mx-auto max-w-xl space-y-4 rounded-2xl bg-card p-6 shadow-card ring-1 ring-black/[0.06]"
        >
          <div>
            <h1 id="z-title" className="text-2xl font-semibold tracking-tight">
              {t('posKiosk.z.title')}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {t('posKiosk.z.description', { number: summary.number })}
            </p>
          </div>
          <dl className="divide-y divide-border">
            <Figure
              label={t('pos.fields.openedAt')}
              value={formatUbDateTime(Date.parse(summary.openedAt))}
            />
            {summary.closedAt ? (
              <Figure
                label={t('pos.fields.closedAt')}
                value={formatUbDateTime(Date.parse(summary.closedAt))}
              />
            ) : null}
            <Figure label={t('pos.fields.salesCount')} value={formatCount(summary.salesCount)} />
            <Figure label={t('pos.fields.cashSales')} value={formatTugrik(summary.cashSales)} />
            <Figure label={t('pos.fields.cardSales')} value={formatTugrik(summary.cardSales)} />
            {summary.creditSales && summary.creditSales !== '0.00' ? (
              <Figure
                label={t('posKiosk.z.creditSales')}
                value={formatTugrik(summary.creditSales)}
              />
            ) : null}
            <Figure label={t('pos.fields.salesTotal')} value={formatTugrik(summary.total)} />
            <Figure label={t('pos.fields.salesVat')} value={formatTugrik(summary.vatTotal)} />
            {summary.returnsCount ? (
              <Figure
                label={t('posKiosk.z.returns', { count: summary.returnsCount })}
                value={`−${formatTugrik(summary.cashRefunds)}`}
              />
            ) : null}
            {summary.creditRefunds && summary.creditRefunds !== '0.00' ? (
              <Figure
                label={t('posKiosk.z.creditRefunds')}
                value={`−${formatTugrik(summary.creditRefunds)}`}
              />
            ) : null}
            <Figure
              label={t('pos.fields.openingFloat')}
              value={formatTugrik(summary.openingFloat)}
            />
            <Figure
              label={t('pos.fields.expectedCash')}
              value={formatTugrik(summary.expectedCash)}
            />
            {summary.countedCash !== null ? (
              <Figure
                label={t('pos.fields.countedCash')}
                value={formatTugrik(summary.countedCash)}
              />
            ) : null}
            {summary.floatKept !== null ? (
              <Figure label={t('pos.fields.floatKept')} value={formatTugrik(summary.floatKept)} />
            ) : null}
            {summary.countedCash !== null && summary.floatKept !== null ? (
              <Figure
                strong
                label={t('posKiosk.z.handover')}
                value={formatTugrik(
                  handoverAmount(summary.countedCash, summary.floatKept).toFixed(2),
                )}
              />
            ) : null}
          </dl>
          <VarianceTile variance={variance} />
          <Button size="lg" className="h-12 w-full text-base" autoFocus onClick={props.onSignOut}>
            <LogOut />
            {t('posKiosk.menu.logout')}
          </Button>
        </section>
      </main>
    </div>
  );
}
