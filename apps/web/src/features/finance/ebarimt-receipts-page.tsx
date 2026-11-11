import type { components } from '@tugeel/api-client';
import {
  RECEIPT_TYPES,
  WHOLESALE_RECEIPT_STATUSES,
  type WholesaleCancelStatus,
  type WholesaleReceiptStatus,
} from '@tugeel/shared/mn';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { ReceiptText } from 'lucide-react';
import { type FormEvent, useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';

export type EbarimtReceipt = components['schemas']['EbarimtReceipt'];

const KEY = ['finance', 'ebarimt-receipts'] as const;
/** Receipts are issued by the store edge a few seconds after the sale: the list follows. */
const REFRESH_MS = 15_000;

type Tone = 'warning' | 'success' | 'destructive' | 'secondary';

const STATUS_TONE: Record<WholesaleReceiptStatus, Tone> = {
  PENDING: 'secondary',
  SENDING: 'secondary',
  CONFIRMED: 'success',
  ERROR: 'destructive',
  INDETERMINATE: 'warning',
  CANCELLED: 'secondary',
};

const CANCEL_TONE: Record<WholesaleCancelStatus, Tone> = {
  PENDING: 'secondary',
  SENDING: 'secondary',
  DONE: 'secondary',
  ERROR: 'destructive',
  INDETERMINATE: 'warning',
};

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'createdAt', kind: 'datetime' },
  { key: 'invoice', kind: 'number' },
  { key: 'customer', kind: 'text', weight: 3, min: 14 },
  { key: 'type', kind: 'status' },
  { key: 'amount', kind: 'money' },
  { key: 'status', kind: 'status', width: 13 },
  { key: 'ddtd', kind: 'text', weight: 2, min: 12 },
  { key: 'message', kind: 'text', weight: 3, min: 12 },
  { key: 'actions', kind: 'text', weight: 2, min: 16 },
  { key: 'spacer', kind: 'spacer' },
];

const isStatus = (value: string | null): value is WholesaleReceiptStatus =>
  WHOLESALE_RECEIPT_STATUSES.some((entry) => entry === value);
const isType = (value: string | null): value is (typeof RECEIPT_TYPES)[number] =>
  RECEIPT_TYPES.some((entry) => entry === value);

/** The state of a receipt, and of its cancellation while that is not through. */
export function EbarimtStatusBadges({ receipt }: { receipt: EbarimtReceipt }) {
  const { t } = useTranslation();
  const cancel = receipt.cancelStatus;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={STATUS_TONE[receipt.status]}>
        {t(`finance.ebarimtReceipts.statuses.${receipt.status}`)}
      </Badge>
      {cancel && cancel !== 'DONE' ? (
        <Badge variant={CANCEL_TONE[cancel]}>
          {t(`finance.ebarimtReceipts.cancelStatuses.${cancel}`)}
        </Badge>
      ) : null}
    </span>
  );
}

/** Why a receipt waits, in the accountant's words, then PosAPI's own message. */
function ebarimtReason(receipt: EbarimtReceipt, t: TFunction): string {
  const parts = [
    receipt.errorCode && receipt.status === 'ERROR'
      ? t(`finance.ebarimtReceipts.errors.${receipt.errorCode}`)
      : null,
    receipt.errorCode === 'POSAPI_REFUSED' || receipt.status !== 'ERROR' ? receipt.message : null,
    receipt.cancelStatus && receipt.cancelStatus !== 'DONE' ? receipt.cancelMessage : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function useReceipts(query: {
  q: string;
  status: WholesaleReceiptStatus | undefined;
  type: (typeof RECEIPT_TYPES)[number] | undefined;
  cancelOpen: boolean | undefined;
}) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEY, 'list', query],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt/receipts', {
          params: {
            query: {
              q: query.q || undefined,
              status: query.status,
              type: query.type,
              cancelOpen: query.cancelOpen,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: REFRESH_MS,
  });
}

function useAttention() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'attention'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/ebarimt/receipts/attention', { signal })),
    refetchInterval: REFRESH_MS,
  });
}

