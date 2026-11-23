import type { ProblemDetails } from '@tugeel/api-client';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatTugrik } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { accountOption } from './account-option';
import { counterAccountLabel } from './vat-waiver';
import {
  type CustomerCounterAccount,
  type Invoice,
  useCustomerCounterAccount,
  useFinanceMutations,
  useGlAccounts,
  useVatWaiverSettings,
  type VatWaiverBlock,
} from './api';

const BLOCKS: readonly VatWaiverBlock[] = ['VOID', 'VAT_WAIVED', 'NOTHING_LEFT', 'B2B_RECEIPT'];

/**
 * The refusals of «НӨАТ хасуулах» in the owner's words (ADR-0240): the api answers its standing
 * codes with a `status` saying which, and these dialogs say it plainly. Null for any other
 * problem, which `ProblemAlert` shows as it does everywhere.
 */
function vatWaiverRefusal(problem: ProblemDetails | null): VatWaiverBlock | null {
  if (problem?.code !== 'INVOICE_STATE_INVALID') return null;
  const status = problem.params?.status;
  return BLOCKS.find((block) => block === status) ?? null;
}

/** A waiver's problem: the refusal in plain words, else the usual alert. */
export function VatWaiverProblem({ problem }: { problem: ProblemDetails | null }) {
  const { t } = useTranslation();
  if (!problem) return null;
  const refusal = vatWaiverRefusal(problem);
  const notWaived =
    problem.code === 'INVOICE_STATE_INVALID' && problem.params?.status === 'NOT_VAT_WAIVED';
  const afterWaiver =
    problem.code === 'EBARIMT_RECEIPT_STATE_INVALID' && problem.params?.status === 'VAT_WAIVED';
  const text = refusal
    ? t(`finance.vatWaiver.errors.${refusal}`)
    : notWaived
      ? t('finance.vatWaiver.errors.NOT_VAT_WAIVED')
      : afterWaiver
        ? t('finance.vatWaiver.errors.RECEIPT_AFTER_WAIVER')
        : null;
  if (text === null) return <ProblemAlert problem={problem} />;
  return (
    <Alert variant="destructive">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

/**
 * «НӨАТ хасуулах» (ADR-0240): what the waiver will write, said before it is written — the invoice,
 * what the percent is taken from, the discount, the account and the entry's words. An invoice
 * that cannot be waived says why and keeps the button off.
 */
export function VatWaiverDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const plain = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const account = useCustomerCounterAccount(invoice.customerId);
  const settings = useVatWaiverSettings();
  const preview = invoice.vatWaiverPreview;
  const returned = preview.baseAmount !== invoice.total;
  const blocked = preview.blockedBy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        await mutations.waiveVat.mutateAsync({ id: invoice.id, key });
      })
      .then((ok) => {
        if (ok) {
          toast.success(t('finance.vatWaiver.done'));
          onClose();
        }
      });
  };
  const facts: [string, string, boolean?][] = [
    [t('finance.vatWaiver.dialog.invoice'), `${invoice.number} · ${invoice.invoiceDate}`],
    [
      returned
        ? t('finance.vatWaiver.dialog.totalAfterReturns')
        : t('finance.vatWaiver.dialog.total'),
      formatTugrik(preview.baseAmount),
    ],
    [t('finance.vatWaiver.dialog.pct'), t('finance.vatWaiver.settings.pctValue', preview)],
    [t('finance.vatWaiver.dialog.amount'), formatTugrik(preview.amount), true],
    [t('finance.vatWaiver.dialog.account'), counterAccountLabel(account.data, plain)],
    [t('finance.vatWaiver.dialog.description'), settings.data?.description ?? '…'],
  ];
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" guard={false} closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.vatWaiver.dialog.title')}</DialogTitle>
          <DialogDescription>{t('finance.vatWaiver.dialog.sentence')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {facts.map(([label, value, strong]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={strong ? 'text-right font-mono font-semibold' : 'text-right'}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {blocked ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`finance.vatWaiver.errors.${blocked}`)}</AlertDescription>
            </Alert>
          ) : null}
          <VatWaiverProblem problem={action.problem} />
          <DialogFormFooter
            pending={mutations.waiveVat.isPending}
            onCancel={onClose}
            submitLabel={t('finance.vatWaiver.dialog.submit')}
            disabled={blocked !== null}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** «НӨАТ хасуулсныг буцаах уу?» with an optional reason (ADR-0240 #5). */
export function VatWaiverReverseDialog({
  invoice,
  onClose,
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [reason, setReason] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        await mutations.reverseVatWaiver.mutateAsync({
          id: invoice.id,
          key,
          reason: reason.trim() || null,
        });
      })
      .then((ok) => {
        if (ok) {
          toast.success(t('finance.vatWaiver.reversed'));
          onClose();
        }
      });
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.vatWaiver.reverseDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('finance.vatWaiver.reverseDialog.description', {
              number: invoice.number,
              amount: formatTugrik(invoice.vatWaiver?.amount ?? '0'),
            })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField
            label={t('finance.vatWaiver.reverseDialog.reason')}
            htmlFor="vat-waiver-reverse-reason"
            hint={t('finance.vatWaiver.reverseDialog.reasonHint')}
            hintBeside
          >
            <Textarea
              id="vat-waiver-reverse-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <VatWaiverProblem problem={action.problem} />
          <DialogFormFooter
            pending={mutations.reverseVatWaiver.isPending}
            onCancel={onClose}
            submitLabel={t('finance.vatWaiver.reverseDialog.submit')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Харилцсан данс» of a customer (ADR-0240 #7): an active account that is neither a receivable or
 * payable, nor money, nor stock; the api checks the rest. «Анхдагч данс руу буцаах» takes the
 * customer's own account away.
 */
export function CounterAccountDialog({
  customer,
  current,
  onClose,
}: {
  customer: { id: number; name: string };
  current: CustomerCounterAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const accounts = useGlAccounts();
  const [accountId, setAccountId] = useState(
    current.own && current.account ? String(current.account.id) : '',
  );
  const options = (accounts.data ?? [])
    .filter((account) => account.status === 'ACTIVE')
    .map(accountOption);
  const save = (next: number | null) => {
    void action
      .run(async () => {
        await mutations.setCounterAccount.mutateAsync({ customerId: customer.id, accountId: next });
      })
      .then((ok) => {
        if (ok) {
          toast.success(t('finance.vatWaiver.counterAccount.saved'));
          onClose();
        }
      });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (accountId) save(Number.parseInt(accountId, 10));
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.vatWaiver.counterAccount.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('finance.vatWaiver.counterAccount.dialogDescription', { name: customer.name })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={t('finance.vatWaiver.counterAccount.label')} htmlFor="counter-account">
            <SearchSelect
              id="counter-account"
              value={accountId}
              options={options}
              placeholder={t('finance.vatWaiver.counterAccount.placeholder')}
              onChange={setAccountId}
            />
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFooter className="sm:flex-wrap sm:items-center">
            {current.own ? (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={mutations.setCounterAccount.isPending}
                onClick={() => save(null)}
              >
                {t('finance.vatWaiver.counterAccount.useDefault')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              pending={mutations.setCounterAccount.isPending}
              disabled={!accountId}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
