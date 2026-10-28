import { allocateFifo, type ArEntryKind, type PayableEntryKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useFinanceMutations, useOpenItems, useSupplierOpenItems } from './api';

/** Whose open items the dialog pairs: a customer's receivables or a supplier's payables (F3). */
export type AllocationParty = { kind: 'customer' | 'supplier'; id: number };

/** What the dialog needs of an open item, receivable or payable. */
interface Item {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  kind: ArEntryKind | PayableEntryKind;
  number: string;
  itemDate: string;
  dueDate: string | null;
  openAmount: string;
}

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const isOpen = (item: Item) => new Decimal(item.openAmount).gt(0);
/** The date an item falls due: its due date, else the day it was booked. */
const dueOf = (item: Item) => item.dueDate ?? item.itemDate;

/**
 * «Тулгалт хийх» (ADR-0090): the accountant pairs one open credit of a customer (a payment's or a
 * credit note's remainder) with open debits (invoices, refunds) by hand. For a supplier (F3,
 * ADR-0091) the sides turn: one open debit (a payment or a return booked on the payables) with
 * open bills. «Хуучнаас нь» fills the amounts oldest due first up to the chosen item's open amount;
 * nothing is sent before «Тулгах».
 */
export function AllocationDialog({
  open,
  party,
  onClose,
}: {
  open: boolean;
  party: AllocationParty;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <AllocationForm party={party} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function AllocationForm({ party, onClose }: { party: AllocationParty; onClose: () => void }) {
  const { t } = useTranslation();
  const supplier = party.kind === 'supplier';
  const receivables = useOpenItems(party.id, !supplier);
  const payables = useSupplierOpenItems(party.id, supplier);
  const items = supplier ? payables : receivables;
  // A customer's credit pays its debits; a supplier's debit (a payment) pays its bills (credits).
  const sourceSide = supplier ? 'DEBIT' : 'CREDIT';
  const kindLabel = (kind: Item['kind']) =>
    supplier
      ? t(`finance.apKinds.${kind as PayableEntryKind}`)
      : t(`finance.arKinds.${kind as ArEntryKind}`);
  const texts = supplier
    ? {
        intro: t('finance.payables.allocation.intro'),
        credits: t('finance.payables.allocation.credits'),
        noCredits: t('finance.payables.allocation.noCredits'),
        debits: t('finance.payables.allocation.debits'),
        noDebits: t('finance.payables.allocation.noDebits'),
        chooseCredit: t('finance.payables.allocation.chooseCredit'),
      }
    : {
        intro: t('finance.allocations.intro'),
        credits: t('finance.allocations.credits'),
        noCredits: t('finance.allocations.noCredits'),
        debits: t('finance.allocations.debits'),
        noDebits: t('finance.allocations.noDebits'),
        chooseCredit: t('finance.allocations.chooseCredit'),
      };
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [creditId, setCreditId] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [date, setDate] = useState(businessDate());
  const [description, setDescription] = useState('');
  const [checked, setChecked] = useState(false);

  const all: Item[] = useMemo(() => items.data ?? [], [items.data]);
  const credits = useMemo(
    () => all.filter((item) => item.side === sourceSide && isOpen(item)),
    [all, sourceSide],
  );
  const debits = useMemo(
    () =>
      all
        .filter((item) => item.side !== sourceSide && isOpen(item))
        .sort((a, b) => dueOf(a).localeCompare(dueOf(b)) || a.id - b.id),
    [all, sourceSide],
  );
  // A lone credit is chosen already.
  useEffect(() => {
    if (creditId === null && credits.length === 1 && credits[0]) setCreditId(credits[0].id);
  }, [credits, creditId]);
  const credit = credits.find((item) => item.id === creditId) ?? null;

  const typed = debits.flatMap((item) => {
    const raw = amounts[item.id] ?? '';
    return raw ? [{ item, value: MONEY.test(raw) ? new Decimal(raw) : null }] : [];
  });
  const invalid = typed.filter((entry) => entry.value === null);
  const overDebit = typed.filter((entry) => entry.value?.gt(entry.item.openAmount));
  const pairs = typed.flatMap((entry) =>
    entry.value && entry.value.gt(0) ? [{ item: entry.item, amount: entry.value }] : [],
  );
  const total = pairs.reduce((sum, pair) => sum.plus(pair.amount), new Decimal(0));
  const remaining = credit ? new Decimal(credit.openAmount).minus(total) : null;
  const overCredit = remaining !== null && remaining.lt(0);

  const oldestFirst = () => {
    if (!credit) {
      setChecked(true);
      return;
    }
    const fifo = allocateFifo(
      credit.openAmount,
      debits.map((item) => ({ id: item.id, dueDate: dueOf(item), openAmount: item.openAmount })),
    );
    setAmounts(Object.fromEntries(fifo.map((entry) => [entry.invoiceId, entry.amount.toFixed()])));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (
      credit === null ||
      pairs.length === 0 ||
      invalid.length > 0 ||
      overDebit.length > 0 ||
      overCredit
    ) {
      return;
    }
    void action.run(async () => {
      const allocation = await mutations.allocate.mutateAsync({
        key,
        body: {
          ...(supplier ? { supplierId: party.id } : { customerId: party.id }),
          date,
          description: description.trim() || null,
          pairs: pairs.map((pair) => ({
            debitItemId: supplier ? credit.id : pair.item.id,
            creditItemId: supplier ? pair.item.id : credit.id,
            amount: pair.amount.toFixed(),
          })),
        },
      });
      toast.success(t('finance.allocations.done', { number: allocation.number }));
      onClose();
    });
  };

  const messages = [
    ...(checked && credit === null ? [texts.chooseCredit] : []),
    ...(checked && credit !== null && pairs.length === 0 && invalid.length === 0
      ? [t('finance.allocations.nothing')]
      : []),
    ...(checked
      ? invalid.map((entry) =>
          t('finance.allocations.invalidAmount', { number: entry.item.number }),
        )
      : []),
    ...overDebit.map((entry) => t('finance.allocations.overDebit', { number: entry.item.number })),
    ...(overCredit ? [t('finance.allocations.overCredit')] : []),
  ];

  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <DialogHeader>
        <DialogTitle>{t('finance.allocations.title')}</DialogTitle>
        <DialogDescription>{texts.intro}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ProblemAlert problem={problemFromError(items.error)} onRetry={items.refetch} />
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{texts.credits}</legend>
          {items.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : credits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{texts.noCredits}</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('finance.fields.number')}</TableHead>
                    <TableHead>{t('finance.fields.kind')}</TableHead>
                    <TableHead>{t('finance.fields.date')}</TableHead>
                    <TableHead className="text-right">{t('finance.fields.open')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.map((item) => (
                    <TableRow
                      key={item.id}
                      data-state={item.id === creditId ? 'selected' : undefined}
                    >
                      <TableCell className="font-mono">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="allocation-credit"
                            className="size-4 accent-primary"
                            checked={item.id === creditId}
                            onChange={() => setCreditId(item.id)}
                          />
                          {item.number}
                        </label>
                      </TableCell>
                      <TableCell>{kindLabel(item.kind)}</TableCell>
                      <TableCell className="font-mono">{item.itemDate}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatTugrik(item.openAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </fieldset>
        <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{texts.debits}</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={debits.length === 0}
              onClick={oldestFirst}
            >
              {t('finance.allocations.oldestFirst')}
            </Button>
          </div>
          {items.isPending ? null : debits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{texts.noDebits}</p>
          ) : (
            // Many open invoices scroll inside the section; the footer stays in reach.
            <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('finance.fields.number')}</TableHead>
                    <TableHead>{t('finance.fields.dueDate')}</TableHead>
                    <TableHead className="text-right">{t('finance.fields.open')}</TableHead>
                    <TableHead className="text-right">{t('finance.allocations.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {debits.map((item) => {
                    const raw = amounts[item.id] ?? '';
                    const wrong =
                      (checked && raw !== '' && !MONEY.test(raw)) ||
                      (MONEY.test(raw) && new Decimal(raw).gt(item.openAmount));
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono">
                          {item.number}
                          {item.kind === 'INVOICE' || item.kind === 'BILL' ? null : (
                            <span className="ml-2 font-sans text-xs text-muted-foreground">
                              {kindLabel(item.kind)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono">{item.dueDate ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatTugrik(item.openAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            aria-label={`${t('finance.allocations.amount')}: ${item.number}`}
                            aria-invalid={wrong ? true : undefined}
                            inputMode="decimal"
                            className="ml-auto w-32 font-mono"
                            value={raw}
                            onChange={(event) =>
                              setAmounts((previous) => ({
                                ...previous,
                                [item.id]: event.target.value.trim(),
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-sm">
            {t('finance.allocations.allocated', { amount: formatMnt(total.toFixed(2)) })}
            {remaining !== null && !overCredit
              ? ` · ${t('finance.allocations.remaining', { amount: formatMnt(remaining.toFixed(2)) })}`
              : ''}
          </p>
          {messages.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
              {messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}
        </section>
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <FormField label={t('finance.allocations.date')} htmlFor="allocation-date">
            <Input
              id="allocation-date"
              type="date"
              className="font-mono"
              value={date}
              max={businessDate()}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          <FormField label={t('finance.allocations.description')} htmlFor="allocation-description">
            <Input
              id="allocation-description"
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
        </div>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter
          pending={mutations.allocate.isPending}
          onCancel={onClose}
          submitLabel={t('finance.allocations.submit')}
        />
      </form>
    </DialogContent>
  );
}
