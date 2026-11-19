import { addDays, businessDate } from '@tugeel/shared/time';
import { CalendarSearch, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbMinute } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ErxesRangeDeal,
  type ErxesRangePreview,
  type ErxesRangeRequest,
  type ErxesRangeResult,
  useErxesRangeActions,
  useErxesRangePipelines,
} from './api';
import { FAILURE_KEYS, useIssueText } from './erxes-texts';

/** A range is whole days, at most this many (the api refuses more, ADR-0220). */
const MAX_DAYS = 31;
/** Deals sent in one request: the progress moves after each part. */
const PART = 20;

interface CopyTally {
  copied: number;
  waiting: number;
  skipped: number;
  failed: number;
  /** Deals not sent because erxes could not be reached. */
  notSent: number;
  results: ErxesRangeResult[];
}

const dealLabel = (deal: { number: string | null; name: string | null; erxesId: string }) =>
  [deal.number, deal.name].filter(Boolean).join(' · ') || deal.erxesId;

/**
 * «Хугацаагаар татах» (ADR-0220): the deals created in erxes within whole days a person picks,
 * in the pipelines they choose, listed with what Bto already holds of each; the ticked new ones
 * are copied by exactly the rules of the minute pull, a part at a time, with the progress shown.
 */
export function ErxesRangeDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const pipelines = useErxesRangePipelines();
  const actions = useErxesRangeActions();
  const action = useAction();
  const issueText = useIssueText();
  const today = businessDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [asked, setAsked] = useState<ErxesRangeRequest | null>(null);
  const [preview, setPreview] = useState<ErxesRangePreview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tally, setTally] = useState<CopyTally | null>(null);

  const usable = pipelines.data ?? [];
  // Until the person changes it, the pipelines the minute pull reads.
  const chosen =
    picked ?? usable.filter((pipeline) => pipeline.enabled).map((pipeline) => pipeline.id);
  const formError =
    !from || !to
      ? t('erxes.range.error.dates')
      : to < from
        ? t('erxes.range.error.order')
        : addDays(from, MAX_DAYS - 1) < to
          ? t('erxes.range.error.tooLong', { days: MAX_DAYS })
          : chosen.length === 0
            ? t('erxes.range.error.noPipeline')
            : null;
  const copying = progress !== null;
  const deals = useMemo(() => preview?.deals ?? [], [preview]);
  const fresh = useMemo(() => deals.filter((deal) => deal.known === null), [deals]);
  const tickedDeals = fresh.filter((deal) => ticked.has(deal.erxesId));
  const byId = useMemo(() => new Map(deals.map((deal) => [deal.erxesId, deal])), [deals]);

  const show = (request: ErxesRangeRequest) =>
    action.run(async () => {
      const answer = await actions.preview.mutateAsync(request);
      if (!answer.ok) {
        toast.warning(
          t('erxes.pullFailed', {
            reason: t(`erxes.failure.${FAILURE_KEYS[answer.failure ?? 'INTERNAL']}`),
          }),
        );
      }
      setAsked(request);
      setPreview(answer);
      // New deals are ticked; a person unticks what is not wanted.
      setTicked(
        new Set(answer.deals.filter((deal) => deal.known === null).map((deal) => deal.erxesId)),
      );
    });

  const look = () => {
    if (formError) return;
    setTally(null);
    void show({ from, to, pipelineIds: chosen });
  };

  const copy = () =>
    void action.run(async () => {
      if (!asked || tickedDeals.length === 0) return;
      // Oldest first, so the orders are numbered in the order the deals were made.
      const queue = [...tickedDeals].reverse();
      const sum: CopyTally = {
        copied: 0,
        waiting: 0,
        skipped: 0,
        failed: 0,
        notSent: 0,
        results: [],
      };
      setTally(null);
      setProgress({ done: 0, total: queue.length });
      try {
        for (let start = 0; start < queue.length; start += PART) {
          const part = queue.slice(start, start + PART);
          const answer = await actions.copy.mutateAsync({
            ...asked,
            deals: part.map((deal) => ({ erxesId: deal.erxesId, pipelineId: deal.pipelineId })),
          });
          sum.copied += answer.copied;
          sum.waiting += answer.waiting;
          sum.skipped += answer.skipped;
          sum.failed += answer.failed;
          sum.results.push(...answer.results);
          setProgress({ done: Math.min(start + PART, queue.length), total: queue.length });
          if (!answer.ok) {
            // erxes cannot be reached or signed in to: the rest would fail the same way.
            sum.notSent = Math.max(0, queue.length - start - PART);
            toast.warning(
              t('erxes.pullFailed', {
                reason: t(`erxes.failure.${FAILURE_KEYS[answer.failure ?? 'INTERNAL']}`),
              }),
            );
            break;
          }
        }
      } finally {
        setProgress(null);
        setTally({ ...sum });
        await actions.settle();
      }
      toast.success(t('erxes.range.done', { copied: sum.copied, waiting: sum.waiting }));
      // What Bto holds now, read again.
      await show(asked);
    });

  const toggle = (erxesId: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(erxesId);
      else next.delete(erxesId);
      return next;
    });
  const allTicked = fresh.length > 0 && tickedDeals.length === fresh.length;
  const labelOf = (entry: ErxesRangeResult) => {
    const deal = byId.get(entry.erxesId);
    return deal ? dealLabel(deal) : entry.erxesId;
  };

  return (
    <Dialog open onOpenChange={(open) => (open || copying ? undefined : props.onClose())}>
      <DialogContent size="2xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('erxes.range.title')}</DialogTitle>
          <DialogDescription>{t('erxes.range.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert
          problem={problemFromError(pipelines.error) ?? action.problem}
          onRetry={pipelines.error ? pipelines.refetch : undefined}
        />

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <FormField label={t('erxes.range.from')} htmlFor="erxes-range-from">
            <DateInput id="erxes-range-from" value={from} max={today} onChange={setFrom} />
          </FormField>
          <FormField label={t('erxes.range.to')} htmlFor="erxes-range-to">
            <DateInput id="erxes-range-to" value={to} max={today} onChange={setTo} />
          </FormField>
          <p className="pb-2 text-xs text-muted-foreground">
            {t('erxes.range.rangeHint', { days: MAX_DAYS })}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('erxes.range.pipelines')}</legend>
          {pipelines.data && usable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('erxes.range.noPipelines')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 touch:gap-y-0">
              {usable.map((pipeline) => {
                const id = `erxes-range-pipeline-${pipeline.id}`;
                return (
                  <div key={pipeline.id} className="flex items-center gap-2 touch:min-h-10">
                    <Checkbox
                      id={id}
                      checked={chosen.includes(pipeline.id)}
                      disabled={copying}
                      onCheckedChange={(next) =>
                        setPicked(
                          next === true
                            ? [...chosen, pipeline.id]
                            : chosen.filter((value) => value !== pipeline.id),
                        )
                      }
                    />
                    <Label htmlFor={id} className="leading-snug font-normal">
                      {[pipeline.boardName, pipeline.name].filter(Boolean).join(' · ')}
                      {pipeline.enabled ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {t('erxes.range.ticked')}
                        </span>
                      ) : null}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('erxes.range.pipelinesHint')}</p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={formError !== null || copying}
            pending={actions.preview.isPending}
            onClick={look}
          >
            <CalendarSearch />
            {actions.preview.isPending ? t('erxes.range.showing') : t('erxes.range.show')}
          </Button>
          {formError && pipelines.data ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}
        </div>

        {preview?.tooMany ? (
          <Alert variant="destructive">
            <AlertDescription>{t('erxes.range.tooMany')}</AlertDescription>
          </Alert>
        ) : null}

        {preview?.ok ? (
          deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('erxes.range.empty')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {t('erxes.range.found', { count: deals.length, fresh: fresh.length })}
                </p>
                {fresh.length > 0 ? (
                  <Label className="flex items-center gap-2 font-normal touch:min-h-10">
                    <Checkbox
                      checked={allTicked}
                      disabled={copying}
                      onCheckedChange={(next) =>
                        setTicked(
                          next === true ? new Set(fresh.map((deal) => deal.erxesId)) : new Set(),
                        )
                      }
                    />
                    {t('erxes.range.selectAll')}
                  </Label>
                ) : null}
              </div>
              <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>{t('erxes.range.column.deal')}</TableHead>
                      <TableHead>{t('erxes.range.column.createdAt')}</TableHead>
                      <TableHead>{t('erxes.range.column.creator')}</TableHead>
                      <TableHead>{t('erxes.range.column.stage')}</TableHead>
                      <TableHead>{t('erxes.range.column.customer')}</TableHead>
                      <TableHead className="text-right">{t('erxes.range.column.lines')}</TableHead>
                      <TableHead className="text-right">{t('erxes.range.column.total')}</TableHead>
                      <TableHead>{t('erxes.range.column.bto')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.map((deal) => (
                      <RangeRow
                        key={deal.erxesId}
                        deal={deal}
                        ticked={ticked.has(deal.erxesId)}
                        disabled={copying}
                        onTick={(on) => toggle(deal.erxesId, on)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )
        ) : null}

        {progress ? (
          <p className="text-sm font-medium" role="status">
            {t('erxes.range.copying', { done: progress.done, total: progress.total })}
          </p>
        ) : null}

        {tally ? (
          <Alert>
            <AlertDescription>
              <p className="font-medium">
                {t('erxes.range.result', {
                  copied: tally.copied,
                  waiting: tally.waiting,
                  skipped: tally.skipped,
                  failed: tally.failed,
                })}
              </p>
              {tally.notSent > 0 ? (
                <p>{t('erxes.range.notSent', { count: tally.notSent })}</p>
              ) : null}
              <ResultList
                title={t('erxes.range.resultWaiting')}
                rows={tally.results.filter((entry) => entry.outcome === 'WAITING')}
                label={labelOf}
                why={(entry) => entry.issues.map(issueText).join('; ')}
              />
              <ResultList
                title={t('erxes.range.resultFailed')}
                rows={tally.results.filter((entry) => entry.outcome === 'FAILED')}
                label={labelOf}
                why={(entry) =>
                  [t(`erxes.failure.${FAILURE_KEYS[entry.failure ?? 'INTERNAL']}`), entry.detail]
                    .filter(Boolean)
                    .join(': ')
                }
              />
              <ResultList
                title={t('erxes.range.resultSkipped')}
                rows={tally.results.filter((entry) => entry.outcome === 'SKIPPED')}
                label={labelOf}
                why={(entry) => t(`erxes.range.skip.${entry.skip ?? 'KNOWN'}`)}
              />
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={copying} onClick={props.onClose}>
            {t('common.close')}
          </Button>
          {preview?.ok && fresh.length > 0 ? (
            <Button
              type="button"
              pending={copying}
              disabled={tickedDeals.length === 0 || copying || actions.preview.isPending}
              onClick={copy}
            >
              <Copy />
              {t('erxes.range.copy', { count: tickedDeals.length })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RangeRow(props: {
  deal: ErxesRangeDeal;
  ticked: boolean;
  disabled: boolean;
  onTick: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const { deal } = props;
  const known = deal.known;
  return (
    <TableRow className={known ? 'text-muted-foreground' : undefined}>
      <TableCell>
        <Checkbox
          aria-label={dealLabel(deal)}
          checked={known === null && props.ticked}
          // A deal Bto holds already is never copied again.
          disabled={known !== null || props.disabled}
          onCheckedChange={(next) => props.onTick(next === true)}
        />
      </TableCell>
      <TableCell className="max-w-64 truncate font-medium" title={dealLabel(deal)}>
        {dealLabel(deal)}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {deal.createdAt ? formatUbMinute(deal.createdAt) : ''}
      </TableCell>
      <TableCell className="max-w-40 truncate">{deal.creatorName ?? ''}</TableCell>
      <TableCell className="max-w-40 truncate">{deal.stageName ?? ''}</TableCell>
      <TableCell className="max-w-48 truncate">{deal.customerName ?? ''}</TableCell>
      <TableCell className="text-right tabular-nums">{deal.lines ?? ''}</TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {deal.total ? formatTugrik(deal.total) : ''}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {known === null ? (
          t('erxes.range.inBtoNew')
        ) : known.status === 'COPIED' && known.orderId !== null ? (
          <Link
            to={`/sales/orders/${known.orderId}`}
            className="text-link underline-offset-4 hover:underline"
          >
            {t('erxes.status.COPIED')}
          </Link>
        ) : (
          t(`erxes.status.${known.status}`)
        )}
      </TableCell>
    </TableRow>
  );
}

function ResultList(props: {
  title: string;
  rows: ErxesRangeResult[];
  label: (entry: ErxesRangeResult) => string;
  why: (entry: ErxesRangeResult) => string;
}) {
  if (props.rows.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="font-medium">{props.title}</p>
      <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
        {props.rows.map((entry) => (
          <li key={entry.erxesId}>
            {props.label(entry)}
            {props.why(entry) ? ` — ${props.why(entry)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
