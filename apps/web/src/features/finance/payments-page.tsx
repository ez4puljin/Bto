import { PAYMENT_KINDS, PAYMENT_STATUSES } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { Coins, Ellipsis, Plus, Printer } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { printFormatParam, usePrintFormat } from '@/lib/print-format';
import { PrintFormatToggle } from '@/components/print-format-toggle';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { DateRangeFilter } from './date-range-filter';
import {
  type PaymentDetail,
  type PaymentKind,
  type PaymentStatus,
  useFinanceMutations,
  useMoneyAccounts,
  usePayment,
  usePayments,
} from './api';
import { PaymentKindBadge, PaymentStatusBadge } from './badges';
import { FactChips, PanelSection, RecordSheet } from './panel';
import { PaymentDialog } from './payment-dialog';
import { VoidDialog } from './void-dialog';

const isKind = (value: string | null): value is PaymentKind =>
  PAYMENT_KINDS.some((kind) => kind === value);
const isStatus = (value: string | null): value is PaymentStatus =>
  PAYMENT_STATUSES.some((status) => status === value);

/**
 * The vouchers (ADR-0060 #11): search, filter by kind, status, money account and dates; «Төлбөр
 * бүртгэх» opens the dialog (`?new=1`); a row opens the voucher in the panel (`?payment=`).
 */
