import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { cn } from '@/lib/utils';
import { type SaleDetail, useSale } from './api';

/**
 * A copy of a till's receipt on paper (`/pos/sales/:id/print`): the lines, the totals and the
 * tenders; never the lottery or the QR (ADR-0063 #8, ADR-0065) — the copy says so.
 */
export function PosSalePrintPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const sale = useSale(id > 0 ? id : null);
  return (
    <PrintFrame
      ready={sale.data !== undefined}
      error={sale.error}
      title={sale.data ? t('pos.sales.printTitle', { number: sale.data.number }) : ''}
    >
      {(narrow) => (sale.data ? <ReceiptSheet sale={sale.data} narrow={narrow} /> : null)}
    </PrintFrame>
  );
}

function ReceiptSheet({ sale, narrow }: { sale: SaleDetail; narrow: boolean }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('pos.fields.soldAt'), formatUbDateTime(Date.parse(sale.soldAt))],
    [t('pos.fields.till'), sale.tillCode],
    [t('pos.fields.cashier'), sale.cashierName ?? ''],
    ...(sale.ddtd ? [[t('pos.fields.ddtd'), sale.ddtd] as [string, string]] : []),
    ...(sale.customerTin
      ? [[t('pos.fields.customerTin'), sale.customerTin] as [string, string]]
      : []),
  ];
  return (
    <article className={cn(narrow ? 'flex flex-col gap-2' : 'flex flex-col gap-6')}>
      <header className={cn('border-b border-dashed border-foreground pb-2', narrow ? '' : 'pb-4')}>
        <h1 className={cn('text-center font-semibold', narrow ? '' : 'text-lg')}>
          {t('brand.company')}
        </h1>
        <h2 className={cn('mt-1 text-center font-bold', narrow ? 'text-sm' : 'text-xl')}>
          {t(`pos.saleKinds.${sale.kind}`)} · {sale.number}
        </h2>
        <p className="mt-1 text-center font-semibold tracking-widest">{t('pos.sales.copyTitle')}</p>
        <dl className="mt-2 flex flex-col gap-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt>{label}</dt>
              <dd className="text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <table className="w-full">
        <thead className={narrow ? 'sr-only' : undefined}>
          <tr className="border-b border-foreground text-left">
            <th className="py-1">{t('pos.fields.product')}</th>
            <th className="py-1 text-right">{t('pos.fields.qty')}</th>
            <th className="py-1 text-right">{t('pos.fields.unitPrice')}</th>
            <th className="py-1 text-right">{t('pos.fields.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.id} className={narrow ? undefined : 'border-b border-border'}>
              <td className="py-0.5 pr-2">{line.productName}</td>
              <td className="py-0.5 text-right font-mono whitespace-nowrap">
                {`${line.qty} × ${formatMnt(line.unitPrice)}`}
              </td>
              {narrow ? null : (
                <td className="py-0.5 text-right font-mono">{formatMnt(line.unitPrice)}</td>
              )}
              <td className="py-0.5 text-right font-mono whitespace-nowrap">
                {formatMnt(line.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex flex-col gap-0.5 border-t border-dashed border-foreground pt-2">
        {sale.discountTotal !== '0.00' ? (
          <div className="flex justify-between gap-2">
            <dt>{t('pos.fields.discount')}</dt>
            <dd className="font-mono">{formatMnt(sale.discountTotal)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 font-bold">
          <dt>{t('pos.fields.total')}</dt>
          <dd className="font-mono">{formatMnt(sale.total)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('pos.fields.vat')}</dt>
          <dd className="font-mono">{formatMnt(sale.vatTotal)}</dd>
        </div>
        {sale.tenders.map((tender) => (
          <div key={tender.id} className="flex justify-between gap-2">
            <dt>{t(`pos.tenderKinds.${tender.kind}`)}</dt>
            <dd className="font-mono">
              {formatMnt(tender.tendered ?? tender.amount)}
              {tender.tendered && tender.tendered !== tender.amount
                ? ` · ${t('pos.fields.change')} ${formatMnt(changeOf(tender.tendered, tender.amount))}`
                : ''}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-center text-xs text-muted-foreground print:text-foreground">
        {t('pos.sales.copyNote')}
      </p>
    </article>
  );
}

/** tendered − amount of two money strings, without a float. */
function changeOf(tendered: string, amount: string): string {
  const cents = (value: string) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  };
  const result = cents(tendered) - cents(amount);
  const abs = result < 0n ? -result : result;
  return `${result < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
