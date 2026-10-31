import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ListCard, ListTable, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { PickStatusBadge } from './order-pick';
import { type PickWork, usePickWork, useSalesMutations } from './pipelines-api';
import { usePickerSelf } from './use-picker-self';

const VIEWS = ['OPEN', 'MINE', 'ALL', 'DONE'] as const;
type View = (typeof VIEWS)[number];

/**
 * «Бэлтгэл» (ADR-0126 #2): the warehouses' parts of the open orders in the caller's warehouses (a
 * lead: every warehouse): those to take, the caller's own, all, and today's done. «Бэлдэж эхлэх»
 * takes a part; a row opens its order on the «Бэлтгэх» tab, where the counts are confirmed.
 */
export function SalesPickingPage() {
  const { t } = useTranslation();
  const work = usePickWork();
  const self = usePickerSelf();
  const mutations = useSalesMutations();
  const action = useAction();
  const [view, setView] = useState<View>('OPEN');
  const [warehouse, setWarehouse] = useState<number | null>(null);
  const rows = work.data ?? [];
  const warehouses = [...new Map(rows.map((row) => [row.warehouseId, row.warehouseName]))];
  const shown = rows.filter(
    (row) =>
      (warehouse === null || row.warehouseId === warehouse) &&
      (view === 'ALL'
        ? row.status !== 'DONE'
        : view === 'MINE'
          ? row.status === 'PICKING' && row.pickerId === self.id
          : row.status === view),
  );
  const take = (row: PickWork) =>
    void action.run(async () => {
      await mutations.takePart.mutateAsync({ orderId: row.orderId, warehouseId: row.warehouseId });
      toast.success(t('sales.pick.taken'));
    });
  return (
    <div>
      <PageHeader title={t('sales.picking.title')} description={t('sales.picking.description')} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedControl
          options={VIEWS}
          value={view}
          label={(value) => t(`sales.picking.views.${value}`)}
          onChange={setView}
        />
        {warehouses.length > 1 ? (
          <NativeSelect
            aria-label={t('sales.picking.warehouse')}
            className="w-56"
            value={warehouse ?? ''}
            onChange={(event) => setWarehouse(Number.parseInt(event.target.value, 10) || null)}
          >
            <option value="">{t('sales.picking.allWarehouses')}</option>
            {warehouses.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>
      <ProblemAlert problem={problemFromError(work.error) ?? action.problem} />
      <ListCard>
        <ListTable
          columns={[
            { key: 'order', kind: 'code', width: 12 },
            { key: 'customer', kind: 'text', weight: 2, min: 12 },
            { key: 'date', kind: 'date' },
            { key: 'warehouse', kind: 'text', weight: 1, min: 10 },
            { key: 'lines', kind: 'qty', width: 7 },
            { key: 'status', kind: 'text', weight: 1, min: 12 },
            { key: 'actions', kind: 'actions', actions: 2 },
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.picking.order')}</TableHead>
              <TableHead>{t('sales.picking.customer')}</TableHead>
              <TableHead>{t('sales.picking.deliveryDate')}</TableHead>
              <TableHead>{t('sales.picking.warehouse')}</TableHead>
              <TableHead className="text-right">{t('sales.picking.lines')}</TableHead>
              <TableHead>{t('sales.picking.status')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('sales.picking.open')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={`${row.orderId}:${row.warehouseId}`}>
                <TableCell className="font-mono">
                  <Link
                    className="text-link underline-offset-4 hover:underline"
                    to={`/sales/boards?order=${row.orderId}&tab=pick`}
                  >
                    {row.orderNumber ?? row.orderId}
                  </Link>
                </TableCell>
                <TableCell className="truncate">{row.customerName}</TableCell>
                <TableCell className="font-mono">{row.deliveryDate}</TableCell>
                <TableCell className="truncate">{row.warehouseName}</TableCell>
                <TableCell className="text-right font-mono">{row.lines}</TableCell>
                <TableCell>
                  <PickStatusBadge part={row} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {row.status === 'OPEN' && self.writes(row.warehouseId) ? (
                      <Button
                        size="sm"
                        disabled={mutations.takePart.isPending}
                        onClick={() => take(row)}
                      >
                        {t('sales.pick.take')}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/sales/boards?order=${row.orderId}&tab=pick`}>
                        {t('sales.picking.open')}
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {work.data && shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('sales.picking.empty')}
          </p>
        ) : null}
      </ListCard>
    </div>
  );
}
