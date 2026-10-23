import { describe, expect, it } from 'vitest';
import {
  creditBarOf,
  creditWarningOf,
  debtOf,
  invoiceDueOf,
  overdueOf,
  settlementCardOf,
} from './account';
import { noticeTabsOf, STORE_TILES, storeFactsOf, storeTargetOf } from './notifications';
import { backorderedIn, byDay, orderAmount, orderNotes, progressOf, takerOf } from './orders';
import { reorderPlan } from './reorder';
import { codeComplete, codeInput, newPasswordIssue, phoneInput, phoneOf } from './sign-in';
import { columnAmount, lastMonthRange, statementPresetOf, statementRange } from './statement';
import { canOrder, lineStockNote } from './stock';

describe('«Bto300»: the stock in words (ADR-0079 #4)', () => {
  it('lets a store order what is not «Дууссан» and priced', () => {
    expect(canOrder({ stock: 'IN' }, { wholesale: '20000' })).toBe(true);
    expect(canOrder({ stock: 'LOW' }, { wholesale: '700' })).toBe(true);
    expect(canOrder({ stock: 'OUT' }, { wholesale: '700' })).toBe(false);
    expect(canOrder({ stock: 'IN' }, { wholesale: null })).toBe(false);
    expect(canOrder({ stock: 'IN' }, undefined)).toBe(false);
  });

  it('notes a cart line that is low or may wait for stock', () => {
    expect(lineStockNote(undefined)).toBeNull();
    expect(lineStockNote({ stock: 'IN', mayBackorder: false })).toBeNull();
    expect(lineStockNote({ stock: 'LOW', mayBackorder: false })).toBe('low');
    expect(lineStockNote({ stock: 'IN', mayBackorder: true })).toBe('mayBackorder');
    expect(lineStockNote({ stock: 'LOW', mayBackorder: true })).toBe('lowMayBackorder');
    expect(lineStockNote({ stock: 'OUT', mayBackorder: true })).toBe('out');
  });
});

describe('«Bto300»: the store’s orders (ADR-0079 #6)', () => {
  it('follows the progress and tells who took an order', () => {
    expect(
      ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED'].map((state) =>
        progressOf(state as 'PENDING'),
      ),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(progressOf('CANCELLED')).toBe(-1);
    expect(takerOf({ channel: 'CUSTOMER_APP', takerName: null })).toEqual({ kind: 'app' });
    expect(takerOf({ channel: 'SALES_REP', takerName: 'Бат' })).toEqual({
      kind: 'rep',
      name: 'Бат',
    });
    expect(takerOf({ channel: 'ADMIN', takerName: null })).toEqual({ kind: 'office' });
  });

  it('notes backordered lines and a cancellation, and marks a pending amount «≈»', () => {
    expect(orderNotes({ state: 'CONFIRMED', backorderedLines: 1, cancelReason: null })).toEqual([
      { kind: 'backordered', lines: 1 },
    ]);
    expect(
      orderNotes({ state: 'CANCELLED', backorderedLines: 2, cancelReason: 'хүсэлтээр' }),
    ).toEqual([{ kind: 'cancelled', reason: 'хүсэлтээр' }]);
    expect(orderNotes({ state: 'DELIVERED', backorderedLines: 0, cancelReason: null })).toEqual([]);
    expect(orderAmount({ total: '200800', estimatedTotal: null })).toEqual({
      amount: '200800',
      estimate: false,
    });
    expect(orderAmount({ total: null, estimatedTotal: '419600' })).toEqual({
      amount: '419600',
      estimate: true,
    });
    expect(orderAmount({ total: null, estimatedTotal: null })).toBeNull();
  });

  it('groups orders by day', () => {
    const rows = [
      { id: 1, createdDate: '2026-10-18' },
      { id: 2, createdDate: '2026-10-18' },
      { id: 3, createdDate: '2026-10-16' },
    ];
    expect(byDay(rows)).toEqual([
      { date: '2026-10-18', orders: [rows[0], rows[1]] },
      { date: '2026-10-16', orders: [rows[2]] },
    ]);
  });

  it('tells backordered base units in the line’s unit when they make whole units', () => {
    expect(backorderedIn({ qty: '2.000', qtyBase: '48.000', qtyBackordered: '24.000' })).toEqual({
      qty: '1',
      inUnit: true,
    });
    expect(backorderedIn({ qty: '2.000', qtyBase: '48.000', qtyBackordered: '5.000' })).toEqual({
      qty: '5',
      inUnit: false,
    });
    expect(backorderedIn({ qty: '2.000', qtyBase: '48.000', qtyBackordered: '0.000' })).toBeNull();
  });
});

