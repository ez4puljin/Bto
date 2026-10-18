import { Decimal } from '@tugeel/shared/money';
import { PRINT_KINDS, type PrintKind } from '@tugeel/shared/sales';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useWarehouses } from '@/features/identity/api';
import { useWarehouseName } from '@/features/inventory/helpers';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt, plainDecimal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { type SalesOrder, useSalesOrder } from './api';
import { useOrderBatch } from './pipelines-api';
import { PrintFrame as SharedPrintFrame } from '@/components/print-frame';

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

/**
 * The orders on paper (ADR-0058): the shared frame, ready once the documents and the warehouse
 * names are in; each order on its own sheet.
 */
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
  const warehouses = useWarehouses();
  const ready = (orders?.length ?? 0) > 0 && !warehouses.isPending;
  return (
    <SharedPrintFrame
      ready={ready}
      error={error}
      title={`${title} · ${t(`sales.printKinds.${kind}`)}`}
      printLabel={t('sales.print.print')}
    >
      {(narrow) =>
        (orders ?? []).map((order, index, all) => (
          <section
            key={order.id}
            className={
              index < all.length - 1
                ? cn('break-after-page print:mb-0', narrow ? 'mb-6' : 'mb-10')
                : undefined
            }
          >
            {kind === 'DELIVERY_NOTE' ? (
              <DeliveryNote order={order} narrow={narrow} />
            ) : (
              <PickList order={order} narrow={narrow} />
            )}
          </section>
        ))
      }
    </SharedPrintFrame>
  );
}

/**
 * The company, the document and its number, then the order's header with how it is paid and who
 * entered it (ADR-0058). On the roll everything is black: a thermal printer fades grey.
 */
function Heading({ order, title, narrow }: { order: SalesOrder; title: string; narrow: boolean }) {
  const { t } = useTranslation();
  const rows = [
    { label: t('sales.order.customer'), value: `${order.customerName} · ${order.customerCode}` },
    {
      label: t('sales.order.fulfilment'),
      value: `${t(`sales.fulfilments.${order.fulfilment}`)} · ${order.deliveryDate}`,
    },
    ...(order.addressText ? [{ label: t('sales.order.address'), value: order.addressText }] : []),
    ...(order.contactName || order.contactPhone
      ? [
          {
            label: t('sales.order.contactName'),
            value: [order.contactName, order.contactPhone].filter(Boolean).join(' · '),
          },
        ]
      : []),
    {
      label: t('sales.order.paymentMethod'),
      value: t(`sales.paymentMethods.${order.paymentMethod}`),
    },
    ...(order.createdByName
      ? [{ label: t('sales.order.createdBy'), value: order.createdByName }]
      : []),
    ...(order.note ? [{ label: t('sales.order.note'), value: order.note }] : []),
  ];
  const number = order.number ?? t('sales.order.draftNo', { id: order.id });
  if (narrow) {
    return (
      <header className="border-b border-dashed border-foreground pb-2">
        <h1 className="text-center font-semibold">{t('brand.company')}</h1>
        <h2 className="mt-1 text-center text-sm font-bold">
          {title} · {number}
        </h2>
        <p className="text-center">
          {t('sales.print.printedAt', { at: formatUbDateTime(Date.now()) })}
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2">
          {rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd className="min-w-0 font-medium">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      </header>
    );
  }
  return (
    <header className="mb-4 border-b border-border pb-3">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">{t('brand.company')}</h1>
        <span className="text-xs text-muted-foreground">{formatUbDateTime(Date.now())}</span>
      </div>
      <h2 className="mt-2 text-base font-semibold">
        {title} · {number}
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{row.value}</dd>
          </Fragment>
        ))}
      </dl>
    </header>
  );
}

/**
 * The pick list: a section per warehouse, its name and line count on top (ADR-0056 #7, ADR-0058);
 * on the roll each line takes two or three short rows instead of a table's columns.
 */
