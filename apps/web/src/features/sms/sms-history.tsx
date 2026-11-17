import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  ListCard,
  ListTable,
  LoadMore,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { PanelSection, RecordSheet } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { type SmsBatch, type SmsMessage, useSmsBatch, useSmsBatches } from './api';
import { useSmsReason } from './sms-text';

/** The history's columns (ADR-0119): when, who, the group, the text, four counts, the state. */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'when', kind: 'datetime', width: 10 },
  { key: 'who', kind: 'text', weight: 1, min: 7, drop: 2 },
  { key: 'group', kind: 'text', weight: 1, min: 7, drop: 1 },
  { key: 'template', kind: 'text', weight: 3, min: 10 },
  { key: 'total', kind: 'count' },
  { key: 'sent', kind: 'count', width: 6 },
  { key: 'failed', kind: 'count', width: 6 },
  { key: 'skipped', kind: 'count', width: 6, drop: 1 },
  { key: 'status', kind: 'status' },
  { key: 'chevron', kind: 'chevron' },
];

type HistoryColumn =
  'when' | 'who' | 'group' | 'template' | 'total' | 'sent' | 'failed' | 'skipped' | 'status';

const BATCH_TONE = { QUEUED: 'secondary', SENDING: 'default', DONE: 'success' } as const;
const MESSAGE_TONE = {
  QUEUED: 'secondary',
  SENT: 'success',
  FAILED: 'destructive',
  SKIPPED: 'outline',
} as const;

/** «Түүх» (ADR-0216): every batch newest first; a row opens its messages (`?batch=`). */
export function SmsHistory() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const batches = useSmsBatches();
  const rows = batches.data?.pages.flatMap((page) => page.data) ?? [];
  const open = Number.parseInt(params.get('batch') ?? '', 10);
  const columnHead = (key: HistoryColumn, numeric = false) => (
    <TableHead className={numeric ? 'text-right' : undefined}>
      {t(`sms.history.columns.${key}`)}
    </TableHead>
  );

  return (
    <>
      <ProblemAlert problem={problemFromError(batches.error)} onRetry={batches.refetch} />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              {columnHead('when')}
              {columnHead('who')}
              {columnHead('group')}
              {columnHead('template')}
              {columnHead('total', true)}
              {columnHead('sent', true)}
              {columnHead('failed', true)}
              {columnHead('skipped', true)}
              {columnHead('status')}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.isPending ? <SkeletonRows columns={10} /> : null}
            {rows.map((batch) => (
              <ButtonRow
                key={batch.id}
                selected={batch.id === open}
                onOpen={() => setParam('batch', String(batch.id))}
              >
                <TableCell className="font-mono">
                  <button
                    type="button"
                    className="text-link underline-offset-4 hover:underline"
                    onClick={() => setParam('batch', String(batch.id))}
                  >
                    {formatUbMinute(batch.createdAt)}
                  </button>
                </TableCell>
                <TruncateCell text={batch.createdBy} />
                <TableCell className="whitespace-nowrap">
                  {batch.settlementGroup ? t(`sms.groups.${batch.settlementGroup}`) : ''}
                </TableCell>
                <TruncateCell text={batch.template} />
                <TableCell className="text-right font-mono">
                  {formatCount(batch.totalCount)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCount(batch.sentCount)}
                </TableCell>
                <TableCell
                  className={
                    batch.failedCount > 0
                      ? 'text-right font-mono text-destructive'
                      : 'text-right font-mono'
                  }
                >
                  {formatCount(batch.failedCount)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCount(batch.skippedCount)}
                </TableCell>
                <TableCell>
                  <Badge variant={BATCH_TONE[batch.status]}>
                    {t(`sms.batchStatuses.${batch.status}`)}
                  </Badge>
                </TableCell>
              </ButtonRow>
            ))}
          </TableBody>
        </ListTable>
        {!batches.isPending && rows.length === 0 ? (
          <EmptyState icon={History} title={t('sms.history.empty')} />
        ) : null}
        <LoadMore query={batches} />
      </ListCard>
      {Number.isInteger(open) && open > 0 ? (
        <BatchSheet id={open} onClose={() => setParam('batch', null)} />
      ) : null}
    </>
  );
}

