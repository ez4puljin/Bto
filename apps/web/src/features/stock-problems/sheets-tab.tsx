import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  DateFilter,
  FilterBar,
  LinkRow,
  ChevronHead,
  EmptyState,
  ListCard,
  ListTable,
  LoadMore,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  SHEET_STATUSES,
  type SheetStatus,
  type StockProblemWarehouse,
  useStockProblemMutations,
  useStockProblemSheets,
} from './api';
import { sheetPath } from './helpers';
import { SheetStatusBadge } from './sheet-status';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date' },
  { key: 'warehouse', kind: 'text', weight: 1 },
  { key: 'progress', kind: 'count', width: 7 },
  { key: 'status', kind: 'status' },
  { key: 'builtBy', kind: 'text', weight: 1, drop: 1 },
  { key: 'approved', kind: 'datetime', drop: 2 },
  { key: 'chevron', kind: 'chevron' },
];

const isStatus = (value: string | null): value is SheetStatus =>
  SHEET_STATUSES.some((status) => status === value);

/** «Өглөөний жагсаалт»: the sheets, newest first, and «Одоо гаргах». */
export function SheetsTab(props: {
  warehouses: readonly StockProblemWarehouse[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const warehouseParam = Number.parseInt(params.get('sw') ?? '', 10);
  const warehouseId = Number.isNaN(warehouseParam) ? undefined : warehouseParam;
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const sheetDate = params.get('date') ?? undefined;
  const sheets = useStockProblemSheets({ warehouseId, status, sheetDate });
  const rows = sheets.data?.pages.flatMap((page) => page.data) ?? [];
  const mutations = useStockProblemMutations();
  const action = useAction();
  const build = () =>
    void action.run(async () => {
      const made = await mutations.build.mutateAsync({ key: randomUuid(), warehouseId });
      toast.success(
        made.length > 0 ? t('stockProblems.sheets.built') : t('stockProblems.sheets.builtNone'),
      );
    });
  return (
    <>
      <FilterBar
        end={
          props.canManage ? (
            <Button onClick={build} disabled={mutations.build.isPending}>
              <ListChecks />
              {t('stockProblems.sheets.build')}
            </Button>
          ) : null
        }
      >
        <NativeSelect
          variant="filter"
          aria-label={t('stockProblems.sheets.columns.warehouse')}
          value={warehouseId ?? ''}
          onChange={(event) => setParam('sw', event.target.value)}
        >
          <option value="">{t('stockProblems.sheets.allWarehouses')}</option>
          {props.warehouses.map((warehouse) => (
            <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
              {warehouse.warehouseName}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('stockProblems.sheets.columns.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('stockProblems.sheets.allStatuses')}</option>
          {SHEET_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`stockProblems.sheet.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <DateFilter
          label={t('stockProblems.sheets.date')}
          value={sheetDate}
          onChange={(value) => setParam('date', value)}
        />
      </FilterBar>
      <ProblemAlert
        problem={action.problem ?? problemFromError(sheets.error)}
        onRetry={sheets.refetch}
      />
      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('stockProblems.sheets.columns.date')}</TableHead>
              <TableHead>{t('stockProblems.sheets.columns.warehouse')}</TableHead>
              <TableHead className="text-right">
                {t('stockProblems.sheets.columns.progress')}
              </TableHead>
              <TableHead>{t('stockProblems.sheets.columns.status')}</TableHead>
              <TableHead>{t('stockProblems.sheets.columns.builtBy')}</TableHead>
              <TableHead>{t('stockProblems.sheets.columns.approved')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheets.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={sheetPath(row.id)}>
                <TableCell className="font-mono">
                  <Link
                    to={sheetPath(row.id)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.sheetDate}
                  </Link>
                </TableCell>
                <TableCell>{row.warehouseName}</TableCell>
                <TableCell className="text-right font-mono">
                  {t('stockProblems.sheets.progress', {
                    counted: row.countedCount,
                    lines: row.lineCount,
                  })}
                </TableCell>
                <TableCell>
                  <SheetStatusBadge status={row.status} />
                </TableCell>
                <TableCell>{row.builtByName ?? t('stockProblems.sheets.job')}</TableCell>
                <TableCell className="font-mono">
                  {row.approvedAt ? formatUbMinute(row.approvedAt) : ''}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!sheets.isPending && rows.length === 0 ? (
          <EmptyState title={t('stockProblems.sheets.empty')} />
        ) : null}
        <LoadMore query={sheets} />
      </ListCard>
    </>
  );
}
