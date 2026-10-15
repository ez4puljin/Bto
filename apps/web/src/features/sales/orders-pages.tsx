import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  defaultDeliveryDate,
  FULFILMENTS,
  type Fulfilment,
  isCancellable,
  ORDER_STATUSES,
  orderHeaderIssues,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FieldList } from '@/components/detail';
import { FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouseName } from '@/features/inventory/helpers';
import { ProductSearch } from '@/features/inventory/shared';
import { useCustomer } from '@/features/partners/api';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { type Quote, useQuote } from '@/features/pricing/api';
import { QuoteResult, UnitSelect } from '@/features/pricing/quote-table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type OrderStatus,
  type SalesOrder,
  type SalesOrderRequest,
  useProductOrderInfo,
  useSalesOrder,
  useSalesOrderMutations,
  useSalesOrders,
} from './api';

const MANAGE = 'sales.orders.manage';

const isStatus = (value: string | null): value is OrderStatus =>
  value !== null && (ORDER_STATUSES as readonly string[]).includes(value);

/** Whole tugriks with the sign («72,000₮»); empty for a total not frozen yet. */
function useMoney() {
  const { t } = useTranslation();
  return (value: string | null) =>
    value === null ? '' : t('pricing.money', { amount: formatMnt(value) });
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const variant =
    status === 'CANCELLED'
      ? 'outline'
      : status === 'DRAFT'
        ? 'secondary'
        : status === 'CONFIRMED'
          ? 'default'
          : 'success';
  return <Badge variant={variant}>{t(`sales.statuses.${status}`)}</Badge>;
}

