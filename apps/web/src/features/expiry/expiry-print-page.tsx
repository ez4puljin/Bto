import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PrintFrame } from '@/components/print-frame';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatQty } from '@/lib/money';
import { cn } from '@/lib/utils';
import { type ExpiryItem, useAllExpiryItems, useExpirySummary } from './api';
import { EXPIRY_COLUMN_KEYS, isNumericColumn } from './expiry-columns';
import { daysText, liabilityShort, parseExpiryFilter, URGENCY_ROW, URGENCY_TEXT } from './helpers';

/** Later than the frame's own `@page`, so it wins: a wide list, on one A4 lying down. */
const LANDSCAPE_RULE = '@page { size: A4 landscape; margin: 8mm; }';

/**
 * What the list's filters show, on paper (`/inventory/expiry/print`, ADR-0172 #8): every record,
 * every page of them read first, all the columns. Ready, it opens the browser's print dialog once.
 */
export function ExpiryPrintPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const filter = parseExpiryFilter(params);
  const items = useAllExpiryItems(filter);
  const summary = useExpirySummary();
  const rows = items.data;
  const title = t('expiry.printPage.title');
  return (
    <PrintFrame
      ready={rows !== undefined && summary.data !== undefined}
      error={items.error ?? summary.error}
      title={title}
    >
      {(narrow) =>
        rows && summary.data ? (
          <article className="flex flex-col gap-2">
            {narrow ? null : <style>{LANDSCAPE_RULE}</style>}
            <header className="border-b border-foreground pb-1.5">
              <h1 className={narrow ? 'font-bold' : 'text-base font-bold'}>{title}</h1>
              <p className="text-xs">
                {t('expiry.printPage.meta', {
                  date: summary.data.today,
                  n: formatCount(rows.length),
                })}
              </p>
            </header>
            {narrow ? <PrintRoll rows={rows} /> : <PrintTable rows={rows} />}
          </article>
        ) : null
      }
    </PrintFrame>
  );
}

/** The sheet's table, compact as the old page's print; scrolls on a screen narrower than it. */
function PrintTable({ rows }: { rows: readonly ExpiryItem[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[60rem] border-collapse text-[0.6875rem] leading-tight print:min-w-0">
        <thead>
          <tr className="border-b border-foreground">
            {EXPIRY_COLUMN_KEYS.map((key) => (
              <th
                key={key}
                className={cn(
                  'px-1 py-0.5 font-semibold',
                  isNumericColumn(key) ? 'text-right' : 'text-left',
                )}
              >
                {t(`expiry.columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              className={cn(
                'border-b border-border align-top break-inside-avoid [print-color-adjust:exact]',
                URGENCY_ROW[item.urgency],
              )}
            >
              <td className="px-1 py-0.5">
                <span className="block font-medium">{item.product.name}</span>
                <span className="block font-mono">{item.product.sku}</span>
              </td>
              <td className="px-1 py-0.5">{item.supplier?.name ?? t('common.none')}</td>
              <td className="px-1 py-0.5 break-words whitespace-pre-wrap">{item.note}</td>
              <td className="px-1 py-0.5 font-mono whitespace-nowrap">{item.expiryDate}</td>
              <td className={cn('px-1 py-0.5', URGENCY_TEXT[item.urgency])}>
                {daysText(t, item.daysLeft)}
              </td>
              <td className="px-1 py-0.5 text-right font-mono">{formatQty(item.qtyFloor)}</td>
              <td className="px-1 py-0.5 text-right font-mono">{formatQty(item.qtyWarehouse)}</td>
              <td className="px-1 py-0.5 text-right font-mono font-bold">
                {formatQty(item.qtyTotal)}
              </td>
              <td className="px-1 py-0.5">{t(`expiry.status.${item.status}`)}</td>
              <td className="px-1 py-0.5">
                {item.liability.type === 'NONE' ? null : liabilityShort(t, item.liability)}
                {item.liability.note ? (
                  <span className="block break-words whitespace-pre-wrap">
                    {item.liability.note}
                  </span>
                ) : null}
              </td>
              <td className="px-1 py-0.5">{item.createdByName}</td>
              <td className="px-1 py-0.5 font-mono whitespace-nowrap">
                {formatUbMinute(item.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The frame's 80 mm paper: the same records as rows, black only (ADR-0058). */
function PrintRoll({ rows }: { rows: readonly ExpiryItem[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col">
      {rows.map((item) => (
        <li key={item.id} className="border-b border-dashed border-foreground py-1">
          <p className="font-semibold">{item.product.name}</p>
          <p className="flex justify-between gap-2 font-mono">
            <span>{item.product.sku}</span>
            <span>{item.expiryDate}</span>
          </p>
          <p>{daysText(t, item.daysLeft)}</p>
          <p className="flex justify-between gap-2">
            <span>
              {t('expiry.history.qty', {
                floor: formatQty(item.qtyFloor),
                warehouse: formatQty(item.qtyWarehouse),
              })}
            </span>
            <span className="font-bold">{formatQty(item.qtyTotal)}</span>
          </p>
          <p>{t(`expiry.status.${item.status}`)}</p>
        </li>
      ))}
    </ul>
  );
}
