import { Decimal } from '@tugeel/shared/money';
import dayjs from 'dayjs';
import { ClipboardList, Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyName } from '@/features/company/api';
import { BUSINESS_TZ } from '@/lib/dayjs';
import { formatCount, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  isPoStatus,
  PO_STATUSES,
  type PurchaseOrderPrint,
  usePurchaseOrderMutations,
  usePurchaseOrderPrint,
  usePurchaseOrders,
} from './api';
import { StatusCountBadge, SupplierTicks } from './parts';

const idOf = (value: string | null | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Purchase orders by supplier (ADR-0115): every order with its lowest status and its suppliers,
 * filtered by number, status and «Миний нийлүүлэгч»; managers start a new one from a dialog.
 */
export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('procurement.orders.manage');
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isPoStatus(statusParam) ? statusParam : undefined;
  const mine = params.get('mine') === '1';
  const archived = params.get('archived') === '1';
  const orders = usePurchaseOrders({ q, status, mine, archived });
  const rows = orders.data?.pages.flatMap((page) => page.data) ?? [];
  const [creating, setCreating] = useCreateParam();
  const filtered = q !== '' || status !== undefined || mine || archived;

  return (
    <div>
      <PageHeader
        title={t('procurement.orders.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('procurement.orders.create')}
            </Button>
          ) : null
        }
      />
      {canManage ? (
        <Dialog open={creating} onOpenChange={setCreating}>
          {creating ? <CreateOrderDialog onCancel={() => setCreating(false)} /> : null}
        </Dialog>
      ) : null}
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('procurement.orders.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('procurement.orders.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('procurement.orders.allStatuses')}</option>
          {PO_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`procurement.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <FilterToggle
          label={t('procurement.orders.mine')}
          checked={mine}
          onCheckedChange={(checked) => setParam('mine', checked ? '1' : '')}
        />
        <FilterToggle
          label={t('procurement.orders.archived')}
          checked={archived}
          onCheckedChange={(checked) => setParam('archived', checked ? '1' : '')}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(orders.error)} onRetry={orders.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('procurement.orders.number')}</TableHead>
              <TableHead>{t('procurement.orders.date')}</TableHead>
              <TableHead>{t('procurement.orders.suppliers')}</TableHead>
              <TableHead className="text-right">{t('procurement.orders.supplierCount')}</TableHead>
              <TableHead>{t('procurement.orders.note')}</TableHead>
              <TableHead>{t('procurement.orders.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((order) => (
              <LinkRow key={order.id} to={`/procurement/orders/${order.id}`}>
                <TableCell className="font-mono">
                  <Link
                    to={`/procurement/orders/${order.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {order.number}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">{order.orderDate}</TableCell>
                <TruncateCell text={order.supplierNames.join(', ')} />
                <TableCell className="text-right font-mono">{order.supplierCount}</TableCell>
                <TruncateCell
                  className="text-muted-foreground"
                  text={order.note ?? t('common.none')}
                />
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {order.statusCounts.map((entry) => (
                      <StatusCountBadge
                        key={entry.status}
                        status={entry.status}
                        count={entry.count}
                      />
                    ))}
                    {order.archivedAt !== null ? (
                      <Badge variant="outline">{t('procurement.detail.archived')}</Badge>
                    ) : null}
                  </span>
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!orders.isPending && rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t(filtered ? 'procurement.orders.emptyFiltered' : 'procurement.orders.empty')}
            onClearFilters={
              filtered
                ? () => {
                    setSearch('');
                    setParam('q', '');
                    setParam('status', '');
                    setParam('mine', '');
                    setParam('archived', '');
                  }
                : undefined
            }
          />
        ) : null}
        <LoadMore query={orders} />
      </ListCard>
    </div>
  );
}

