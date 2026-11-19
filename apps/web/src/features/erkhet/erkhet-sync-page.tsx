import {
  ERKHET_ISSUES_OF,
  ERKHET_LIMITS,
  ERKHET_SYNC_KINDS,
  erkhetIssueAppliable,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
import { ArrowLeftRight, RefreshCw, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ErkhetItem,
  type ErkhetListSummary,
  type ErkhetRun,
  useErkhetActions,
  useErkhetItems,
  useErkhetOverview,
} from './api';
import { ErkhetLedgerPanel } from './erkhet-ledger-panel';
import { ErkhetSettingsDialog } from './erkhet-settings-dialog';

const CUSTOMER_COLUMNS: readonly ColumnSpec[] = [
  { key: 'erkhetCode', kind: 'code' },
  { key: 'erkhetName', kind: 'text', weight: 3, min: 12 },
  { key: 'erkhetGroup', kind: 'text', weight: 2, min: 9 },
  { key: 'btoCode', kind: 'code' },
  { key: 'btoName', kind: 'text', weight: 3, min: 12 },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
];

const PRODUCT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'erkhetCode', kind: 'code' },
  { key: 'erkhetName', kind: 'text', weight: 3, min: 12 },
  { key: 'erkhetBarcodes', kind: 'text', weight: 2, min: 9 },
  { key: 'erkhetPrice', kind: 'money' },
  { key: 'btoCode', kind: 'code' },
  { key: 'btoName', kind: 'text', weight: 3, min: 12 },
  { key: 'btoPrice', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
];

/** The page's two parts: the check of customers and items, and the copy of the ledgers (ADR-0219). */
const PARTS = ['check', 'ledger'] as const;

const isKind = (value: string | null): value is ErkhetSyncKind =>
  (ERKHET_SYNC_KINDS as readonly string[]).includes(value ?? '');

const summaryOf = (run: ErkhetRun | null, kind: ErkhetSyncKind): ErkhetListSummary | null =>
  run?.summary ? (kind === 'CUSTOMER' ? run.summary.customers : run.summary.products) : null;

const countOf = (summary: ErkhetListSummary | null, issue: ErkhetSyncIssue): number =>
  summary?.issues[issue] ?? 0;

/** What «Bto-д тааруулах» does for an issue; null where a person has to settle it. */
function applyAction(
  kind: ErkhetSyncKind,
  issue: ErkhetSyncIssue,
): 'addCustomers' | 'renameCustomers' | 'setPrices' | null {
  if (!erkhetIssueAppliable(kind, issue)) return null;
  if (kind === 'PRODUCT') return 'setPrices';
  return issue === 'MISSING_IN_BTO' ? 'addCustomers' : 'renameCustomers';
}

type FailureKey =
  | 'loginFailed'
  | 'companyUnreachable'
  | 'unreachable'
  | 'timeout'
  | 'notConfigured'
  | 'keyUnreadable'
  | 'unexpectedFile'
  | 'interrupted'
  | 'internal'
  | 'unexpectedAnswer';

/** The Bto record a row points at; an ambiguous item points at several, so at none. */
function btoLink(item: ErkhetItem): string | null {
  if (item.btoId === null) return null;
  return item.kind === 'CUSTOMER'
    ? `/partners/customers/${item.btoId}`
    : `/catalog/products/${item.btoId}`;
}

/**
 * «Эрхэт тулгалт» (ADR-0203): Erkhet's customers and items against Bto's while Erkhet is still the
 * books. Customers are matched by code, items by barcode. «Шалгах» starts a check in the
 * background and the page shows the latest finished one; «Bto-д тааруулах» brings Bto to Erkhet
 * for one kind of difference. Nothing here writes to Erkhet.
 */