/** The accountant's decisions; each refreshes the finance lists (the invoice's panel too). */
function useEbarimtActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const done = () => queryClient.invalidateQueries({ queryKey: ['finance'] });
  return {
    retry: useMutation({
      mutationFn: async (invoiceId: number) =>
        unwrap(
          await api.POST('/api/v1/invoices/{id}/ebarimt', { params: { path: { id: invoiceId } } }),
        ),
      onSuccess: done,
    }),
    resolve: useMutation({
      mutationFn: async (input: {
        id: number;
        outcome: 'ISSUED' | 'NOT_ISSUED';
        ddtd?: string;
        posapiDate?: string;
      }) =>
        unwrap(
          await api.POST('/api/v1/ebarimt/receipts/{id}/resolve', {
            params: { path: { id: input.id } },
            body: { outcome: input.outcome, ddtd: input.ddtd, posapiDate: input.posapiDate },
          }),
        ),
      onSuccess: done,
    }),
    cancelResolve: useMutation({
      mutationFn: async (input: { id: number; outcome: 'RETRY' | 'CANCELLED' }) =>
        unwrap(
          await api.POST('/api/v1/ebarimt/receipts/{id}/cancel-resolve', {
            params: { path: { id: input.id } },
            body: { outcome: input.outcome },
          }),
        ),
      onSuccess: done,
    }),
  };
}

/**
 * «Санхүү → e-Barimt баримт» (ADR-0185): the wholesale receipts the store edge issues at the store
 * PosAPI. The accountant sees what waits, prepares a refused one again, decides on one PosAPI left
 * unanswered after looking it up on ebarimt.mn (it is never sent again unasked), follows a
 * cancellation, and prints — with the lottery and the QR code once, a copy afterwards.
 */