describe('«Bto300»: the account (ADR-0079 #7)', () => {
  it('words the balance, the overdue amount and the credit bar', () => {
    expect(debtOf('1284600.00')).toEqual({ kind: 'debt', amount: '1284600.00' });
    expect(debtOf('-5000.00')).toEqual({ kind: 'advance', amount: '5000.00' });
    expect(debtOf('0.00')).toEqual({ kind: 'clear' });
    expect(overdueOf({ overdueAmount: '350000.00', oldestOverdueDate: '2026-10-10' })).toEqual({
      amount: '350000.00',
      since: '2026-10-10',
    });
    expect(overdueOf({ overdueAmount: '0.00', oldestOverdueDate: null })).toBeNull();
    expect(creditBarOf({ creditLimit: null, creditAvailable: null })).toBeNull();
    expect(creditBarOf({ creditLimit: '3000000.00', creditAvailable: '1715400.00' })).toEqual({
      available: '1715400.00',
      limit: '3000000.00',
      free: 0.5718,
    });
    expect(creditBarOf({ creditLimit: '1000.00', creditAvailable: '-50.00' })?.free).toBe(0);
  });

  it('words «Тооцоо хийх өдөр» for both settlement groups (ADR-0101 #6)', () => {
    const monthEnd = {
      group: 'MONTH_END' as const,
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      dueDate: '2026-10-31',
      daysLeft: 10,
      amountDue: '1284600.00',
      overdueAmount: '0.00',
    };
    expect(settlementCardOf(monthEnd)).toEqual({
      dueDate: '2026-10-31',
      days: { kind: 'left', days: 10 },
      amountDue: '1284600.00',
      purchases: { kind: 'month', month: 10 },
      overdue: null,
      tone: 'due',
    });
    const day20 = settlementCardOf({
      ...monthEnd,
      group: 'DAY_20',
      periodFrom: '2026-09-21',
      periodTo: '2026-10-20',
      dueDate: '2026-10-20',
      daysLeft: 0,
      overdueAmount: '350000.00',
    });
    expect(day20.days).toEqual({ kind: 'today' });
    expect(day20.purchases).toEqual({ kind: 'range', from: '2026-09-21', to: '2026-10-20' });
    expect(day20.overdue).toBe('350000.00');
    expect(day20.tone).toBe('overdue');
  });

  it('says how an invoice stands and which credit warning comes first', () => {
    expect(invoiceDueOf({ daysOverdue: 8, daysLeft: 0 })).toEqual({ kind: 'overdue', days: 8 });
    expect(invoiceDueOf({ daysOverdue: 0, daysLeft: 15 })).toEqual({ kind: 'left', days: 15 });
    expect(invoiceDueOf({ daysOverdue: 0, daysLeft: 0 })).toEqual({ kind: 'today' });
    const check = {
      overdueAmount: '350000.00',
      oldestOverdueDate: '2026-10-10',
      excess: '12000.00',
    };
    expect(creditWarningOf({ ...check, warnings: [] })).toBeNull();
    expect(creditWarningOf({ ...check, warnings: ['LIMIT', 'OVERDUE', 'HOLD'] })).toEqual({
      kind: 'hold',
    });
    expect(creditWarningOf({ ...check, warnings: ['LIMIT', 'OVERDUE'] })).toEqual({
      kind: 'overdue',
      amount: '350000.00',
      since: '2026-10-10',
    });
    expect(creditWarningOf({ ...check, warnings: ['LIMIT'] })).toEqual({
      kind: 'limit',
      excess: '12000.00',
    });
  });
});

