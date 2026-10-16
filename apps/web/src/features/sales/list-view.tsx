import { ORDER_STATUSES } from '@tugeel/shared/sales';
import { ShoppingCart } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ColumnChooser } from '@/components/column-chooser';
import {
  ButtonRow,
  ChevronHead,
  EmptyState,
  ListCard,
  LoadMore,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import {
  ARCHIVED_SCOPES,
  LIST_COLUMNS,
  LIST_SCOPES,
  type ListColumn,
  type ListColumns,
  type ListFilters,
  LOCKED_COLUMNS,
} from './list-filters';
import { OrderStatusBadge, PaymentLabel } from './order-badges';
import {
  type FilterQuery,
  type ListQuery,
  type SalesPipeline,
  useOrderList,
} from './pipelines-api';

/** «Баганууд» of the list view, at the end of the work page's bar. */
export function ListColumnChooser({ columns }: { columns: ListColumns }) {
  const { t } = useTranslation();
  return (
    <ColumnChooser
      keys={LIST_COLUMNS}
      locked={LOCKED_COLUMNS}
      label={(column) => t(`sales.work.columns.${column}`)}
      hidden={columns.hidden}
      toggle={columns.toggle}
      showAll={columns.showAll}
    />
  );
}

/** The list's own pills (scope, stage, status, archive), in the work page's one filter bar. */
export function ListFilterPills({
  pipeline,
  own,
  onChange,
}: {
  pipeline: SalesPipeline | null;
  own: ListFilters;
  onChange: (next: ListFilters) => void;
}) {
  const { t } = useTranslation();
  const stages = (pipeline?.stages ?? []).filter((stage) => stage.canView);
  return (
    <>
      <NativeSelect
        variant="filter"
        aria-label={t('sales.work.scope')}
        value={own.scope}
        active={own.scope !== 'PIPELINE'}
        onChange={(event) => {
          const scope = LIST_SCOPES.find((value) => value === event.target.value) ?? 'PIPELINE';
          onChange({ ...own, scope, stageId: undefined });
        }}
      >
        {LIST_SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {t(`sales.work.scopes.${scope}`)}
          </option>
        ))}
      </NativeSelect>
      {own.scope === 'PIPELINE' ? (
        <NativeSelect
          variant="filter"
          aria-label={t('sales.boards.stage')}
          value={own.stageId ?? ''}
          onChange={(event) =>
            onChange({ ...own, stageId: Number.parseInt(event.target.value, 10) || undefined })
          }
        >
          <option value="">{t('sales.work.allStages')}</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      <NativeSelect
        variant="filter"
        aria-label={t('sales.order.status')}
        value={own.status ?? ''}
        onChange={(event) =>
          onChange({ ...own, status: ORDER_STATUSES.find((value) => value === event.target.value) })
        }
      >
        <option value="">{t('sales.orders.allStatuses')}</option>
        {ORDER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`sales.statuses.${value}`)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        variant="filter"
        aria-label={t('sales.work.archivedLabel')}
        value={own.archived}
        active={own.archived !== 'exclude'}
        onChange={(event) =>
          onChange({
            ...own,
            archived: ARCHIVED_SCOPES.find((value) => value === event.target.value) ?? 'exclude',
          })
        }
      >
        {ARCHIVED_SCOPES.map((value) => (
          <option key={value} value={value}>
            {t(`sales.work.archivedScopes.${value}`)}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * «Жагсаалтаар» (ADR-0057 #7): the pipeline's orders (or all of them, or those in no pipeline)
 * newest first with the shared filters plus stage, status and archive (their pills sit in the work
 * page's bar); the column chooser keeps each user's columns; a click on a row opens the order
 * beside the list, its number staying the keyboard's button.
 */
export function ListView({
  pipeline,
  filters,
  own,
  columns,
  openId,
  onOpen,
  onCount,
  onClearFilters,
}: {
  pipeline: SalesPipeline | null;
  filters: FilterQuery;
  own: ListFilters;
  columns: ListColumns;
  /** The order open in the panel: its row is tinted. */
  openId?: number | null;
  onOpen: (orderId: number) => void;
  onCount?: (count: number | null) => void;
  /** Offered by the empty list while filters narrow it. */
  onClearFilters?: () => void;
}) {
  const { t } = useTranslation();
  const query: ListQuery = {
    ...filters,
    ...(own.scope === 'PIPELINE' && pipeline ? { pipeline: String(pipeline.id) } : {}),
    ...(own.scope === 'NONE' ? { pipeline: 'none' } : {}),
    ...(own.scope === 'PIPELINE' && own.stageId ? { stageId: own.stageId } : {}),
    ...(own.status ? { status: own.status } : {}),
    archived: own.archived,
  };
  const orders = useOrderList(query);
  const rows = orders.data?.pages.flatMap((page) => page.data) ?? [];
  const total = orders.data?.pages[0]?.total ?? null;
  useEffect(() => {
    onCount?.(total);
  }, [total, onCount]);
  const shown = (column: ListColumn) => !columns.hidden.has(column);
  const visible = LIST_COLUMNS.filter(shown);
  const problem = problemFromError(orders.error);
  return (
    <>
      {problem ? (
        <div className="mb-3">
          <ProblemAlert problem={problem} />
        </div>
      ) : null}
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              {visible.map((column) => (
                <TableHead key={column} className={column === 'total' ? 'text-right' : undefined}>
                  {t(`sales.work.columns.${column}`)}
                </TableHead>
              ))}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.isPending ? <SkeletonRows columns={visible.length + 1} /> : null}
            {rows.map((row) => {
              const title = row.number ?? t('sales.order.draftNo', { id: row.id });
              const stage = [own.scope === 'PIPELINE' ? null : row.pipelineName, row.stageName]
                .filter(Boolean)
                .join(' · ');
              return (
                <ButtonRow key={row.id} selected={row.id === openId} onOpen={() => onOpen(row.id)}>
                  {shown('number') ? (
                    <TableCell className="font-mono">
                      <button
                        type="button"
                        className="font-medium underline-offset-4 hover:underline"
                        onClick={() => onOpen(row.id)}
                      >
                        {title}
                      </button>
                      {row.archivedAt ? (
                        <Badge variant="outline" className="ml-2">
                          {t('sales.work.archivedBadge')}
                        </Badge>
                      ) : null}
                    </TableCell>
                  ) : null}
                  {shown('customer') ? (
                    <TruncateCell
                      text={`${row.customerName} · ${row.customerCode}`}
                      fill
                      className="min-w-40"
                    >
                      {row.customerName}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {row.customerCode}
                      </span>
                    </TruncateCell>
                  ) : null}
                  {shown('stage') ? <TruncateCell text={stage} /> : null}
                  {shown('status') ? (
                    <TableCell>
                      <OrderStatusBadge status={row.status} />
                    </TableCell>
                  ) : null}
                  {shown('deliveryDate') ? (
                    <TableCell className="font-mono">{row.deliveryDate}</TableCell>
                  ) : null}
                  {shown('total') ? (
                    <TableCell className="text-right font-mono">
                      {row.total === null ? '' : formatTugrik(row.total)}
                    </TableCell>
                  ) : null}
                  {shown('payment') ? (
                    <TableCell>
                      <PaymentLabel method={row.paymentMethod} />
                    </TableCell>
                  ) : null}
                  {shown('createdBy') ? <TableCell>{row.createdByName ?? ''}</TableCell> : null}
                  {shown('channel') ? (
                    <TableCell>{t(`sales.channels.${row.channel}`)}</TableCell>
                  ) : null}
                  {shown('createdAt') ? (
                    <TableCell className="font-mono text-muted-foreground">
                      {formatUbDateTime(Date.parse(row.createdAt))}
                    </TableCell>
                  ) : null}
                </ButtonRow>
              );
            })}
          </TableBody>
        </Table>
        {!orders.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={t('sales.orders.empty')}
            onClearFilters={onClearFilters}
          />
        ) : null}
        <LoadMore query={orders} />
      </ListCard>
    </>
  );
}