export function EbarimtReceiptsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('finance.invoices.manage');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const typeParam = params.get('type');
  const type = isType(typeParam) ? typeParam : undefined;
  const cancelOpen = params.get('cancel') === '1' ? true : undefined;
  const receipts = useReceipts({ q, status, type, cancelOpen });
  const attention = useAttention();
  const actions = useEbarimtActions();
  const [resolving, setResolving] = useState<EbarimtReceipt | null>(null);
  const rows = receipts.data?.pages.flatMap((page) => page.data) ?? [];
  const counts = attention.data;
  const problem =
    problemFromError(receipts.error) ??
    problemFromError(actions.retry.error) ??
    problemFromError(actions.cancelResolve.error);

  return (
    <>
      <PageHeader
        title={t('finance.ebarimtReceipts.title')}
        meta={
          counts ? (
            <span className="tabular-nums">
              {t('finance.ebarimtReceipts.counts', {
                pending: counts.pending,
                indeterminate: counts.indeterminate,
                error: counts.error,
              })}
            </span>
          ) : undefined
        }
      />
      <p className="mb-3 text-sm text-muted-foreground">
        {t('finance.ebarimtReceipts.intro')}{' '}
        {counts
          ? counts.relaySeenAt
            ? t('finance.ebarimtReceipts.relaySeen', {
                code: counts.relayNodeCode ?? '',
                at: formatUbDateTime(Date.parse(counts.relaySeenAt)),
              })
            : counts.pending > 0
              ? t('finance.ebarimtReceipts.relayNever')
              : ''
          : ''}
      </p>
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('finance.ebarimtReceipts.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('finance.ebarimtReceipts.columns.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('finance.ebarimtReceipts.allStatuses')}</option>
          {WHOLESALE_RECEIPT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`finance.ebarimtReceipts.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('finance.ebarimtReceipts.columns.type')}
          value={type ?? ''}
          onChange={(event) => setParam('type', event.target.value)}
        >
          <option value="">{t('finance.ebarimtReceipts.allTypes')}</option>
          {RECEIPT_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`finance.ebarimtReceipts.types.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('finance.ebarimtReceipts.cancelOpen')}
          checked={cancelOpen === true}
          onCheckedChange={(checked) => setParam('cancel', checked ? '1' : undefined)}
        />
      </FilterBar>
      <ProblemAlert problem={problem} onRetry={receipts.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.ebarimtReceipts.columns.createdAt')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.invoice')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.customer')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.type')}</TableHead>
              <TableHead className="text-right">
                {t('finance.ebarimtReceipts.columns.amount')}
              </TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.status')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.ddtd')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.message')}</TableHead>
              <TableHead>{t('finance.ebarimtReceipts.columns.actions')}</TableHead>
              <SpacerHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.isPending ? <SkeletonRows columns={10} /> : null}
            {rows.map((row) => {
              const reason = ebarimtReason(row, t);
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">
                    {formatUbDateTime(Date.parse(row.createdAt))}
                  </TableCell>
                  <TableCell className="font-mono">
                    {row.sourceDocType === 'SALES_INVOICE' ? (
                      <Link
                        to={`/finance/invoices?invoice=${row.sourceDocId}`}
                        className="font-medium text-link underline-offset-4 hover:underline"
                      >
                        {row.docNumber}
                      </Link>
                    ) : (
                      row.docNumber
                    )}
                  </TableCell>
                  <TruncateCell text={row.buyerName}>{row.buyerName}</TruncateCell>
                  <TableCell>{t(`finance.ebarimtReceipts.types.${row.receiptType}`)}</TableCell>
                  <TableCell className="text-right font-mono">{formatTugrik(row.total)}</TableCell>
                  <TableCell>
                    <EbarimtStatusBadges receipt={row} />
                  </TableCell>
                  <TruncateCell text={row.ddtd ?? ''}>
                    <span className="font-mono">{row.ddtd ?? ''}</span>
                  </TruncateCell>
                  <TruncateCell text={reason}>{reason}</TruncateCell>
                  <TableCell className="py-1">
                    <EbarimtRowActions
                      receipt={row}
                      canManage={canManage}
                      busy={actions.retry.isPending || actions.cancelResolve.isPending}
                      onResolve={() => setResolving(row)}
                      onRetry={() =>
                        actions.retry.mutate(Number.parseInt(row.sourceDocId, 10), {
                          onSuccess: () => toast.success(t('finance.ebarimtReceipts.retried')),
                        })
                      }
                      onCancel={(outcome) =>
                        actions.cancelResolve.mutate(
                          { id: row.id, outcome },
                          {
                            onSuccess: () =>
                              toast.success(t('finance.ebarimtReceipts.cancelResolved')),
                          },
                        )
                      }
                    />
                  </TableCell>
                  <SpacerCell />
                </TableRow>
              );
            })}
          </TableBody>
        </ListTable>
        {!receipts.isPending && rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('finance.ebarimtReceipts.empty')} />
        ) : null}
        <LoadMore query={receipts} />
      </ListCard>
      {resolving ? (
        <ResolveDialog
          receipt={resolving}
          pending={actions.resolve.isPending}
          error={actions.resolve.error}
          onClose={() => {
            actions.resolve.reset();
            setResolving(null);
          }}
          onConfirm={(input) =>
            actions.resolve.mutate(
              { id: resolving.id, ...input },
              {
                onSuccess: () => {
                  toast.success(t('finance.ebarimtReceipts.resolved'));
                  setResolving(null);
                },
              },
            )
          }
        />
      ) : null}
    </>
  );
}

