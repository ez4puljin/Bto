import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  BALANCE_ROWS,
  balanceDifference,
  buildStatement,
  defaultRowOf,
  INCOME_ROWS,
  linkableRows,
  type StatementAccount,
  type StatementAccountKind,
} from './statements';

const d = (value: number | string) => new Decimal(value);
let nextId = 1;
const account = (
  code: string,
  kind: StatementAccountKind,
  amount: number,
  opening: number | null = 0,
): StatementAccount => ({
  accountId: nextId++,
  code,
  name: `Данс ${code}`,
  kind,
  opening: opening === null ? null : d(opening),
  amount: d(amount),
});
const amountOf = (rows: ReturnType<typeof buildStatement>, code: string) =>
  rows.find((row) => row.code === code)?.amount?.toFixed(2);

describe('the financial statements (ADR-0184)', () => {
  it('names every row once and sums only rows built before', () => {
    for (const rows of [BALANCE_ROWS, INCOME_ROWS]) {
      const seen = new Set<string>();
      for (const row of rows) {
        expect(seen.has(row.code)).toBe(false);
        for (const [code] of row.sum ?? []) expect(seen.has(code)).toBe(true);
        seen.add(row.code);
      }
    }
  });

  it('places an account by its longest prefix among the rows of its kind', () => {
    expect(defaultRowOf({ code: '100101', kind: 'ASSET' })).toBe('A1_1');
    expect(defaultRowOf({ code: '120101', kind: 'ASSET' })).toBe('A1_2');
    expect(defaultRowOf({ code: '121001', kind: 'ASSET' })).toBe('A1_3');
    expect(defaultRowOf({ code: '122001', kind: 'ASSET' })).toBe('A1_4');
    expect(defaultRowOf({ code: '150101', kind: 'ASSET' })).toBe('A1_6');
    expect(defaultRowOf({ code: '200101', kind: 'ASSET' })).toBe('A2_1');
    // No prefix: the kind's fallback row.
    expect(defaultRowOf({ code: '990001', kind: 'ASSET' })).toBe('A1_8');
    // Retained earnings on the temporary code 340101 is equity, never a liability.
    expect(defaultRowOf({ code: '340101', kind: 'EQUITY' })).toBe('E_3');
    expect(defaultRowOf({ code: '310101', kind: 'LIABILITY' })).toBe('L1_1');
    expect(defaultRowOf({ code: '520101', kind: 'INCOME' })).toBe('I1');
    expect(defaultRowOf({ code: '700101', kind: 'EXPENSE' })).toBe('I10');
    expect(defaultRowOf({ code: '610101', kind: 'EXPENSE' })).toBe('I2');
    expect(linkableRows('EXPENSE').map((row) => row.code)).toContain('I19');
    expect(linkableRows('EXPENSE').map((row) => row.code)).not.toContain('I1');
  });

  it('balances СТ-1 with the result that is not closed yet', () => {
    // Cash 700 and stock 500, payables 400, capital 300; sales 800 and cost 300 still open.
    const accounts = [
      account('100101', 'ASSET', 700, 300),
      account('150101', 'ASSET', 500, 0),
      account('310101', 'LIABILITY', -400, 0),
      account('420101', 'EQUITY', -300, -300),
      account('510101', 'INCOME', -800, 0),
      account('610101', 'EXPENSE', 300, 0),
    ];
    const rows = buildStatement('BALANCE', accounts);
    expect(amountOf(rows, 'A1_T')).toBe('1200.00');
    expect(amountOf(rows, 'A_T')).toBe('1200.00');
    expect(amountOf(rows, 'L_T')).toBe('400.00');
    expect(amountOf(rows, 'E_1')).toBe('300.00');
    // Retained earnings holds the open profit of 500.
    expect(rows.find((row) => row.code === 'E_3')).toMatchObject({
      amount: d(500),
      result: { amount: d(500), opening: d(0) },
    });
    expect(amountOf(rows, 'LE_T')).toBe('1200.00');
    const difference = balanceDifference(rows);
    expect(difference.amount.isZero()).toBe(true);
    expect(difference.opening.isZero()).toBe(true);
    expect(rows.find((row) => row.code === 'A_T')?.opening?.toFixed(2)).toBe('300.00');
  });

  it('builds СТ-2 from the period, returns netted and costs taken off', () => {
    const accounts = [
      account('510101', 'INCOME', -1000, null),
      account('520101', 'INCOME', 100, null),
      account('610101', 'EXPENSE', 500, null),
      account('710101', 'EXPENSE', 50, null),
      account('700101', 'EXPENSE', 70, null),
      account('511001', 'INCOME', -20, null),
      // A balance-sheet account is not part of СТ-2.
      account('100101', 'ASSET', 999, null),
    ];
    const rows = buildStatement('INCOME', accounts);
    expect(amountOf(rows, 'I1')).toBe('900.00');
    expect(amountOf(rows, 'I2')).toBe('500.00');
    expect(amountOf(rows, 'I3')).toBe('400.00');
    expect(amountOf(rows, 'I8')).toBe('20.00');
    expect(amountOf(rows, 'I18')).toBe('300.00');
    expect(amountOf(rows, 'I22')).toBe('300.00');
    expect(rows.every((row) => row.opening === null)).toBe(true);
  });

  it('moves an account to the row its accountant linked, within its kind only', () => {
    const tax = account('730501', 'EXPENSE', 30, null);
    const sales = account('510101', 'INCOME', -330, null);
    const before = buildStatement('INCOME', [tax, sales]);
    expect(amountOf(before, 'I12')).toBe('30.00');
    expect(amountOf(before, 'I22')).toBe('300.00');
    const after = buildStatement('INCOME', [tax, sales], new Map([[tax.accountId, 'I19']]));
    expect(amountOf(after, 'I12')).toBe('0.00');
    expect(amountOf(after, 'I18')).toBe('330.00');
    expect(amountOf(after, 'I19')).toBe('30.00');
    expect(after.find((row) => row.code === 'I19')?.accounts[0]).toMatchObject({ linked: true });
    // A link to an income row is not for an expense account: the default stands.
    const wrong = buildStatement('INCOME', [tax, sales], new Map([[tax.accountId, 'I1']]));
    expect(amountOf(wrong, 'I12')).toBe('30.00');
  });
});
