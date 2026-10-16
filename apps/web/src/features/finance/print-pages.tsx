import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { cn } from '@/lib/utils';
import { type InvoiceDetail, type PaymentDetail, useInvoice, usePayment } from './api';

/** An invoice on paper (`/finance/invoices/:id/print`): A4 or the 80 mm roll (ADR-0058). */
export function InvoicePrintPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const invoice = useInvoice(id > 0 ? id : null);
  return (
    <PrintFrame
      ready={invoice.data !== undefined}
      error={invoice.error}
      title={
        invoice.data
          ? t('finance.print.tabTitle', {
              number: invoice.data.number,
              kind: t('finance.print.invoice'),
            })
          : ''
      }
    >
      {(narrow) => (invoice.data ? <InvoiceSheet invoice={invoice.data} narrow={narrow} /> : null)}
    </PrintFrame>
  );
}

/** A voucher on paper (`/finance/payments/:id/print`): the receipt the payer takes away. */
export function PaymentPrintPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const payment = usePayment(id > 0 ? id : null);
  const kind =
    payment.data?.direction === 'OUT'
      ? t('finance.print.voucherOut')
      : t('finance.print.voucherIn');
  return (
    <PrintFrame
      ready={payment.data !== undefined}
      error={payment.error}
      title={payment.data ? t('finance.print.tabTitle', { number: payment.data.number, kind }) : ''}
    >
      {(narrow) => (payment.data ? <VoucherSheet payment={payment.data} narrow={narrow} /> : null)}
    </PrintFrame>
  );
}