export function ErkhetSyncPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('erkhet.sync.manage');
  const canSet = useHasPermission('erkhet.settings.manage');
  const [params, setParams] = useSearchParams();
  const overview = useErkhetOverview();
  const actions = useErkhetActions();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const settingsOpen = params.get('settings') === '1' && canSet;
  const part = params.get('part') === 'ledger' ? 'ledger' : 'check';

  const kindParam = params.get('kind');
  const kind: ErkhetSyncKind = isKind(kindParam) ? kindParam : 'CUSTOMER';
  const issues = ERKHET_ISSUES_OF[kind];
  const issueParam = params.get('issue');
  const issue = issues.find((one) => one === issueParam) ?? issues[0] ?? 'MISSING_IN_BTO';
  const q = params.get('q') ?? '';
  const open = params.get('open') === '1';
  const patch = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const state = overview.data;
  const latest = state?.latest ?? null;
  const summary = summaryOf(latest, kind);
  const items = useErkhetItems({ runId: latest?.id ?? null, kind, issue, q, open });
  const rows = items.data?.pages.flatMap((page) => page.data) ?? [];
  const openRows = rows.filter((row) => row.resolution === null).length;
  const applying = canManage ? applyAction(kind, issue) : null;
  const columns = kind === 'CUSTOMER' ? CUSTOMER_COLUMNS : PRODUCT_COLUMNS;
  const running = Boolean(state?.active) || actions.start.isPending;

  const start = () =>
    void action.run(async () => {
      await actions.start.mutateAsync();
      toast.success(t('erkhet.started'));
    });
  const apply = async () => {
    const done = await action.run(async () => {
      const result = await actions.apply.mutateAsync({ kind, issue });
      toast.success(t('erkhet.apply.done', { count: result.applied }));
      if (result.stale + result.refused > 0) {
        toast.warning(t('erkhet.apply.left', { stale: result.stale, refused: result.refused }));
      }
    });
    if (done) setConfirming(false);
  };

  return (
    <div>
      <PageHeader
        title={t('erkhet.title')}
        description={t('erkhet.description')}
        actions={
          <>
            {canSet ? (
              <Button variant="outline" onClick={() => patch({ settings: '1' })}>
                <Settings2 />
                {t('erkhet.settings.open')}
              </Button>
            ) : null}
            {canManage && part === 'check' ? (
              <Button pending={running} disabled={!state?.configured} onClick={start}>
                <RefreshCw />
                {running ? t('erkhet.running') : t('erkhet.start')}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4">
        <SegmentedControl
          name={t('erkhet.partLabel')}
          options={PARTS}
          value={part}
          label={(value) => t(`erkhet.part.${value}`)}
          onChange={(value) => patch({ part: value === 'ledger' ? value : null })}
        />
      </div>
      {part === 'check' ? (
        <ProblemAlert
          problem={problemFromError(overview.error ?? items.error) ?? action.problem}
          onRetry={overview.error ? overview.refetch : undefined}
        />
      ) : null}
      {state && !state.configured ? (
        <Alert className="mb-4">
          <AlertDescription>
            {t(canSet ? 'erkhet.notConfigured' : 'erkhet.notConfiguredReader')}
          </AlertDescription>
        </Alert>
      ) : null}
      {part === 'ledger' ? <ErkhetLedgerPanel /> : null}
      {part === 'check' ? (
        <>
          {state?.failed ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {t('erkhet.failed', {
                  at: formatUbMinute(state.failed.finishedAt ?? state.failed.createdAt),
                  reason: t(`erkhet.failure.${failureKey(state.failed.failure)}`),
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SegmentedControl
              name={t('erkhet.kindLabel')}
              options={ERKHET_SYNC_KINDS}
              value={kind}
              label={(value) => t(`erkhet.kind.${value}`)}
              onChange={(value) => patch({ kind: value, issue: null, q: null })}
            />
            <p className="text-sm text-muted-foreground">
              {latest
                ? t(
                    latest.trigger === 'NIGHTLY'
                      ? 'erkhet.checkedNightly'
                      : latest.startedBy
                        ? 'erkhet.checkedBy'
                        : 'erkhet.checkedAt',
                    {
                      at: formatUbMinute(latest.finishedAt ?? latest.createdAt),
                      name: latest.startedBy ?? '',
                    },
                  )
                : state
                  ? t('erkhet.neverChecked')
                  : null}
            </p>
          </div>

          {summary ? (
            <dl className="mb-3 grid grid-cols-2 gap-2 @container sm:grid-cols-4">
              <Stat label={t('erkhet.stat.erkhet')} value={summary.erkhet} />
              <Stat label={t(`erkhet.stat.bto.${kind}`)} value={summary.bto} />
              <Stat label={t('erkhet.stat.agreed')} value={summary.agreed} tone="success" />
              <Stat
                label={t('erkhet.stat.differ')}
                value={Object.values(summary.issues).reduce((sum, count) => sum + (count ?? 0), 0)}
                tone="warning"
              />
            </dl>
          ) : null}

          <FilterBar
            end={
              applying && latest ? (
                <Button
                  variant="secondary"
                  disabled={openRows === 0 || running}
                  onClick={() => setConfirming(true)}
                >
                  <ArrowLeftRight />
                  {t(`erkhet.apply.button.${applying}`)}
                </Button>
              ) : null
            }
          >
            <SegmentedControl
              name={t('erkhet.issueLabel')}
              options={issues}
              value={issue}
              label={(value) =>
                t('erkhet.issueCount', {
                  issue: t(`erkhet.issue.${value}`),
                  count: formatCount(countOf(summary, value)),
                })
              }
              onChange={(value) => patch({ issue: value })}
            />
            <SearchField
              aria-label={t('common.search')}
              placeholder={t(`erkhet.search.${kind}`)}
              value={q}
              onChange={(event) => patch({ q: event.target.value })}
            />
            <FilterToggle
              label={t('erkhet.openOnly')}
              checked={open}
              onCheckedChange={(checked) => patch({ open: checked ? '1' : null })}
            />
          </FilterBar>
          <p className="mb-2 text-sm text-muted-foreground">{t(`erkhet.issueHelp.${issue}`)}</p>

          <ListCard scroll>
            <ListTable columns={columns}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('erkhet.column.erkhetCode')}</TableHead>
                  <TableHead>{t('erkhet.column.erkhetName')}</TableHead>
                  <TableHead>
                    {t(kind === 'CUSTOMER' ? 'erkhet.column.group' : 'erkhet.column.barcodes')}
                  </TableHead>
                  {kind === 'PRODUCT' ? (
                    <TableHead className="text-right">{t('erkhet.column.erkhetPrice')}</TableHead>
                  ) : null}
                  <TableHead>{t('erkhet.column.btoCode')}</TableHead>
                  <TableHead>{t('erkhet.column.btoName')}</TableHead>
                  {kind === 'PRODUCT' ? (
                    <TableHead className="text-right">{t('erkhet.column.btoPrice')}</TableHead>
                  ) : null}
                  <TableHead>{t('erkhet.column.status')}</TableHead>
                  <SpacerHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.isPending && latest ? <SkeletonRows columns={columns.length} /> : null}
                {rows.map((row) => (
                  <ItemRow key={row.id} item={row} />
                ))}
              </TableBody>
            </ListTable>
            {!latest && state ? (
              <EmptyState icon={ArrowLeftRight} title={t('erkhet.emptyNoCheck')} />
            ) : !items.isPending && rows.length === 0 ? (
              <EmptyState
                icon={ArrowLeftRight}
                title={t(q || open ? 'erkhet.emptyFiltered' : 'erkhet.emptyIssue')}
                onClearFilters={q || open ? () => patch({ q: null, open: null }) : undefined}
              />
            ) : null}
            <LoadMore query={items} />
          </ListCard>

          {applying ? (
            <ConfirmDialog
              open={confirming}
              title={t(`erkhet.apply.button.${applying}`)}
              description={t(`erkhet.apply.confirm.${applying}`, { max: ERKHET_LIMITS.maxApply })}
              confirmLabel={t('erkhet.apply.confirmLabel')}
              pending={actions.apply.isPending}
              problem={action.problem}
              onConfirm={() => void apply()}
              onClose={() => setConfirming(false)}
            />
          ) : null}
        </>
      ) : null}
      {settingsOpen ? <ErkhetSettingsDialog onClose={() => patch({ settings: null })} /> : null}
    </div>
  );
}

function failureKey(failure: ErkhetRun['failure']): FailureKey {
  switch (failure) {
    case 'LOGIN_FAILED':
      return 'loginFailed';
    case 'COMPANY_UNREACHABLE':
      return 'companyUnreachable';
    case 'UNREACHABLE':
      return 'unreachable';
    case 'TIMEOUT':
      return 'timeout';
    case 'NOT_CONFIGURED':
      return 'notConfigured';
    case 'KEY_UNREADABLE':
      return 'keyUnreadable';
    case 'UNEXPECTED_FILE':
      return 'unexpectedFile';
    case 'INTERRUPTED':
      return 'interrupted';
    case 'INTERNAL':
      return 'internal';
    default:
      return 'unexpectedAnswer';
  }
}

function Stat(props: { label: string; value: number; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.tone === 'success'
            ? 'text-xl font-semibold tabular-nums text-success'
            : props.tone === 'warning' && props.value > 0
              ? 'text-xl font-semibold tabular-nums text-warning'
              : 'text-xl font-semibold tabular-nums'
        }
      >
        {formatCount(props.value)}
      </dd>
    </div>
  );
}

function ItemRow({ item }: { item: ErkhetItem }) {
  const { t } = useTranslation();
  const link = btoLink(item);
  const product = item.kind === 'PRODUCT';
  return (
    <TableRow>
      <TableCell className="tabular-nums">{item.erkhetCode ?? ''}</TableCell>
      <TruncateCell text={item.erkhetName ?? ''} className="font-medium" />
      <TruncateCell
        text={(product ? item.erkhetBarcodes : item.erkhetGroup) ?? ''}
        className="text-muted-foreground"
      />
      {product ? (
        <TableCell className="text-right tabular-nums">
          {item.erkhetPrice === null ? '' : formatMnt(item.erkhetPrice)}
        </TableCell>
      ) : null}
      <TableCell className="tabular-nums">{item.btoCode ?? ''}</TableCell>
      <TruncateCell text={item.btoName ?? ''}>
        {link && item.btoName ? (
          <Link to={link} className="text-link underline-offset-4 hover:underline">
            {item.btoName}
          </Link>
        ) : undefined}
      </TruncateCell>
      {product ? (
        <TableCell className="text-right tabular-nums">
          {item.btoPrice === null ? '' : formatMnt(item.btoPrice)}
        </TableCell>
      ) : null}
      <TableCell>
        {item.resolution ? (
          <Badge
            variant={
              item.resolution === 'APPLIED'
                ? 'success'
                : item.resolution === 'STALE'
                  ? 'warning'
                  : 'destructive'
            }
          >
            {t(`erkhet.resolution.${item.resolution}`)}
          </Badge>
        ) : null}
      </TableCell>
      <SpacerCell />
    </TableRow>
  );
}
