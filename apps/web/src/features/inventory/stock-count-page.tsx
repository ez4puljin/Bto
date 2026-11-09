import { ClipboardCheck } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState, LoadMore, SearchField, SegmentedControl } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { stockDocHref } from '@/features/reports/books/book-links';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  COUNT_LINE_FILTERS,
  type StockCountAccountChoice,
  type StockCountDetail,
  type StockCountLine,
  type StockCountLineFilter,
  type StockCountSettlement,
  type StockCountUncounted,
  useStockCount,
  useStockCountAccountChoices,
  useStockCountLineEntries,
  useStockCountLineMoved,
  useStockCountLines,
  useStockCountMutations,
} from './counts-api';
import { useCanWrite } from './helpers';
import { DocStatusBadge } from './shared';
import {
  type SettlementDraft,
  draftOf,
  draftValid,
  inputOf,
  signedQty,
} from './stock-count-helpers';
import { SettlementFields, SettlementText } from './stock-count-settlement';

// The count window (ADR-0176): who counts, what was counted against the stock, where the
// differences go, and the approval.

const UNCOUNTED: readonly StockCountUncounted[] = ['ZERO', 'LEAVE'];
const isZero = (value: string) => new RegExp('^-?0(\\.0+)?$').test(value);
const time = (value: string) => formatUbDateTime(Date.parse(value));

