import type { CustomerNotificationKind } from '@tugeel/shared/notifications';
import { monthDay } from '../dates/calendar';
import { weekdayOf } from '../dates/dates';
import { dayName } from '../notifications/feed';
import type { StoreNotificationFacts } from './notifications';

// «Мэдэгдэл» of «Bto300» (ADR-0079 #8, the Notifications board) as pure functions: a day's title and
// the line under a notification's title, as parts the screen words.

/** «Өнөөдөр», «Өчигдөр · 10/17», «10/15 Пүрэв» (the weekday 0 = Sunday … 6 = Saturday). */
export type FeedDay =
  | { kind: 'today' }
  | { kind: 'yesterday'; date: string }
  | { kind: 'date'; date: string; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 };

export function feedDayOf(day: string, today: string | null): FeedDay {
  const name = today ? dayName(day, today) : 'date';
  if (name === 'today') return { kind: 'today' };
  if (name === 'yesterday') return { kind: 'yesterday', date: monthDay(day) };
  return {
    kind: 'date',
    date: monthDay(day),
    weekday: weekdayOf(day) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  };
}

/** A piece of a notification's line, joined with « · » by the screen. */
export type LinePart =
  /** An order's, a payment's or an invoice's number, as it is. */
  | { kind: 'number'; value: string }
  | { kind: 'money'; amount: string }
  /** «1 мөр хойшилсон». */
  | { kind: 'backordered'; lines: number }
  /** A sale's invoice: «Нэхэмжлэх Н-…». */
  | { kind: 'invoice'; number: string }
  /** The invoices a payment settled: «Н-20261012-0004-д». */
  | { kind: 'settled'; numbers: string[] }
  /** An invoice's due date: «хугацаа 10/10». */
  | { kind: 'due'; date: string }
  /** A cancellation's reason: «шалтгаан: …». */
  | { kind: 'reason'; reason: string };

/**
 * The line under a notification's title (the board): «20261017_0005 · 200,800₮ · 1 мөр хойшилсон»,
 * «Т-20261015-0003 · 1,579,200₮ · Н-20261012-0004-д», «Н-20260910-0004 · 350,000₮ · хугацаа
 * 10/10», «20261011_0002 · шалтгаан: …». A fact the payload lacks is left out.
 */
export function storeLineOf(
  kind: CustomerNotificationKind,
  facts: StoreNotificationFacts,
): LinePart[] {
  const parts: (LinePart | null)[] = [];
  const number = (value: string | null): LinePart | null =>
    value ? { kind: 'number', value } : null;
  const money: LinePart | null = facts.amount ? { kind: 'money', amount: facts.amount } : null;
  switch (kind) {
    case 'ORDER_CONFIRMED':
      parts.push(
        number(facts.orderNumber),
        money,
        facts.backorderedLines > 0 ? { kind: 'backordered', lines: facts.backorderedLines } : null,
      );
      break;
    case 'ORDER_CANCELLED':
      parts.push(
        number(facts.orderNumber),
        facts.reason ? { kind: 'reason', reason: facts.reason } : null,
      );
      break;
    case 'ORDER_SOLD':
      parts.push(
        number(facts.orderNumber),
        money,
        facts.invoiceNumber ? { kind: 'invoice', number: facts.invoiceNumber } : null,
      );
      break;
    case 'PAYMENT_RECORDED':
      parts.push(
        number(facts.paymentNumber),
        money,
        facts.invoices.length > 0 ? { kind: 'settled', numbers: facts.invoices } : null,
      );
      break;
    case 'INVOICE_DUE_SOON':
    case 'INVOICE_OVERDUE':
      parts.push(
        number(facts.invoiceNumber),
        money,
        facts.dueDate ? { kind: 'due', date: monthDay(facts.dueDate) } : null,
      );
      break;
  }
  return parts.filter((part): part is LinePart => part !== null);
}
