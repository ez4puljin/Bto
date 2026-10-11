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

/** A NUMERIC string without trailing zeros, for a form field ("47.918400" → "47.9184"). */
export function plainDecimal(value: string): string {
  return new Decimal(value).toString();
}
