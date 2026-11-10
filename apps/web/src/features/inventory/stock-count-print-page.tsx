import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { useCompanyName } from '@/features/company/api';
import { formatMnt, formatQty } from '@/lib/money';
import {
  SHEET_FILTERS,
  type StockCountSheetQuery,
  useStockCount,
  useStockCountSheet,
} from './counts-api';
import { SheetTiles } from './stock-count-sheet';
import { groupBySupplier, signedMnt, signedQty, sumsOf } from './stock-count-helpers';

// The count sheet on paper (ADR-0177, printed from the browser as ADR-0058 has it): what the window's
// view and filters show, A4 across, by supplier with the reasons. «PDF» opens the same page; the
// browser's «Save as PDF» names the file after the count's day.

const cell = 'border border-black/30 px-1.5 py-0.5 align-top';
const num = `${cell} text-right tabular-nums`;
const idOf = (value: string | null) => (value ? Number.parseInt(value, 10) : undefined);

export function StockCountPrintPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const [search] = useSearchParams();
  const filter = SHEET_FILTERS.find((value) => value === search.get('filter')) ?? 'DIFFERENT';
  const query: StockCountSheetQuery = {
    filter,
    ...(search.get('q') ? { q: search.get('q') ?? '' } : {}),
    ...(idOf(search.get('supplierId')) ? { supplierId: idOf(search.get('supplierId')) } : {}),
    ...(idOf(search.get('categoryId')) ? { categoryId: idOf(search.get('categoryId')) } : {}),
    ...(idOf(search.get('segmentId')) ? { segmentId: idOf(search.get('segmentId')) } : {}),
  };
  const count = useStockCount(id);
  const sheet = useStockCountSheet(id, query, false);
  const companyName = useCompanyName();
  const rows = useMemo(() => sheet.data?.rows ?? [], [sheet.data]);
  const groups = useMemo(() => groupBySupplier(rows), [rows]);
  const shown = useMemo(() => sumsOf(rows), [rows]);
  const day = count.data?.effectiveDate ?? sheet.data?.priceDate ?? '';
  const title = search.get('pdf')
    ? t('inventory.counts.print.fileName', { date: day })
    : t('inventory.counts.print.title', {
        number: count.data?.number ?? t('inventory.stocktake.noNumber', { id }),
      });
  const numbers = useMemo(() => new Map(rows.map((row, index) => [row.lineId, index + 1])), [rows]);

  return (
    <PrintFrame
      landscape
      ready={count.data !== undefined && sheet.data !== undefined}
      error={count.error ?? sheet.error}
      title={title}
    >
      {() =>
        count.data && sheet.data ? (
          <div className="flex flex-col gap-3">
            <header className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="text-base font-semibold">
                  {t('inventory.counts.print.heading', {
                    view: t(`inventory.counts.sheet.views.${filter}`),
                  })}
                </h1>
                <p className="text-muted-foreground print:text-foreground">
                  {t('inventory.counts.print.subtitle', {
                    company: companyName,
                    warehouse: count.data.warehouseName,
                    number: count.data.number ?? t('inventory.stocktake.noNumber', { id }),
                    date: day,
                  })}
                </p>
              </div>
              <p className="text-muted-foreground print:text-foreground">
                {t('inventory.counts.print.priceDate', { date: sheet.data.priceDate })}
              </p>
            </header>
            <SheetTiles totals={sheet.data.totals} />
            <table className="w-full border-collapse text-[0.6875rem] leading-tight">
              <thead>
                <tr className="bg-black/[0.06]">
                  <th className={num}>{t('inventory.counts.sheet.no')}</th>
                  <th className={cell}>{t('inventory.counts.sheet.code')}</th>
                  <th className={cell}>{t('inventory.counts.sheet.name')}</th>
                  <th className={num}>{t('inventory.counts.expected')}</th>
                  <th className={num}>{t('inventory.counts.counted')}</th>
                  <th className={num}>{t('inventory.counts.difference')}</th>
                  <th className={num}>{t('inventory.counts.sheet.price')}</th>
                  <th className={num}>{t('inventory.counts.sheet.amount')}</th>
                  <th className={cell}>{t('inventory.counts.sheet.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.supplierId ?? 'none'}>
                    <tr className="break-inside-avoid bg-black/[0.03]">
                      <td className={cell} colSpan={9}>
                        <span className="font-semibold">
                          {group.supplierName ?? t('inventory.counts.sheet.noSupplier')}
                        </span>
                        <span className="ml-3">
                          {t('inventory.counts.print.groupLine', {
                            count: group.rows.length,
                            surplusQty: signedQty(group.surplusQty),
                            surplusAmount: signedMnt(group.surplusAmount),
                            shortageQty: signedQty(group.shortageQty),
                            shortageAmount: signedMnt(group.shortageAmount),
                            net: signedMnt(group.netAmount),
                          })}
                        </span>
                      </td>
                    </tr>
                    {group.rows.map((row) => {
                      return (
                        <tr key={row.lineId} className="break-inside-avoid">
                          <td className={num}>{numbers.get(row.lineId)}</td>
                          <td className={cell}>{row.sku}</td>
                          <td className={cell}>
                            {row.name}
                            {row.listed ? null : (
                              <span className="ml-1 italic">
                                {t('inventory.counts.print.added')}
                              </span>
                            )}
                          </td>
                          <td className={num}>
                            {row.expectedQty === null ? '' : formatQty(row.expectedQty)}
                          </td>
                          <td className={num}>
                            {row.countedQty === null ? '' : formatQty(row.countedQty)}
                          </td>
                          <td className={num}>
                            {row.differenceQty === null ? '' : signedQty(row.differenceQty)}
                          </td>
                          <td className={num}>
                            {row.salePrice === null ? '' : formatMnt(row.salePrice)}
                          </td>
                          <td className={num}>
                            {row.differenceAmount === null ? '' : signedMnt(row.differenceAmount)}
                          </td>
                          <td className={cell}>{row.reason ?? ''}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                <tr className="bg-black/[0.06] font-semibold">
                  <td className={num} colSpan={5}>
                    {t('inventory.counts.sheet.shownTotal', {
                      surplusQty: signedQty(shown.surplusQty),
                      surplusAmount: signedMnt(shown.surplusAmount),
                      shortageQty: signedQty(shown.shortageQty),
                      shortageAmount: signedMnt(shown.shortageAmount),
                    })}
                  </td>
                  <td className={num}>{signedQty(shown.netQty)}</td>
                  <td className={cell} />
                  <td className={num}>{signedMnt(shown.netAmount)}</td>
                  <td className={cell} />
                </tr>
              </tbody>
            </table>
            <div className="mt-6 grid grid-cols-3 gap-8 break-inside-avoid">
              {(['counted', 'checked', 'approved'] as const).map((role) => (
                <p key={role} className="border-t border-black/40 pt-1">
                  {t(`inventory.counts.print.signatures.${role}`)}
                </p>
              ))}
            </div>
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
