import { Download, Inbox, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  LoadMore,
  SegmentedControl,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ErxesDealRow,
  type ErxesDealStatus,
  useErxesDealActions,
  useErxesDeals,
  useErxesSettings,
} from './api';
import { ErxesDealDialog } from './erxes-deal-dialog';
import { ErxesSettingsDialog } from './erxes-settings-dialog';
import { FAILURE_KEYS, useIssueText } from './erxes-texts';

const STATUSES: readonly ErxesDealStatus[] = ['WAITING', 'COPIED', 'DISMISSED'];

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'deal', kind: 'text', weight: 3, min: 12 },
  { key: 'pipeline', kind: 'text', weight: 2, min: 9 },
  { key: 'creator', kind: 'text', weight: 2, min: 8 },
  { key: 'createdAt', kind: 'datetime', width: 10 },
  { key: 'reason', kind: 'text', weight: 4, min: 14 },
  { key: 'chevron', kind: 'chevron' },
];

const isStatus = (value: string | null): value is ErxesDealStatus =>
  (STATUSES as readonly string[]).includes(value ?? '');

/**
 * «Erxes-ээс ирсэн» (ADR-0218): the deals of erxes's ticked pipelines. A deal that found its
 * customer and products is a draft order already; one that did not waits here with its reason
 * until a person chooses what is missing and presses «Bto руу хуулах». «Одоо татах» pulls at
 * once instead of waiting for the next minute. Nothing here writes to erxes.
 */
export function ErxesPage() {
  const { t } = useTranslation();
  const canSet = useHasPermission('sales.boards.manage');
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status: ErxesDealStatus = isStatus(statusParam) ? statusParam : 'WAITING';
  const dealId = Number.parseInt(params.get('deal') ?? '', 10);
  const settingsOpen = params.get('settings') === '1' && canSet;
  const settings = useErxesSettings(canSet);
  const deals = useErxesDeals(status);
  const actions = useErxesDealActions();
  const action = useAction();
  const issueText = useIssueText();
  const rows = deals.data?.pages.flatMap((page) => page.data) ?? [];
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

  const pull = () =>
    void action.run(async () => {
      const result = await actions.pull.mutateAsync();
      if (result.ok) {
        toast.success(
          t('erxes.pulled', {
            seen: result.seen,
            copied: result.copied,
            waiting: result.waiting,
          }),
        );
      } else {
        toast.warning(
          t('erxes.pullFailed', {
            reason: t(`erxes.failure.${FAILURE_KEYS[result.failure ?? 'INTERNAL']}`),
          }),
        );
      }
    });

  const state = settings.data;
  return (
    <div>
      <PageHeader
        title={t('erxes.title')}
        description={t('erxes.description')}
        actions={
          <>
            {canSet ? (
              <Button variant="outline" onClick={() => patch({ settings: '1' })}>
                <Settings2 />
                {t('erxes.settings.open')}
              </Button>
            ) : null}
            <Button pending={actions.pull.isPending} onClick={pull}>
              <Download />
              {actions.pull.isPending ? t('erxes.pulling') : t('erxes.pullNow')}
            </Button>
          </>
        }
      />
      <ProblemAlert
        problem={problemFromError(deals.error) ?? action.problem}
        onRetry={deals.error ? deals.refetch : undefined}
      />
      {state && !state.complete ? (
        <Alert className="mb-4">
          <AlertDescription>{t('erxes.notConfigured')}</AlertDescription>
        </Alert>
      ) : state && !state.enabled ? (
        <Alert className="mb-4">
          <AlertDescription>{t('erxes.off')}</AlertDescription>
        </Alert>
      ) : null}
      {state?.lastFailure ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {t('erxes.lastFailure', {
              at: state.lastPullAt ? formatUbMinute(state.lastPullAt) : '',
              reason: t(`erxes.failure.${FAILURE_KEYS[state.lastFailure]}`),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <FilterBar>
        <SegmentedControl
          name={t('erxes.statusLabel')}
          options={STATUSES}
          value={status}
          label={(value) =>
            value === 'WAITING' && state
              ? t('erxes.statusCount', { status: t('erxes.status.WAITING'), count: state.waiting })
              : t(`erxes.status.${value}`)
          }
          onChange={(value) => patch({ status: value === 'WAITING' ? null : value })}
        />
        {state ? (
          <p className="text-sm text-muted-foreground">
            {state.lastOkAt
              ? t('erxes.lastPull', { at: formatUbMinute(state.lastOkAt) })
              : t('erxes.neverPulled')}
          </p>
        ) : null}
      </FilterBar>

      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('erxes.column.deal')}</TableHead>
              <TableHead>{t('erxes.column.pipeline')}</TableHead>
              <TableHead>{t('erxes.column.creator')}</TableHead>
              <TableHead>{t('erxes.column.createdAt')}</TableHead>
              <TableHead>
                {t(status === 'COPIED' ? 'erxes.column.order' : 'erxes.column.reason')}
              </TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.isPending ? <SkeletonRows columns={COLUMNS.length} /> : null}
            {rows.map((row) => (
              <DealRow
                key={row.id}
                deal={row}
                reason={row.issues.map(issueText).join('; ')}
                onOpen={() => patch({ deal: String(row.id) })}
              />
            ))}
          </TableBody>
        </ListTable>
        {!deals.isPending && rows.length === 0 ? (
          <EmptyState icon={Inbox} title={t(`erxes.empty.${status}`)} />
        ) : null}
        <LoadMore query={deals} />
      </ListCard>

      {Number.isInteger(dealId) && dealId > 0 ? (
        <ErxesDealDialog id={dealId} onClose={() => patch({ deal: null })} />
      ) : null}
      {settingsOpen ? <ErxesSettingsDialog onClose={() => patch({ settings: null })} /> : null}
    </div>
  );
}

function DealRow(props: { deal: ErxesDealRow; reason: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const { deal } = props;
  return (
    <ButtonRow onOpen={props.onOpen}>
      <TruncateCell text={deal.name ?? deal.erxesId} className="font-medium">
        <button type="button" className="text-left hover:underline" onClick={props.onOpen}>
          {[deal.number, deal.name ?? deal.erxesId].filter(Boolean).join(' · ')}
        </button>
      </TruncateCell>
      <TruncateCell text={deal.pipelineName ?? ''} className="text-muted-foreground" />
      <TruncateCell text={deal.creatorName ?? ''} />
      <TableCell className="tabular-nums">
        {deal.erxesCreatedAt ? formatUbMinute(deal.erxesCreatedAt) : ''}
      </TableCell>
      {deal.status === 'COPIED' && deal.orderId !== null ? (
        <TableCell>
          <Link
            to={`/sales/orders/${deal.orderId}`}
            className="text-link underline-offset-4 hover:underline"
          >
            {t('erxes.openOrder')}
          </Link>
        </TableCell>
      ) : (
        <TruncateCell text={props.reason} className="text-muted-foreground" />
      )}
    </ButtonRow>
  );
}
