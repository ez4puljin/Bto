import { describe, expect, it } from 'vitest';
import type { AppProblem } from '../api/problem';
import { feedDayOf, storeLineOf } from './feed-lines';
import {
  cartTotalOf,
  contactInitialsOf,
  homeFavourites,
  inOrderOf,
  orderDayOf,
  phoneShown,
  shownContacts,
} from './home';
import { storeFactsOf } from './notifications';
import { minutesOf, signInMessageOf } from './sign-in-problems';

describe('«Bto300» «Нүүр» (ADR-0079 #13, #14)', () => {
  it('draws a contact with the first letters of its role', () => {
    expect(contactInitialsOf('Захиалга, оффис')).toBe('ЗО');
    expect(contactInitialsOf('Борлуулалтын менежер')).toBe('БМ');
    expect(contactInitialsOf('Нягтлан бодогч, тооцоо')).toBe('НБ');
    expect(contactInitialsOf('  агуулах — хүргэлт ')).toBe('АХ');
    expect(contactInitialsOf('(Оффис)')).toBe('О');
    expect(contactInitialsOf('')).toBe('');
  });

  it('lists only the contacts the admins show, in their order', () => {
    const rows = [
      { id: 1, shown: true },
      { id: 2, shown: false },
      { id: 3, shown: true },
    ];
    expect(shownContacts(rows).map((row) => row.id)).toEqual([1, 3]);
  });

  it('shows a Mongolian number in groups and leaves anything else', () => {
    expect(phoneShown('+97699112233')).toBe('+976 9911 2233');
    expect(phoneShown('+976 9911 2233')).toBe('+976 9911 2233');
    expect(phoneShown('7011-2233')).toBe('7011-2233');
  });

  it('takes the newest three stars and keeps their order', () => {
    expect(homeFavourites([9, 4, 4, 7, 1])).toEqual([9, 4, 7]);
    expect(homeFavourites([])).toEqual([]);
    const products = [{ id: 4 }, { id: 9 }];
    expect(inOrderOf([9, 4, 7], products)).toEqual([{ id: 9 }, { id: 4 }]);
  });

  it('names a recent order’s day against the server’s today', () => {
    expect(orderDayOf('2026-10-18', '2026-10-18')).toEqual({ kind: 'today' });
    expect(orderDayOf('2026-10-17', '2026-10-18')).toEqual({ kind: 'yesterday' });
    expect(orderDayOf('2026-10-15', '2026-10-18')).toEqual({ kind: 'date', date: '10/15' });
    expect(orderDayOf('2026-10-18', null)).toEqual({ kind: 'date', date: '10/18' });
  });

  it('gives the unsent cart an amount only when every line is priced', () => {
    expect(cartTotalOf(undefined)).toBeNull();
    expect(cartTotalOf({ total: '0.00', lines: [] })).toBeNull();
    expect(cartTotalOf({ total: '419600.00', lines: [{ priced: true }, { priced: true }] })).toBe(
      '419600.00',
    );
    expect(cartTotalOf({ total: '1000.00', lines: [{ priced: true }, { priced: false }] })).toBe(
      null,
    );
  });
});

