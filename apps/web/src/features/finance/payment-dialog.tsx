import { PAYMENT_KINDS, type PaymentKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { MoneyInput } from '@/components/money-input';
import { SearchSelect } from '@/components/search-select';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUsers } from '@/features/identity/api';
import type { PickedCustomer } from '@/features/partners/customer-picker';
import { CustomerSelect } from '@/features/partners/party-select';
import { formatTugrik } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useFinanceMutations, useGlAccounts, useMoneyAccounts } from './api';
import { DateInput } from '@/components/date-input';
import { accountOption } from './account-option';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const isKind = (value: string): value is PaymentKind =>
  PAYMENT_KINDS.some((kind) => kind === value);

/**
 * Two columns from 36rem, three at the dialog's whole width (53.5rem; one rem less would break
 * the reference's label over two lines). The middle one is the widest: a cash box's name is
 * read to its end («… (Хархорин)»).
 */
const FIELDS =
  'grid gap-x-4 gap-y-3.5 *:min-w-0 @xl:grid-cols-2 @[53rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]';

/**
 * «Төлбөр бүртгэх» (ADR-0060 #5): a customer's payment, which the server settles oldest first
 * and which lowers the customer's balance (no invoices on screen, owner 2026-11-27), a refund,
 * another income or an expense against its account; into a cash box or a bank account, on a date, with the driver who handed it in.
 *
 * The form lays itself out by its own width (three columns in the whole dialog, two on a tablet)
 * and keeps one height while it is filled (ADR-0201): the account's balance stands on its
 * label's line. So it fits a laptop's and a till PC's height without scrolling.
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
  const users = useUsers({});
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const formRef = useRef<HTMLFormElement>(null);
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
  const [checked, setChecked] = useState(false);

  const activeAccounts = (moneyAccounts.data ?? []).filter(
    (account) => account.status === 'ACTIVE',
  );
  useEffect(() => {
    if (moneyAccountId === null && activeAccounts[0]) setMoneyAccountId(activeAccounts[0].id);
  }, [activeAccounts, moneyAccountId]);
  const customerKind = kind === 'CUSTOMER_PAYMENT' || kind === 'CUSTOMER_REFUND';
  const amountValue = MONEY.test(amount) ? new Decimal(amount) : null;
  const accountOptions = (glAccounts.data ?? []).filter((account) => account.status === 'ACTIVE');
  const moneyAccount = activeAccounts.find((account) => account.id === moneyAccountId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save(false);
  };
  /** «Хадгалаад шинэ» (ADR-0151) keeps the kind, the account, the date and who took it. */
  const save = (another: boolean) => {
    setChecked(true);
    if (
      amountValue === null ||
      !amountValue.gt(0) ||
      moneyAccountId === null ||
      (customerKind && customer === null) ||
      (!customerKind && glAccountId === null)
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
          // The server settles a customer's payment oldest first (owner 2026-11-27: no
          // invoices on screen); what is left over stays on the customer's balance.
          allocations: null,
        },
      });
      toast.success(t('finance.payments.recorded', { number: payment.number }));
      if (another) {
        formRef.current?.reset();
        setKey(randomUuid());
        setChecked(false);
        setCustomer(null);
        setAmount('');
        setDescription('');
        setReference('');
        setCounterparty('');
        return;
      }
      // The page replaces the address with the voucher, which closes the dialog.
      onRecorded(payment.id);
    });
  };

  return (
    <DialogContent closeLabel={t('common.close')} size="xl">
      <DialogHeader>
        <DialogTitle>{t('finance.payments.dialog.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('finance.payments.dialog.intro')}
        </DialogDescription>
      </DialogHeader>
      <form ref={formRef} className="@container flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className={FIELDS}>
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
          <FormField
            label={t('finance.payments.dialog.moneyAccount')}
            htmlFor="payment-account"
            hint={
              moneyAccount
                ? t('finance.transactions.balance', {
                    amount: formatTugrik(moneyAccount.balance),
                  })
                : undefined
            }
            hintBeside
          >
            <SearchSelect
              id="payment-account"
              value={moneyAccountId === null ? '' : String(moneyAccountId)}
              options={activeAccounts.map((account) => ({
                value: String(account.id),
                label: account.name,
              }))}
              onChange={(value) => setMoneyAccountId(Number.parseInt(value, 10) || null)}
            />
          </FormField>
          <div className="@xl:col-span-2">
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
                <CustomerSelect
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
                <SearchSelect
                  id="payment-gl-account"
                  value={glAccountId === null ? '' : String(glAccountId)}
                  options={accountOptions.map(accountOption)}
                  placeholder={t('finance.journal.dialog.chooseAccount')}
                  onChange={(value) => setGlAccountId(Number.parseInt(value, 10) || null)}
                />
              </FormField>
            )}
          </div>
          <FormField
            label={t('finance.payments.dialog.amount')}
            htmlFor="payment-amount"
            error={
              checked && (amountValue === null || !amountValue.gt(0))
                ? 'validation.required'
                : undefined
            }
          >
            <MoneyInput
              id="payment-amount"
              className="text-base font-semibold"
              value={amount}
              onValueChange={setAmount}
            />
          </FormField>
          {/* In three columns the date ends the first row; it keeps its turn after the amount. */}
          <div className="@[53rem]:col-start-3 @[53rem]:row-start-1">
            <FormField label={t('finance.payments.dialog.paidOn')} htmlFor="payment-date">
              <DateInput
                id="payment-date"
                className="font-mono"
                value={paidOn}
                max={businessDate()}
                onChange={(value) => setPaidOn(value)}
              />
            </FormField>
          </div>
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
          {/* The last row has no hole: the description takes what the fields before it left. */}
          <div
            className={customerKind ? '@xl:col-span-2 @[53rem]:col-span-1' : '@[53rem]:col-span-3'}
          >
            <FormField
              label={t('finance.payments.dialog.description')}
              htmlFor="payment-description"
            >
              <Input
                id="payment-description"
                value={description}
                maxLength={300}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
          </div>
        </div>
        <ProblemAlert problem={action.problem} />
        <DialogFormFooter
          pending={mutations.recordPayment.isPending}
          onCancel={onClose}
          submitLabel={t('finance.payments.dialog.submit')}
          {...(preset ? {} : { onSaveAndNew: () => save(true) })}
        />
      </form>
    </DialogContent>
  );
}
