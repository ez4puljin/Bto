import { Decimal } from '@tugeel/shared/money';
import { useTranslation } from 'react-i18next';

/** Axis ticks in thousands, millions or billions («12 мян», «1.5 сая»). */
export function useShortAmount(): (value: number) => string {
  const { t } = useTranslation();
  return (value) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000)
      return t('reports.common.billions', { value: (value / 1_000_000_000).toFixed(1) });
    if (abs >= 1_000_000)
      return t('reports.common.millions', { value: (value / 1_000_000).toFixed(1) });
    if (abs >= 1_000) return t('reports.common.thousands', { value: Math.round(value / 1_000) });
    return String(Math.round(value));
  };
}

/** A chart number from a NUMERIC string: geometry only, never arithmetic. */
export const plottedNumber = (value: string | null | undefined): number =>
  value === null || value === undefined ? 0 : new Decimal(value).toNumber();

/** User text inside an ECharts tooltip's HTML. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