/** A new order: its date (today), a note and the suppliers to order from; the grid comes after. */
function CreateOrderDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [orderDate, setOrderDate] = useState(() => dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD'));
  const [note, setNote] = useState('');
  const [suppliers, setSuppliers] = useState<ReadonlyMap<number, string>>(new Map());

  const create = () =>
    void action.run(async () => {
      const order = await mutations.create.mutateAsync({
        key,
        orderDate: orderDate || null,
        note: note.trim() || null,
        supplierIds: [...suppliers.keys()],
      });
      toast.success(t('procurement.create.created', { number: order.number }));
      await navigate(`/procurement/orders/${order.id}`, { replace: true });
    });

  return (
    <DialogContent size="lg" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (suppliers.size > 0 && !mutations.create.isPending) create();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.create.title')}</DialogTitle>
          <DialogDescription>{t('procurement.create.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <FormField label={t('procurement.create.date')} htmlFor="po-date">
            <Input
              id="po-date"
              type="date"
              className="font-mono"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </FormField>
          <FormField label={t('procurement.create.note')} htmlFor="po-note">
            <Input
              id="po-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label={t('procurement.create.suppliers')} htmlFor="po-suppliers">
          <SupplierTicks id="po-suppliers" value={suppliers} onChange={setSuppliers} />
        </FormField>
        <DialogFormFooter
          pending={mutations.create.isPending}
          disabled={suppliers.size === 0}
          submitLabel={
            suppliers.size > 0
              ? t('procurement.create.submitCount', { count: formatCount(suppliers.size) })
              : t('procurement.create.submit')
          }
          onCancel={onCancel}
        />
      </form>
    </DialogContent>
  );
}

/**
 * The order on paper (`/procurement/orders/:id/print?supplierId=`, ADR-0058: from the browser, no
 * PDF): one sheet per supplier with what to send, in the units ordered, the pieces and the weight.
 */
export function PurchaseOrderPrintPage() {
  const { t } = useTranslation();
  const id = idOf(useParams().id) ?? 0;
  const [search] = useSearchParams();
  const supplierId = idOf(search.get('supplierId'));
  const sheets = usePurchaseOrderPrint(id, supplierId);
  return (
    <PrintFrame
      ready={sheets.data !== undefined}
      error={sheets.error}
      title={sheets.data ? `${t('procurement.print.title')} ${sheets.data.number}` : ''}
    >
      {(narrow) =>
        sheets.data
          ? sheets.data.sheets.map((sheet, index, all) => (
              <SupplierSheet
                key={sheet.supplierId}
                order={sheets.data}
                sheet={sheet}
                narrow={narrow}
                last={index === all.length - 1}
              />
            ))
          : null
      }
    </PrintFrame>
  );
}

function SupplierSheet(props: {
  order: PurchaseOrderPrint;
  sheet: PurchaseOrderPrint['sheets'][number];
  narrow: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const { order, sheet } = props;
  const pieces = sheet.lines.reduce((sum, line) => sum.plus(line.qtyBase), new Decimal(0));
  const kg = sheet.lines.reduce(
    (sum, line) => (line.weightKg ? sum.plus(line.weightKg) : sum),
    new Decimal(0),
  );
  const kgText = (value: Decimal) => formatQty(value.toDecimalPlaces(2).toString());
  const facts: [string, string][] = [
    [t('procurement.print.number'), order.number],
    [t('procurement.print.date'), order.orderDate],
    [t('procurement.print.supplier'), sheet.supplierName],
    [t('procurement.print.orderer'), sheet.ordererName ?? t('common.none')],
    ...(order.note ? ([[t('procurement.print.note'), order.note]] as [string, string][]) : []),
  ];
  const cell = 'border border-foreground/60 px-1.5 py-1';
  return (
    <article
      className={cn('flex flex-col gap-4', props.last ? undefined : 'mb-10 break-after-page')}
    >
      <header
        className={cn(
          'flex flex-col gap-2 border-b pb-3',
          props.narrow ? 'border-dashed border-foreground' : 'border-foreground',
        )}
      >
        <p className="font-semibold">{companyName}</p>
        <h1 className={cn('text-center font-bold', props.narrow ? 'text-sm' : 'text-lg')}>
          {t('procurement.print.title')}
        </h1>
        <dl className={cn('grid gap-x-6 gap-y-0.5', props.narrow ? 'grid-cols-1' : 'grid-cols-2')}>
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-muted-foreground print:text-foreground">{label}:</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {sheet.lines.length === 0 ? <p>{t('procurement.print.empty')}</p> : null}
      {props.narrow ? (
        <ol className="flex flex-col divide-y divide-dashed divide-foreground">
          {sheet.lines.map((line, index) => (
            <li key={line.productId} className="py-1">
              <p>
                {index + 1}. {line.name}
              </p>
              <p className="flex justify-between gap-2 font-mono">
                <span>{line.sku}</span>
                <span className="font-semibold">
                  {formatQty(line.qty)} {line.unitName}
                </span>
              </p>
            </li>
          ))}
        </ol>
      ) : sheet.lines.length > 0 ? (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left">
              <th className={cell}>{t('procurement.print.lineNo')}</th>
              <th className={cell}>{t('procurement.print.sku')}</th>
              <th className={cell}>{t('procurement.print.name')}</th>
              <th className={cell}>{t('procurement.print.warehouse')}</th>
              <th className={cell}>{t('procurement.print.unit')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.qty')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.pieces')}</th>
              <th className={cn(cell, 'text-right')}>{t('procurement.print.kg')}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((line, index) => (
              <tr key={line.productId}>
                <td className={cn(cell, 'text-right')}>{index + 1}</td>
                <td className={cn(cell, 'font-mono')}>{line.sku}</td>
                <td className={cell}>{line.name}</td>
                <td className={cell}>{line.warehouseName ?? ''}</td>
                <td className={cell}>{line.unitName}</td>
                <td className={cn(cell, 'text-right font-mono font-semibold')}>
                  {formatQty(line.qty)}
                </td>
                <td className={cn(cell, 'text-right font-mono')}>
                  {formatQty(line.qtyBase)} {line.baseUnitName}
                </td>
                <td className={cn(cell, 'text-right font-mono')}>
                  {line.weightKg ? kgText(new Decimal(line.weightKg)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className={cell} colSpan={6}>
                {t('procurement.print.total', { count: sheet.lines.length })}
              </td>
              <td className={cn(cell, 'text-right font-mono')}>{formatQty(pieces.toString())}</td>
              <td className={cn(cell, 'text-right font-mono')}>{kgText(kg)}</td>
            </tr>
          </tfoot>
        </table>
      ) : null}
      {props.narrow && sheet.lines.length > 0 ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-foreground pt-1">
          <dt>{t('procurement.print.total', { count: sheet.lines.length })}</dt>
          <dd className="text-right font-mono">{formatQty(pieces.toString())}</dd>
          <dt>{t('procurement.print.kg')}</dt>
          <dd className="text-right font-mono">{kgText(kg)}</dd>
        </dl>
      ) : null}
      <footer className={cn('mt-8 grid gap-6', props.narrow ? 'grid-cols-1' : 'grid-cols-2')}>
        {[t('procurement.print.orderedBy'), t('procurement.print.acceptedBy')].map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <span>{label}:</span>
            <span className="mt-6 border-b border-foreground" />
            <span className="text-center text-xs">{t('procurement.print.signature')}</span>
          </div>
        ))}
      </footer>
    </article>
  );
}
