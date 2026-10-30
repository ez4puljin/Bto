import { Decimal } from '@tugeel/shared/money';
import { formatVoucherCode } from '@tugeel/shared/pos';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { useCompany, useCompanyName } from '@/features/company/api';
import { Code128Svg } from '@/lib/barcode/code128-svg';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { type VoucherBatchDetail, useVoucherBatch, voucherValueText } from './vouchers-api';

const CARDS_PER_SHEET = 10;
/** 2 × 90 mm across and 5 × 54 mm down inside these margins of an A4 sheet (210 × 297 mm). */
const SHEET_RULE = '@page { size: A4; margin: 10mm 15mm; }';

/**
 * A batch on paper (`/pos/vouchers/:id/print`, ADR-0110): its coupon or voucher cards, ten to an
 * A4 sheet, each with its Code 128 barcode; or, with `?used=1`, the list of a partner's used
 * vouchers that goes with its invoices.
 */
export function PosVoucherPrintPage() {
  const id = Number.parseInt(useParams().id ?? '', 10);
  const [search] = useSearchParams();
  const batch = useVoucherBatch(id > 0 ? id : null);
  const company = useCompany();
  const ready = batch.data !== undefined && !company.isPending;
  return search.get('used') === '1' ? (
    <UsedListPage batch={batch.data} ready={ready} error={batch.error} />
  ) : (
    <CardsPage batch={batch.data} ready={ready} error={batch.error} />
  );
}

