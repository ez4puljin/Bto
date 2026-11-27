import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ListTable, SegmentedControl, TruncateCell } from '@/components/list';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type StockCountAccountChoice,
  type StockCountDetail,
  type StockCountUncounted,
  useStockCount,
  useStockCountAccountChoices,
  useStockCountMutations,
} from './counts-api';
import { useCanWrite } from './helpers';
import { DocStatusBadge } from './shared';
import { type SettlementDraft, draftOf, draftValid, inputOf } from './stock-count-helpers';
import { SettlementFields } from './stock-count-settlement';
import { CountSheet } from './stock-count-sheet';

// The count window (ADR-0176, its sheet ADR-0177): who counts, the products against the stock with
// their reasons, and «Гүйлгээ хийх», where the differences' account and party are chosen.

const UNCOUNTED: readonly StockCountUncounted[] = ['ZERO', 'LEAVE'];

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
  const [sessionsOpen, setSessionsOpen] = useState(false);

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
  const pending =
    mutations.close.isPending || mutations.reopen.isPending || mutations.cancel.isPending;
  const mayCancel = (counting && manages) || (review && approves);

  return (
    <>
      {/* One row of title and facts, so the sheet starts high in a short window (ADR-0201). */}
      <PageHeader
        dense
        title={detail.number ?? t('inventory.counts.noNumber', { id: detail.id })}
        crumbs={[{ label: t('inventory.counts.title'), to: '/inventory/counts' }]}
        actions={
          counting ? null : (
            <Button variant="outline" size="sm" onClick={() => setSessionsOpen(true)}>
              {t('inventory.counts.sessions.title')}
              <Badge variant="secondary" className="tabular-nums">
                {detail.sessions.length}
              </Badge>
            </Button>
          )
        }
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

        {/*
          While people count, who counts stands above the sheet. Once counting is closed they are
          the count's history and open from the header: the sheet, where the approver works, then
          has its first rows in a 640px window (ADR-0201).
        */}
        {counting ? <SessionsCard detail={detail} mayForce={manages} /> : null}
        <CountSheet detail={detail} mayEdit={(counting || review) && approves} />
        <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
          {sessionsOpen ? (
            <DialogContent closeLabel={t('common.close')} size="lg">
              <DialogHeader>
                <DialogTitle>{t('inventory.counts.sessions.title')}</DialogTitle>
                <DialogDescription>{t('inventory.counts.sessions.description')}</DialogDescription>
              </DialogHeader>
              <SessionsTable detail={detail} />
              <DialogFooter>
                <Button onClick={() => setSessionsOpen(false)}>{t('common.close')}</Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>

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
        <Dialog
          open={confirm === 'approve'}
          onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        >
          {confirm === 'approve' ? (
            <ApproveDialog detail={detail} onDone={() => setConfirm(null)} />
          ) : null}
        </Dialog>
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
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('inventory.counts.sessions.title')}</CardTitle>
        <CardDescription>{t('inventory.counts.sessions.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <SessionsTable
          detail={detail}
          {...(mayForce
            ? {
                onForce: (sessionId: number) => {
                  action.clear();
                  setForcing(sessionId);
                },
              }
            : {})}
        />
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

/**
 * The counters' columns: 47.5rem with «Өмнөөс нь илгээх», 36.5 without. A tablet upright's card
 * (about 39) lets the two counts of each counter go: 38.5rem (ADR-0201).
 */
const sessionColumns = (force: boolean): ColumnSpec[] => [
  { key: 'counter', kind: 'text', weight: 2, min: 7.5 },
  { key: 'started', kind: 'datetime', width: 10 },
  { key: 'sent', kind: 'text', weight: 1, min: 10 },
  { key: 'products', kind: 'count', drop: 1 },
  { key: 'entries', kind: 'count', drop: 1 },
  ...(force ? [{ key: 'force', kind: 'actions', width: 11 } as const] : []),
];

/**
 * Each counter: when they started and sent (to the minute, so the table fits a tablet's card and
 * the dialog), how much they counted. `onForce`: the manager sends for one who has not.
 */
function SessionsTable(props: { detail: StockCountDetail; onForce?: (sessionId: number) => void }) {
  const { t } = useTranslation();
  const { detail, onForce } = props;
  if (detail.sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('inventory.counts.sessions.empty')}</p>;
  }
  return (
    <ListTable columns={sessionColumns(onForce !== undefined)}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('inventory.counts.sessions.counter')}</TableHead>
          <TableHead>{t('inventory.counts.sessions.started')}</TableHead>
          <TableHead>{t('inventory.counts.sessions.sent')}</TableHead>
          <TableHead className="text-right">{t('inventory.counts.sessions.products')}</TableHead>
          <TableHead className="text-right">{t('inventory.counts.sessions.entries')}</TableHead>
          {onForce ? <TableHead /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {detail.sessions.map((row) => (
          <TableRow key={row.id}>
            <TruncateCell text={row.name} className="font-medium" />
            <TableCell className="font-mono">{formatUbMinute(row.startedAt)}</TableCell>
            <TableCell>
              {row.sentAt === null ? (
                <Badge variant="warning">{t('inventory.counts.sessions.notSent')}</Badge>
              ) : (
                <>
                  <span className="font-mono">{formatUbMinute(row.sentAt)}</span>
                  {row.sentByName && row.sentByName !== row.name ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t('inventory.counts.sessions.sentBy', { name: row.sentByName })}
                    </span>
                  ) : null}
                </>
              )}
            </TableCell>
            <TableCell className="text-right font-mono">{row.products}</TableCell>
            <TableCell className="text-right font-mono">{row.entries}</TableCell>
            {onForce ? (
              <TableCell className="text-right">
                {row.sentAt === null ? (
                  <Button size="sm" variant="outline" onClick={() => onForce(row.id)}>
                    {t('inventory.counts.sessions.sendFor')}
                  </Button>
                ) : null}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </ListTable>
  );
}

/**
 * «Гүйлгээ хийх» (ADR-0177): where the surpluses and the shortages go — an account and a party
 * each, the count's last choice offered — and what becomes of the uncounted products; then the
 * count is approved and posted.
 */
function ApproveDialog({ detail, onDone }: { detail: StockCountDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const accounts = useStockCountAccountChoices(true);
  const mutations = useStockCountMutations();
  const action = useAction();
  const [surplus, setSurplus] = useState<SettlementDraft>(() => draftOf(detail.surplus));
  const [shortage, setShortage] = useState<SettlementDraft>(() => draftOf(detail.shortage));
  const [uncounted, setUncounted] = useState<StockCountUncounted>('LEAVE');
  const choices: readonly StockCountAccountChoice[] = accounts.data ?? [];
  const pending = mutations.defaults.isPending || mutations.approve.isPending;
  const valid = draftValid(surplus) && draftValid(shortage);

  const approve = () =>
    void action.run(async () => {
      await mutations.defaults.mutateAsync({
        id: detail.id,
        surplus: inputOf(surplus),
        shortage: inputOf(shortage),
      });
      const approved = await mutations.approve.mutateAsync({ id: detail.id, uncounted });
      toast.success(t('inventory.stocktake.approved', { number: approved.number ?? '' }));
      onDone();
    });

  return (
    <DialogContent closeLabel={t('common.close')} size="lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !pending) approve();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('inventory.counts.approveTitle')}</DialogTitle>
          <DialogDescription>
            {t('inventory.counts.approveText', { count: detail.different })}
          </DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(accounts.error)} />
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">
              {t('inventory.counts.defaults.surplus')}
            </legend>
            <SettlementFields
              value={surplus}
              onChange={setSurplus}
              accounts={choices}
              mayCharge={false}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">
              {t('inventory.counts.defaults.shortage')}
            </legend>
            <SettlementFields
              value={shortage}
              onChange={setShortage}
              accounts={choices}
              mayCharge
            />
          </fieldset>
        </div>
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
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending || !valid}>
            {t('inventory.counts.approve')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
