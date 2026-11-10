import { type components, idempotencyKey } from '@tugeel/api-client';
import { COLLECTION_STATUSES, type CollectionStatus } from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  SegmentedControl,
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { randomUuid } from '@/lib/uuid';
import { useMoneyAccounts } from './api';
import { VoidDialog } from './void-dialog';

type RepCollection = components['schemas']['RepCollection'];

const VIEWS = ['PENDING', 'RECORDED', 'REJECTED', 'ALL'] as const;
type View = (typeof VIEWS)[number];
const KEY = ['finance', 'rep-collections'] as const;

const TONE: Record<CollectionStatus, 'warning' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  RECORDED: 'success',
  REJECTED: 'destructive',
};

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'createdAt', kind: 'datetime' },
  { key: 'rep', kind: 'text', weight: 2, min: 10 },
  { key: 'customer', kind: 'text', weight: 3, min: 14 },
  { key: 'method', kind: 'status' },
  { key: 'amount', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'note', kind: 'text', weight: 3, min: 12 },
  { key: 'actions', kind: 'text', weight: 2, min: 16 },
  { key: 'spacer', kind: 'spacer' },
];

function useCollections(status: CollectionStatus | undefined) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEY, status ?? 'ALL'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/rep-collections', {
          params: { query: { status, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useDecide() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const done = () => queryClient.invalidateQueries({ queryKey: ['finance'] });
  return {
    record: useMutation({
      mutationFn: async (input: { id: number; moneyAccountId: number; paidOn: string }) =>
        unwrap(
          await api.POST('/api/v1/rep-collections/{id}/record', {
            params: { path: { id: input.id }, header: idempotencyKey(randomUuid()) },
            body: { moneyAccountId: input.moneyAccountId, paidOn: input.paidOn },
          }),
        ),
      onSuccess: done,
    }),
    reject: useMutation({
      mutationFn: async (input: { id: number; reason: string }) =>
        unwrap(
          await api.POST('/api/v1/rep-collections/{id}/reject', {
            params: { path: { id: input.id } },
            body: { reason: input.reason },
          }),
        ),
      onSuccess: done,
    }),
  };
}

/**
 * «Цуглуулсан төлбөр» (ADR-0183): the money reps say stores handed over. A report changes nothing
 * in the books; «Орлого бичих» writes the customer's payment voucher into the chosen cash or bank
 * account and names the rep on it, «Татгалзах» refuses it with a reason the rep reads.
 */
export function RepCollectionsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const canDecide = useHasPermission('finance.payments.record');
  const viewParam = params.get('status');
  const view: View = VIEWS.find((value) => value === viewParam) ?? 'PENDING';
  const status = COLLECTION_STATUSES.find((value) => value === view);
  const collections = useCollections(status);
  const decide = useDecide();
  const [recording, setRecording] = useState<RepCollection | null>(null);
  const [rejecting, setRejecting] = useState<RepCollection | null>(null);
  const rows = collections.data?.pages.flatMap((page) => page.data) ?? [];
  const first = collections.data?.pages[0];
  return (
    <>
      <PageHeader
        title={t('finance.collections.title')}
        meta={
          first ? (
            <span className="tabular-nums">
              {t('finance.collections.pending', {
                count: formatCount(first.pendingCount),
                amount: formatTugrik(first.pendingAmount),
              })}
            </span>
          ) : undefined
        }
      />
      <FilterBar>
        <SegmentedControl
          options={VIEWS}
          value={view}
          label={(value) => t(`finance.collections.views.${value}`)}
          onChange={(value) => setParam('status', value === 'PENDING' ? null : value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(collections.error)} onRetry={collections.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.collections.columns.createdAt')}</TableHead>
              <TableHead>{t('finance.collections.columns.rep')}</TableHead>
              <TableHead>{t('finance.collections.columns.customer')}</TableHead>
              <TableHead>{t('finance.collections.columns.method')}</TableHead>
              <TableHead className="text-right">
                {t('finance.collections.columns.amount')}
              </TableHead>
              <TableHead>{t('finance.collections.columns.status')}</TableHead>
              <TableHead>{t('finance.collections.columns.note')}</TableHead>
              <TableHead />
              <SpacerHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {collections.isPending ? <SkeletonRows columns={9} /> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(row.createdAt))}
                </TableCell>
                <TruncateCell text={row.userName}>{row.userName}</TruncateCell>
                <TruncateCell text={row.customerName}>{row.customerName}</TruncateCell>
                <TableCell>{t(`finance.collections.methods.${row.method}`)}</TableCell>
                <TableCell className="text-right font-mono">{formatTugrik(row.amount)}</TableCell>
                <TableCell>
                  <Badge variant={TONE[row.status]}>
                    {t(`finance.collections.statuses.${row.status}`)}
                  </Badge>
                </TableCell>
                <TruncateCell text={row.decisionNote ?? row.note ?? ''}>
                  {row.decisionNote ?? row.note ?? ''}
                </TruncateCell>
                <TableCell className="py-1">
                  {row.status === 'PENDING' && canDecide ? (
                    <span className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => setRecording(row)}>
                        {t('finance.collections.record')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(row)}>
                        {t('finance.collections.reject')}
                      </Button>
                    </span>
                  ) : row.paymentNumber ? (
                    <Link
                      to={`/finance/payments?payment=${row.paymentId}`}
                      className="font-mono text-link underline-offset-4 hover:underline"
                    >
                      {row.paymentNumber}
                    </Link>
                  ) : null}
                </TableCell>
                <SpacerCell />
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!collections.isPending && rows.length === 0 ? (
          <EmptyState icon={HandCoins} title={t('finance.collections.empty')} />
        ) : null}
        <LoadMore query={collections} />
      </ListCard>
      {recording ? (
        <RecordDialog
          collection={recording}
          pending={decide.record.isPending}
          error={decide.record.error}
          onClose={() => {
            decide.record.reset();
            setRecording(null);
          }}
          onConfirm={(moneyAccountId, paidOn) =>
            decide.record.mutate(
              { id: recording.id, moneyAccountId, paidOn },
              {
                onSuccess: (done) => {
                  toast.success(
                    t('finance.collections.recorded', { number: done.paymentNumber ?? '' }),
                  );
                  setRecording(null);
                },
              },
            )
          }
        />
      ) : null}
      <VoidDialog
        open={rejecting !== null}
        title={t('finance.collections.rejectTitle')}
        description={t('finance.collections.rejectText', {
          name: rejecting?.customerName ?? '',
          amount: formatTugrik(rejecting?.amount ?? '0'),
        })}
        pending={decide.reject.isPending}
        problem={problemFromError(decide.reject.error)}
        submitLabel={t('finance.collections.reject')}
        onClose={() => {
          decide.reject.reset();
          setRejecting(null);
        }}
        onConfirm={(reason) => {
          if (!rejecting) return;
          decide.reject.mutate(
            { id: rejecting.id, reason },
            {
              onSuccess: () => {
                toast.success(t('finance.collections.rejected'));
                setRejecting(null);
              },
            },
          );
        }}
      />
    </>
  );
}

