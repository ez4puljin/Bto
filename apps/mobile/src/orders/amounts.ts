import type { TFunction } from 'i18next';
import { formatMillions, formatMnt } from '../format/format';

/**
 * A summary's MNT as its cell shows it: millions to one place from a million on («1.2 сая₮»),
 * whole below («850,000₮»).
 */
export function shortMoney(t: TFunction, value: string): string {
  const millions = formatMillions(value);
  return millions
    ? t('mobile.orders.millions', { amount: millions })
    : t('pricing.money', { amount: formatMnt(value) });
}