export function StockCountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('inventory.stocktakes.manage');
  const canApprove = useHasPermission('inventory.stocktakes.approve');
  const canWrite = useCanWrite();
  const count = useStockCount(id);
  const mutations = useStockCountMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'close' | 'reopen' | 'cancel' | 'approve' | null>(null);
  const [uncounted, setUncounted] = useState<StockCountUncounted>('LEAVE');

  const loadProblem = problemFromError(count.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!count.data) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  const detail = count.data;
  const writer = canWrite(detail.warehouseId);
  const counting = detail.status === 'COUNTING';
  const review = detail.status === 'REVIEW';
  const manages = canManage && writer;
  const approves = canApprove && writer;
  const unsent = detail.sessions.filter((session) => session.sentAt === null);
  const scope = detail.scopeLabel
    ? t('inventory.counts.scopeWith', {
        scope: t(`inventory.counts.scopes.${detail.scopeMode}`),
        label: detail.scopeLabel,
      })
    : t(`inventory.counts.scopes.${detail.scopeMode}`);

  const ask = (which: NonNullable<typeof confirm>) => {
    action.clear();
    setConfirm(which);
  };
  const run = (work: () => Promise<void>) =>
    void action.run(async () => {
      await work();
      setConfirm(null);
    });
  const close = () =>
    run(async () => {
      await mutations.close.mutateAsync(detail.id);
      toast.success(t('inventory.counts.closed'));
    });
  const reopen = () =>
    run(async () => {
      await mutations.reopen.mutateAsync(detail.id);
      toast.success(t('inventory.counts.reopened'));
    });
  const cancel = () =>
    run(async () => {
      await mutations.cancel.mutateAsync(detail.id);
      await navigate('/inventory/counts');
    });
  const approve = () =>
    run(async () => {
      const approved = await mutations.approve.mutateAsync({ id: detail.id, uncounted });
      toast.success(t('inventory.stocktake.approved', { number: approved.number ?? '' }));
    });
  const pending =
    mutations.close.isPending ||
    mutations.reopen.isPending ||
    mutations.cancel.isPending ||
    mutations.approve.isPending;
  const mayCancel = (counting && manages) || (review && approves);

  return (
    <>
      <PageHeader
        title={detail.number ?? t('inventory.stocktake.noNumber', { id: detail.id })}
        crumbs={[{ label: t('inventory.counts.title'), to: '/inventory/counts' }]}
        meta={
          <>
            <DocStatusBadge status={detail.status} />
            <span className="text-foreground">{detail.warehouseName}</span>
            <span>{scope}</span>
            <span>
              {t('inventory.counts.progressLong', {
                counted: detail.counted,
                lines: detail.lines,
              })}
            </span>
            {detail.showStock ? <span>{t('inventory.counts.stockShown')}</span> : null}
            {detail.startedByName ? (
              <span>{t('inventory.counts.startedBy', { name: detail.startedByName })}</span>
            ) : null}
            {detail.effectiveDate ? (
              <span>{t('inventory.stocktake.approvedOn', { date: detail.effectiveDate })}</span>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        {detail.note ? <p className="text-sm text-muted-foreground">{detail.note}</p> : null}
        <ProblemAlert problem={confirm ? null : action.problem} />

        <SessionsCard detail={detail} mayForce={counting && manages} />
        <DefaultsCard detail={detail} mayEdit={(counting || review) && approves} />
        <LinesCard detail={detail} mayEdit={(counting || review) && approves} />

        {(counting && manages) || (review && (manages || approves)) ? (
          <StickyActions
            summary={
              counting
                ? unsent.length > 0
                  ? t('inventory.counts.unsentSummary', { count: unsent.length })
                  : t('inventory.counts.allSent')
                : t('inventory.counts.reviewSummary', {
                    different: detail.different,
                    uncounted: detail.uncountedLines,
                  })
            }
          >
            {mayCancel ? (
              <Button variant="ghost" onClick={() => ask('cancel')}>
                {t('inventory.counts.cancel')}
              </Button>
            ) : null}
            {review && manages ? (
              <Button variant="outline" onClick={() => ask('reopen')}>
                {t('inventory.counts.reopen')}
              </Button>
            ) : null}
            {counting ? (
              <Button onClick={() => ask('close')}>{t('inventory.counts.close')}</Button>
            ) : null}
            {review && approves ? (
              <Button onClick={() => ask('approve')}>{t('inventory.counts.approve')}</Button>
            ) : null}
          </StickyActions>
        ) : null}

        <ConfirmDialog
          open={confirm === 'close'}
          variant="default"
          title={t('inventory.counts.closeTitle')}
          description={
            unsent.length > 0
              ? t('inventory.counts.closeBlocked', {
                  names: unsent.map((session) => session.name).join(', '),
                })
              : t('inventory.counts.closeText')
          }
          confirmLabel={t('inventory.counts.close')}
          pending={pending}
          disabled={unsent.length > 0}
          problem={action.problem}
          onConfirm={close}
          onClose={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm === 'reopen'}
          variant="default"
          title={t('inventory.counts.reopenTitle')}
          description={t('inventory.counts.reopenText')}
          confirmLabel={t('inventory.counts.reopen')}
          pending={pending}
          problem={action.problem}
          onConfirm={reopen}
          onClose={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm === 'cancel'}
          title={t('inventory.counts.cancelTitle')}
          description={t('inventory.counts.cancelText')}
          confirmLabel={t('inventory.counts.cancel')}
          pending={pending}
          problem={action.problem}
          onConfirm={cancel}
          onClose={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm === 'approve'}
          variant="default"
          title={t('inventory.counts.approveTitle')}
          description={t('inventory.counts.approveText', { count: detail.different })}
          confirmLabel={t('inventory.counts.approve')}
          pending={pending}
          problem={action.problem}
          onConfirm={approve}
          onClose={() => setConfirm(null)}
        >
          {detail.uncountedLines > 0 ? (
            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium">
                {t('inventory.counts.uncountedAsk', { count: detail.uncountedLines })}
              </span>
              <SegmentedControl
                name={t('inventory.counts.uncountedName')}
                options={UNCOUNTED}
                value={uncounted}
                label={(value) => t(`inventory.counts.uncounted.${value}`)}
                onChange={setUncounted}
              />
              <span className="text-[0.8125rem] text-muted-foreground">
                {t(`inventory.counts.uncountedHints.${uncounted}`)}
              </span>
            </div>
          ) : null}
        </ConfirmDialog>
      </div>
    </>
  );
}

/** Who started counting, and who has not sent yet. */
function SessionsCard({ detail, mayForce }: { detail: StockCountDetail; mayForce: boolean }) {
  const { t } = useTranslation();
  const mutations = useStockCountMutations();
  const action = useAction();
  const [forcing, setForcing] = useState<number | null>(null);
  const session = detail.sessions.find((row) => row.id === forcing);
  const force = () =>
    void action.run(async () => {
      if (forcing === null) return;
      await mutations.sendFor.mutateAsync({ id: detail.id, sessionId: forcing });
      setForcing(null);
      toast.success(t('inventory.counts.sessions.sentFor'));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.counts.sessions.title')}</CardTitle>
        <CardDescription>{t('inventory.counts.sessions.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inventory.counts.sessions.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.counts.sessions.counter')}</TableHead>
                <TableHead>{t('inventory.counts.sessions.started')}</TableHead>
                <TableHead>{t('inventory.counts.sessions.sent')}</TableHead>
                <TableHead className="text-right">
                  {t('inventory.counts.sessions.products')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.counts.sessions.entries')}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.sessions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono">{time(row.startedAt)}</TableCell>
                  <TableCell>
                    {row.sentAt === null ? (
                      <Badge variant="warning">{t('inventory.counts.sessions.notSent')}</Badge>
                    ) : (
                      <span className="font-mono">
                        {time(row.sentAt)}
                        {row.sentByName && row.sentByName !== row.name ? (
                          <span className="ml-2 font-sans text-xs text-muted-foreground">
                            {t('inventory.counts.sessions.sentBy', { name: row.sentByName })}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.products}</TableCell>
                  <TableCell className="text-right font-mono">{row.entries}</TableCell>
                  <TableCell className="text-right">
                    {mayForce && row.sentAt === null ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          action.clear();
                          setForcing(row.id);
                        }}
                      >
                        {t('inventory.counts.sessions.sendFor')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={forcing !== null}
        variant="default"
        title={t('inventory.counts.sessions.sendForTitle', { name: session?.name ?? '' })}
        description={t('inventory.counts.sessions.sendForText')}
        confirmLabel={t('inventory.counts.sessions.sendFor')}
        pending={mutations.sendFor.isPending}
        problem={action.problem}
        onConfirm={force}
        onClose={() => setForcing(null)}
      />
    </Card>
  );
}

/** Where surpluses and shortages go unless a line says otherwise. */
function DefaultsCard({ detail, mayEdit }: { detail: StockCountDetail; mayEdit: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<'surplus' | 'shortage' | null>(null);
  const sides = ['surplus', 'shortage'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.counts.defaults.title')}</CardTitle>
        <CardDescription>{t('inventory.counts.defaults.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {sides.map((side) => (
          <div
            key={side}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-[0.8125rem] text-muted-foreground">
                {t(`inventory.counts.defaults.${side}`)}
              </span>
              <span className="truncate font-medium">
                <SettlementText value={detail[side]} />
              </span>
            </span>
            {mayEdit ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(side)}>
                {t('common.edit')}
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
      >
        {editing ? (
          <SettlementDialog
            key={editing}
            title={t(`inventory.counts.defaults.${editing}`)}
            description={t('inventory.counts.defaults.editText')}
            initial={detail[editing]}
            mayCharge={editing === 'shortage'}
            countId={detail.id}
            target={{ side: editing }}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

/** The account, the party and the charge of one side or one line. */
function SettlementDialog(props: {
  title: string;
  description: string;
  initial: StockCountSettlement | null;
  mayCharge: boolean;
  countId: number;
  target: { side: 'surplus' | 'shortage' } | { lineId: number; own: boolean };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const accounts = useStockCountAccountChoices(true);
  const mutations = useStockCountMutations();
  const action = useAction();
  const [draft, setDraft] = useState<SettlementDraft>(() => draftOf(props.initial));
  const pending = mutations.defaults.isPending || mutations.lineSettlement.isPending;
  const choices: readonly StockCountAccountChoice[] = accounts.data ?? [];

  const save = (clear: boolean) =>
    void action.run(async () => {
      if ('side' in props.target) {
        await mutations.defaults.mutateAsync({
          id: props.countId,
          [props.target.side]: clear ? null : inputOf(draft),
        });
      } else {
        await mutations.lineSettlement.mutateAsync({
          id: props.countId,
          lineId: props.target.lineId,
          settlement: clear ? null : inputOf(draft),
        });
      }
      toast.success(t('inventory.counts.settlement.saved'));
      props.onDone();
    });

  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftValid(draft) && !pending) save(false);
        }}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(accounts.error)} />
        <SettlementFields
          value={draft}
          onChange={setDraft}
          accounts={choices}
          mayCharge={props.mayCharge}
        />
        <DialogFooter>
          {'lineId' in props.target && props.target.own ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              disabled={pending}
              onClick={() => save(true)}
            >
              {t('inventory.counts.settlement.useDefault')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={props.onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending || !draftValid(draft)}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Every product of the count: the stock at its first count, what was counted, by whom. */
function LinesCard({ detail, mayEdit }: { detail: StockCountDetail; mayEdit: boolean }) {
  const { t } = useTranslation();
  const seesCost = useHasPermission('inventory.costs.manage');
  const [filter, setFilter] = useState<StockCountLineFilter>('ALL');
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const lines = useStockCountLines(detail.id, filter, q, detail.status === 'COUNTING');
  const rows = lines.data?.pages.flatMap((page) => page.data) ?? [];
  const [openId, setOpenId] = useState<number | null>(null);
  const opened = rows.find((row) => row.id === openId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.counts.lines.title')}</CardTitle>
        <CardDescription>{t('inventory.counts.lines.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            name={t('inventory.counts.lines.filter')}
            options={COUNT_LINE_FILTERS}
            value={filter}
            label={(value) => t(`inventory.counts.lines.filters.${value}`)}
            onChange={setFilter}
          />
          <SearchField
            aria-label={t('common.search')}
            placeholder={t('inventory.counts.searchProduct')}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <ProblemAlert problem={problemFromError(lines.error)} onRetry={lines.refetch} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.product')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.expected')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.counted')}</TableHead>
              <TableHead className="text-right">{t('inventory.counts.difference')}</TableHead>
              <TableHead>{t('inventory.counts.lines.counters')}</TableHead>
              <TableHead>{t('inventory.counts.settlementHead')}</TableHead>
              {seesCost ? (
                <TableHead className="text-right">{t('inventory.counts.unitCost')}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => setOpenId(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setOpenId(row.id);
                }}
              >
                <TableCell>
                  <span className="font-medium">{row.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.sku}</span>
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {row.listed ? null : (
                      <Badge variant="outline">{t('inventory.counts.lines.unlisted')}</Badge>
                    )}
                    {isZero(row.movedDuring) ? null : (
                      <Badge variant="secondary">
                        {t('inventory.counts.lines.movedDuring', {
                          qty: signedQty(row.movedDuring),
                        })}
                      </Badge>
                    )}
                    {isZero(row.movedAfter) ? null : (
                      <Badge variant="warning">
                        {t('inventory.counts.lines.movedAfter', { qty: signedQty(row.movedAfter) })}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.expectedQty === null ? '' : formatQty(row.expectedQty)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.countedQty === null ? '' : formatQty(row.countedQty)}
                  {isZero(row.pendingQty) ? null : (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {t('inventory.counts.lines.pending', { qty: formatQty(row.pendingQty) })}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={
                    row.differenceQty?.startsWith('-')
                      ? 'text-right font-mono font-medium text-destructive'
                      : 'text-right font-mono font-medium'
                  }
                >
                  {row.differenceQty === null ? '' : signedQty(row.differenceQty)}
                </TableCell>
                <TableCell className="text-[0.8125rem]">
                  {row.counters
                    .map((counter) =>
                      t('inventory.counts.lines.counter', {
                        name: counter.name,
                        qty: formatQty(counter.qty),
                      }),
                    )
                    .join(', ')}
                </TableCell>
                <TableCell className="text-[0.8125rem]">
                  {row.differenceQty === null || isZero(row.differenceQty) ? null : (
                    <>
                      <SettlementText value={row.settlement} />
                      {row.chargeAmount === null ? null : (
                        <span className="ml-2 font-mono">{formatMnt(row.chargeAmount)}</span>
                      )}
                    </>
                  )}
                </TableCell>
                {seesCost ? (
                  <TableCell className="text-right font-mono">
                    {row.unitCost === null ? '' : formatMnt(row.unitCost)}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!lines.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={
              detail.scopeMode === 'SCANNED' && filter === 'ALL' && q === ''
                ? t('inventory.counts.lines.emptyScanned')
                : t('inventory.counts.lines.empty')
            }
          />
        ) : null}
        <LoadMore query={lines} />
      </CardContent>
      <Dialog
        open={opened !== undefined}
        onOpenChange={(open) => (open ? undefined : setOpenId(null))}
      >
        {opened ? (
          <LineDialog
            detail={detail}
            line={opened}
            mayEdit={mayEdit}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

/** One product: each entry of each counter, the documents that moved it, and where its difference goes. */
function LineDialog(props: {
  detail: StockCountDetail;
  line: StockCountLine;
  mayEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { detail, line } = props;
  const entries = useStockCountLineEntries(detail.id, line.id);
  const moved = useStockCountLineMoved(detail.id, line.id);
  const [settling, setSettling] = useState(false);
  const different = line.differenceQty !== null && !isZero(line.differenceQty);

  if (settling) {
    return (
      <SettlementDialog
        title={line.name}
        description={t('inventory.counts.settlement.lineText')}
        initial={line.settleOwn ? line.settlement : null}
        mayCharge={line.differenceQty?.startsWith('-') ?? false}
        countId={detail.id}
        target={{ lineId: line.id, own: line.settleOwn }}
        onDone={() => setSettling(false)}
      />
    );
  }
  return (
    <DialogContent closeLabel={t('common.close')} size="xl">
      <DialogHeader>
        <DialogTitle>{line.name}</DialogTitle>
        <DialogDescription>
          {t('inventory.counts.line.summary', {
            sku: line.sku,
            unit: line.unitName,
            expected: line.expectedQty === null ? '–' : formatQty(line.expectedQty),
            counted: line.countedQty === null ? '–' : formatQty(line.countedQty),
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <ProblemAlert problem={problemFromError(entries.error) ?? problemFromError(moved.error)} />
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('inventory.counts.line.entries')}</h3>
          {(entries.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {entries.isPending ? t('common.loading') : t('inventory.counts.line.noEntries')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.date')}</TableHead>
                  <TableHead>{t('inventory.counts.sessions.counter')}</TableHead>
                  <TableHead className="text-right">{t('inventory.counts.line.entered')}</TableHead>
                  <TableHead className="text-right">{t('inventory.counts.line.base')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries.data ?? []).map((entry) => (
                  <TableRow key={entry.id} className={entry.voided ? 'opacity-60' : undefined}>
                    <TableCell className="font-mono">{time(entry.createdAt)}</TableCell>
                    <TableCell>{entry.userName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {`${formatQty(entry.enteredQty)} ${entry.unitName}`}
                    </TableCell>
                    <TableCell
                      className={
                        entry.voided ? 'text-right font-mono line-through' : 'text-right font-mono'
                      }
                    >
                      {formatQty(entry.qtyBase)}
                    </TableCell>
                    <TableCell>
                      {entry.voided ? (
                        <Badge variant="outline">{t('inventory.counts.line.voided')}</Badge>
                      ) : entry.sent ? null : (
                        <Badge variant="warning">{t('inventory.counts.sessions.notSent')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('inventory.counts.line.moved')}</h3>
          {(moved.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {moved.isPending ? t('common.loading') : t('inventory.counts.line.noMoved')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.date')}</TableHead>
                  <TableHead>{t('inventory.counts.line.document')}</TableHead>
                  <TableHead className="text-right">{t('inventory.qty')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(moved.data ?? []).map((doc) => {
                  const href = stockDocHref(doc.docType, doc.docId);
                  const label = `${t(`inventory.movements.docTypes.${doc.docType}`, {
                    defaultValue: doc.docType,
                  })} ${doc.number ?? ''}`.trim();
                  return (
                    <TableRow key={`${doc.docType}-${doc.docId}`}>
                      <TableCell className="font-mono">
                        {t('inventory.counts.line.movedDate', {
                          date: doc.effectiveDate,
                          posted: time(doc.postedAt),
                        })}
                      </TableCell>
                      <TableCell>
                        {href ? (
                          <Link
                            to={href}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{signedQty(doc.qty)}</TableCell>
                      <TableCell>
                        {doc.afterApproval ? (
                          <Badge variant="warning">
                            {t('inventory.counts.line.afterApproval')}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
        {different ? (
          <section className="flex flex-col gap-1 text-sm">
            <h3 className="font-medium">{t('inventory.counts.settlementHead')}</h3>
            <span>
              <SettlementText value={line.settlement} />
              {line.settleOwn ? null : (
                <span className="ml-2 text-[0.8125rem] text-muted-foreground">
                  {t('inventory.counts.settlement.fromDefault')}
                </span>
              )}
            </span>
          </section>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" asChild className="mr-auto">
          <Link
            to={`/inventory/movements?product=${line.productId}&warehouse=${detail.warehouseId}`}
          >
            {t('inventory.counts.line.report')}
          </Link>
        </Button>
        {props.mayEdit && different ? (
          <Button variant="outline" onClick={() => setSettling(true)}>
            {t('inventory.counts.settlement.edit')}
          </Button>
        ) : null}
        <Button onClick={props.onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
