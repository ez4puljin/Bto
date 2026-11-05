import { Decimal } from '@tugeel/shared/money';
import {
  fillReceiptText,
  type ReceiptAlign,
  type ReceiptSize,
  type ReceiptTextVariable,
} from '@tugeel/shared/pos';
import {
  defaultDocumentLayout,
  type DocumentBlock,
  documentBlockShown,
  type DocumentColumn,
  type DocumentLayout,
  type DocumentTemplateKind,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { cn } from 'cn';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUbDateTime } from '@/lib/dayjs';
import { BINS_SOON } from '@/lib/features';
import { formatMnt, plainDecimal } from '@/lib/money';
import { QrCode } from '@/pos/components/qr-code';
import type { SalesOrder, SalesOrderLine } from './api';

/** The order's facts a document prints (a real order or the editor's made-up one). */
export type DocumentOrder = Pick<
  SalesOrder,
  | 'id'
  | 'number'
  | 'customerName'
  | 'customerCode'
  | 'fulfilment'
  | 'deliveryDate'
  | 'addressText'
  | 'contactName'
  | 'contactPhone'
  | 'paymentMethod'
  | 'createdByName'
  | 'note'
  | 'subtotal'
  | 'discountTotal'
  | 'total'
> & {
  lines: (Pick<
    SalesOrderLine,
    | 'id'
    | 'warehouseId'
    | 'productName'
    | 'productSku'
    | 'qty'
    | 'unitName'
    | 'qtyApproved'
    | 'baseUnitName'
    | 'qtyPicked'
    | 'pickBinCode'
    | 'total'
    | 'qtyDelivered'
    | 'qtyBase'
  > & {
    parts: Pick<SalesOrderLine['parts'][number], 'qty' | 'uomName' | 'unitPrice' | 'total'>[];
  })[];
};

export interface DocumentCompany {
  name: string;
  tin: string | null;
  registerNo: string | null;
}

const ALIGN: Record<ReceiptAlign, string> = {
  LEFT: 'text-left',
  CENTER: 'text-center',
  RIGHT: 'text-right',
};
const SELF: Record<ReceiptAlign, string> = { LEFT: 'mr-auto', CENTER: 'mx-auto', RIGHT: 'ml-auto' };
const TEXT_SIZE: Record<ReceiptSize, string> = {
  SM: 'text-[0.9em]',
  MD: 'text-[1em]',
  LG: 'text-[1.3em]',
};
const BASE: Record<ReceiptSize, string> = {
  SM: 'text-[0.9em]',
  MD: 'text-[1em]',
  LG: 'text-[1.12em]',
};
const SPACE: Record<ReceiptSize, string> = { SM: 'h-2', MD: 'h-4', LG: 'h-8' };
const QR_SIZE: Record<ReceiptSize, string> = {
  SM: 'size-20 print:size-[20mm]',
  MD: 'size-28 print:size-[28mm]',
  LG: 'size-36 print:size-[36mm]',
};
const NUMERIC: readonly DocumentColumn[] = [
  'NO',
  'QTY',
  'BASE_QTY',
  'UNIT_PRICE',
  'TOTAL',
  'PICKED',
  'DELIVERED',
];

interface Context {
  kind: DocumentTemplateKind;
  order: DocumentOrder;
  narrow: boolean;
  company: DocumentCompany;
  printedAt: number;
  warehouseName: (id: number) => string;
  values: Partial<Record<ReceiptTextVariable, string | null>>;
}

/**
 * A wholesale order's document drawn from its template's blocks (ADR-0143): the heading, the
 * order's facts, the lines with the chosen columns in their order (a pick list by warehouse), a
 * delivery note's totals, the signatures, and the admin's texts, logo, QR code, rules and spaces.
 * On A4 the lines are a table; on the 80 mm roll each line takes short rows. With no template the
 * document prints as it did before (ADR-0058).
 */
export function DocumentView(props: {
  kind: DocumentTemplateKind;
  order: DocumentOrder;
  layout: DocumentLayout | null;
  narrow: boolean;
  company: DocumentCompany;
  printedAt: number;
  warehouseName: (id: number) => string;
}) {
  const { t } = useTranslation();
  const layout = props.layout ?? defaultDocumentLayout(props.kind);
  const day = businessDate(new Date(props.printedAt));
  const printed = formatUbDateTime(props.printedAt);
  const context: Context = {
    ...props,
    values: {
      number: props.order.number ?? t('sales.order.draftNo', { id: props.order.id }),
      date: printed.slice(0, 10),
      time: printed.slice(11, 16),
      customer: props.order.customerName,
      total:
        props.order.total === null
          ? null
          : t('pricing.money', { amount: formatMnt(props.order.total) }),
      cashier: props.order.createdByName ?? null,
      store: props.company.name,
    },
  };
  return (
    <div className={BASE[layout.size]}>
      {layout.blocks
        .filter((block) => documentBlockShown(block, day))
        .map((block, index) => (
          <BlockView key={index} block={block} context={context} />
        ))}
    </div>
  );
}