export function PaymentsPage() {
  const { t } = useTranslation();
  const canRecord = useHasPermission('finance.payments.record');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [creating, setCreating] = useCreateParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const accountParam = Number.parseInt(params.get('account') ?? '', 10);
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('payment') ?? '', 10);
  const accounts = useMoneyAccounts();
  const payments = usePayments({
    q,
    kind: isKind(kindParam) ? kindParam : undefined,
    status: isStatus(statusParam) ? statusParam : undefined,
    moneyAccountId: accountParam > 0 ? accountParam : undefined,
    from,
    to,
  });
  const rows = payments.data?.pages.flatMap((page) => page.data) ?? [];
  const total = payments.data?.pages[0]?.total ?? null;

  return (
    <div>
      <PageHeader
        title={t('finance.payments.title')}
        meta={total !== null ? t('finance.payments.count', { count: total }) : undefined}
        actions={
          canRecord ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('finance.actions.record')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          // Narrower here, so the five filters keep one line at 1366px.
          className="sm:w-52"
          aria-label={t('common.search')}
          placeholder={t('finance.payments.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.kind')}
          value={kindParam ?? ''}
          onChange={(event) => setParam('kind', event.target.value)}
        >
          <option value="">{t('finance.payments.allKinds')}</option>
          {PAYMENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`finance.paymentKinds.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.status')}
          value={statusParam ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('finance.payments.allStatuses')}</option>
          {PAYMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`finance.paymentStatuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.moneyAccount')}
          value={accountParam > 0 ? String(accountParam) : ''}
          onChange={(event) => setParam('account', event.target.value)}
        >
          <option value="">{t('finance.payments.allAccounts')}</option>
          {(accounts.data ?? []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </NativeSelect>
        <DateRangeFilter
          label={t('finance.fields.date')}
          fromLabel={t('finance.fields.from')}
          toLabel={t('finance.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(payments.error)} onRetry={payments.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.number')}</TableHead>
              <TableHead>{t('finance.fields.date')}</TableHead>
              <TableHead>{t('finance.fields.kind')}</TableHead>
              <TableHead>{t('finance.fields.counterparty')}</TableHead>
              <TableHead>{t('finance.fields.moneyAccount')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.amount')}</TableHead>
              <TableHead>{t('finance.fields.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((payment) => {
              // The number is the row's link for the keyboard; a click anywhere opens the panel.
              const href = hrefWithParam(params, 'payment', String(payment.id));
              return (
                <LinkRow key={payment.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {payment.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">{payment.paidOn}</TableCell>
                  <TableCell>
                    <PaymentKindBadge kind={payment.kind} />
                  </TableCell>
                  <TruncateCell
                    text={
                      payment.customerName ??
                      payment.counterpartyName ??
                      payment.glAccountName ??
                      ''
                    }
                  />
                  <TableCell>{payment.moneyAccountName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {payment.direction === 'OUT' ? '−' : ''}
                    {formatTugrik(payment.amount)}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={payment.status} />
                  </TableCell>
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!payments.isPending && rows.length === 0 ? (
          <EmptyState icon={Coins} title={t('finance.payments.empty')} />
        ) : null}
        <LoadMore query={payments} />
      </ListCard>
      <PaymentDialog
        open={creating}
        onClose={() => setCreating(false)}
        onRecorded={(id) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.delete('new');
              next.set('payment', String(id));
              return next;
            },
            { replace: true },
          )
        }
      />
      <PaymentPanel
        paymentId={openId > 0 ? openId : null}
        onClose={() => setParam('payment', null)}
      />
    </div>
  );
}

/** One voucher in the panel (`?payment=`): facts, its allocations, printing and voiding. */
export function PaymentPanel({
  paymentId,
  onClose,
}: {
  paymentId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const payment = usePayment(paymentId);
  const detail = payment.data;
  return (
    <RecordSheet
      open={paymentId !== null}
      onClose={onClose}
      title={detail ? t('finance.payments.panelTitle', { number: detail.number }) : ''}
      description={
        detail ? (detail.customerName ?? detail.counterpartyName ?? detail.glAccountName ?? '') : ''
      }
      badges={
        detail ? (
          <>
            <PaymentKindBadge kind={detail.kind} />
            <PaymentStatusBadge status={detail.status} />
          </>
        ) : null
      }
      actions={detail ? <PaymentActions payment={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(payment.error)} onRetry={payment.refetch} />
      {detail ? <PaymentBody payment={detail} /> : null}
    </RecordSheet>
  );
}

function PaymentActions({ payment }: { payment: PaymentDetail }) {
  const { t } = useTranslation();
  const canRecord = useHasPermission('finance.payments.record');
  const [format, choose] = usePrintFormat();
  const [voiding, setVoiding] = useState(false);
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);

  const voidPayment = (reason: string) => {
    void action
      .run(async () => {
        await mutations.voidPayment.mutateAsync({ id: payment.id, key, reason });
      })
      .then((ok) => {
        if (ok) {
          toast.success(t('finance.payments.voided'));
          setVoiding(false);
          setKey(randomUuid());
        }
      });
  };

  return (
    <>
      <PrintFormatToggle value={format} onChange={choose} />
      <Button asChild variant="outline">
        <Link
          to={`/finance/payments/${payment.id}/print?format=${printFormatParam(format)}`}
          target="_blank"
        >
          <Printer />
          {t('finance.actions.print')}
        </Link>
      </Button>
      {canRecord && payment.status === 'POSTED' ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('finance.actions.other')}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setVoiding(true)}>
              {t('finance.actions.void')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {voiding ? (
        <VoidDialog
          open
          title={t('finance.payments.voidTitle')}
          description={t('finance.payments.voidDescription', { number: payment.number })}
          pending={mutations.voidPayment.isPending}
          problem={action.problem}
          onClose={() => {
            setVoiding(false);
            action.clear();
          }}
          onConfirm={voidPayment}
        />
      ) : null}
    </>
  );
}

function PaymentBody({ payment }: { payment: PaymentDetail }) {
  const { t } = useTranslation();
  const facts = [
    { label: t('finance.fields.date'), value: payment.paidOn },
    {
      label: t('finance.fields.moneyAccount'),
      value: `${payment.moneyAccountName} · ${payment.moneyAccountCode}`,
    },
    ...(payment.customerId
      ? [
          {
            label: t('finance.fields.customer'),
            value: (
              <Link
                className="text-link underline-offset-2 hover:underline"
                to={`/finance/customers/${payment.customerId}`}
              >
                {payment.customerName} · {payment.customerCode}
              </Link>
            ),
          },
        ]
      : []),
    ...(payment.glAccountCode
      ? [
          {
            label: t('finance.fields.account'),
            value: `${payment.glAccountCode} · ${payment.glAccountName}`,
          },
        ]
      : []),
    ...(payment.counterpartyName
      ? [{ label: t('finance.fields.counterparty'), value: payment.counterpartyName }]
      : []),
    ...(payment.reference
      ? [{ label: t('finance.fields.reference'), value: payment.reference }]
      : []),
    ...(payment.collectedByName
      ? [{ label: t('finance.fields.collectedBy'), value: payment.collectedByName }]
      : []),
    ...(payment.createdByName
      ? [
          {
            label: t('finance.fields.createdBy'),
            value: `${payment.createdByName} · ${formatUbDateTime(Date.parse(payment.createdAt))}`,
          },
        ]
      : []),
    ...(payment.journalNumber
      ? [
          {
            label: t('finance.fields.journalEntry'),
            value: (
              <Link
                className="font-mono text-link underline-offset-2 hover:underline"
                to={`/finance/journal?entry=${payment.journalEntryId}`}
              >
                {payment.journalNumber}
              </Link>
            ),
          },
        ]
      : []),
  ];
  const advance = new Decimal(payment.amount).minus(payment.allocatedAmount);
  return (
    <div className="flex flex-col gap-5">
      {payment.status === 'VOID' ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
          {t('finance.invoices.voidedBy', { name: payment.voidedByName ?? '' })}
          {payment.voidReason ? ` — ${payment.voidReason}` : ''}
        </p>
      ) : null}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold">
          {payment.direction === 'OUT' ? '−' : ''}
          {formatTugrik(payment.amount)}
        </span>
        <span className="text-sm text-muted-foreground">
          {t(`finance.directions.${payment.direction}`)}
        </span>
      </div>
      <FactChips facts={facts} />
      {payment.description ? <p className="text-sm">{payment.description}</p> : null}
      {payment.kind === 'CUSTOMER_PAYMENT' ? (
        <PanelSection title={t('finance.payments.allocations')}>
          {payment.allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('finance.payments.noAllocations')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('finance.fields.number')}</TableHead>
                    <TableHead>{t('finance.fields.dueDate')}</TableHead>
                    <TableHead className="text-right">{t('finance.fields.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payment.allocations.map((allocation) => (
                    <TableRow
                      key={allocation.id}
                      className={
                        allocation.voidedAt ? 'text-muted-foreground line-through' : undefined
                      }
                    >
                      <TableCell className="font-mono">
                        <Link
                          className="text-link underline-offset-2 hover:underline"
                          to={`/finance/invoices?invoice=${allocation.invoiceId}`}
                        >
                          {allocation.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{allocation.invoiceDueDate}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatTugrik(allocation.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {payment.status === 'POSTED' && advance.gt(0) ? (
            <p className="text-sm text-muted-foreground">
              {t('finance.payments.advance', { amount: formatMnt(advance.toFixed(2)) })}
            </p>
          ) : null}
        </PanelSection>
      ) : null}
    </div>
  );
}