describe('«Bto300» «Мэдэгдэл» lines (ADR-0079 #8)', () => {
  it('titles the days: today, yesterday with its date, then the date and weekday', () => {
    expect(feedDayOf('2026-10-18', '2026-10-18')).toEqual({ kind: 'today' });
    expect(feedDayOf('2026-10-17', '2026-10-18')).toEqual({ kind: 'yesterday', date: '10/17' });
    // 2026-10-15 is a Thursday («Пүрэв»).
    expect(feedDayOf('2026-10-15', '2026-10-18')).toEqual({
      kind: 'date',
      date: '10/15',
      weekday: 4,
    });
  });

  it('words a confirmed order with its amount and the lines that wait', () => {
    const facts = storeFactsOf('ORDER_CONFIRMED', {
      orderNumber: '20261017_0005',
      orderTotal: '200800.00',
      backorderedLines: 1,
    });
    expect(storeLineOf('ORDER_CONFIRMED', facts)).toEqual([
      { kind: 'number', value: '20261017_0005' },
      { kind: 'money', amount: '200800.00' },
      { kind: 'backordered', lines: 1 },
    ]);
  });

  it('words a payment with the invoices it settled', () => {
    const facts = storeFactsOf('PAYMENT_RECORDED', {
      paymentNumber: 'Т-20261015-0003',
      amount: '1579200.00',
      invoices: [{ id: 4, number: 'Н-20261012-0004' }],
    });
    expect(storeLineOf('PAYMENT_RECORDED', facts)).toEqual([
      { kind: 'number', value: 'Т-20261015-0003' },
      { kind: 'money', amount: '1579200.00' },
      { kind: 'settled', numbers: ['Н-20261012-0004'] },
    ]);
  });

  it('words a due invoice, a sale and a cancellation; a missing fact is left out', () => {
    const due = storeFactsOf('INVOICE_OVERDUE', {
      invoiceNumber: 'Н-20260910-0004',
      openAmount: '350000.00',
      dueDate: '2026-10-10',
    });
    expect(storeLineOf('INVOICE_OVERDUE', due)).toEqual([
      { kind: 'number', value: 'Н-20260910-0004' },
      { kind: 'money', amount: '350000.00' },
      { kind: 'due', date: '10/10' },
    ]);
    const sold = storeFactsOf('ORDER_SOLD', {
      orderNumber: '20261017_0005',
      orderTotal: '200800.00',
      invoiceNumber: 'Н-20261018-0001',
      invoiceTotal: '180800.00',
    });
    expect(storeLineOf('ORDER_SOLD', sold)).toEqual([
      { kind: 'number', value: '20261017_0005' },
      { kind: 'money', amount: '180800.00' },
      { kind: 'invoice', number: 'Н-20261018-0001' },
    ]);
    expect(
      storeLineOf('ORDER_CANCELLED', storeFactsOf('ORDER_CANCELLED', { orderNumber: 'A' })),
    ).toEqual([{ kind: 'number', value: 'A' }]);
    expect(
      storeLineOf(
        'ORDER_CANCELLED',
        storeFactsOf('ORDER_CANCELLED', { orderNumber: 'A', reason: 'харилцагчийн хүсэлтээр' }),
      ),
    ).toEqual([
      { kind: 'number', value: 'A' },
      { kind: 'reason', reason: 'харилцагчийн хүсэлтээр' },
    ]);
    expect(storeLineOf('INVOICE_DUE_SOON', storeFactsOf('INVOICE_DUE_SOON', {}))).toEqual([]);
  });
});

describe('«Bto300» sign-in messages (ADR-0079 #3)', () => {
  const problem = (code: string, params?: Record<string, unknown>): AppProblem => ({
    code,
    status: 400,
    ...(params ? { params } : {}),
  });

  it('speaks of the phone and the office instead of a user name and an admin', () => {
    expect(signInMessageOf(problem('INVALID_CREDENTIALS'))?.key).toBe('invalidCredentials');
    expect(signInMessageOf(problem('ACCOUNT_DISABLED'))?.key).toBe('disabled');
    expect(signInMessageOf(problem('PASSWORD_CODE_INVALID'))?.key).toBe('codeInvalid');
    expect(signInMessageOf(problem('PASSWORD_TOO_WEAK', { minLength: 8 }))).toEqual({
      key: 'tooWeak',
      params: { min: 8 },
    });
    expect(signInMessageOf(problem('PASSWORD_TOO_WEAK'))).toEqual({
      key: 'tooWeak',
      params: { min: 8 },
    });
  });

  it('says until when a locked account waits, in Ulaanbaatar time', () => {
    expect(
      signInMessageOf(problem('ACCOUNT_LOCKED', { lockedUntil: '2026-10-19T02:15:00.000Z' })),
    ).toEqual({ key: 'lockedUntil', params: { time: '10:15' } });
    expect(signInMessageOf(problem('ACCOUNT_LOCKED'))).toEqual({ key: 'locked', params: {} });
  });

  it('says how many minutes to wait after too many tries', () => {
    expect(minutesOf(1)).toBe(1);
    expect(minutesOf(60)).toBe(1);
    expect(minutesOf(61)).toBe(2);
    expect(signInMessageOf(problem('TOO_MANY_REQUESTS', { retryAfterSeconds: 720 }))).toEqual({
      key: 'tooManyMinutes',
      params: { minutes: 12 },
    });
    expect(signInMessageOf(problem('TOO_MANY_REQUESTS'))?.key).toBe('tooMany');
  });

  it('leaves every other problem to the shared words', () => {
    expect(signInMessageOf({ code: 'NETWORK', status: 0 })).toBeNull();
    expect(signInMessageOf(problem('CURRENT_PASSWORD_INCORRECT'))).toBeNull();
  });
});