/** «Орлого бичих»: where the money went and on what day; the voucher is written on confirm. */
function RecordDialog(props: {
  collection: RepCollection;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (moneyAccountId: number, paidOn: string) => void;
}) {
  const { t } = useTranslation();
  const accounts = useMoneyAccounts();
  const wanted = props.collection.method === 'CASH' ? 'CASH' : 'BANK';
  const choices = (accounts.data ?? []).filter((account) => account.kind === wanted);
  const [accountId, setAccountId] = useState('');
  const [paidOn, setPaidOn] = useState(props.collection.collectedOn);
  const chosen = accountId || (choices.length === 1 ? String(choices[0]?.id) : '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const id = Number.parseInt(chosen, 10);
    if (id > 0 && paidOn) props.onConfirm(id, paidOn);
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.collections.recordTitle')}</DialogTitle>
          <DialogDescription>
            {t('finance.collections.recordText', {
              rep: props.collection.userName,
              name: props.collection.customerName,
              amount: formatTugrik(props.collection.amount),
            })}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={t('finance.collections.moneyAccount')} htmlFor="collection-account">
            <NativeSelect
              id="collection-account"
              value={chosen}
              required
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">{t('finance.collections.chooseAccount')}</option>
              {choices.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('finance.collections.paidOn')} htmlFor="collection-paid-on">
            <DateInput
              id="collection-paid-on"
              value={paidOn}
              max={businessDate()}
              onChange={(value) => setPaidOn(value)}
            />
          </FormField>
          <ProblemAlert problem={problemFromError(props.error)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={props.pending || !chosen || !paidOn}>
              {t('finance.collections.record')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
