import { Decimal } from '@tugeel/shared/money';

// «Тооцоо» and the debt card on «Нүүр» (ADR-0079 #7, the Account and Main boards), from finance's own
// figures (`GET /customer-app/account`): the app only reads and words them.

/** The balance as the card says it: a debt, an advance, or nothing owed. */
export type Debt =
  { kind: 'debt'; amount: string } | { kind: 'advance'; amount: string } | { kind: 'clear' };

export function debtOf(balance: string): Debt {
  const value = new Decimal(balance);
  if (value.gt(0)) return { kind: 'debt', amount: value.toFixed(2) };
  if (value.lt(0)) return { kind: 'advance', amount: value.negated().toFixed(2) };
  return { kind: 'clear' };
}

/** «Хугацаа хэтэрсэн 350,000₮ · 10/10-нд дууссан»: null when nothing is overdue. */
export function overdueOf(account: {
  overdueAmount: string;
  oldestOverdueDate: string | null;
}): { amount: string; since: string | null } | null {
  return new Decimal(account.overdueAmount).gt(0)
    ? { amount: account.overdueAmount, since: account.oldestOverdueDate }
    : null;
}

/**
 * «Зээлийн үлдсэн боломж 1,715,400₮ / 3,000,000₮» and its bar (only when a limit is set, ADR-0079
 * #7): the share still free, from 0 to 1.
 */
export function creditBarOf(account: {
  creditLimit: string | null;
  creditAvailable: string | null;
}): { available: string; limit: string; free: number } | null {
  if (account.creditLimit === null) return null;
  const limit = new Decimal(account.creditLimit);
  const available = Decimal.max(new Decimal(account.creditAvailable ?? '0'), 0);
  const free = limit.gt(0) ? Decimal.min(available.div(limit), 1).toNumber() : 0;
  return { available: available.toFixed(2), limit: limit.toFixed(2), free };
}

/**
 * «Тооцоо хийх өдөр» under the debt (ADR-0101 #6, the Account board): the settlement day and the
 * days to it, «Төлөх дүн» with the purchases it settles («10-р сарын авалт» for a month-end store,
 * «09/21–10/20-ны авалт» for a 20th store), the overdue part in red under it, and the panel's tone:
 * blue while nothing is overdue, red once something is.
 */
export interface SettlementCard {
  dueDate: string;
  days: { kind: 'left'; days: number } | { kind: 'today' };
  amountDue: string;
  purchases: { kind: 'month'; month: number } | { kind: 'range'; from: string; to: string };
  overdue: string | null;
  tone: 'due' | 'overdue';
}

export function settlementCardOf(settlement: {
  group: 'DAY_20' | 'MONTH_END';
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  daysLeft: number;
  amountDue: string;
  overdueAmount: string;
}): SettlementCard {
  const overdue = new Decimal(settlement.overdueAmount).gt(0) ? settlement.overdueAmount : null;
  return {
    dueDate: settlement.dueDate,
    days: settlement.daysLeft > 0 ? { kind: 'left', days: settlement.daysLeft } : { kind: 'today' },
    amountDue: settlement.amountDue,
    purchases:
      settlement.group === 'MONTH_END'
        ? { kind: 'month', month: Number.parseInt(settlement.periodFrom.slice(5, 7), 10) }
        : { kind: 'range', from: settlement.periodFrom, to: settlement.periodTo },
    overdue,
    tone: overdue === null ? 'due' : 'overdue',
  };
}

/** An open invoice's due state: «N хоног хэтэрсэн», «N хоног үлдсэн», or due today. */
export type InvoiceDue =
  { kind: 'overdue'; days: number } | { kind: 'left'; days: number } | { kind: 'today' };

export function invoiceDueOf(invoice: { daysOverdue: number; daysLeft: number }): InvoiceDue {
  if (invoice.daysOverdue > 0) return { kind: 'overdue', days: invoice.daysOverdue };
  if (invoice.daysLeft > 0) return { kind: 'left', days: invoice.daysLeft };
  return { kind: 'today' };
}

/**
 * The checkout's and the cart's credit warning (ADR-0079 #5): the first reason the office may not
 * confirm yet — a hold (never its internal reason), an overdue amount, or the amount over the
 * limit; null when none. The store may send anyway.
 */
export type CreditWarning =
  | { kind: 'hold' }
  | { kind: 'overdue'; amount: string; since: string | null }
  | { kind: 'limit'; excess: string };

export function creditWarningOf(check: {
  warnings: readonly ('HOLD' | 'OVERDUE' | 'LIMIT')[];
  overdueAmount: string;
  oldestOverdueDate: string | null;
  excess: string;
}): CreditWarning | null {
  if (check.warnings.includes('HOLD')) return { kind: 'hold' };
  if (check.warnings.includes('OVERDUE')) {
    return { kind: 'overdue', amount: check.overdueAmount, since: check.oldestOverdueDate };
  }
  if (check.warnings.includes('LIMIT')) return { kind: 'limit', excess: check.excess };
  return null;
}
