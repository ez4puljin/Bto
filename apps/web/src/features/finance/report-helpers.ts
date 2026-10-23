import { Decimal } from '@tugeel/shared/money';
import { formatMnt } from '@/lib/money';

/** A business date `YYYY-MM-DD` as the report pages accept it. */
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A balance (debit − credit) in its debit and credit columns. */
export function sides(value: string): [string, string] {
  const amount = new Decimal(value);
  if (amount.isZero()) return ['', ''];
  return amount.gt(0) ? [formatMnt(value), ''] : ['', formatMnt(amount.negated().toFixed(2))];
}

/** Saves a downloaded file under `name`. */
export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
