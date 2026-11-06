import type { AccountJournal } from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PickedCustomer } from '@/features/partners/customer-picker';
import { CustomerSelect, SupplierSelect } from '@/features/partners/party-select';
import type { PickedSupplier } from '@/features/partners/supplier-picker';
import { formatMnt } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type GlAccount, useFinanceMutations, useGlAccounts } from './api';
import { accountOption } from './account-option';

const MONEY = /^\d+(\.\d{1,2})?$/;

/** What the form asks: money in or out, a debt made or closed, or a plain side. */
type Direction = 'IN' | 'OUT';

const WORDS: Record<AccountJournal, 'money' | 'debt' | 'side'> = {
  CASH: 'money',
  BANK: 'money',
  MONEY: 'money',
  RECEIVABLE_PAYABLE: 'debt',
  VAT: 'debt',
  GENERAL: 'side',
  FIXED_ASSET: 'side',
  INVENTORY: 'side',
};

/** The chosen account's side: money in is a debit; a debt grows on its normal side. */
function sideOf(journal: AccountJournal, direction: Direction, account: GlAccount | undefined) {
  const grows = direction === 'IN';
  if (WORDS[journal] === 'debt') {
    const assetLike = account?.kind === 'ASSET' || account?.kind === 'EXPENSE';
    return grows === assetLike ? ('DEBIT' as const) : ('CREDIT' as const);
  }
  return grows ? ('DEBIT' as const) : ('CREDIT' as const);
}

/** A transfer takes from the first account: the side that shrinks it. */
function shrinkSide(account: GlAccount | undefined) {
  return account?.kind === 'ASSET' || account?.kind === 'EXPENSE'
    ? ('CREDIT' as const)
    : ('DEBIT' as const);
}

const partyAccount = (account: GlAccount | undefined) => account?.journal === 'RECEIVABLE_PAYABLE';

