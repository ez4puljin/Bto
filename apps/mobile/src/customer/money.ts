import { Decimal } from '@tugeel/shared/money';
import type { PaymentMethod } from '@tugeel/shared/sales';
import { daysBetween } from '../dates/calendar';
import { type InvoiceDue, invoiceDueOf } from './account';

// «Тооцоо» and an invoice's page (ADR-0079 #7, the Account and Invoice boards): what the app says
// about finance's figures; it never computes a balance of its own.

/** «2026-10-10 (30 хоног)»: the days from the invoice to its due date. */
export function termDaysOf(invoiceDate: string, dueDate: string): number {
  return Math.max(daysBetween(invoiceDate, dueDate) - 1, 0);
}

/** «· 2,095,200₮-өөс»: an invoice partly paid (or credited) still shows what it was. */
export function partlyOpen(invoice: { total: string; openAmount: string }): boolean {
  const open = new Decimal(invoice.openAmount);
  return open.gt(0) && open.lt(new Decimal(invoice.total));
}

/** An invoice's standing on its page: void, settled, or its due state. */
export type InvoiceStanding = { kind: 'void' } | { kind: 'settled' } | InvoiceDue;

export function invoiceStandingOf(invoice: {
  status: 'ISSUED' | 'VOID';
  openAmount: string;
  daysOverdue: number;
  daysLeft: number;
}): InvoiceStanding {
  if (invoice.status === 'VOID') return { kind: 'void' };
  if (new Decimal(invoice.openAmount).lte(0)) return { kind: 'settled' };
  return invoiceDueOf(invoice);
}

/** A payment's method as the orders name and colour it: «Бэлнээр» green, «Дансаар» blue. */
export function paymentMethodOf(method: 'CASH' | 'BANK'): PaymentMethod {
  return method === 'CASH' ? 'CASH' : 'BANK_TRANSFER';
}

/** A payment lowers the debt («−1,579,200₮»); a refund to the store raises it. */
export function paymentSignOf(kind: 'CUSTOMER_PAYMENT' | 'CUSTOMER_REFUND'): 'minus' | 'plus' {
  return kind === 'CUSTOMER_REFUND' ? 'plus' : 'minus';
}

/** True for an amount above zero (a discount line, a credited amount, a VAT line). */
export function positive(amount: string | null | undefined): boolean {
  return amount !== null && amount !== undefined && new Decimal(amount).gt(0);
}

/**
 * Text with one part in bold: the parts before, at and after the first `part` in `text` («Хугацаа
 * хэтэрсэн **350,000₮** · хамгийн хуучин 10/10»); the whole text alone when it has no such part.
 */
export function splitAround(text: string, part: string): [string, string, string] | null {
  const at = part ? text.indexOf(part) : -1;
  if (at < 0) return null;
  return [text.slice(0, at), part, text.slice(at + part.length)];
}
