import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
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
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { formatMnt } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type GlAccount,
  type MoneyAccount,
  useFinanceMutations,
  useGlAccounts,
  useMoneyAccounts,
} from './api';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

interface LineDraft {
  id: number;
  accountId: number | null;
  /** The cash box or bank account of a line on a cash or bank account (ADR-0090). */
  moneyAccountId: number | null;
  /** The customer of a line on the receivables account (role AR, ADR-0090). */
  customer: PickedCustomer | null;
  /** The supplier of a line on the payables account (role AP, F3 ADR-0091). */
  supplier: PickedSupplier | null;
  debit: string;
  credit: string;
  description: string;
}

let nextId = 1;
const emptyLine = (): LineDraft => ({
  id: nextId++,
  accountId: null,
  moneyAccountId: null,
  customer: null,
  supplier: null,
  debit: '',
  credit: '',
  description: '',
});

/**
 * «Гараар бичилт» (ADR-0060 #7): a dated, described entry of at least two lines that balance. A
 * line on a cash or bank account names its cash box or bank account (the money accounts that point
 * at it), a line on the receivables account names its customer (ADR-0090: the core refuses either
 * without it), a line on the payables account its supplier (F3, ADR-0091: a supplier's payment or
 * a service bill is such an entry).
 */
export function JournalEntryDialog({
  open,
  onClose,
  onPosted,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: (entryId: number) => void;
}) {
  const { t } = useTranslation();
  const accounts = useGlAccounts();
  const moneyAccounts = useMoneyAccounts();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [entryDate, setEntryDate] = useState(businessDate());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(), emptyLine()]);
  const [checked, setChecked] = useState(false);

  const accountOf = (id: number | null): GlAccount | undefined =>
    id === null ? undefined : accounts.data?.find((account) => account.id === id);
  // Every money account counts for whether a line needs one; only the active ones are offered.
  const boxesOf = (id: number | null): MoneyAccount[] =>
    id === null ? [] : (moneyAccounts.data ?? []).filter((box) => box.glAccountId === id);
  const needsBox = (line: LineDraft) => boxesOf(line.accountId).length > 0;
  const needsCustomer = (line: LineDraft) => accountOf(line.accountId)?.role === 'AR';
  const needsSupplier = (line: LineDraft) => accountOf(line.accountId)?.role === 'AP';
  const detailsMissing = (line: LineDraft) =>
    (needsBox(line) && line.moneyAccountId === null) ||
    (needsCustomer(line) && line.customer === null) ||
    (needsSupplier(line) && line.supplier === null);

  // Money accounts that arrive after a line's account was chosen still fill a lone choice.
  useEffect(() => {
    const boxes = moneyAccounts.data;
    if (!boxes) return;
    setLines((previous) =>
      previous.map((line) => {
        if (line.accountId === null || line.moneyAccountId !== null) return line;
        const active = boxes.filter(
          (box) => box.glAccountId === line.accountId && box.status === 'ACTIVE',
        );
        return active.length === 1 ? { ...line, moneyAccountId: active[0]?.id ?? null } : line;
      }),
    );
  }, [moneyAccounts.data]);

  const sum = (side: 'debit' | 'credit') =>
    lines.reduce(
      (total, line) => (MONEY.test(line[side]) ? total.plus(line[side]) : total),
      new Decimal(0),
    );
  const debit = sum('debit');
  const credit = sum('credit');
  const balanced = debit.eq(credit) && debit.gt(0);
  const complete = lines.every(
    (line) =>
      line.accountId !== null &&
      ((MONEY.test(line.debit) && !line.credit) || (MONEY.test(line.credit) && !line.debit)),
  );
  const patch = (id: number, change: Partial<LineDraft>) =>
    setLines((previous) =>
      previous.map((line) => (line.id === id ? { ...line, ...change } : line)),
    );
  const chooseAccount = (id: number, accountId: number | null) => {
    const active = boxesOf(accountId).filter((box) => box.status === 'ACTIVE');
    patch(id, {
      accountId,
      // A lone cash box or bank account of the chosen account is chosen already.
      moneyAccountId: active.length === 1 ? (active[0]?.id ?? null) : null,
      ...(accountOf(accountId)?.role === 'AR' ? {} : { customer: null }),
      ...(accountOf(accountId)?.role === 'AP' ? {} : { supplier: null }),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!description.trim() || !complete || !balanced || lines.some(detailsMissing)) return;
    void action.run(async () => {
      const entry = await mutations.postEntry.mutateAsync({
        key,
        body: {
          entryDate,
          description: description.trim(),
          lines: lines.map((line) => ({
            accountId: line.accountId ?? 0,
            debit: line.debit || '0',
            credit: line.credit || '0',
            ...(needsBox(line) ? { moneyAccountId: line.moneyAccountId } : {}),
            ...(needsCustomer(line) ? { customerId: line.customer?.id ?? null } : {}),
            ...(needsSupplier(line) ? { supplierId: line.supplier?.id ?? null } : {}),
            description: line.description.trim() || null,
          })),
        },
      });
      toast.success(t('finance.journal.dialog.posted', { number: entry.number }));
      // The page replaces the address with the new entry, which closes the dialog.
      onPosted(entry.id);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <DialogHeader>
          <DialogTitle>{t('finance.journal.dialog.title')}</DialogTitle>
          <DialogDescription>{t('finance.journal.dialog.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <FormField label={t('finance.journal.dialog.date')} htmlFor="entry-date">
              <Input
                id="entry-date"
                type="date"
                className="font-mono"
                value={entryDate}
                max={businessDate()}
                onChange={(event) => setEntryDate(event.target.value)}
              />
            </FormField>
            <FormField
              label={t('finance.journal.dialog.descriptionField')}
              htmlFor="entry-description"
              error={checked && !description.trim() ? 'validation.required' : undefined}
            >
              <Input
                id="entry-description"
                value={description}
                maxLength={300}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('finance.journal.dialog.account')}</TableHead>
                  <TableHead className="w-32 text-right">
                    {t('finance.journal.dialog.debit')}
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    {t('finance.journal.dialog.credit')}
                  </TableHead>
                  <TableHead>{t('finance.journal.dialog.lineDescription')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={line.id}>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-2">
                        <NativeSelect
                          aria-label={`${t('finance.journal.dialog.account')} ${index + 1}`}
                          value={line.accountId ?? ''}
                          aria-invalid={checked && line.accountId === null ? true : undefined}
                          onChange={(event) =>
                            chooseAccount(line.id, Number.parseInt(event.target.value, 10) || null)
                          }
                        >
                          <option value="">{t('finance.journal.dialog.chooseAccount')}</option>
                          {(accounts.data ?? [])
                            .filter((account) => account.status === 'ACTIVE')
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} · {account.name}
                              </option>
                            ))}
                        </NativeSelect>
                        {needsBox(line) ? (
                          <NativeSelect
                            aria-label={`${t('finance.journal.dialog.moneyAccount')} ${index + 1}`}
                            value={line.moneyAccountId ?? ''}
                            aria-invalid={
                              checked && line.moneyAccountId === null ? true : undefined
                            }
                            onChange={(event) =>
                              patch(line.id, {
                                moneyAccountId: Number.parseInt(event.target.value, 10) || null,
                              })
                            }
                          >
                            <option value="">
                              {t('finance.journal.dialog.chooseMoneyAccount')}
                            </option>
                            {boxesOf(line.accountId)
                              .filter((box) => box.status === 'ACTIVE')
                              .map((box) => (
                                <option key={box.id} value={box.id}>
                                  {box.name}
                                </option>
                              ))}
                          </NativeSelect>
                        ) : null}
                        {needsCustomer(line) ? (
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`entry-customer-${line.id}`} className="sr-only">
                              {`${t('finance.journal.dialog.customer')} ${index + 1}`}
                            </Label>
                            <CustomerPicker
                              id={`entry-customer-${line.id}`}
                              value={line.customer}
                              onChange={(customer) => patch(line.id, { customer })}
                              invalid={checked && line.customer === null}
                            />
                          </div>
                        ) : null}
                        {needsSupplier(line) ? (
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`entry-supplier-${line.id}`} className="sr-only">
                              {`${t('finance.journal.dialog.supplier')} ${index + 1}`}
                            </Label>
                            <SupplierPicker
                              id={`entry-supplier-${line.id}`}
                              value={line.supplier}
                              onChange={(supplier) => patch(line.id, { supplier })}
                              invalid={checked && line.supplier === null}
                            />
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${t('finance.journal.dialog.debit')} ${index + 1}`}
                        inputMode="decimal"
                        className="text-right font-mono"
                        value={line.debit}
                        onChange={(event) =>
                          patch(line.id, { debit: event.target.value.trim(), credit: '' })
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${t('finance.journal.dialog.credit')} ${index + 1}`}
                        inputMode="decimal"
                        className="text-right font-mono"
                        value={line.credit}
                        onChange={(event) =>
                          patch(line.id, { credit: event.target.value.trim(), debit: '' })
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`${t('finance.journal.dialog.lineDescription')} ${index + 1}`}
                        value={line.description}
                        maxLength={300}
                        onChange={(event) => patch(line.id, { description: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${t('finance.journal.dialog.removeLine')} ${index + 1}`}
                        disabled={lines.length <= 2}
                        onClick={() =>
                          setLines((previous) => previous.filter((entry) => entry.id !== line.id))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((previous) => [...previous, emptyLine()])}
                    >
                      {t('finance.journal.dialog.addLine')}
                    </Button>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(debit.toFixed(2))}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(credit.toFixed(2))}
                  </TableCell>
                  <TableCell colSpan={2}>
                    {balanced ? (
                      <span className="text-success">{t('finance.journal.dialog.balanced')}</span>
                    ) : (
                      <span className="text-destructive">
                        {t('finance.journal.dialog.difference')}:{' '}
                        <span className="font-mono">
                          {formatMnt(debit.minus(credit).toFixed(2))}
                        </span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {checked && lines.some(detailsMissing) ? (
            <p role="alert" className="text-sm text-destructive">
              {t('finance.journal.dialog.lineDetailsMissing')}
            </p>
          ) : null}
          {checked && !balanced ? (
            <p role="alert" className="text-sm text-destructive">
              {t('finance.journal.dialog.unbalanced')}
            </p>
          ) : null}
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={mutations.postEntry.isPending}
            onCancel={onClose}
            submitLabel={t('finance.journal.dialog.submit')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
