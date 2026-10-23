import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Decimal, type DecimalInput } from '../money';

dayjs.extend(utc);

/**
 * The customers' settlement days (owner 2026-10-21, ADR-0101): every customer is in one group, and
 * an invoice falls due on its group's settlement day — never `invoice date + N days`.
 * - `DAY_20` («Мөрөн»): purchases from the previous month's 21st to this month's 20th are due on
 *   the 20th.
 * - `MONTH_END` («Орон нутаг»): a month's purchases are due on its last day.
 * A weekend or holiday moves nothing (owner 2026-10-23). Dates are Ulaanbaatar business dates
 * (`businessDate()`), handled as plain calendar dates.
 */
export const SETTLEMENT_GROUPS = ['DAY_20', 'MONTH_END'] as const;
export type SettlementGroup = (typeof SETTLEMENT_GROUPS)[number];

export function isSettlementGroup(value: unknown): value is SettlementGroup {
  return typeof value === 'string' && (SETTLEMENT_GROUPS as readonly string[]).includes(value);
}

/** The settlement period a business date belongs to: its first and last day and its due date. */
export interface SettlementPeriod {
  from: string;
  to: string;
  dueDate: string;
}

const DAY_20_CUTOFF = 20;
const ISO = 'YYYY-MM-DD';

export function settlementPeriodOf(group: SettlementGroup, date: string): SettlementPeriod {
  const day = dayjs.utc(date);
  if (group === 'MONTH_END') {
    return {
      from: day.startOf('month').format(ISO),
      to: day.endOf('month').format(ISO),
      dueDate: day.endOf('month').format(ISO),
    };
  }
  const due =
    day.date() <= DAY_20_CUTOFF ? day.date(DAY_20_CUTOFF) : day.add(1, 'month').date(DAY_20_CUTOFF);
  return {
    from: due
      .subtract(1, 'month')
      .date(DAY_20_CUTOFF + 1)
      .format(ISO),
    to: due.format(ISO),
    dueDate: due.format(ISO),
  };
}

/** The due date of an invoice dated `invoiceDate` for a customer of `group`. */
export function settlementDueDate(group: SettlementGroup, invoiceDate: string): string {
  return settlementPeriodOf(group, invoiceDate).dueDate;
}

/** What the customer app's «Тооцоо хийх өдөр» card shows (ADR-0101 #6). */
export interface SettlementSummary {
  group: SettlementGroup;
  /** The current period's first and last purchase day and its settlement day. */
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  /** Calendar days from `today` to the settlement day (0 on the day itself). */
  daysLeft: number;
  /** Everything due by the settlement day: the positive net receivable. */
  amountDue: Decimal;
  /** The part of `amountDue` already past its due date. */
  overdueAmount: Decimal;
}

/**
 * The current period's settlement for a customer whose receivable nets to `net` with `overdue`
 * past due. Every open purchase falls due on or before the current period's day, so the amount due
 * is the positive net balance (an advance lowers it); the overdue part never exceeds it.
 */
export function settlementSummary(
  group: SettlementGroup,
  today: string,
  balance: { net: DecimalInput; overdue: DecimalInput },
): SettlementSummary {
  const period = settlementPeriodOf(group, today);
  const amountDue = Decimal.max(0, new Decimal(balance.net));
  return {
    group,
    periodFrom: period.from,
    periodTo: period.to,
    dueDate: period.dueDate,
    daysLeft: dayjs.utc(period.dueDate).diff(dayjs.utc(today), 'day'),
    amountDue,
    overdueAmount: Decimal.min(amountDue, Decimal.max(0, new Decimal(balance.overdue))),
  };
}
