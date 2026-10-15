import { ORDER_STATUSES } from '@tugeel/shared/sales';
import { ShoppingCart } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ColumnChooser } from '@/components/column-chooser';
import { EmptyState, FilterBar, ListCard, LoadMore, SkeletonRows } from '@/components/list';
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
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import type { OrderStatus } from './api';
import { OrderStatusBadge, PaymentLabel } from './orders-pages';
import {
  type FilterQuery,
  type ListQuery,
  type SalesPipeline,
  useOrderList,
} from './pipelines-api';

const LIST_SCOPES = ['PIPELINE', 'ALL', 'NONE'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];
const ARCHIVED_SCOPES = ['exclude', 'include', 'only'] as const;
export type ArchivedScope = (typeof ARCHIVED_SCOPES)[number];

const COLUMNS = [
  'number',
  'customer',
  'stage',
  'status',
  'deliveryDate',
  'total',
  'payment',
  'createdBy',
  'channel',
  'createdAt',
] as const;
type Column = (typeof COLUMNS)[number];
const LOCKED: readonly Column[] = ['number'];

/** The list's own narrowing beside the shared filters: scope, stage, status, archive. */
export interface ListFilters {
  scope: ListScope;
  stageId?: number;
  status?: OrderStatus;
  archived: ArchivedScope;
}

/**
 * «Жагсаалтаар» (ADR-0057 #7): the pipeline's orders (or all of them, or those in no pipeline)
 * newest first with the shared filters plus stage, status and archive; the column chooser keeps
 * each user's columns; a row opens the order beside the list.
 */
export function ListView({
  pipeline,
  filters,
  own,
  onOwnChange,
  onOpen,
  onCount,
}: {
  pipeline: SalesPipeline | null;
  filters: FilterQuery;
  own: ListFilters;
  onOwnChange: (next: ListFilters) => void;
  onOpen: (orderId: number) => void;
  onCount?: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const columns = useHiddenColumns('salesOrders', COLUMNS, LOCKED);
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
  const shown = (column: Column) => !columns.hidden.has(column);
  const money = (value: string | null) =>
    value === null ? '' : t('pricing.money', { amount: formatMnt(value) });
  const stages = (pipeline?.stages ?? []).filter((stage) => stage.canView);
  return (
    <>
      <FilterBar
        end={
          <ColumnChooser
            keys={COLUMNS}
            locked={LOCKED}
            label={(column) => t(`sales.work.columns.${column}`)}
            hidden={columns.hidden}
            toggle={columns.toggle}
            showAll={columns.showAll}
          />
        }
      >
        <NativeSelect
          variant="filter"
          aria-label={t('sales.work.scope')}
          value={own.scope}
          active={own.scope !== 'PIPELINE'}
          onChange={(event) => {
            const scope = LIST_SCOPES.find((value) => value === event.target.value) ?? 'PIPELINE';
            onOwnChange({ ...own, scope, stageId: undefined });
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
              onOwnChange({
                ...own,
                stageId: Number.parseInt(event.target.value, 10) || undefined,
              })
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
            onOwnChange({
              ...own,
              status: ORDER_STATUSES.find((value) => value === event.target.value),
            })
          }
        >
          <option value="">{t('sales.orders.allStatuses')}</option>
          {(['DRAFT', 'CONFIRMED', 'PICKING', 'PACKED', 'DELIVERED', 'CANCELLED'] as const).map(
            (value) => (
              <option key={value} value={value}>
                {t(`sales.statuses.${value}`)}
              </option>
            ),
          )}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('sales.work.archivedLabel')}
          value={own.archived}
          active={own.archived !== 'exclude'}
          onChange={(event) =>
            onOwnChange({
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
      </FilterBar>
      <ProblemAlert problem={problemFromError(orders.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.filter(shown).map((column) => (
                <TableHead key={column} className={column === 'total' ? 'text-right' : undefined}>
                  {t(`sales.work.columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.isPending ? <SkeletonRows columns={COLUMNS.filter(shown).length} /> : null}
            {rows.map((row) => {
              const title = row.number ?? t('sales.order.draftNo', { id: row.id });
              return (
                <TableRow key={row.id}>
                  {shown('number') ? (
                    <TableCell className="font-mono">
                      <button
                        type="button"
                        className="font-medium text-link underline-offset-4 hover:underline"
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
                    <TableCell className="whitespace-normal">
                      {row.customerName}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {row.customerCode}
                      </span>
                    </TableCell>
                  ) : null}
                  {shown('stage') ? (
                    <TableCell className="whitespace-normal">
                      {[own.scope === 'PIPELINE' ? null : row.pipelineName, row.stageName]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                  ) : null}
                  {shown('status') ? (
                    <TableCell>
                      <OrderStatusBadge status={row.status} />
                    </TableCell>
                  ) : null}
                  {shown('deliveryDate') ? (
                    <TableCell className="font-mono">{row.deliveryDate}</TableCell>
                  ) : null}
                  {shown('total') ? (
                    <TableCell className="text-right font-mono">{money(row.total)}</TableCell>
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!orders.isPending && rows.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={t('sales.orders.empty')} />
        ) : null}
        <LoadMore query={orders} />
      </ListCard>
    </>
  );
}