describe('«Bto300»: «Дахин захиалах» (ADR-0079 #6)', () => {
  const unit = (id: number, wholesale: string | null) => ({
    id,
    uomName: 'хайрцаг',
    uomCode: 'BOX',
    factorToBase: '20',
    isBase: false,
    wholesale,
  });
  const product = (id: number, stock: 'IN' | 'LOW' | 'OUT', units = [unit(id * 10, '20000')]) => ({
    id,
    sku: String(id),
    name: `Бараа ${id}`,
    thumbUrl: null,
    stock,
    units,
  });

  it('puts the orderable lines in whole units and keeps the skips', () => {
    const plan = reorderPlan(
      {
        lines: [
          { productId: 1, productUnitId: 10, qty: '5.000' },
          { productId: 2, productUnitId: 20, qty: '1.500' },
          { productId: 3, productUnitId: 30, qty: '2.000' },
          { productId: 4, productUnitId: 40, qty: '1.000' },
          { productId: 5, productUnitId: 50, qty: '1.000' },
        ],
        skipped: [{ productId: 9, name: 'Хуучин бараа', reason: 'UNAVAILABLE' }],
      },
      [product(1, 'IN'), product(2, 'LOW'), product(3, 'OUT'), product(4, 'IN', [unit(40, null)])],
    );
    expect(plan.lines.map((entry) => [entry.line.productUnitId, entry.qty])).toEqual([
      [10, 5],
      [20, 2],
    ]);
    expect(plan.lines[0]?.line).toMatchObject({ sku: '1', uomCode: 'BOX', wholesale: '20000' });
    expect(plan.skipped).toEqual([
      { productId: 9, name: 'Хуучин бараа', reason: 'UNAVAILABLE' },
      { productId: 3, name: 'Бараа 3', reason: 'OUT_OF_STOCK' },
      { productId: 4, name: 'Бараа 4', reason: 'UNAVAILABLE' },
      { productId: 5, name: null, reason: 'UNAVAILABLE' },
    ]);
  });
});

describe('«Bto300»: the sign-in fields (ADR-0079 #3)', () => {
  it('takes the phone after «+976»', () => {
    expect(phoneInput('99112233')).toBe('9911 2233');
    expect(phoneInput('+976 9911-2233')).toBe('9911 2233');
    expect(phoneInput('00976 99112233')).toBe('9911 2233');
    expect(phoneInput('9911223345')).toBe('9911 2233');
    expect(phoneInput('991')).toBe('991');
    expect(phoneOf('9911 2233')).toBe('+97699112233');
    expect(phoneOf('9911 223')).toBeNull();
  });

  it('types the office’s code as XXXXX-XXXXX and checks the new password', () => {
    expect(codeInput('7kq2mx9d4f')).toBe('7KQ2M-X9D4F');
    expect(codeInput('7KQ2M-X9D4F-EXTRA')).toBe('7KQ2M-X9D4F');
    expect(codeInput('7kq2')).toBe('7KQ2');
    expect(codeComplete('7KQ2M-X9D4F')).toBe(true);
    expect(codeComplete('7KQ2M-X9D4')).toBe(false);
    expect(newPasswordIssue('short', 'short')).toBe('short');
    expect(newPasswordIssue('delguur-1', 'delguur-2')).toBe('mismatch');
    expect(newPasswordIssue('delguur-1', 'delguur-1')).toBeNull();
    expect(newPasswordIssue('x'.repeat(129), 'x'.repeat(129))).toBe('long');
  });
});

