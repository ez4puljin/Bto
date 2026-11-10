import { Decimal } from '@tugeel/shared/money';
import { useTranslation } from 'react-i18next';
import { formatCount, formatTugrik } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SalesSummary } from './api';

interface Tile {
  key: string;
  label: string;
  value: string;
  sub?: string | undefined;
}

/**
 * «Посын борлуулалт»'s banner (owner 2026-11-10): the totals of every sale and return the
 * filters match — the count and amount of the sales, then the money by tender kind, each net of
 * its refunds. «Бусад» (vouchers, points) shows only when there is some. The tile look is the
 * count sheet's.
 */
export function SalesTotals({ summary }: { summary: SalesSummary | undefined }) {
  const { t } = useTranslation();
  const money = (value: string | undefined) => (value === undefined ? '—' : formatTugrik(value));
  const returns = summary !== undefined && summary.returnsCount > 0;
  const tiles: Tile[] = [
    {
      key: 'count',
      label: t('pos.sales.totals.salesCount'),
      value: summary === undefined ? '—' : formatCount(summary.salesCount),
      sub: returns
        ? t('pos.sales.totals.returnsCount', { count: formatCount(summary.returnsCount) })
        : undefined,
    },
    {
      key: 'amount',
      label: t('pos.sales.totals.salesAmount'),
      value: money(summary?.total),
      sub: returns
        ? t('pos.sales.totals.returnsAmount', { amount: formatTugrik(summary.returnsTotal) })
        : undefined,
    },
    { key: 'cash', label: t('pos.sales.totals.cash'), value: money(summary?.cash) },
    { key: 'transfer', label: t('pos.sales.totals.transfer'), value: money(summary?.transfer) },
    { key: 'card', label: t('pos.sales.totals.card'), value: money(summary?.card) },
    { key: 'credit', label: t('pos.sales.totals.credit'), value: money(summary?.credit) },
  ];
  const other = summary !== undefined && !new Decimal(summary.other).isZero();
  if (other) {
    tiles.push({
      key: 'other',
      label: t('pos.sales.totals.other'),
      value: formatTugrik(summary.other),
      sub: t('pos.sales.totals.otherSub'),
    });
  }
  return (
    <section
      aria-label={t('pos.sales.totals.label')}
      className={cn(
        'mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3',
        other ? 'xl:grid-cols-7' : 'xl:grid-cols-6',
      )}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          role="group"
          aria-label={tile.label}
          className="rounded-xl bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.06]"
        >
          <div className="text-[0.75rem] text-muted-foreground">{tile.label}</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{tile.value}</div>
          {tile.sub ? <div className="text-[0.75rem] text-muted-foreground">{tile.sub}</div> : null}
        </div>
      ))}
    </section>
  );
}
