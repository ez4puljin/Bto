import { Decimal } from '@tugeel/shared/money';

/**
 * MNT for reading: thousands grouped with commas, cents only when there are any
 * ("5000000.00" → "5,000,000", "1250.5" → "1,250.50"). Never through a float.
 */
export function formatMnt(value: string): string {
  const [whole = '0', cents = '00'] = new Decimal(value).toFixed(2).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.slice(sign.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${cents === '00' ? '' : `.${cents}`}`;
}

/** A count for reading, thousands grouped with commas (1751 → "1,751"). */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A NUMERIC string without trailing zeros, for a form field ("47.918400" → "47.9184"). */
export function plainDecimal(value: string): string {
  return new Decimal(value).toString();
}

/** MNT with its sign, for lists, cards and panels («12,000₮»); journals and ledgers print plain numbers. */
export function formatTugrik(value: string): string {
  return `${formatMnt(value)}₮`;
}

/** A quantity for reading: thousands grouped, trailing zeros dropped ("12000.000" → "12,000"). */
export function formatQty(value: string): string {
  const [whole = '0', fraction = ''] = new Decimal(value).toFixed().split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = whole.slice(sign.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}