/** «Борлуулалт» → «Захиалга» (ADR-0055): the orders, newest first, by status and number. */
export function SalesOrdersPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const canManage = useHasPermission(MANAGE);
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const orders = useSalesOrders({ status, q });
  const rows = orders.data?.pages.flatMap((page) => page.data) ?? [];

  const setStatus = (value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set('status', value);
        else next.delete('status');
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title={t('sales.orders.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/sales/orders/new">
                <Plus />
                {t('sales.orders.new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('sales.orders.search')}
          placeholder={t('sales.orders.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('sales.order.status')}
          value={status ?? ''}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t('sales.orders.allStatuses')}</option>
          {(['DRAFT', 'CONFIRMED', 'CANCELLED'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`sales.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(orders.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.order.number')}</TableHead>
              <TableHead>{t('sales.order.customer')}</TableHead>
              <TableHead>{t('sales.order.fulfilment')}</TableHead>
              <TableHead>{t('sales.order.deliveryDate')}</TableHead>
              <TableHead className="text-right">{t('sales.order.lines')}</TableHead>
              <TableHead className="text-right">{t('sales.order.total')}</TableHead>
              <TableHead>{t('sales.order.status')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((row) => (
              <LinkRow key={row.id} to={`/sales/orders/${row.id}`}>
                <TableCell className="font-mono">
                  <Link to={`/sales/orders/${row.id}`} className="font-medium">
                    {row.number ?? t('sales.order.draftNo', { id: row.id })}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {row.customerName}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {row.customerCode}
                  </span>
                </TableCell>
                <TableCell>{t(`sales.fulfilments.${row.fulfilment}`)}</TableCell>
                <TableCell className="font-mono">{row.deliveryDate}</TableCell>
                <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                <TableCell className="text-right font-mono">{money(row.total)}</TableCell>
                <TableCell>
                  <OrderStatusBadge status={row.status} />
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!orders.isPending && rows.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={t('sales.orders.empty')} />
        ) : null}
        <LoadMore query={orders} />
      </ListCard>
    </div>
  );
}

/** «Шинэ захиалга»: the editor of a new order; saving keeps a draft, «Илгээх» confirms it. */
export function SalesOrderNewPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <PageHeader title={t('sales.orders.new')} />
      <OrderEditor order={null} />
    </div>
  );
}

/** One order: the editor while it is a draft, else what was confirmed and reserved. */
export function SalesOrderPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const order = useSalesOrder(id);
  const canManage = useHasPermission(MANAGE);
  const detail = order.data;
  if (!detail) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('sales.orders.title')} />
        <ProblemAlert problem={problemFromError(order.error)} />
      </div>
    );
  }
  const title = detail.number ?? t('sales.order.draftNo', { id: detail.id });
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={detail.status} />
            <span>{detail.customerName}</span>
          </div>
        }
      />
      {detail.status === 'DRAFT' && canManage ? (
        <OrderEditor key={detail.updatedAt} order={detail} />
      ) : (
        <OrderView order={detail} canManage={canManage} />
      )}
    </div>
  );
}

interface CartLine {
  key: string;
  productId: number;
  sku: string;
  name: string;
  unitId: number;
  qty: string;
}

function linesOf(order: SalesOrder | null): CartLine[] {
  return (order?.lines ?? []).map((line) => ({
    key: String(line.id),
    productId: line.productId,
    sku: line.productSku,
    name: line.productName,
    unitId: line.productUnitId,
    qty: plainDecimal(line.qty),
  }));
}

/**
 * The order form (ADR-0055): the customer, pickup or delivery with its date and address, the
 * contact, how they pay and a note; then the lines — a product, its unit and quantity, with its
 * home warehouse and the stock available there. «Үнэ тооцоолох» shows today's prices; «Илгээх»
 * saves, confirms and reserves.
 */
function OrderEditor({ order }: { order: SalesOrder | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useSalesOrderMutations();
  const quote = useQuote();
  const action = useAction();
  const warehouseName = useWarehouseName();
  const [customer, setCustomer] = useState<PickedCustomer | null>(
    order ? { id: order.customerId, code: order.customerCode, name: order.customerName } : null,
  );
  const [fulfilment, setFulfilment] = useState<Fulfilment>(order?.fulfilment ?? 'PICKUP');
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate ?? defaultDeliveryDate());
  const [addressId, setAddressId] = useState<number | null>(order?.addressId ?? null);
  const [contactName, setContactName] = useState(order?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(order?.contactPhone ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(order?.paymentMethod ?? 'CASH');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<CartLine[]>(() => linesOf(order));
  const [prices, setPrices] = useState<Quote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [createKey] = useState(randomUuid);
  const [submitKey] = useState(randomUuid);
  const [checked, setChecked] = useState(false);
  const info = useProductOrderInfo(lines.map((line) => line.productId));
  const infoOf = (productId: number) => info.data?.find((row) => row.productId === productId);
  const details = useCustomerDetails(customer?.id ?? null);

  // A new delivery takes the customer's default address; a new customer, their first contact.
  useEffect(() => {
    if (!details) return;
    if (fulfilment === 'DELIVERY' && addressId === null) {
      const fallback = details.addresses.find((row) => row.isDefault) ?? details.addresses[0];
      if (fallback) setAddressId(fallback.id);
    }
  }, [details, fulfilment, addressId]);

  const issues = orderHeaderIssues(
    {
      fulfilment,
      deliveryDate,
      addressId: fulfilment === 'DELIVERY' ? addressId : null,
      contactPhone: contactPhone.trim() === '' ? null : contactPhone,
    },
    businessDate(),
  );
  const issueOf = (path: string) => {
    const issue = issues.find((entry) => entry.path === path);
    if (!checked || !issue) return undefined;
    if (issue.path === 'deliveryDate') return t(`sales.issues.deliveryDate.${issue.code}`);
    return issue.path === 'addressId'
      ? t('sales.issues.addressId.required')
      : t('sales.issues.contactPhone.phone');
  };
  const blocked = lines.some((line) => {
    const row = infoOf(line.productId);
    return row !== undefined && (!row.sellable || row.homeWarehouseId === null);
  });

  const change = (next: CartLine[]) => {
    setLines(next);
    setPrices(null);
  };
  const body = (): SalesOrderRequest | null => {
    if (!customer) return null;
    return {
      customerId: customer.id,
      fulfilment,
      deliveryDate,
      addressId: fulfilment === 'DELIVERY' ? addressId : null,
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() ? (normalizeMnPhone(contactPhone) ?? contactPhone) : null,
      paymentMethod,
      note: note.trim() || null,
      lines: lines.map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
    };
  };
  const save = async (): Promise<number | null> => {
    setChecked(true);
    const request = body();
    if (!request || issues.length > 0) return null;
    const saved = order
      ? await mutations.update.mutateAsync({ id: order.id, body: request })
      : await mutations.create.mutateAsync({ key: createKey, body: request });
    return saved.id;
  };
  const saveDraft = () =>
    void action.run(async () => {
      const id = await save();
      if (id === null) return;
      toast.success(t('sales.order.saved'));
      if (!order) await navigate(`/sales/orders/${id}`, { replace: true });
    });
  const submit = () =>
    void action.run(async () => {
      const id = await save();
      if (id === null) {
        setConfirming(false);
        return;
      }
      const confirmed = await mutations.submit.mutateAsync({ id, key: submitKey });
      setConfirming(false);
      toast.success(t('sales.order.confirmed', { number: confirmed.number ?? '' }));
      await navigate(`/sales/orders/${id}`, { replace: true });
    });
  const showPrices = () =>
    void action.run(async () => {
      setPrices(
        await quote.mutateAsync({
          list: 'WHOLESALE',
          date: businessDate(),
          lines: lines.map((line) => ({ productUnitId: line.unitId, qty: line.qty })),
        }),
      );
    });
  const pending = mutations.create.isPending || mutations.update.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('sales.order.header')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label={t('sales.order.customer')} htmlFor="order-customer">
            {order ? (
              <Input
                id="order-customer"
                readOnly
                value={`${order.customerName} · ${order.customerCode}`}
              />
            ) : (
              <CustomerPicker
                id="order-customer"
                value={customer}
                onChange={(picked) => {
                  setCustomer(picked);
                  setAddressId(null);
                }}
                invalid={checked && !customer}
              />
            )}
          </FormField>
          <FormField label={t('sales.order.fulfilment')} htmlFor="order-fulfilment">
            <NativeSelect
              id="order-fulfilment"
              value={fulfilment}
              onChange={(event) =>
                setFulfilment(event.target.value === 'DELIVERY' ? 'DELIVERY' : 'PICKUP')
              }
            >
              {FULFILMENTS.map((value) => (
                <option key={value} value={value}>
                  {t(`sales.fulfilments.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={t('sales.order.deliveryDate')}
            htmlFor="order-date"
            error={issueOf('deliveryDate')}
          >
            <Input
              id="order-date"
              type="date"
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </FormField>
          {fulfilment === 'DELIVERY' ? (
            <FormField
              label={t('sales.order.address')}
              htmlFor="order-address"
              error={issueOf('addressId')}
              hint={details && details.addresses.length === 0 ? t('sales.order.noAddress') : null}
            >
              <NativeSelect
                id="order-address"
                value={addressId ?? ''}
                onChange={(event) =>
                  setAddressId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
                }
              >
                <option value="">{t('sales.order.chooseAddress')}</option>
                {(details?.addresses ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {[row.label, row.address].filter(Boolean).join(' · ') || `#${row.id}`}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField label={t('sales.order.contactName')} htmlFor="order-contact">
            <Input
              id="order-contact"
              list="order-contacts"
              value={contactName}
              onChange={(event) => {
                setContactName(event.target.value);
                const known = details?.contacts.find((row) => row.name === event.target.value);
                if (known?.phone) setContactPhone(known.phone);
              }}
            />
            <datalist id="order-contacts">
              {(details?.contacts ?? []).map((row) => (
                <option key={row.id} value={row.name ?? ''} />
              ))}
            </datalist>
          </FormField>
          <FormField
            label={t('sales.order.contactPhone')}
            htmlFor="order-phone"
            error={issueOf('contactPhone')}
          >
            <Input
              id="order-phone"
              inputMode="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          </FormField>
          <FormField label={t('sales.order.paymentMethod')} htmlFor="order-payment">
            <NativeSelect
              id="order-payment"
              value={paymentMethod}
              onChange={(event) => {
                const value = PAYMENT_METHODS.find((entry) => entry === event.target.value);
                if (value) setPaymentMethod(value);
              }}
            >
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {t(`sales.paymentMethods.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="md:col-span-2">
            <FormField label={t('sales.order.note')} htmlFor="order-note">
              <Textarea
                id="order-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('sales.order.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProductSearch
            onPick={(product) =>
              change([
                ...lines,
                {
                  key: randomUuid(),
                  productId: product.id,
                  sku: product.sku,
                  name: product.name,
                  unitId: product.baseUnit.id,
                  qty: '1',
                },
              ])
            }
          />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sales.order.noLines')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sales.order.product')}</TableHead>
                  <TableHead>{t('sales.order.unit')}</TableHead>
                  <TableHead>{t('sales.order.qty')}</TableHead>
                  <TableHead>{t('sales.order.warehouse')}</TableHead>
                  <TableHead className="text-right">{t('sales.order.available')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('sales.order.remove')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const row = infoOf(line.productId);
                  return (
                    <TableRow key={line.key}>
                      <TableCell className="whitespace-normal">
                        <span className="mr-2 font-mono text-muted-foreground">{line.sku}</span>
                        {line.name}
                        {row && !row.sellable ? (
                          <div className="text-xs text-destructive">
                            {t('sales.order.notSellable')}
                          </div>
                        ) : row && row.homeWarehouseId === null ? (
                          <div className="text-xs text-destructive">{t('sales.order.noHome')}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <UnitSelect
                          productId={line.productId}
                          unitId={line.unitId}
                          name={line.name}
                          onChange={(unitId) =>
                            change(
                              lines.map((entry) =>
                                entry.key === line.key ? { ...entry, unitId } : entry,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`${t('sales.order.qty')}: ${line.name}`}
                          inputMode="decimal"
                          className="w-28 text-right font-mono"
                          value={line.qty}
                          onChange={(event) =>
                            change(
                              lines.map((entry) =>
                                entry.key === line.key
                                  ? { ...entry, qty: event.target.value.trim() }
                                  : entry,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {row?.homeWarehouseId ? warehouseName(row.homeWarehouseId) : ''}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row ? plainDecimal(row.available) : ''}
                      </TableCell>
                      <RowActions>
                        <RowAction
                          label={`${t('sales.order.remove')}: ${line.name}`}
                          icon={Trash2}
                          destructive
                          onClick={() => change(lines.filter((entry) => entry.key !== line.key))}
                        />
                      </RowActions>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={lines.length === 0 || quote.isPending}
              onClick={showPrices}
            >
              {t('sales.order.showPrices')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {prices ? (
        <QuoteResult result={prices} names={lines.map(({ key, name }) => ({ key, name }))} />
      ) : null}
      <ProblemAlert problem={action.problem} />
      <StickyActions summary={t('sales.order.lineCount', { count: lines.length })}>
        <Button variant="outline" disabled={pending || !customer} onClick={saveDraft}>
          {t('sales.order.saveDraft')}
        </Button>
        <Button
          disabled={pending || !customer || lines.length === 0 || blocked}
          onClick={() => {
            setChecked(true);
            if (issues.length === 0) setConfirming(true);
          }}
        >
          {t('sales.order.submit')}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        variant="default"
        title={t('sales.order.submitTitle')}
        description={t('sales.order.submitDescription')}
        confirmLabel={t('sales.order.submit')}
        pending={mutations.submit.isPending || pending}
        problem={action.problem}
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/** The chosen customer's addresses and contacts, once one is chosen. */
function useCustomerDetails(id: number | null) {
  const customer = useCustomer(id ?? 0, { enabled: id !== null });
  return id === null ? undefined : customer.data;
}

/** A confirmed (or cancelled) order: its header, lines with what was reserved, prices, history. */
function OrderView({ order, canManage }: { order: SalesOrder; canManage: boolean }) {
  const { t } = useTranslation();
  const money = useMoney();
  const live = order.status !== 'CANCELLED';
  const warehouseName = useWarehouseName();
  const mutations = useSalesOrderMutations();
  const action = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelKey] = useState(randomUuid);
  const backordered = order.lines.filter((line) => new Decimal(line.qtyBackordered).gt(0));

  const cancel = () =>
    void action.run(async () => {
      await mutations.cancel.mutateAsync({ id: order.id, key: cancelKey, reason: reason.trim() });
      setCancelling(false);
      toast.success(t('sales.order.cancelled'));
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('sales.order.header')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldList
            items={[
              {
                label: t('sales.order.customer'),
                value: `${order.customerName} · ${order.customerCode}`,
              },
              {
                label: t('sales.order.fulfilment'),
                value: t(`sales.fulfilments.${order.fulfilment}`),
              },
              { label: t('sales.order.deliveryDate'), value: order.deliveryDate },
              ...(order.fulfilment === 'DELIVERY'
                ? [{ label: t('sales.order.address'), value: order.addressText }]
                : []),
              {
                label: t('sales.order.contactName'),
                value: [order.contactName, order.contactPhone].filter(Boolean).join(' · '),
              },
              {
                label: t('sales.order.paymentMethod'),
                value: t(`sales.paymentMethods.${order.paymentMethod}`),
              },
              { label: t('sales.order.note'), value: order.note },
              { label: t('sales.order.total'), value: money(order.total) },
              ...(order.cancelReason
                ? [{ label: t('sales.order.cancelReason'), value: order.cancelReason }]
                : []),
            ]}
          />
        </CardContent>
      </Card>
      {backordered.length > 0 && live ? (
        <p className="text-sm text-warning">
          {t('sales.order.backorderedLines', { count: backordered.length })}
        </p>
      ) : null}
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.order.product')}</TableHead>
              <TableHead className="text-right">{t('sales.order.qty')}</TableHead>
              <TableHead>{t('sales.order.warehouse')}</TableHead>
              {live ? (
                <>
                  <TableHead className="text-right">{t('sales.order.reserved')}</TableHead>
                  <TableHead className="text-right">{t('sales.order.backordered')}</TableHead>
                </>
              ) : null}
              <TableHead className="text-right">{t('sales.order.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">
                  <span className="mr-2 font-mono text-muted-foreground">{line.productSku}</span>
                  {line.productName}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {t('sales.order.qtyIn', { qty: plainDecimal(line.qty), unit: line.unitName })}
                </TableCell>
                <TableCell>{warehouseName(line.warehouseId)}</TableCell>
                {live ? (
                  <>
                    <TableCell className="text-right font-mono">
                      {t('sales.order.qtyIn', {
                        qty: plainDecimal(line.qtyApproved),
                        unit: line.baseUnitName,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {new Decimal(line.qtyBackordered).gt(0)
                        ? t('sales.order.qtyIn', {
                            qty: plainDecimal(line.qtyBackordered),
                            unit: line.baseUnitName,
                          })
                        : ''}
                    </TableCell>
                  </>
                ) : null}
                <TableCell className="text-right font-mono">{money(line.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListCard>
      {order.total !== null ? (
        <QuoteResult
          result={{
            lines: order.lines.map((line) => ({ priced: true, qty: line.qty, parts: line.parts })),
            subtotal: order.subtotal ?? '0',
            discountTotal: order.discountTotal ?? '0',
            total: order.total,
          }}
          names={order.lines.map((line) => ({ key: String(line.id), name: line.productName }))}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('sales.order.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {order.events.map((event, index) => (
              <li key={`${event.toStatus}:${index}`} className="flex flex-wrap gap-2">
                <span className="font-mono text-muted-foreground">
                  {formatUbDateTime(Date.parse(event.createdAt))}
                </span>
                <span>{t(`sales.statuses.${event.toStatus}`)}</span>
                {event.reason ? (
                  <span className="text-muted-foreground">{event.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {canManage && isCancellable(order.status) ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setCancelling(true)}>
            {t('sales.order.cancel')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={cancelling}
        title={t('sales.order.cancelTitle')}
        description={t('sales.order.cancelDescription')}
        confirmLabel={t('sales.order.cancel')}
        disabled={!reason.trim()}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setCancelling(false)}
      >
        <FormField label={t('sales.order.cancelReason')} htmlFor="order-cancel-reason">
          <Textarea
            id="order-cancel-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