function BlockView({ block, context }: { block: DocumentBlock; context: Context }): ReactNode {
  const { t } = useTranslation();
  const { order, narrow } = context;
  switch (block.type) {
    case 'HEADING':
      return <Heading block={block} context={context} />;
    case 'ORDER_INFO':
      return <OrderInfo fields={block.fields} context={context} />;
    case 'LINES':
      return <Lines block={block} context={context} />;
    case 'TOTALS': {
      if (order.total === null) return null;
      const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
      const big = block.large ? 'text-[1.2em]' : null;
      return (
        <dl
          className={cn(
            'grid grid-cols-[1fr_auto] gap-x-3',
            narrow ? 'mt-2' : 'mt-3 ml-auto w-72 max-w-full',
          )}
        >
          {block.showSubtotal ? (
            <>
              <dt>{t('pricing.quote.columns.subtotal')}</dt>
              <dd className="text-right font-mono">{money(order.subtotal ?? '0')}</dd>
            </>
          ) : null}
          {block.showDiscount && !new Decimal(order.discountTotal ?? '0').isZero() ? (
            <>
              <dt>{t('pricing.quote.columns.discount')}</dt>
              <dd className="text-right font-mono">{money(order.discountTotal ?? '0')}</dd>
            </>
          ) : null}
          <dt className={cn('font-bold', big)}>{t('pricing.quote.columns.total')}</dt>
          <dd className={cn('text-right font-mono font-bold', big)}>{money(order.total)}</dd>
        </dl>
      );
    }
    case 'SIGNATURES':
      return narrow ? (
        <div className="mt-6 space-y-6">
          {block.labels.map((label, index) => (
            <p key={index}>{`${label}: ____________________`}</p>
          ))}
        </div>
      ) : (
        <div
          className="mt-10 grid gap-8 text-[0.85em]"
          style={{
            gridTemplateColumns: `repeat(${Math.min(block.labels.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {block.labels.map((label, index) => (
            <p key={index} className="border-t border-foreground/60 pt-1">
              {label}
            </p>
          ))}
        </div>
      );
    case 'TEXT':
      return (
        <p
          className={cn(
            'my-1 whitespace-pre-line',
            ALIGN[block.align],
            TEXT_SIZE[block.size],
            block.bold ? 'font-semibold' : null,
            block.inverse ? 'rounded-sm bg-foreground px-1.5 py-0.5 text-background' : null,
          )}
        >
          {fillReceiptText(block.text, context.values)}
        </p>
      );
    case 'LOGO':
      return (
        <img
          src={block.image}
          alt=""
          className={cn('my-1 block h-auto [image-rendering:pixelated]', SELF[block.align])}
          style={{ width: `${narrow ? block.width : Math.round(block.width / 2)}%` }}
        />
      );
    case 'QR':
      return (
        <figure className="my-2 text-center">
          <QrCode
            data={block.data}
            label={block.caption ?? block.data}
            className={QR_SIZE[block.size]}
          />
          {block.caption ? (
            <figcaption className="pt-1 text-[0.9em]">{block.caption}</figcaption>
          ) : null}
        </figure>
      );
    case 'DIVIDER':
      return (
        <hr
          className={cn(
            'my-2',
            block.rule === 'DASHED'
              ? 'border-t border-dashed border-foreground/60'
              : block.rule === 'SOLID'
                ? 'border-t border-foreground/60'
                : 'h-1 border-y border-foreground/60',
          )}
        />
      );
    case 'SPACE':
      return <div aria-hidden className={SPACE[block.size]} />;
  }
}

function Heading({
  block,
  context,
}: {
  block: Extract<DocumentBlock, { type: 'HEADING' }>;
  context: Context;
}) {
  const { t } = useTranslation();
  const { order, narrow, company, kind } = context;
  const title = block.title ?? t(`sales.printKinds.${kind}`);
  const number = order.number ?? t('sales.order.draftNo', { id: order.id });
  const tin = block.showTin
    ? [
        company.tin ? t('sales.documentTemplates.tin', { tin: company.tin }) : null,
        company.registerNo
          ? t('sales.documentTemplates.registerNo', { number: company.registerNo })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  if (narrow) {
    return (
      <header className={cn('border-b border-dashed border-foreground pb-2', ALIGN[block.align])}>
        {block.showCompany ? <h1 className="font-semibold">{company.name}</h1> : null}
        {tin ? <p>{tin}</p> : null}
        <h2 className="mt-1 text-[1.15em] font-bold">{`${title} · ${number}`}</h2>
        {block.showPrintedAt ? (
          <p>{t('sales.print.printedAt', { at: formatUbDateTime(context.printedAt) })}</p>
        ) : null}
      </header>
    );
  }
  return (
    <header className={cn('mb-2 border-b border-border pb-2', ALIGN[block.align])}>
      <div
        className={cn(
          'flex items-baseline gap-4',
          block.align === 'CENTER' ? 'justify-center' : 'justify-between',
          block.align === 'RIGHT' ? 'flex-row-reverse' : null,
        )}
      >
        {block.showCompany ? <h1 className="text-[1.3em] font-semibold">{company.name}</h1> : null}
        {block.showPrintedAt ? (
          <span className="text-[0.85em] text-muted-foreground">
            {formatUbDateTime(context.printedAt)}
          </span>
        ) : null}
      </div>
      {tin ? <p className="text-[0.9em] text-muted-foreground">{tin}</p> : null}
      <h2 className="mt-1 text-[1.15em] font-semibold">{`${title} · ${number}`}</h2>
    </header>
  );
}

function OrderInfo({
  fields,
  context,
}: {
  fields: Extract<DocumentBlock, { type: 'ORDER_INFO' }>['fields'];
  context: Context;
}) {
  const { t } = useTranslation();
  const { order, narrow } = context;
  const rows = [
    fields.customer
      ? { label: t('sales.order.customer'), value: `${order.customerName} · ${order.customerCode}` }
      : null,
    fields.fulfilment
      ? {
          label: t('sales.order.fulfilment'),
          value: `${t(`sales.fulfilments.${order.fulfilment}`)} · ${order.deliveryDate}`,
        }
      : null,
    fields.address && order.addressText
      ? { label: t('sales.order.address'), value: order.addressText }
      : null,
    fields.contact && (order.contactName || order.contactPhone)
      ? {
          label: t('sales.order.contactName'),
          value: [order.contactName, order.contactPhone].filter(Boolean).join(' · '),
        }
      : null,
    fields.payment
      ? {
          label: t('sales.order.paymentMethod'),
          value: t(`sales.paymentMethods.${order.paymentMethod}`),
        }
      : null,
    fields.createdBy && order.createdByName
      ? { label: t('sales.order.createdBy'), value: order.createdByName }
      : null,
    fields.note && order.note ? { label: t('sales.order.note'), value: order.note } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  if (rows.length === 0) return null;
  return (
    <dl
      className={cn(
        'grid grid-cols-[auto_1fr]',
        narrow ? 'mt-2 gap-x-2' : 'mt-1 mb-3 gap-x-4 gap-y-0.5',
      )}
    >
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className={narrow ? undefined : 'text-muted-foreground'}>{row.label}</dt>
          <dd className={cn('min-w-0', narrow ? 'font-medium' : null)}>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

type Line = DocumentOrder['lines'][number];

/** The lines: the chosen columns in their order; a pick list in sections per warehouse. */
function Lines({
  block,
  context,
}: {
  block: Extract<DocumentBlock, { type: 'LINES' }>;
  context: Context;
}) {
  const { t } = useTranslation();
  const { order, narrow, kind } = context;
  const columns = block.columns
    .filter((column) => column.on && !(BINS_SOON && column.key === 'BIN'))
    .map((column) => column.key);
  const qty = (value: string, unit: string) =>
    t('sales.order.qtyIn', { qty: plainDecimal(value), unit });
  const money = (value: string) => t('pricing.money', { amount: formatMnt(value) });
  const delivered = (line: Line) =>
    line.qtyDelivered !== null && !new Decimal(line.qtyDelivered).eq(line.qtyBase)
      ? qty(line.qtyDelivered, line.baseUnitName)
      : '';
  const cell = (key: DocumentColumn, line: Line, number: number): ReactNode => {
    switch (key) {
      case 'NO':
        return String(number);
      case 'SKU':
        return line.productSku;
      case 'PRODUCT':
        return line.productName;
      case 'QTY':
        return kind === 'DELIVERY_NOTE' && line.parts.length > 0
          ? line.parts.map((part, index) => (
              <span key={index} className="block">
                {qty(part.qty, part.uomName)}
              </span>
            ))
          : qty(line.qty, line.unitName);
      case 'BASE_QTY':
        return qty(line.qtyApproved, line.baseUnitName);
      case 'BIN':
        return line.pickBinCode ?? '';
      case 'PICKED':
        return line.qtyPicked === null ? '☐ ______' : plainDecimal(line.qtyPicked);
      case 'UNIT_PRICE':
        return line.parts.map((part, index) => (
          <span key={index} className="block">
            {money(part.unitPrice)}
          </span>
        ));
      case 'TOTAL':
        return line.total === null ? '' : money(line.total);
      case 'DELIVERED':
        return delivered(line);
    }
  };
  const header = (key: DocumentColumn) => t(`sales.documentTemplates.columns.${key}`);
  const groups =
    kind === 'PICK_LIST' && block.byWarehouse
      ? [...new Set(order.lines.map((line) => line.warehouseId))].map((warehouseId) => {
          const lines = order.lines.filter((line) => line.warehouseId === warehouseId);
          return {
            key: String(warehouseId),
            title: `${context.warehouseName(warehouseId)} · ${t('sales.order.lineCount', {
              count: lines.length,
            })}`,
            lines,
          };
        })
      : [{ key: 'all', title: null, lines: order.lines }];

  if (narrow) {
    // The roll (ADR-0058): the product on top; a delivery note's priced parts as «qty × price»
    // with their totals; the other columns as short «name: value» pieces.
    const priced = kind === 'DELIVERY_NOTE';
    const rest = columns.filter(
      (key) =>
        key !== 'PRODUCT' &&
        key !== 'NO' &&
        !(priced && (key === 'QTY' || key === 'UNIT_PRICE' || key === 'TOTAL')),
    );
    const plain = (key: DocumentColumn, line: Line, number: number): string => {
      const value = cell(key, line, number);
      return typeof value === 'string' ? value : '';
    };
    return (
      <>
        {groups.map((group) => (
          <section key={group.key} className="mt-2">
            {group.title ? (
              <h3 className="border-y-2 border-foreground py-0.5 font-bold">{group.title}</h3>
            ) : null}
            <ol>
              {group.lines.map((line, index) => (
                <li key={line.id} className="border-b border-dashed border-foreground py-1">
                  <p className="font-semibold">
                    {columns.includes('NO') ? `${index + 1}. ` : ''}
                    {line.productName}
                  </p>
                  {priced
                    ? (line.parts.length > 0
                        ? line.parts
                        : [
                            {
                              qty: line.qty,
                              uomName: line.unitName,
                              unitPrice: null,
                              total: line.total,
                            },
                          ]
                      ).map((part, at) => (
                        <p key={at} className="flex justify-between gap-2">
                          <span>
                            {columns.includes('UNIT_PRICE') && part.unitPrice !== null
                              ? t('sales.print.partLine', {
                                  qty: plainDecimal(part.qty),
                                  unit: part.uomName,
                                  price: formatMnt(part.unitPrice),
                                })
                              : qty(part.qty, part.uomName)}
                          </span>
                          {columns.includes('TOTAL') && part.total !== null ? (
                            <span className="font-mono">{money(part.total)}</span>
                          ) : null}
                        </p>
                      ))
                    : null}
                  {rest.length > 0 ? (
                    <p className="flex flex-wrap justify-between gap-x-3">
                      {rest.map((key) => {
                        const value = plain(key, line, index + 1);
                        if (value === '') return null;
                        const shown =
                          key === 'SKU' || key === 'QTY' ? value : `${header(key)}: ${value}`;
                        return (
                          <span
                            key={key}
                            className={cn(
                              key === 'SKU' ? 'font-mono' : null,
                              key === 'QTY' ? 'font-semibold' : null,
                            )}
                          >
                            {shown}
                          </span>
                        );
                      })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className="mb-3">
          {group.title ? <h3 className="mb-1 font-semibold">{group.title}</h3> : null}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {columns.map((key) => (
                  <th
                    key={key}
                    className={cn(
                      'py-1 pr-2 font-medium',
                      NUMERIC.includes(key) ? 'text-right' : null,
                    )}
                  >
                    {header(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.lines.map((line, index) => (
                <tr key={line.id} className="border-b border-border/60 align-top">
                  {columns.map((key) => (
                    <td
                      key={key}
                      className={cn(
                        'py-1 pr-2',
                        NUMERIC.includes(key) ? 'text-right font-mono' : null,
                        key === 'SKU' || key === 'BIN' ? 'font-mono text-muted-foreground' : null,
                      )}
                    >
                      {cell(key, line, index + 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