/** One batch: its template, its counts and every message with its state and final text. */
function BatchSheet(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const reason = useSmsReason();
  const detail = useSmsBatch(props.id);
  const batch: SmsBatch | undefined = detail.data?.batch;
  return (
    <RecordSheet
      open
      onClose={props.onClose}
      size="panel"
      title={t('sms.history.batchTitle', { id: props.id })}
      description={
        batch
          ? t('sms.history.batchDescription', {
              who: batch.createdBy,
              when: formatUbMinute(batch.createdAt),
            })
          : undefined
      }
      badges={
        batch ? (
          <Badge variant={BATCH_TONE[batch.status]}>{t(`sms.batchStatuses.${batch.status}`)}</Badge>
        ) : null
      }
    >
      <ProblemAlert problem={problemFromError(detail.error)} onRetry={detail.refetch} />
      {batch ? (
        <>
          <PanelSection title={t('sms.history.template')}>
            <p className="rounded-lg bg-fill/60 px-3 py-2 text-sm whitespace-pre-wrap">
              {batch.template}
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <li className="text-success">{t('sms.dialog.sent', { count: batch.sentCount })}</li>
              <li className={batch.failedCount > 0 ? 'text-destructive' : undefined}>
                {t('sms.dialog.failed', { count: batch.failedCount })}
              </li>
              <li className="text-muted-foreground">
                {t('sms.dialog.skipped', { count: batch.skippedCount })}
              </li>
              <li className="text-muted-foreground">
                {t('sms.history.credits', { amount: formatTugrik(String(batch.creditsUsed)) })}
              </li>
            </ul>
            {batch.stoppedCode ? (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {t('sms.dialog.stopped', { reason: reason(batch.stoppedCode) })}
              </p>
            ) : null}
          </PanelSection>
          <PanelSection title={t('sms.history.messages')}>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sms.history.messageColumns.customer')}</TableHead>
                    <TableHead>{t('sms.history.messageColumns.phone')}</TableHead>
                    <TableHead className="text-right">
                      {t('sms.history.messageColumns.balance')}
                    </TableHead>
                    <TableHead>{t('sms.history.messageColumns.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.isPending ? <SkeletonRows columns={4} /> : null}
                  {(detail.data?.messages ?? []).map((message) => (
                    <MessageRow key={message.id} message={message} reason={reason} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </PanelSection>
        </>
      ) : null}
    </RecordSheet>
  );
}

function MessageRow(props: { message: SmsMessage; reason: (code: string | null) => string }) {
  const { t } = useTranslation();
  const { message } = props;
  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <span className="font-medium">{message.customerName}</span>
        <span className="ml-2 font-mono text-muted-foreground">{message.customerCode}</span>
        <p className="mt-1 text-[0.8125rem] whitespace-pre-wrap text-muted-foreground">
          {message.text}
        </p>
      </TableCell>
      <TableCell className="align-top font-mono whitespace-nowrap">
        {message.phone?.replace(/^\+976/, '') ?? t('sms.noPhone')}
      </TableCell>
      <TableCell className="text-right align-top font-mono whitespace-nowrap">
        {formatTugrik(message.balance)}
      </TableCell>
      <TableCell className="w-56 align-top whitespace-normal">
        <Badge variant={MESSAGE_TONE[message.status]}>{t(`sms.statuses.${message.status}`)}</Badge>
        {message.errorCode ? (
          <p className="mt-1 text-xs text-destructive">{props.reason(message.errorCode)}</p>
        ) : null}
        {message.sentAt ? (
          <p className="mt-1 text-xs text-muted-foreground">{formatUbMinute(message.sentAt)}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
