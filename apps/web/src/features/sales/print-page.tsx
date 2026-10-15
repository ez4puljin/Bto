import { Decimal } from '@tugeel/shared/money';
import { PRINT_KINDS, type PrintKind } from '@tugeel/shared/sales';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { useWarehouseName } from '@/features/inventory/helpers';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { type SalesOrder, useSalesOrder } from './api';
import { useOrderBatch } from './pipelines-api';

const isKind = (value: string | undefined): value is PrintKind =>
  value !== undefined && (PRINT_KINDS as readonly string[]).includes(value);

/**
 * A document of an order on paper (ADR-0056 #7): the pick list (no prices, per warehouse with the
 * shelf) or the delivery note (prices, totals, signatures), rendered without the shell and sent to
 * the browser's print dialog once loaded. Nothing is generated on the server.
 */
export function SalesOrderPrintPage() {
  const params = useParams();
  const id = Number.parseInt(params.id ?? '', 10);
  const kind = isKind(params.kind) ? params.kind : 'PICK_LIST';
  const order = useSalesOrder(id);
  return (
    <PrintFrame
      kind={kind}
      orders={order.data ? [order.data] : undefined}
      error={order.error}
      title={order.data ? (order.data.number ?? String(order.data.id)) : ''}
    />
  );
}

/**
 * Several orders on one printout (ADR-0057 #7, a stage's «Баримт хэвлэх»): `?ids=` names up to 100
 * orders, each on its own sheet; a delivery note leaves out the drafts, which have no prices.
 */
export function SalesBatchPrintPage() {
  const { t } = useTranslation();
  const params = useParams();
  const [search] = useSearchParams();
  const kind = isKind(params.kind) ? params.kind : 'PICK_LIST';
  const ids = (search.get('ids') ?? '')
    .split(',')
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => id > 0);
  const batch = useOrderBatch(ids);
  const orders = batch.data?.filter((order) => kind === 'PICK_LIST' || order.total !== null);
  return (
    <PrintFrame
      kind={kind}
      orders={orders}
      error={batch.error}
      title={t('sales.print.batchTitle', { count: orders?.length ?? 0 })}
    />
  );
}

