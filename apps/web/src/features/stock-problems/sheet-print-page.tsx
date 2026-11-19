import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { formatQty } from '@/lib/money';
import { useStockProblemSheet } from './api';
import { hasQty } from './helpers';

/**
 * A morning sheet on paper (`/inventory/stock-problems/sheets/:id/print`): the lines in shelf order
 * with an empty «Тоолсон» column to write in, and the signatures. Opens the print dialog once ready.
 */
export function StockProblemSheetPrintPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const sheet = useStockProblemSheet(id);
  const detail = sheet.data;
  const title = t('stockProblems.print.title');
  return (
    <PrintFrame ready={detail !== undefined} error={sheet.error} title={title}>
      {(narrow) =>
        detail ? (
          <article className="flex flex-col gap-3">
            <header className="border-b border-foreground pb-1.5">
              <h1 className={narrow ? 'font-bold' : 'text-lg font-bold'}>{title}</h1>
              <p className="flex flex-wrap justify-between gap-x-4 text-xs">
                <span>{t('stockProblems.print.warehouse', { name: detail.warehouseName })}</span>
                <span>{t('stockProblems.print.date', { date: detail.sheetDate })}</span>
              </p>
            </header>
            <table className="w-full border-collapse text-xs leading-tight">
              <thead>
                <tr className="border-b border-foreground">
                  <th className="px-1 py-1 text-left font-semibold">
                    {t('stockProblems.print.columns.bin')}
                  </th>
                  <th className="px-1 py-1 text-left font-semibold">
                    {t('stockProblems.print.columns.sku')}
                  </th>
                  <th className="px-1 py-1 text-left font-semibold">
                    {t('stockProblems.print.columns.product')}
                  </th>
                  <th className="px-1 py-1 text-right font-semibold">
                    {t('stockProblems.print.columns.system')}
                  </th>
                  <th className="px-1 py-1 text-right font-semibold">
                    {t('stockProblems.print.columns.red')}
                  </th>
                  <th className="px-1 py-1 text-right font-semibold">
                    {t('stockProblems.print.columns.cut')}
                  </th>
                  <th className="w-[22%] px-1 py-1 text-left font-semibold">
                    {t('stockProblems.print.columns.counted')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr
                    key={line.id}
                    className="break-inside-avoid border-b border-foreground/40 align-top"
                  >
                    <td className="px-1 py-1.5 font-mono">{line.binCode ?? ''}</td>
                    <td className="px-1 py-1.5 font-mono">{line.product.sku}</td>
                    <td className="px-1 py-1.5">{line.product.name}</td>
                    <td className="px-1 py-1.5 text-right font-mono">
                      {formatQty(line.systemQty)}
                    </td>
                    <td className="px-1 py-1.5 text-right font-mono">
                      {hasQty(line.redQty) ? formatQty(line.redQty) : ''}
                    </td>
                    <td className="px-1 py-1.5 text-right font-mono">
                      {hasQty(line.cutQty) ? formatQty(line.cutQty) : ''}
                    </td>
                    <td className="border-l border-foreground/40 px-1 py-1.5" />
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.lines.length === 0 ? <p>{t('stockProblems.print.empty')}</p> : null}
            <footer className="mt-6 flex flex-wrap gap-x-12 gap-y-6 break-inside-avoid text-xs">
              <p className="min-w-[40%] flex-1 border-b border-foreground pb-1">
                {t('stockProblems.print.counted')}
              </p>
              <p className="min-w-[40%] flex-1 border-b border-foreground pb-1">
                {t('stockProblems.print.reviewed')}
              </p>
            </footer>
          </article>
        ) : null
      }
    </PrintFrame>
  );
}