/** What a person may do with a receipt in its state; the print opens in a tab of its own. */
function EbarimtRowActions(props: {
  receipt: EbarimtReceipt;
  canManage: boolean;
  busy: boolean;
  onResolve: () => void;
  onRetry: () => void;
  onCancel: (outcome: 'RETRY' | 'CANCELLED') => void;
}) {
  const { t } = useTranslation();
  const { receipt, canManage } = props;
  const cancelStuck = receipt.cancelStatus === 'ERROR' || receipt.cancelStatus === 'INDETERMINATE';
  return (
    <span className="flex flex-wrap gap-1.5">
      {receipt.status === 'CONFIRMED' ? (
        <Button asChild size="sm" variant={receipt.printable ? 'default' : 'outline'}>
          <a
            href={`/finance/ebarimt-receipts/${receipt.id}/print`}
            target="_blank"
            rel="noreferrer"
          >
            {receipt.printable
              ? t('finance.ebarimtReceipts.printWithLottery')
              : t('finance.ebarimtReceipts.print')}
          </a>
        </Button>
      ) : null}
      {canManage && receipt.status === 'INDETERMINATE' ? (
        <Button size="sm" onClick={props.onResolve}>
          {t('finance.ebarimtReceipts.resolve')}
        </Button>
      ) : null}
      {canManage &&
      receipt.status === 'ERROR' &&
      receipt.cancelStatus === null &&
      receipt.sourceDocType === 'SALES_INVOICE' ? (
        <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onRetry}>
          {t('finance.ebarimtReceipts.retry')}
        </Button>
      ) : null}
      {canManage && cancelStuck ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onCancel('RETRY')}
          >
            {t('finance.ebarimtReceipts.cancelRetry')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={props.busy}
            onClick={() => props.onCancel('CANCELLED')}
          >
            {t('finance.ebarimtReceipts.cancelDone')}
          </Button>
        </>
      ) : null}
    </span>
  );
}

/** «Шалгах»: what ebarimt.mn shows for a receipt PosAPI left unanswered. */
function ResolveDialog(props: {
  receipt: EbarimtReceipt;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (input: {
    outcome: 'ISSUED' | 'NOT_ISSUED';
    ddtd?: string;
    posapiDate?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<'ISSUED' | 'NOT_ISSUED'>('ISSUED');
  const [ddtd, setDdtd] = useState('');
  const [posapiDate, setPosapiDate] = useState('');
  const ready = outcome === 'NOT_ISSUED' || (ddtd.trim() !== '' && posapiDate.trim() !== '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    props.onConfirm(
      outcome === 'ISSUED'
        ? { outcome, ddtd: ddtd.trim(), posapiDate: posapiDate.trim() }
        : { outcome },
    );
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.ebarimtReceipts.resolveTitle')}</DialogTitle>
          <DialogDescription>
            {t('finance.ebarimtReceipts.resolveText', { number: props.receipt.docNumber })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={t('finance.ebarimtReceipts.outcome')} htmlFor="ebarimt-outcome">
            <NativeSelect
              id="ebarimt-outcome"
              value={outcome}
              onChange={(event) =>
                setOutcome(event.target.value === 'NOT_ISSUED' ? 'NOT_ISSUED' : 'ISSUED')
              }
            >
              <option value="ISSUED">{t('finance.ebarimtReceipts.issued')}</option>
              <option value="NOT_ISSUED">{t('finance.ebarimtReceipts.notIssued')}</option>
            </NativeSelect>
          </FormField>
          {outcome === 'ISSUED' ? (
            <>
              <FormField label={t('finance.ebarimtReceipts.ddtd')} htmlFor="ebarimt-ddtd">
                <Input
                  id="ebarimt-ddtd"
                  inputMode="numeric"
                  className="font-mono"
                  maxLength={40}
                  value={ddtd}
                  onChange={(event) => setDdtd(event.target.value)}
                />
              </FormField>
              <FormField
                label={t('finance.ebarimtReceipts.posapiDate')}
                htmlFor="ebarimt-date"
                hint={t('finance.ebarimtReceipts.posapiDateHint')}
              >
                <Input
                  id="ebarimt-date"
                  className="font-mono"
                  maxLength={19}
                  value={posapiDate}
                  onChange={(event) => setPosapiDate(event.target.value)}
                />
              </FormField>
            </>
          ) : null}
          <ProblemAlert problem={problemFromError(props.error)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.pending || !ready}>
              {outcome === 'ISSUED'
                ? t('finance.ebarimtReceipts.resolveIssued')
                : t('finance.ebarimtReceipts.resolveNotIssued')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