/** The cards: always A4, so the frame has no paper switch; the print dialog opens once. */
function CardsPage({
  batch,
  ready,
  error,
}: {
  batch: VoucherBatchDetail | undefined;
  ready: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const printed = useRef(false);
  const title = batch ? t('pos.vouchers.print.title', { number: batch.number }) : '';
  useEffect(() => {
    if (ready) document.title = title;
  }, [ready, title]);
  useEffect(() => {
    if (!ready || printed.current) return;
    const timer = window.setTimeout(() => {
      printed.current = true;
      window.print();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const sheets: VoucherBatchDetail['codes'][] = [];
  for (let index = 0; batch && index < batch.codes.length; index += CARDS_PER_SHEET) {
    sheets.push(batch.codes.slice(index, index + CARDS_PER_SHEET));
  }
  return (
    <div className="p-6 text-foreground print:p-0">
      <style>{SHEET_RULE}</style>
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full flex-wrap items-center gap-2 print:hidden">
        <Button disabled={!ready} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
        <Button variant="outline" onClick={() => window.close()}>
          {t('common.close')}
        </Button>
      </div>
      <div className="mx-auto w-[210mm] max-w-full print:hidden">
        <ProblemAlert problem={problemFromError(error)} />
      </div>
      {batch ? (
        <div className="flex flex-col items-center gap-6 print:block">
          {sheets.map((codes, index) => (
            <section
              key={codes[0]?.id ?? index}
              aria-label={t('pos.vouchers.print.title', { number: batch.number })}
              className={cn(
                'grid w-[210mm] grid-cols-[repeat(2,90mm)] grid-rows-[repeat(5,54mm)] content-start justify-center bg-background px-[15mm] py-[10mm] shadow-card print:w-auto print:p-0 print:shadow-none',
                index < sheets.length - 1 ? 'break-after-page' : '',
              )}
            >
              {codes.map((code) => (
                <VoucherCard key={code.id} batch={batch} code={code.code} />
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VoucherCard({ batch, code }: { batch: VoucherBatchDetail; code: string }) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const formatted = formatVoucherCode(code);
  return (
    <article className="flex h-[54mm] w-[90mm] flex-col overflow-hidden border border-dashed border-foreground px-[4mm] py-[3mm] break-inside-avoid">
      <header className="flex items-baseline justify-between gap-2 text-[8pt]">
        <span className="truncate font-semibold">{companyName}</span>
        <span className="shrink-0 font-semibold tracking-widest uppercase">
          {t(`pos.vouchers.cardKinds.${batch.kind}`)}
        </span>
      </header>
      <p className="mt-[1mm] text-[22pt] leading-none font-bold tabular-nums">
        {voucherValueText(batch)}
      </p>
      <p className="mt-[1mm] truncate text-[9pt] font-medium">{batch.name}</p>
      {batch.kind === 'PARTNER' && batch.customerName ? (
        <p className="truncate text-[8pt]">{batch.customerName}</p>
      ) : null}
      <p className="text-[8pt]">
        {t('pos.vouchers.print.validity', { from: batch.validFrom, to: batch.validTo })}
      </p>
      <div className="mt-auto flex flex-col items-center">
        <Code128Svg value={code} label={formatted} className="h-[10mm] w-[60mm]" />
        <span className="font-mono text-[9pt] tracking-wider">{formatted}</span>
      </div>
    </article>
  );
}

/** A partner's used vouchers: each code's sale, day, what it paid, its face value, the invoice. */
function UsedListPage({
  batch,
  ready,
  error,
}: {
  batch: VoucherBatchDetail | undefined;
  ready: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  return (
    <PrintFrame
      ready={ready}
      error={error}
      title={batch ? t('pos.vouchers.print.usedTitle', { number: batch.number }) : ''}
    >
      {(narrow) => (batch ? <UsedList batch={batch} narrow={narrow} /> : null)}
    </PrintFrame>
  );
}

function UsedList({ batch, narrow }: { batch: VoucherBatchDetail; narrow: boolean }) {
  const { t } = useTranslation();
  const companyName = useCompanyName();
  const uses = [...batch.uses].sort((a, b) => a.soldAt.localeCompare(b.soldAt));
  const faceTotal = uses.reduce((sum, use) => sum.plus(use.face), new Decimal(0)).toFixed(2);
  const amountTotal = uses.reduce((sum, use) => sum.plus(use.amount), new Decimal(0)).toFixed(2);
  return (
    <article className="flex flex-col gap-4">
      <header className="border-b border-foreground pb-2">
        <p className="font-semibold">{companyName}</p>
        <h1 className={cn('font-bold', narrow ? 'text-sm' : 'text-lg')}>
          {t('pos.vouchers.print.usedHeading')}
        </h1>
        <dl className="mt-2 flex flex-col gap-0.5">
          {(
            [
              [t('pos.vouchers.fields.partner'), batch.customerName ?? ''],
              [t('pos.vouchers.fields.number'), `${batch.number} · ${batch.name}`],
              [t('pos.vouchers.fields.face'), voucherValueText(batch)],
              [t('pos.vouchers.fields.validity'), `${batch.validFrom} – ${batch.validTo}`],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt>{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </header>
      {uses.length === 0 ? (
        <p>{t('pos.vouchers.print.usedEmpty')}</p>
      ) : (
        <table className={cn('w-full', narrow ? 'text-[0.6875rem]' : '')}>
          <thead>
            <tr className="border-b border-foreground text-left">
              <th className="py-1 pr-2">{t('pos.vouchers.fields.code')}</th>
              <th className="py-1 pr-2">{t('pos.vouchers.fields.sale')}</th>
              <th className="py-1 pr-2">{t('pos.vouchers.fields.usedAt')}</th>
              <th className="py-1 pr-2 text-right">{t('pos.vouchers.fields.amountUsed')}</th>
              <th className="py-1 pr-2 text-right">{t('pos.vouchers.fields.face')}</th>
              <th className="py-1">{t('pos.vouchers.fields.invoice')}</th>
            </tr>
          </thead>
          <tbody>
            {uses.map((use) => (
              <tr key={use.id} className="border-b border-border">
                <td className="py-0.5 pr-2 font-mono whitespace-nowrap">
                  {formatVoucherCode(use.code)}
                </td>
                <td className="py-0.5 pr-2 font-mono">{use.saleNumber}</td>
                <td className="py-0.5 pr-2 font-mono whitespace-nowrap">
                  {formatUbDateTime(Date.parse(use.soldAt))}
                </td>
                <td className="py-0.5 pr-2 text-right font-mono">{formatMnt(use.amount)}</td>
                <td className="py-0.5 pr-2 text-right font-mono">{formatMnt(use.face)}</td>
                <td className="py-0.5 font-mono">{use.invoiceNumber ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="pt-1 pr-2" colSpan={3}>
                {t('pos.vouchers.print.total')}
              </td>
              <td className="pt-1 pr-2 text-right font-mono">{formatMnt(amountTotal)}</td>
              <td className="pt-1 pr-2 text-right font-mono">{formatMnt(faceTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </article>
  );
}