function Heading({
  title,
  number,
  rows,
  narrow,
}: {
  title: string;
  number: string;
  rows: [string, string][];
  narrow: boolean;
}) {
  const { t } = useTranslation();
  if (narrow) {
    return (
      <header className="border-b border-dashed border-foreground pb-2">
        <h1 className="text-center font-semibold">{t('brand.company')}</h1>
        <h2 className="mt-1 text-center text-sm font-bold">
          {title} · {number}
        </h2>
        <dl className="mt-2 flex flex-col gap-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt>{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
    );
  }
  return (
    <header className="mb-6 flex items-start justify-between gap-6 border-b border-foreground pb-4">
      <div>
        <h1 className="text-lg font-semibold">{t('brand.company')}</h1>
        <h2 className="mt-2 text-2xl font-bold">{title}</h2>
        <p className="font-mono text-base">{number}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground print:text-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

function InvoiceSheet({ invoice, narrow }: { invoice: InvoiceDetail; narrow: boolean }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('finance.print.buyer'), `${invoice.customerName} · ${invoice.customerCode}`],
    [t('finance.fields.date'), invoice.invoiceDate],
    [t('finance.print.dueDate'), invoice.dueDate],
    ...(invoice.orderNumber
      ? [[t('finance.fields.order'), invoice.orderNumber] as [string, string]]
      : []),
    [t('finance.fields.paymentMethod'), t(`sales.paymentMethods.${invoice.paymentMethod}`)],
  ];
  const cell = cn('py-1 align-top', narrow ? 'px-0' : 'px-2');
  return (
    <article>
      <Heading
        title={t('finance.print.invoice')}
        number={invoice.number}
        rows={rows}
        narrow={narrow}
      />
      <table className={cn('w-full border-collapse', narrow ? 'mt-2 text-xs' : 'text-sm')}>
        <thead>
          <tr className="border-b border-foreground text-left">
            {!narrow ? <th className={cell}>{t('finance.print.lineNo')}</th> : null}
            <th className={cell}>{t('finance.print.product')}</th>
            <th className={cn(cell, 'text-right')}>{t('finance.print.qty')}</th>
            {!narrow ? <th className={cell}>{t('finance.print.unit')}</th> : null}
            <th className={cn(cell, 'text-right')}>{t('finance.print.unitPrice')}</th>
            <th className={cn(cell, 'text-right')}>{t('finance.print.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-dashed border-foreground/40">
              {!narrow ? <td className={cell}>{line.lineNo}</td> : null}
              <td className={cell}>
                {line.productName}
                {narrow ? <span className="block text-[10px]">{line.uomName}</span> : null}
              </td>
              <td className={cn(cell, 'text-right font-mono')}>{line.qty}</td>
              {!narrow ? <td className={cell}>{line.uomName}</td> : null}
              <td className={cn(cell, 'text-right font-mono')}>{formatMnt(line.unitPrice)}</td>
              <td className={cn(cell, 'text-right font-mono')}>{formatMnt(line.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={narrow ? 3 : 5} className={cn(cell, 'text-right font-semibold')}>
              {t('finance.print.totals')}
            </td>
            <td className={cn(cell, 'text-right font-mono font-semibold')}>
              {formatMnt(invoice.total)}
            </td>
          </tr>
          <tr>
            <td colSpan={narrow ? 3 : 5} className={cn(cell, 'text-right')}>
              {t('finance.print.vatIncluded')}
            </td>
            <td className={cn(cell, 'text-right font-mono')}>{formatMnt(invoice.vatTotal)}</td>
          </tr>
          <tr>
            <td colSpan={narrow ? 3 : 5} className={cn(cell, 'text-right')}>
              {t('finance.print.open')}
            </td>
            <td className={cn(cell, 'text-right font-mono')}>{formatMnt(invoice.openAmount)}</td>
          </tr>
        </tfoot>
      </table>
      <footer
        className={cn(
          'flex justify-between gap-4',
          narrow ? 'mt-3 flex-col text-[10px]' : 'mt-10 text-sm',
        )}
      >
        <p>
          {t('finance.print.issuedBy')}: {invoice.createdByName ?? ''} ____________________
        </p>
        <p>{t('finance.print.received')}: ____________________</p>
      </footer>
      <p
        className={cn(
          'text-muted-foreground print:text-foreground',
          narrow ? 'mt-2 text-[10px]' : 'mt-4 text-xs',
        )}
      >
        {t('sales.print.printedAt', { at: formatUbDateTime(Date.now()) })}
      </p>
    </article>
  );
}

function VoucherSheet({ payment, narrow }: { payment: PaymentDetail; narrow: boolean }) {
  const { t } = useTranslation();
  const out = payment.direction === 'OUT';
  const party = payment.customerName ?? payment.counterpartyName ?? payment.glAccountName ?? '';
  const rows: [string, string][] = [
    [out ? t('finance.print.paidTo') : t('finance.print.receivedFrom'), party],
    [t('finance.fields.date'), payment.paidOn],
    [t('finance.fields.moneyAccount'), payment.moneyAccountName],
    [t('finance.fields.kind'), t(`finance.paymentKinds.${payment.kind}`)],
    ...(payment.reference
      ? [[t('finance.fields.reference'), payment.reference] as [string, string]]
      : []),
  ];
  return (
    <article>
      <Heading
        title={out ? t('finance.print.voucherOut') : t('finance.print.voucherIn')}
        number={payment.number}
        rows={rows}
        narrow={narrow}
      />
      <p className={cn('flex items-baseline justify-between', narrow ? 'mt-2' : 'mt-6 text-lg')}>
        <span>{t('finance.print.amount')}</span>
        <span className="font-mono font-bold">{formatMnt(payment.amount)}₮</span>
      </p>
      {payment.description ? (
        <p className={narrow ? 'mt-1' : 'mt-3'}>{payment.description}</p>
      ) : null}
      {payment.allocations.length > 0 ? (
        <ul className={cn('flex flex-col gap-0.5', narrow ? 'mt-2 text-[10px]' : 'mt-4 text-sm')}>
          {payment.allocations
            .filter((allocation) => allocation.voidedAt === null)
            .map((allocation) => (
              <li key={allocation.id} className="flex justify-between gap-2 font-mono">
                <span>{allocation.invoiceNumber}</span>
                <span>{formatMnt(allocation.amount)}</span>
              </li>
            ))}
        </ul>
      ) : null}
      <footer
        className={cn(
          'flex justify-between gap-4',
          narrow ? 'mt-3 flex-col text-[10px]' : 'mt-10 text-sm',
        )}
      >
        <p>
          {t('finance.print.cashier')}: {payment.createdByName ?? ''} ____________________
        </p>
        <p>
          {t('finance.print.payer')}: {payment.collectedByName ?? ''} ____________________
        </p>
      </footer>
      <p
        className={cn(
          'text-muted-foreground print:text-foreground',
          narrow ? 'mt-2 text-[10px]' : 'mt-4 text-xs',
        )}
      >
        {t('sales.print.printedAt', { at: formatUbDateTime(Date.now()) })}
      </p>
    </article>
  );
}