function PickList({ order, narrow }: { order: SalesOrder; narrow: boolean }) {
  const { t } = useTranslation();
  const warehouseName = useWarehouseName();
  const sections = [...new Set(order.lines.map((line) => line.warehouseId))].map((warehouseId) => {
    const lines = order.lines.filter((line) => line.warehouseId === warehouseId);
    return {
      warehouseId,
      lines,
      title: `${warehouseName(warehouseId)} · ${t('sales.order.lineCount', { count: lines.length })}`,
    };
  });
  const qty = (value: string, unit: string) =>
    t('sales.order.qtyIn', { qty: plainDecimal(value), unit });
  return (
    <>
      <Heading order={order} title={t('sales.printKinds.PICK_LIST')} narrow={narrow} />
      {sections.map((section) =>
        narrow ? (
          <section key={section.warehouseId} className="mt-3">
            <h3 className="border-y-2 border-foreground py-0.5 text-sm font-bold">
              {section.title}
            </h3>
            <ol>
              {section.lines.map((line) => (
                <li key={line.id} className="border-b border-dashed border-foreground py-1">
                  <p className="font-semibold">{line.productName}</p>
                  <p className="flex justify-between gap-2">
                    <span className="font-mono">{line.productSku}</span>
                    <span className="font-semibold">{qty(line.qty, line.unitName)}</span>
                  </p>
                  <p className="flex justify-between gap-2">
                    <span>
                      {t('sales.print.baseQty')}: {qty(line.qtyApproved, line.baseUnitName)}
                    </span>
                    <span>
                      {line.qtyPicked === null
                        ? '☐ ______'
                        : `${t('sales.print.picked')}: ${plainDecimal(line.qtyPicked)}`}
                    </span>
                  </p>
                  {line.pickBinCode ? (
                    <p>
                      {t('sales.pick.bin')}: {line.pickBinCode}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <section key={section.warehouseId} className="mb-4">
            <h3 className="mb-1 font-semibold">{section.title}</h3>
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
                {section.lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-1 pr-2">
                      <span className="mr-2 font-mono text-muted-foreground">
                        {line.productSku}
                      </span>
                      {line.productName}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {qty(line.qty, line.unitName)}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {qty(line.qtyApproved, line.baseUnitName)}
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
        ),
      )}
      <p className={narrow ? 'mt-3' : 'mt-6 text-xs text-muted-foreground'}>
        {t('sales.print.pickFooter')}
      </p>
    </>
  );
}

/** The delivery note: prices by part, the totals and two signatures; on the roll a row per part. */
function DeliveryNote({ order, narrow }: { order: SalesOrder; narrow: boolean }) {
  const { t } = useTranslation();
  const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
  const delivered = (line: SalesOrder['lines'][number]) =>
    line.qtyDelivered !== null && !new Decimal(line.qtyDelivered).eq(line.qtyBase)
      ? t('sales.print.delivered', {
          qty: plainDecimal(line.qtyDelivered),
          unit: line.baseUnitName,
        })
      : null;
  if (narrow) {
    return (
      <>
        <Heading order={order} title={t('sales.printKinds.DELIVERY_NOTE')} narrow />
        <ul className="mt-2">
          {order.lines.map((line) => (
            <li key={line.id} className="border-b border-dashed border-foreground py-1">
              <p className="font-semibold">{line.productName}</p>
              {line.parts.length > 0 ? (
                line.parts.map((part, index) => (
                  <p key={index} className="flex justify-between gap-2">
                    <span>
                      {t('sales.print.partLine', {
                        qty: plainDecimal(part.qty),
                        unit: part.uomName,
                        price: formatMnt(part.unitPrice),
                      })}
                    </span>
                    <span className="font-mono">{money(part.total)}</span>
                  </p>
                ))
              ) : (
                <p className="flex justify-between gap-2">
                  <span>
                    {t('sales.order.qtyIn', { qty: plainDecimal(line.qty), unit: line.unitName })}
                  </span>
                  <span className="font-mono">{line.total === null ? '' : money(line.total)}</span>
                </p>
              )}
              {delivered(line) ? <p>{delivered(line)}</p> : null}
            </li>
          ))}
        </ul>
        {order.total !== null ? (
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-2">
            <dt>{t('pricing.quote.columns.subtotal')}</dt>
            <dd className="text-right font-mono">{money(order.subtotal ?? '0')}</dd>
            <dt>{t('pricing.quote.columns.discount')}</dt>
            <dd className="text-right font-mono">{money(order.discountTotal ?? '0')}</dd>
            <dt className="font-bold">{t('pricing.quote.columns.total')}</dt>
            <dd className="text-right font-mono font-bold">{money(order.total)}</dd>
          </dl>
        ) : null}
        <div className="mt-6 space-y-6">
          <p>{t('sales.print.signedBy')}</p>
          <p>{t('sales.print.receivedBy')}</p>
        </div>
      </>
    );
  }
  return (
    <>
      <Heading order={order} title={t('sales.printKinds.DELIVERY_NOTE')} narrow={false} />
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
                {delivered(line) ? (
                  <div className="text-xs text-muted-foreground">{delivered(line)}</div>
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