/** One party: a customer or a supplier, as the account usually wants. */
function PartyField(props: {
  id: string;
  label: string;
  kind: 'customer' | 'supplier';
  onKind: (kind: 'customer' | 'supplier') => void;
  customer: PickedCustomer | null;
  supplier: PickedSupplier | null;
  onCustomer: (value: PickedCustomer | null) => void;
  onSupplier: (value: PickedSupplier | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <Label>{t('finance.transactions.partyKind')}</Label>
        <SegmentedControl
          name={t('finance.transactions.partyKind')}
          options={['customer', 'supplier'] as const}
          value={props.kind}
          label={(value) => t(`finance.transactions.partyKinds.${value}`)}
          onChange={props.onKind}
        />
      </div>
      <FormField label={props.label} htmlFor={props.id} error={props.error}>
        {props.kind === 'customer' ? (
          <CustomerSelect
            id={props.id}
            value={props.customer}
            onChange={props.onCustomer}
            invalid={Boolean(props.error)}
          />
        ) : (
          <SupplierSelect
            id={props.id}
            value={props.supplier}
            onChange={props.onSupplier}
            invalid={Boolean(props.error)}
          />
        )}
      </FormField>
    </div>
  );
}

/** What will be written, before it is: both sides of the entry (ADR-0155). */
function PostingPreview(props: { debit: GlAccount; credit: GlAccount; amount: string }) {
  const { t } = useTranslation();
  const row = (side: string, account: GlAccount) => (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-6 shrink-0 font-medium text-muted-foreground">{side}</span>
      <span className="min-w-0 flex-1 truncate" title={account.name}>
        {account.code} · {account.name}
      </span>
      <span className="shrink-0 font-mono font-medium">{formatMnt(props.amount)}</span>
    </div>
  );
  return (
    <div
      role="group"
      aria-label={t('finance.transactions.preview')}
      className="grid gap-x-6 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-[0.8125rem] sm:grid-cols-2"
    >
      {row(t('finance.transactions.debitShort'), props.debit)}
      {row(t('finance.transactions.creditShort'), props.credit)}
    </div>
  );
}

/**
 * «Шинэ гүйлгээ» of one journal (ADR-0150), Erkhet's form: the account comes only from this journal
 * with its balance beside it, the counter account from the whole chart. Cash and bank ask «Орлого /
 * Зарлага» and may split VAT and city tax from the amount; receivables, payables and VAT ask
 * «Үүсгэх / Хаах»; the general journal «Дебет / Кредит». A party is asked when a line needs one.
 * «Хадгалаад шинэ» keeps the date, the accounts and the kind for the next one and clears the rest.
 * What was typed is not lost by accident: a click outside does nothing, and «Болих», ✕ or Esc ask.
 */
export function TransactionDialog(props: {
  journal: AccountJournal;
  /** «Шилжүүлэг» (ADR-0151): from an account of this journal to another; it shrinks the first. */
  transfer?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { journal } = props;
  const accounts = useGlAccounts();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [entryDate, setEntryDate] = useState(businessDate());
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [counterId, setCounterId] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction>('IN');
  const [amount, setAmount] = useState('');
  const [partyKind, setPartyKind] = useState<'customer' | 'supplier'>('customer');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [otherKind, setOtherKind] = useState<'customer' | 'supplier'>('customer');
  const [otherCustomer, setOtherCustomer] = useState<PickedCustomer | null>(null);
  const [otherSupplier, setOtherSupplier] = useState<PickedSupplier | null>(null);
  const [withVat, setWithVat] = useState(false);
  const [withCityTax, setWithCityTax] = useState(false);
  const [checked, setChecked] = useState(false);
  const [savedOne, setSavedOne] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);

  const typed =
    amount.trim() !== '' ||
    description.trim() !== '' ||
    customer !== null ||
    supplier !== null ||
    otherCustomer !== null ||
    otherSupplier !== null;
  // What the last save kept for the next entry is not work to lose.
  const dirty = typed || (!savedOne && (accountId !== null || counterId !== null));

  const active = (accounts.data ?? []).filter((row) => row.status === 'ACTIVE');
  const own = active.filter((row) => row.journal === journal);
  const others = active.filter((row) => row.id !== accountId && row.journal !== 'INVENTORY');
  const account = own.find((row) => row.id === accountId);
  const counter = others.find((row) => row.id === counterId);
  const words = WORDS[journal];
  const transfer = props.transfer === true;
  const mainNeedsParty = partyAccount(account);
  const counterNeedsParty = partyAccount(counter);
  // «Авлага өглөг» always names one, even before an account is chosen.
  const needsParty = journal === 'RECEIVABLE_PAYABLE' || mainNeedsParty || counterNeedsParty;
  const bothNeedParty = mainNeedsParty && counterNeedsParty;

  const side = transfer ? shrinkSide(account) : sideOf(journal, direction, account);
  const party = partyKind === 'customer' ? customer : supplier;
  const otherParty = otherKind === 'customer' ? otherCustomer : otherSupplier;
  const amountOk = MONEY.test(amount.trim()) && !/^0+(\.0+)?$/.test(amount.trim());
  const partyOk = !needsParty || party !== null;
  const otherOk = !bothNeedParty || !transfer || otherParty !== null;

  const pickAccount = (id: number | null) => {
    setAccountId(id);
    const chosen = own.find((row) => row.id === id);
    setPartyKind(chosen?.kind === 'LIABILITY' ? 'supplier' : 'customer');
  };
  const pickCounter = (id: number | null) => {
    setCounterId(id);
    const chosen = others.find((row) => row.id === id);
    if (!mainNeedsParty) setPartyKind(chosen?.kind === 'LIABILITY' ? 'supplier' : 'customer');
    setOtherKind(chosen?.kind === 'LIABILITY' ? 'supplier' : 'customer');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };
  const save = async (another: boolean) => {
    setChecked(true);
    if (
      accountId === null ||
      counterId === null ||
      !amountOk ||
      !partyOk ||
      !otherOk ||
      !description.trim()
    ) {
      return;
    }
    const partyOf = (kind: 'customer' | 'supplier', value: { id: number } | null) =>
      value === null
        ? null
        : kind === 'customer'
          ? { customerId: value.id }
          : { supplierId: value.id };
    const ok = await action.run(() =>
      mutations.postTransaction.mutateAsync({
        key,
        body: {
          journal,
          entryDate,
          description: description.trim(),
          accountId,
          counterAccountId: counterId,
          side,
          amount: amount.trim(),
          party: partyOf(partyKind, party),
          counterParty: bothNeedParty ? partyOf(otherKind, otherParty) : null,
          withVat: !transfer && words === 'money' && withVat,
          withCityTax: !transfer && words === 'money' && withCityTax,
        },
      }),
    );
    if (!ok) return;
    toast.success(t('finance.transactions.saved'));
    if (!another) {
      props.onClose();
      return;
    }
    // The next entry is another document: a key of its own.
    setKey(randomUuid());
    setSavedOne(true);
    setChecked(false);
    setAmount('');
    setDescription('');
    setCustomer(null);
    setSupplier(null);
    setOtherCustomer(null);
    setOtherSupplier(null);
    amountInput.current?.focus();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        closeLabel={t('common.close')}
        size="xl"
        dirty={dirty}
        // The date is rarely changed: the work starts at the account (ADR-0155).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById('trx-account')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {transfer
              ? t('finance.transactions.transfer.title', {
                  journal: t(`finance.transactions.tabs.${journal}`),
                })
              : t(`finance.transactions.tabs.${journal}`)}
          </DialogTitle>
          <DialogDescription
            className={journal === 'RECEIVABLE_PAYABLE' && !transfer ? 'sr-only' : undefined}
          >
            {transfer
              ? t('finance.transactions.transfer.hint')
              : t('finance.transactions.dialogHint')}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          <ProblemAlert problem={action.problem} />
          {journal === 'RECEIVABLE_PAYABLE' && !transfer ? (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-[0.8125rem]">
              {t('finance.transactions.debtNote')}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('finance.fields.date')} htmlFor="trx-date">
              <DateInput
                id="trx-date"
                required
                max={businessDate()}
                value={entryDate}
                onChange={setEntryDate}
              />
            </FormField>
            {transfer ? null : (
              <FormField
                label={t(`finance.transactions.direction.${words}`)}
                htmlFor="trx-direction"
              >
                <SegmentedControl
                  name={t(`finance.transactions.direction.${words}`)}
                  options={['IN', 'OUT'] as const}
                  value={direction}
                  label={(value) => t(`finance.transactions.${words}.${value}`)}
                  onChange={setDirection}
                />
              </FormField>
            )}
            <FormField
              label={
                transfer
                  ? t('finance.transactions.transfer.from')
                  : t('finance.transactions.account')
              }
              htmlFor="trx-account"
              hint={
                account
                  ? t('finance.transactions.balance', { amount: formatMnt(account.balance) })
                  : undefined
              }
              error={checked && accountId === null ? 'validation.required' : undefined}
            >
              <SearchSelect
                id="trx-account"
                value={accountId === null ? '' : String(accountId)}
                options={own.map(accountOption)}
                placeholder={t('finance.journal.dialog.chooseAccount')}
                invalid={checked && accountId === null}
                onChange={(value) => pickAccount(Number.parseInt(value, 10) || null)}
              />
            </FormField>
            <FormField
              label={
                transfer
                  ? t('finance.transactions.transfer.to')
                  : t('finance.transactions.counterAccount')
              }
              htmlFor="trx-counter"
              error={checked && counterId === null ? 'validation.required' : undefined}
            >
              <SearchSelect
                id="trx-counter"
                value={counterId === null ? '' : String(counterId)}
                options={others.map(accountOption)}
                placeholder={t('finance.journal.dialog.chooseAccount')}
                invalid={checked && counterId === null}
                onChange={(value) => pickCounter(Number.parseInt(value, 10) || null)}
              />
            </FormField>
            <FormField
              label={t('finance.fields.amount')}
              htmlFor="trx-amount"
              error={checked && !amountOk ? 'validation.required' : undefined}
            >
              <MoneyInput
                ref={amountInput}
                id="trx-amount"
                className="h-12 text-lg font-semibold"
                value={amount}
                onValueChange={setAmount}
              />
            </FormField>
            <FormField
              label={t('finance.fields.description')}
              htmlFor="trx-description"
              error={checked && !description.trim() ? 'validation.required' : undefined}
            >
              <Input
                id="trx-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            {!transfer || needsParty ? (
              <PartyField
                id="trx-party"
                label={
                  needsParty
                    ? t('finance.transactions.party')
                    : t('finance.transactions.partyOptional')
                }
                kind={partyKind}
                onKind={setPartyKind}
                customer={customer}
                supplier={supplier}
                onCustomer={setCustomer}
                onSupplier={setSupplier}
                error={checked && !partyOk ? 'validation.required' : undefined}
              />
            ) : null}
            {bothNeedParty ? (
              <PartyField
                id="trx-other-party"
                label={t('finance.transactions.otherParty')}
                kind={otherKind}
                onKind={setOtherKind}
                customer={otherCustomer}
                supplier={otherSupplier}
                onCustomer={setOtherCustomer}
                onSupplier={setOtherSupplier}
                error={checked && !otherOk ? 'validation.required' : undefined}
              />
            ) : null}
          </div>
          {words === 'money' && !transfer ? (
            <div className="flex flex-wrap gap-5">
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={withVat}
                  onCheckedChange={(value) => setWithVat(value === true)}
                />
                {t('finance.transactions.withVat')}
              </Label>
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={withCityTax}
                  onCheckedChange={(value) => setWithCityTax(value === true)}
                />
                {t('finance.transactions.withCityTax')}
              </Label>
            </div>
          ) : null}
          {account && counter && amountOk && !withVat && !withCityTax ? (
            <PostingPreview
              debit={side === 'DEBIT' ? account : counter}
              credit={side === 'DEBIT' ? counter : account}
              amount={amount}
            />
          ) : null}
          <DialogFormFooter
            pending={mutations.postTransaction.isPending}
            onCancel={props.onClose}
            submitLabel={t('common.save')}
            onSaveAndNew={() => void save(true)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