function PrintFrame({
  kind,
  orders,
  error,
  title,
}: {
  kind: PrintKind;
  orders: SalesOrder[] | undefined;
  error: unknown;
  title: string;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  useEffect(() => {
    if (!orders || orders.length === 0 || printed.current) return;
    printed.current = true;
    document.title = `${title} · ${t(`sales.printKinds.${kind}`)}`;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [orders, kind, title, t]);

  return (
    <div className="mx-auto max-w-3xl bg-background p-6 text-sm text-foreground print:p-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => window.print()}>{t('sales.print.print')}</Button>
        <Button variant="outline" onClick={() => window.close()}>
          {t('common.close')}
        </Button>
      </div>
      <ProblemAlert problem={problemFromError(error)} />
      {(orders ?? []).map((order, index, all) => (
        <section
          key={order.id}
          className={index < all.length - 1 ? 'mb-10 break-after-page print:mb-0' : undefined}
        >
          {kind === 'DELIVERY_NOTE' ? <DeliveryNote order={order} /> : <PickList order={order} />}
        </section>
      ))}
    </div>
  );
}

function Heading({ order, title }: { order: SalesOrder; title: string }) {
  const { t } = useTranslation();
  return (
    <header className="mb-4 border-b border-border pb-3">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">{t('brand.company')}</h1>
        <span className="text-xs text-muted-foreground">{formatUbDateTime(Date.now())}</span>
      </div>
      <h2 className="mt-2 text-base font-semibold">
        {title} · {order.number ?? t('sales.order.draftNo', { id: order.id })}
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        <dt className="text-muted-foreground">{t('sales.order.customer')}</dt>
        <dd>
          {order.customerName} · {order.customerCode}
        </dd>
        <dt className="text-muted-foreground">{t('sales.order.fulfilment')}</dt>
        <dd>
          {t(`sales.fulfilments.${order.fulfilment}`)} · {order.deliveryDate}
        </dd>
        {order.addressText ? (
          <>
            <dt className="text-muted-foreground">{t('sales.order.address')}</dt>
            <dd>{order.addressText}</dd>
          </>
        ) : null}
        {order.contactName || order.contactPhone ? (
          <>
            <dt className="text-muted-foreground">{t('sales.order.contactName')}</dt>
            <dd>{[order.contactName, order.contactPhone].filter(Boolean).join(' · ')}</dd>
          </>
        ) : null}
        {order.note ? (
          <>
            <dt className="text-muted-foreground">{t('sales.order.note')}</dt>
            <dd>{order.note}</dd>
          </>
        ) : null}
      </dl>
    </header>
  );
}

function PickList({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const warehouses = [...new Set(order.lines.map((line) => line.warehouseId))];
  return (
    <>
      <Heading order={order} title={t('sales.printKinds.PICK_LIST')} />
      {warehouses.map((warehouseId) => (
        <section key={warehouseId} className="mb-4">
          <h3 className="mb-1 font-semibold">{warehouseName(warehouseId)}</h3>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1 pr-2 font-medium">{t('sales.order.product')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('sales.order.qty')}</th>
                <th className="py-1 pr-2 text-right font-medium">{t('sales.print.baseQty')}</th>
                <th className="py-1 pr-2 font-medium">{t('sales.pick.bin')}</th>
                <th className="py-1 font-medium">{t('sales.print.picked')}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines
                .filter((line) => line.warehouseId === warehouseId)
                .map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-1 pr-2">
                      <span className="mr-2 font-mono text-muted-foreground">
                        {line.productSku}
                      </span>
                      {line.productName}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {t('sales.order.qtyIn', { qty: plainDecimal(line.qty), unit: line.unitName })}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {t('sales.order.qtyIn', {
                        qty: plainDecimal(line.qtyApproved),
                        unit: line.baseUnitName,
                      })}
                    </td>
                    <td className="py-1 pr-2 font-mono">{line.pickBinCode ?? ''}</td>
                    <td className="py-1 font-mono">
                      {line.qtyPicked === null ? '☐ ______' : plainDecimal(line.qtyPicked)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="mt-6 text-xs text-muted-foreground">{t('sales.print.pickFooter')}</p>
    </>
  );
}

function DeliveryNote({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
  return (
    <>
      <Heading order={order} title={t('sales.printKinds.DELIVERY_NOTE')} />
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 pr-2 font-medium">{t('sales.order.product')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('sales.order.qty')}</th>
            <th className="py-1 pr-2 text-right font-medium">
              {t('pricing.quote.columns.unitPrice')}
            </th>
            <th className="py-1 text-right font-medium">{t('sales.order.total')}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id} className="border-b border-border/60 align-top">
              <td className="py-1 pr-2">
                <span className="mr-2 font-mono text-muted-foreground">{line.productSku}</span>
                {line.productName}
                {line.qtyDelivered !== null && !new Decimal(line.qtyDelivered).eq(line.qtyBase) ? (
                  <div className="text-xs text-muted-foreground">
                    {t('sales.print.delivered', {
                      qty: plainDecimal(line.qtyDelivered),
                      unit: line.baseUnitName,
                    })}
                  </div>
                ) : null}
              </td>
              <td className="py-1 pr-2 text-right font-mono">
                {line.parts.length > 0
                  ? line.parts.map((part, index) => (
                      <div key={index}>
                        {t('sales.order.qtyIn', {
                          qty: plainDecimal(part.qty),
                          unit: part.uomName,
                        })}
                      </div>
                    ))
                  : t('sales.order.qtyIn', { qty: plainDecimal(line.qty), unit: line.unitName })}
              </td>
              <td className="py-1 pr-2 text-right font-mono">
                {line.parts.map((part, index) => (
                  <div key={index}>{money(part.unitPrice)}</div>
                ))}
              </td>
              <td className="py-1 text-right font-mono">
                {line.total === null ? '' : money(line.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.total !== null ? (
        <p className="mt-3 text-right font-medium">
          {t('pricing.quote.totals', {
            subtotal: formatMnt(order.subtotal ?? '0'),
            discount: formatMnt(order.discountTotal ?? '0'),
            total: formatMnt(order.total),
          })}
        </p>
      ) : null}
      <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-muted-foreground">
        <p className="border-t border-border pt-1">{t('sales.print.signedBy')}</p>
        <p className="border-t border-border pt-1">{t('sales.print.receivedBy')}</p>
      </div>
    </>
  );
}