describe('«Bto300»: notifications (ADR-0079 #8)', () => {
  it('counts each tab’s unread and opens on the first tab with any, «Захиалга» first', () => {
    const read = { read: true };
    const unread = { read: false };
    expect(noticeTabsOf([], [])).toEqual({ orders: 0, promos: 0, first: 'orders' });
    expect(noticeTabsOf([unread, read], [read])).toEqual({ orders: 0, promos: 1, first: 'promos' });
    expect(noticeTabsOf([unread], [unread, unread, read])).toEqual({
      orders: 2,
      promos: 1,
      first: 'orders',
    });
  });

  it('opens the order, the invoice or the account', () => {
    expect(storeTargetOf({ kind: 'ORDER_CONFIRMED', orderId: 5, invoiceId: null })).toBe(
      '/order/5',
    );
    expect(storeTargetOf({ kind: 'ORDER_SOLD', orderId: null, invoiceId: 3 })).toBeNull();
    expect(storeTargetOf({ kind: 'PAYMENT_RECORDED', orderId: null, invoiceId: null })).toBe(
      '/account',
    );
    expect(storeTargetOf({ kind: 'INVOICE_OVERDUE', orderId: null, invoiceId: 3 })).toBe(
      '/invoice/3',
    );
    expect(STORE_TILES.ORDER_CANCELLED.tile).toBe('cross');
  });

  it('reads a payload’s facts and survives an older row', () => {
    expect(
      storeFactsOf('ORDER_CONFIRMED', {
        orderNumber: '20261017_0005',
        orderTotal: '200800',
        backorderedLines: 1,
      }),
    ).toMatchObject({ orderNumber: '20261017_0005', amount: '200800', backorderedLines: 1 });
    expect(
      storeFactsOf('PAYMENT_RECORDED', {
        paymentNumber: 'Т-20261015-0003',
        amount: '1579200.00',
        invoices: [{ invoiceId: 4, number: 'Н-20261012-0004', amount: '1579200.00' }, 'odd'],
      }),
    ).toMatchObject({ amount: '1579200.00', invoices: ['Н-20261012-0004'] });
    expect(storeFactsOf('INVOICE_DUE_SOON', {})).toMatchObject({
      amount: null,
      dueDate: null,
      backorderedLines: 0,
    });
  });
});

describe('«Bto300»: the statement (ADR-0086)', () => {
  it('opens on the last month, today included', () => {
    expect(lastMonthRange('2026-10-20')).toEqual({ from: '2026-09-21', to: '2026-10-20' });
    expect(lastMonthRange('2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(lastMonthRange('2026-01-15')).toEqual({ from: '2025-12-16', to: '2026-01-15' });
  });

  it('gives each chip its days', () => {
    expect(statementRange('lastMonth', '2026-10-21')).toEqual({
      from: '2026-09-22',
      to: '2026-10-21',
    });
    expect(statementRange('thisMonth', '2026-10-21')).toEqual({
      from: '2026-10-01',
      to: '2026-10-21',
    });
    expect(statementRange('prevMonth', '2026-10-21')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(statementRange('prevMonth', '2026-03-05')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(statementRange('prevMonth', '2026-01-01')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('lights the chip whose days are shown, none for calendar days', () => {
    expect(statementPresetOf({ from: '2026-09-22', to: '2026-10-21' }, '2026-10-21')).toBe(
      'lastMonth',
    );
    expect(statementPresetOf({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-21')).toBe(
      'prevMonth',
    );
    expect(statementPresetOf({ from: '2026-09-10', to: '2026-10-10' }, '2026-10-21')).toBeNull();
    // On the last day of a 31-day month the last month is this month: the first chip wins.
    expect(statementPresetOf({ from: '2026-03-01', to: '2026-03-31' }, '2026-03-31')).toBe(
      'lastMonth',
    );
  });

  it('leaves a zero out of its column', () => {
    expect(columnAmount('0.00')).toBeNull();
    expect(columnAmount('-0.00')).toBeNull();
    expect(columnAmount('350000.00')).toBe('350000.00');
    expect(columnAmount('0.50')).toBe('0.50');
  });
});
