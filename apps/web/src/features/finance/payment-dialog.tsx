import { allocateFifo, PAYMENT_KINDS, type PaymentKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUsers } from '@/features/identity/api';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { formatMnt, formatTugrik } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useFinanceMutations, useGlAccounts, useInvoices, useMoneyAccounts } from './api';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const isKind = (value: string): value is PaymentKind =>
  PAYMENT_KINDS.some((kind) => kind === value);

/**
 * «Төлбөр бүртгэх» (ADR-0060 #5): a customer's payment settled oldest due first or as the
 * accountant allocates it (the rest an advance), a refund, another income or an expense against
 * its account; into a cash box or a bank account, on a date, with the driver who handed it in.
 */
export function PaymentDialog({
  open,
  customer: preset,
  onClose,
  onRecorded,
}: {
  open: boolean;
  /** A customer the dialog starts with (from the balances page). */
  customer?: PickedCustomer | null;
  onClose: () => void;
  onRecorded: (paymentId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {open ? (
        <PaymentForm preset={preset ?? null} onClose={onClose} onRecorded={onRecorded} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function PaymentForm({
  preset,
  onClose,
  onRecorded,
}: {
  preset: PickedCustomer | null;
  onClose: () => void;
  onRecorded: (paymentId: number) => void;
}) {
  const { t } = useTranslation();
  const moneyAccounts = useMoneyAccounts();
  const glAccounts = useGlAccounts();
  const users = useUsers('');
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [kind, setKind] = useState<PaymentKind>('CUSTOMER_PAYMENT');
  const [moneyAccountId, setMoneyAccountId] = useState<number | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(preset);
  const [glAccountId, setGlAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(businessDate());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [collectedBy, setCollectedBy] = useState<number | null>(null);
  const [manual, setManual] = useState(false);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);

  const activeAccounts = (moneyAccounts.data ?? []).filter(
    (account) => account.status === 'ACTIVE',
  );
  useEffect(() => {
    if (moneyAccountId === null && activeAccounts[0]) setMoneyAccountId(activeAccounts[0].id);
  }, [activeAccounts, moneyAccountId]);
  const customerKind = kind === 'CUSTOMER_PAYMENT' || kind === 'CUSTOMER_REFUND';
  const allocating = kind === 'CUSTOMER_PAYMENT' && customer !== null;
  const invoices = useInvoices(
    { customerId: customer?.id, status: 'ISSUED' },
    { enabled: allocating },
  );
  const open = useMemo(
    () =>
      (invoices.data?.pages.flatMap((page) => page.data) ?? []).filter((invoice) =>
        new Decimal(invoice.openAmount).gt(0),
      ),
    [invoices.data],
  );
  const amountValue = MONEY.test(amount) ? new Decimal(amount) : null;
  // Oldest due first unless the accountant allocates by hand.
  const fifo = amountValue ? allocateFifo(amountValue, open) : [];
  const allocations = manual
    ? open.flatMap((invoice) => {
        const typed = chosen[invoice.id] ?? '';
        if (!typed) return [];
        const value = MONEY.test(typed) ? new Decimal(typed) : null;
        return value && value.gt(0) ? [{ invoiceId: invoice.id, amount: value }] : [];
      })
    : fifo;
  const allocated = allocations.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
  const remainder = amountValue ? amountValue.minus(allocated) : null;
  const overAllocated = remainder !== null && remainder.lt(0);
  const accountOptions = (glAccounts.data ?? []).filter((account) => account.status === 'ACTIVE');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (
      amountValue === null ||
      !amountValue.gt(0) ||
      moneyAccountId === null ||
      (customerKind && customer === null) ||
      (!customerKind && glAccountId === null) ||
      overAllocated
    ) {
      return;
    }
    void action.run(async () => {
      const payment = await mutations.recordPayment.mutateAsync({
        key,
        body: {
          kind,
          moneyAccountId,
          customerId: customerKind ? (customer?.id ?? null) : null,
          glAccountId: customerKind ? null : glAccountId,
          amount: amountValue.toFixed(),
          paidOn,
          description: description.trim() || null,
          reference: reference.trim() || null,
          counterpartyName: counterparty.trim() || null,
          collectedBy,
          allocations:
            kind === 'CUSTOMER_PAYMENT' && manual
              ? allocations.map((entry) => ({
                  invoiceId: entry.invoiceId,
                  amount: entry.amount.toFixed(),
                }))
              : null,
        },
      });
      toast.success(t('finance.payments.recorded', { number: payment.number }));
      // The page replaces the address with the voucher, which closes the dialog.
      onRecorded(payment.id);
    });
  };

  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <DialogHeader>
        <DialogTitle>{t('finance.payments.dialog.title')}</DialogTitle>
        <DialogDescription>{t('finance.payments.dialog.intro')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('finance.payments.dialog.kind')} htmlFor="payment-kind">
            <NativeSelect
              id="payment-kind"
              value={kind}
              onChange={(event) => {
                if (isKind(event.target.value)) setKind(event.target.value);
              }}
            >
              {PAYMENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.paymentKinds.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('finance.payments.dialog.moneyAccount')} htmlFor="payment-account">
            <NativeSelect
              id="payment-account"
              value={moneyAccountId ?? ''}
              onChange={(event) =>
                setMoneyAccountId(Number.parseInt(event.target.value, 10) || null)
              }
            >
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {formatTugrik(account.balance)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        {customerKind ? (
          <FormField
            label={t('finance.payments.dialog.customer')}
            htmlFor="payment-customer"
            hint={
              checked && customer === null ? (
                <span role="alert" className="text-destructive">
                  {t('finance.payments.dialog.customerRequired')}
                </span>
              ) : undefined
            }
          >
            <CustomerPicker
              id="payment-customer"
              value={customer}
              onChange={setCustomer}
              invalid={checked && customer === null}
            />
          </FormField>
        ) : (
          <FormField
            label={t('finance.payments.dialog.glAccount')}
            htmlFor="payment-gl-account"
            hint={
              checked && glAccountId === null ? (
                <span role="alert" className="text-destructive">
                  {t('finance.payments.dialog.glAccountRequired')}
                </span>
              ) : undefined
            }
          >
            <NativeSelect
              id="payment-gl-account"
              value={glAccountId ?? ''}
              onChange={(event) => setGlAccountId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('finance.journal.dialog.chooseAccount')}</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('finance.payments.dialog.amount')}
            htmlFor="payment-amount"
            error={
              checked && (amountValue === null || !amountValue.gt(0))
                ? 'validation.required'
                : undefined
            }
          >
            <Input
              id="payment-amount"
              inputMode="decimal"
              className="font-mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value.trim())}
            />
          </FormField>
          <FormField label={t('finance.payments.dialog.paidOn')} htmlFor="payment-date">
            <Input
              id="payment-date"
              type="date"
              className="font-mono"
              value={paidOn}
              max={businessDate()}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          </FormField>
        </div>
        {allocating ? (
          <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('finance.payments.dialog.allocations')}</h3>
              <div className="flex items-center gap-2 text-sm">
                <Switch checked={manual} onCheckedChange={setManual} id="payment-manual" />
                <Label htmlFor="payment-manual">{t('finance.payments.dialog.manual')}</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('finance.payments.dialog.allocationsHint')}
            </p>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('finance.payments.dialog.noOpenInvoices')}
              </p>
            ) : (
              // Many open invoices scroll inside the section; the footer stays in reach.
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('finance.fields.number')}</TableHead>
                      <TableHead>{t('finance.fields.dueDate')}</TableHead>
                      <TableHead className="text-right">{t('finance.fields.open')}</TableHead>
                      <TableHead className="text-right">
                        {t('finance.payments.dialog.allocate')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {open.map((invoice) => {
                      const auto = fifo.find((entry) => entry.invoiceId === invoice.id);
                      return (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono">{invoice.number}</TableCell>
                          <TableCell className="font-mono">{invoice.dueDate}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatTugrik(invoice.openAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {manual ? (
                              <Input
                                aria-label={`${t('finance.payments.dialog.allocate')}: ${invoice.number}`}
                                inputMode="decimal"
                                className="ml-auto w-32 font-mono"
                                value={chosen[invoice.id] ?? ''}
                                onChange={(event) =>
                                  setChosen((previous) => ({
                                    ...previous,
                                    [invoice.id]: event.target.value.trim(),
                                  }))
                                }
                              />
                            ) : (
                              <span className="font-mono">
                                {auto ? formatTugrik(auto.amount.toFixed(2)) : '—'}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-sm">
              {t('finance.payments.dialog.allocated', { amount: formatMnt(allocated.toFixed(2)) })}
              {remainder !== null && remainder.gt(0)
                ? ` · ${t('finance.payments.dialog.remainder', { amount: formatMnt(remainder.toFixed(2)) })}`
                : ''}
            </p>
            {overAllocated ? (
              <p role="alert" className="text-sm text-destructive">
                {t('finance.payments.dialog.overAllocated')}
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('finance.payments.dialog.reference')} htmlFor="payment-reference">
            <Input
              id="payment-reference"
              value={reference}
              maxLength={60}
              onChange={(event) => setReference(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('finance.payments.dialog.collectedBy')}
            htmlFor="payment-collected-by"
          >
            <NativeSelect
              id="payment-collected-by"
              value={collectedBy ?? ''}
              onChange={(event) => setCollectedBy(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('finance.payments.dialog.collectedByNone')}</option>
              {(users.data?.pages.flatMap((page) => page.data) ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        {!customerKind ? (
          <FormField
            label={t('finance.payments.dialog.counterparty')}
            htmlFor="payment-counterparty"
          >
            <Input
              id="payment-counterparty"
              value={counterparty}
              maxLength={120}
              onChange={(event) => setCounterparty(event.target.value)}
            />
          </FormField>
        ) : null}
        <FormField label={t('finance.payments.dialog.description')} htmlFor="payment-description">
          <Input
            id="payment-description"
            value={description}
            maxLength={300}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter
          pending={mutations.recordPayment.isPending}
          onCancel={onClose}
          submitLabel={t('finance.payments.dialog.submit')}
        />
      </form>
    </DialogContent>
  );
}
