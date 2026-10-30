import { Decimal } from '@tugeel/shared/money';
import { type EdgeCartLine, type EdgeQuoteResponse, formatVoucherCode } from '@tugeel/shared/pos';
import { ScanBarcode, Ticket, X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatMnt, formatTugrik } from '@/lib/money';
import { useProblemText } from '../messages';
import { useQuote } from '../queries';
import { useVoucherAdd } from '../vouchers';
import { KioskAlert } from './layout';

/**
 * «Купон, ваучер (F2)» (ADR-0110): the cashier scans or types the customer's discount coupons and
 * partner vouchers, sees what each takes off or pays and what is left, and goes on to the payment
 * («Төлбөр рүү»), which a supervisor's PIN opens once for the sale.
 */
export function VoucherDialog(props: {
  open: boolean;
  lines: readonly EdgeCartLine[];
  codes: readonly string[];
  onCodes: (codes: string[]) => void;
  onPay: (quote: EdgeQuoteResponse) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="md" className="gap-3" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket aria-hidden className="size-5 text-primary" />
            {t('posKiosk.vouchers.title')}
          </DialogTitle>
          <DialogDescription>{t('posKiosk.vouchers.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? <VoucherPanel {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VoucherPanel(props: {
  lines: readonly EdgeCartLine[];
  codes: readonly string[];
  onCodes: (codes: string[]) => void;
  onPay: (quote: EdgeQuoteResponse) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const addCode = useVoucherAdd();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const quote = useQuote(props.lines, props.codes);
  const fresh = quote.isSuccess && !quote.isPlaceholderData && !quote.isFetching;
  const taken = quote.data?.vouchers ?? [];

  const add = async (typed: string) => {
    setText('');
    if (!typed.trim()) return;
    setError(null);
    setChecking(true);
    const result = await addCode(props.lines, props.codes, typed);
    setChecking(false);
    if (result.ok) props.onCodes(result.codes);
    else setError(result.error);
    input.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void add(text);
  };

  const remove = (code: string) => {
    props.onCodes(props.codes.filter((one) => one !== code));
    setError(null);
    input.current?.focus();
  };

  const coupons = taken
    .filter((one) => one.kind === 'COUPON')
    .reduce((sum, one) => sum.plus(one.amount), new Decimal(0));

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="relative">
        <ScanBarcode
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          autoFocus
          aria-label={t('posKiosk.vouchers.codeLabel')}
          placeholder={t('posKiosk.vouchers.codePlaceholder')}
          autoComplete="off"
          inputMode="numeric"
          spellCheck={false}
          className="h-12 pl-10 font-mono text-lg"
          value={text}
          disabled={checking}
          onChange={(event) => setText(event.target.value)}
        />
      </form>
      {error ? <KioskAlert>{error}</KioskAlert> : null}
      {taken.length > 0 ? (
        <ul aria-label={t('posKiosk.vouchers.taken')} className="divide-y divide-border">
          {taken.map((one) => (
            <li key={one.code} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-medium">
                  {`${t(`posKiosk.vouchers.kinds.${one.kind}`)} · ${one.name}`}
                </p>
                <p className="truncate font-mono text-[0.8125rem] text-muted-foreground">
                  {formatVoucherCode(one.code)}
                  {one.partnerName ? ` · ${one.partnerName}` : ''}
                </p>
              </div>
              <span className="font-mono text-[0.9375rem]">{`−${formatMnt(one.amount)}₮`}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-11"
                aria-label={t('posKiosk.vouchers.remove', { code: formatVoucherCode(one.code) })}
                title={t('posKiosk.vouchers.remove', { code: formatVoucherCode(one.code) })}
                onClick={() => remove(one.code)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{t('posKiosk.vouchers.none')}</p>
      )}
      {quote.data ? (
        <dl className="space-y-1.5 rounded-xl bg-canvas px-4 py-3 text-[0.9375rem]">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('posKiosk.vouchers.before')}</dt>
            <dd className="font-mono">
              {formatTugrik(new Decimal(quote.data.total).plus(coupons).toFixed(2))}
            </dd>
          </div>
          {coupons.gt(0) ? (
            <div className="flex justify-between text-success">
              <dt>{t('posKiosk.vouchers.couponTotal')}</dt>
              <dd className="font-mono">{`−${formatMnt(coupons.toFixed(2))}₮`}</dd>
            </div>
          ) : null}
          {new Decimal(quote.data.voucherTotal ?? 0).gt(0) ? (
            <div className="flex justify-between text-success">
              <dt>{t('posKiosk.vouchers.voucherTotal')}</dt>
              <dd className="font-mono">{`−${formatMnt(quote.data.voucherTotal ?? '0')}₮`}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t border-border pt-2">
            <dt className="font-semibold">{t('posKiosk.vouchers.due')}</dt>
            <dd data-testid="voucher-due" className="font-mono text-2xl font-semibold">
              {formatTugrik(quote.data.due ?? quote.data.total)}
            </dd>
          </div>
        </dl>
      ) : null}
      {quote.isError ? <KioskAlert>{problemText(quote.error)}</KioskAlert> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" className="h-11" onClick={props.onClose}>
          {t('common.close')}
        </Button>
        <Button
          type="button"
          className="h-11 px-6 text-base"
          disabled={!fresh || checking || props.codes.length === 0}
          onClick={() => {
            if (quote.data) props.onPay(quote.data);
          }}
        >
          {t('posKiosk.vouchers.toPayment')}
        </Button>
      </DialogFooter>
    </div>
  );
}
