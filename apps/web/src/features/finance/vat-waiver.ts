import type { CustomerCounterAccount } from './api';

/** «520201 Борлуулалтын хөнгөлөлт (анхдагч)», or the customer's own account. */
export function counterAccountLabel(
  row: CustomerCounterAccount | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!row) return '…';
  if (!row.account) return t('finance.vatWaiver.counterAccount.missing');
  return row.own
    ? `${row.account.code} ${row.account.name}`
    : t('finance.vatWaiver.counterAccount.default', {
        code: row.account.code,
        name: row.account.name,
      });
}
