import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { EmptyState, SegmentedControl } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { cn } from '@/lib/utils';
import {
  type StockProblem,
  type StockProblemWarehouse,
  useStockProblemWarehouses,
  useStockProblems,
} from './api';
import { LegitDialog, SettingsDialog, ZeroOutDialog } from './problem-dialogs';
import { ProblemList, type RowAction } from './problem-list';
import { SheetsTab } from './sheets-tab';

const TABS = ['list', 'sheets'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Агуулах → Асуудалтай бараа» (ADR-0230): per warehouse the products whose stock the system got
 * wrong, and the morning sheets that settle them.
 */
export function StockProblemsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('stockProblems.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const tab: Tab = params.get('tab') === 'sheets' ? 'sheets' : 'list';
  const warehouses = useStockProblemWarehouses();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wanted = Number.parseInt(params.get('w') ?? '', 10);
  const all = warehouses.data ?? [];
  const current = all.find((entry) => entry.warehouseId === wanted) ?? all[0];

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('stockProblems.title')}
        description={t('stockProblems.page.description')}
        actions={
          canManage ? (
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings />
              {t('stockProblems.page.settings')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          {settingsOpen ? (
            <SettingsDialog
              warehouseId={current?.warehouseId}
              onDone={() => setSettingsOpen(false)}
            />
          ) : null}
        </Dialog>
      ) : null}
      <SegmentedControl
        name={t('stockProblems.page.tabsName')}
        options={TABS}
        value={tab}
        label={(value) => t(`stockProblems.page.tabs.${value}`)}
        onChange={(value) => setParam('tab', value === 'list' ? null : value)}
      />
      <ProblemAlert problem={problemFromError(warehouses.error)} onRetry={warehouses.refetch} />
      {warehouses.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : all.length === 0 ? (
        <EmptyState title={t('stockProblems.page.noWarehouses')} />
      ) : tab === 'list' ? (
        <ListTab
          warehouses={all}
          current={current}
          canManage={canManage}
          onPick={(id) => setParam('w', String(id))}
        />
      ) : (
        <SheetsTab warehouses={all} canManage={canManage} />
      )}
    </div>
  );
}

function ListTab(props: {
  warehouses: readonly StockProblemWarehouse[];
  current: StockProblemWarehouse | undefined;
  canManage: boolean;
  onPick: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { current } = props;
  const list = useStockProblems(current?.warehouseId);
  const [dialog, setDialog] = useState<{ row: StockProblem; action: RowAction } | null>(null);
  return (
    <>
      <div
        role="group"
        aria-label={t('stockProblems.page.warehouses')}
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2"
      >
        {props.warehouses.map((warehouse) => {
          const chosen = warehouse.warehouseId === current?.warehouseId;
          return (
            <button
              key={warehouse.warehouseId}
              type="button"
              aria-pressed={chosen}
              onClick={() => props.onPick(warehouse.warehouseId)}
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-xl bg-card p-3 text-left shadow-card ring-1 ring-black/[0.06] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11',
                chosen && 'ring-2 ring-primary',
              )}
            >
              <span className="truncate font-medium">{warehouse.warehouseName}</span>
              <span className="flex flex-wrap gap-x-3 text-[0.8125rem]">
                <span
                  className={warehouse.redCount > 0 ? 'text-destructive' : 'text-muted-foreground'}
                >
                  {t('stockProblems.group.RED')}: <b className="font-mono">{warehouse.redCount}</b>
                </span>
                <span className="text-muted-foreground">
                  {t('stockProblems.group.CUT')}: <b className="font-mono">{warehouse.cutCount}</b>
                </span>
              </span>
              {warehouse.settingsReady ? null : (
                <span className="text-xs text-warning">
                  {t('stockProblems.page.settingsNotReady')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ProblemAlert problem={problemFromError(list.error)} onRetry={list.refetch} />
      <ProblemList
        rows={list.data}
        pending={list.isPending && current !== undefined}
        canManage={props.canManage}
        onAction={(row, action) => setDialog({ row, action })}
      />
      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? null : setDialog(null))}>
        {dialog?.action === 'legit' ? (
          <LegitDialog row={dialog.row} onDone={() => setDialog(null)} />
        ) : null}
        {dialog?.action === 'zeroOut' ? (
          <ZeroOutDialog row={dialog.row} onDone={() => setDialog(null)} />
        ) : null}
      </Dialog>
    </>
  );
}
