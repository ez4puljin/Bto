import type { TFunction } from 'i18next';
import type { AiColumn } from './api';

const NUMBER = /^(-?)(\d+)(\.\d+)?$/;

/**
 * A number as the database printed it, for reading: thousands grouped, decimals kept unless they
 * are all zeros ("1234567.50" → "1,234,567.50", "48.000" → "48"). Never through a float.
 */
export function formatNumberText(value: string): string {
  const match = NUMBER.exec(value);
  if (!match) return value;
  const [, sign = '', whole = '', fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${/^\.0+$/.test(fraction) ? '' : fraction}`;
}

/** The text of one result cell by its column kind (ADR-0045: values arrive as database text). */
export function cellText(value: string | null, kind: AiColumn['kind'], t: TFunction): string {
  if (value === null) return t('common.none');
  switch (kind) {
    case 'number':
      return formatNumberText(value);
    case 'boolean':
      return value === 't' ? t('common.yes') : value === 'f' ? t('common.no') : value;
    case 'datetime':
      // "2026-10-13 21:57:01.592+08" → "2026-10-13 21:57" (Ulaanbaatar time already)
      return value.slice(0, 16);
    default:
      return value;
  }
}
