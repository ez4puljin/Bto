import type { components } from '@tugeel/api-client';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { PrintFrame } from '@/components/print-frame';
import { useCompanyName } from '@/features/company/api';
import { formatMnt, formatQty } from '@/lib/money';
import { unwrap } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { QrCode } from '@/pos/components/qr-code';

type Printable = components['schemas']['EbarimtPrintableReceipt'];
type Line = components['schemas']['EbarimtReceiptLine'];

/**
 * A wholesale e-Barimt receipt on paper (`/finance/ebarimt-receipts/:id/print`, ADR-0185): seller
 * and TIN, ДДТД, date, lines, totals with VAT and city tax apart, the buyer for a company's
 * receipt, and — on the one print while the server still holds them — the lottery after the word
 * «Сугалаа» and a sharp QR code; every later print is a copy («ХУУЛБАР»). The page asks once and
 * keeps the answer only while it is open: the secrets are never stored in the browser.
 */
export function EbarimtReceiptPrintPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const printable = useQuery({
    // Asked once per page: the first answer carries the secrets, a second would be a copy.
    queryKey: ['finance', 'ebarimt-receipts', 'print', id],
    queryFn: async () =>
      unwrap(await api.POST('/api/v1/ebarimt/receipts/{id}/print', { params: { path: { id } } })),
    enabled: id > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <PrintFrame
      ready={printable.data !== undefined}
      error={printable.error}
      title={
        printable.data
          ? t('finance.ebarimtReceipts.sheet.printTitle', {
              number: printable.data.receipt.docNumber,
            })
          : ''
      }
    >
      {(narrow) => (printable.data ? <Sheet printable={printable.data} narrow={narrow} /> : null)}
    </PrintFrame>
  );
}

function Sheet({ printable, narrow }: { printable: Printable; narrow: boolean }) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const { receipt, secrets } = printable;
  const b2b = receipt.receiptType === 'B2B';
  const facts: [string, string][] = [
    [t('finance.ebarimtReceipts.sheet.sellerTin'), receipt.merchantTin ?? ''],
    [t('finance.ebarimtReceipts.sheet.ddtd'), receipt.ddtd ?? ''],
    [t('finance.ebarimtReceipts.sheet.date'), receipt.posapiDate ?? ''],
    [t('finance.ebarimtReceipts.sheet.invoice'), receipt.docNumber],
    ...(b2b
      ? ([
          [t('finance.ebarimtReceipts.sheet.buyer'), receipt.buyerName],
          [t('finance.ebarimtReceipts.sheet.buyerTin'), receipt.customerTin ?? ''],
        ] as [string, string][])
      : receipt.consumerNo
        ? ([[t('finance.ebarimtReceipts.sheet.consumerNo'), receipt.consumerNo]] as [
            string,
            string,
          ][])
        : []),
  ];
  return (
    <article className={cn('flex flex-col', narrow ? 'gap-2' : 'gap-5')}>
      <header className={cn('border-b border-dashed border-foreground', narrow ? 'pb-2' : 'pb-4')}>
        <h1 className={cn('text-center font-semibold', narrow ? '' : 'text-lg')}>
          {receipt.merchantName || companyName}
        </h1>
        <h2 className={cn('mt-1 text-center font-bold', narrow ? 'text-sm' : 'text-xl')}>
          {t('finance.ebarimtReceipts.sheet.title')} ·{' '}
          {t(`finance.ebarimtReceipts.types.${receipt.receiptType}`)}
        </h2>
        {printable.copy ? (
          <p className="mt-1 text-center font-semibold tracking-widest">
            {t('finance.ebarimtReceipts.sheet.copy')}
          </p>
        ) : null}
        <dl className="mt-2 flex flex-col gap-0.5">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt>{label}</dt>
              <dd className="text-right font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <table className="w-full">
        <thead className={narrow ? 'sr-only' : undefined}>
          <tr className="border-b border-foreground text-left">
            <th className="py-1">{t('finance.ebarimtReceipts.sheet.product')}</th>
            <th className="py-1 text-right">{t('finance.ebarimtReceipts.sheet.qty')}</th>
            <th className="py-1 text-right">{t('finance.ebarimtReceipts.sheet.unitPrice')}</th>
            <th className="py-1 text-right">{t('finance.ebarimtReceipts.sheet.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            // Lines carry no id of their own: their order on the receipt is their key.
            <tr key={index} className={narrow ? undefined : 'border-b border-border'}>
              <td className="py-0.5 pr-2">{line.name}</td>
              <td className="py-0.5 text-right font-mono whitespace-nowrap">
                {narrow
                  ? `${formatQty(line.qty)} × ${formatMnt(unitPrice(line))}`
                  : `${formatQty(line.qty)} ${line.measureUnit}`}
              </td>
              {narrow ? null : (
                <td className="py-0.5 text-right font-mono">{formatMnt(unitPrice(line))}</td>
              )}
              <td className="py-0.5 text-right font-mono whitespace-nowrap">
                {formatMnt(line.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex flex-col gap-0.5 border-t border-dashed border-foreground pt-2">
        <div className="flex justify-between gap-2 font-bold">
          <dt>{t('finance.ebarimtReceipts.sheet.total')}</dt>
          <dd className="font-mono">{formatMnt(receipt.total)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('finance.ebarimtReceipts.sheet.vat')}</dt>
          <dd className="font-mono">{formatMnt(receipt.vatTotal)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('finance.ebarimtReceipts.sheet.cityTax')}</dt>
          <dd className="font-mono">{formatMnt(receipt.cityTaxTotal)}</dd>
        </div>
        {receipt.payments.map((payment) => (
          <div key={payment.code} className="flex justify-between gap-2">
            <dt>{t(`finance.ebarimtReceipts.payments.${payment.code}`)}</dt>
            <dd className="font-mono">{formatMnt(payment.amount)}</dd>
          </div>
        ))}
      </dl>
      {secrets ? (
        <section
          aria-label={t('finance.ebarimtReceipts.sheet.title')}
          className="flex flex-col gap-2 border-t border-dashed border-foreground pt-3 text-center"
        >
          {/* A company's receipt takes no part in the lottery. */}
          {secrets.lottery && !b2b ? (
            <p className="text-[1.1em] font-semibold">
              {t('finance.ebarimtReceipts.sheet.lottery', { lottery: secrets.lottery })}
            </p>
          ) : null}
          {secrets.qrData ? (
            <QrCode data={secrets.qrData} label={t('finance.ebarimtReceipts.sheet.qr')} />
          ) : null}
        </section>
      ) : (
        <p className="text-center text-xs text-muted-foreground print:text-foreground">
          {t('finance.ebarimtReceipts.sheet.copyNote')}
        </p>
      )}
    </article>
  );
}

/** total ÷ qty of two decimal strings in whole hundredths, without a float (display only). */
function unitPrice(line: Line): string {
  const scaled = (value: string, digits: number) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(digits, '0').slice(0, digits));
  };
  const qty = scaled(line.qty, 3);
  if (qty <= 0n) return line.total;
  // cents × 1000 ÷ thousandths, rounded half up.
  const cents = (scaled(line.total, 2) * 1000n * 2n + qty) / (qty * 2n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
