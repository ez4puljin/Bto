import { Decimal, toMoney } from '@tugeel/shared/money';
import type {
  EdgeApproval,
  EdgePrintableReceipt,
  EdgeReturnSale,
  EdgeReturnableLine,
} from '@tugeel/shared/pos';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty, formatTugrik } from '@/lib/money';
import { randomUuid } from '@/lib/uuid';
import { parseQty } from '../amounts';
import { useKiosk } from '../kiosk-context';
import { typeDigits } from '../keys';
import { useProblemText } from '../messages';
import { ApprovalForm } from './approval-dialog';
import { KioskAlert } from './layout';

interface Chosen {
  qty: string;
  damaged: boolean;
}

/**
 * «Буцаалт (F4)» (ADR-0104): the receipt's number finds the sale, the cashier types how many of
 * each line come back (a damaged item goes to DAMAGED, not the shelf), a supervisor approves and
 * the money goes back in cash; the refund receipt follows.
 */
export function ReturnsDialog(props: {
  open: boolean;
  approvalRequired: boolean;
  onClose: () => void;
  onDone: (receipt: EdgePrintableReceipt) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent size="lg" onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('posKiosk.returns.title')}</DialogTitle>
          <DialogDescription>{t('posKiosk.returns.description')}</DialogDescription>
        </DialogHeader>
        {props.open ? (
          <ReturnsPanel
            approvalRequired={props.approvalRequired}
            onCancel={props.onClose}
            onDone={props.onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The refund of a line part as the edge will compute it: its share of the line's total. */
function partOf(line: EdgeReturnableLine, qty: string): Decimal {
  return toMoney(new Decimal(line.total).times(qty).dividedBy(line.qty));
}

function ReturnsPanel(props: {
  approvalRequired: boolean;
  onCancel: () => void;
  onDone: (receipt: EdgePrintableReceipt) => void;
}) {
  const { t } = useTranslation();
  const { client } = useKiosk();
  const problemText = useProblemText();
  const [number, setNumber] = useState('');
  const [sale, setSale] = useState<EdgeReturnSale | null>(null);
  const [chosen, setChosen] = useState<Record<number, Chosen>>({});
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One client id per return of this sale: a retry after a timeout sends the same one.
  const clientId = useRef(randomUuid());

  const find = async () => {
    if (!number.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      setSale(await client.returnSale(number.trim()));
      setChosen({});
      clientId.current = randomUuid();
    } catch (caught) {
      setError(problemText(caught));
    } finally {
      setPending(false);
    }
  };

  const lines = sale
    ? sale.lines.flatMap((line) => {
        const pick = chosen[line.lineNo];
        const qty = pick ? parseQty(pick.qty) : null;
        return qty && new Decimal(qty).gt(0)
          ? [{ line, qty, damaged: pick?.damaged ?? false }]
          : [];
      })
    : [];
  const total = lines.reduce(
    (sum, entry) => sum.plus(partOf(entry.line, entry.qty)),
    new Decimal(0),
  );
  const tooMany = lines.some((entry) => new Decimal(entry.qty).gt(entry.line.returnable));

  const refund = async (approval: EdgeApproval | null) => {
    if (!sale) return;
    const receipt = await client.refund({
      clientId: clientId.current,
      refundsSaleClientId: sale.clientId,
      lines: lines.map((entry) => ({
        refundsLineNo: entry.line.lineNo,
        qty: entry.qty,
        damaged: entry.damaged,
      })),
      approval,
    });
    props.onDone(receipt);
  };

  const submit = async () => {
    if (lines.length === 0 || tooMany) {
      setError(t('posKiosk.returns.pickSome'));
      return;
    }
    if (props.approvalRequired) {
      setApproving(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await refund(null);
    } catch (caught) {
      setError(problemText(caught));
    } finally {
      setPending(false);
    }
  };

  if (sale && approving) {
    return (
      <ApprovalForm
        request={{
          kind: 'RETURN',
          items: lines.map((entry) => ({
            name: entry.line.name,
            qty: entry.qty,
            uomName: entry.line.uomName,
          })),
          run: refund,
        }}
        onCancel={() => setApproving(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <Input
          autoFocus
          aria-label={t('posKiosk.returns.number')}
          placeholder={t('posKiosk.returns.numberPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          className="h-12 font-mono text-lg md:text-lg"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
        <Button type="submit" className="h-12 px-5" disabled={pending || !number.trim()}>
          <Search />
          {t('posKiosk.returns.find')}
        </Button>
      </form>
      {error ? <KioskAlert>{error}</KioskAlert> : null}
      {sale ? (
        <section aria-label={sale.number} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('posKiosk.returns.sale', {
              number: sale.number,
              date: formatUbDateTime(Date.parse(sale.soldAt)),
              total: formatTugrik(sale.total),
            })}
          </p>
          {sale.withinWindow ? null : (
            <KioskAlert>{t('posKiosk.returns.outOfWindow', { days: sale.windowDays })}</KioskAlert>
          )}
          {sale.loyalty ? (
            <KioskAlert tone="info">{t('posKiosk.loyalty.returnNote')}</KioskAlert>
          ) : null}
          <ul className="max-h-[min(22rem,45svh)] divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-border">
            {sale.lines.map((line) => {
              const left = new Decimal(line.returnable);
              const pick = chosen[line.lineNo] ?? { qty: '', damaged: false };
              const set = (change: Partial<Chosen>) =>
                setChosen((previous) => ({ ...previous, [line.lineNo]: { ...pick, ...change } }));
              return (
                <li key={line.lineNo} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{line.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t('posKiosk.returns.sold', {
                        qty: formatQty(line.qty),
                        uom: line.uomName,
                        price: formatMnt(line.unitPrice),
                      })}
                      {' · '}
                      {left.gt(0)
                        ? t('posKiosk.returns.returnable', { qty: formatQty(line.returnable) })
                        : t('posKiosk.returns.nothingLeft')}
                    </span>
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={pick.damaged}
                      disabled={!left.gt(0) || !sale.withinWindow}
                      onCheckedChange={(checked) => set({ damaged: checked === true })}
                    />
                    {t('posKiosk.returns.damaged')}
                  </label>
                  <Input
                    aria-label={t('posKiosk.returns.qty', { name: line.name })}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={!left.gt(0) || !sale.withinWindow}
                    className="h-10 w-20 text-right font-mono"
                    placeholder="0"
                    value={pick.qty}
                    onChange={(event) => set({ qty: event.target.value })}
                    onKeyDown={(event) => typeDigits(event, pick.qty, (next) => set({ qty: next }))}
                  />
                </li>
              );
            })}
          </ul>
          <p className="flex items-baseline justify-between text-[15px]">
            <span className="text-muted-foreground">{t('posKiosk.returns.total')}</span>
            <span data-testid="return-total" className="font-mono text-2xl font-semibold">
              {formatTugrik(total.toFixed(2))}
            </span>
          </p>
        </section>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          className="h-11"
          disabled={!sale?.withinWindow || lines.length === 0 || tooMany || pending}
          onClick={() => void submit()}
        >
          {t('posKiosk.returns.submit')}
        </Button>
      </DialogFooter>
    </div>
  );
}
