import { describe, expect, it } from 'vitest';
import {
  invoiceStandingOf,
  partlyOpen,
  paymentMethodOf,
  paymentSignOf,
  positive,
  splitAround,
  termDaysOf,
} from './money';

describe('«Bto300»: «Тооцоо» and an invoice (ADR-0079 #7)', () => {
  it('counts the days from an invoice to its due date', () => {
    expect(termDaysOf('2026-09-10', '2026-10-10')).toBe(30);
    expect(termDaysOf('2026-10-18', '2026-10-18')).toBe(0);
    expect(termDaysOf('2026-12-17', '2027-01-16')).toBe(30);
    expect(termDaysOf('2026-10-18', '2026-10-01')).toBe(0);
  });

  it('marks an invoice partly paid', () => {
    expect(partlyOpen({ total: '2095200.00', openAmount: '516000.00' })).toBe(true);
    expect(partlyOpen({ total: '350000.00', openAmount: '350000.00' })).toBe(false);
    expect(partlyOpen({ total: '350000.00', openAmount: '0.00' })).toBe(false);
  });

  it('tells an invoice void, settled, overdue, due today or with days left', () => {
    const invoice = {
      status: 'ISSUED' as const,
      openAmount: '350000.00',
      daysOverdue: 0,
      daysLeft: 0,
    };
    expect(invoiceStandingOf({ ...invoice, status: 'VOID' })).toEqual({ kind: 'void' });
    expect(invoiceStandingOf({ ...invoice, openAmount: '0.00', daysOverdue: 8 })).toEqual({
      kind: 'settled',
    });
    expect(invoiceStandingOf({ ...invoice, daysOverdue: 8 })).toEqual({ kind: 'overdue', days: 8 });
    expect(invoiceStandingOf({ ...invoice, daysLeft: 15 })).toEqual({ kind: 'left', days: 15 });
    expect(invoiceStandingOf(invoice)).toEqual({ kind: 'today' });
  });

  it('words a payment’s method and sign', () => {
    expect(paymentMethodOf('CASH')).toBe('CASH');
    expect(paymentMethodOf('BANK')).toBe('BANK_TRANSFER');
    expect(paymentSignOf('CUSTOMER_PAYMENT')).toBe('minus');
    expect(paymentSignOf('CUSTOMER_REFUND')).toBe('plus');
  });

  it('shows only amounts above zero', () => {
    expect(positive('1200.00')).toBe(true);
    expect(positive('0.00')).toBe(false);
    expect(positive(null)).toBe(false);
    expect(positive(undefined)).toBe(false);
  });

  it('splits a text around its bold part', () => {
    expect(splitAround('Хугацаа хэтэрсэн 350,000₮ · 10/10', '350,000₮')).toEqual([
      'Хугацаа хэтэрсэн ',
      '350,000₮',
      ' · 10/10',
    ]);
    expect(splitAround('Төлбөрийг шалгана', 'Н-1')).toBeNull();
    expect(splitAround('abc', '')).toBeNull();
  });
});
