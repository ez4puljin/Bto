import { describe, expect, it } from 'vitest';
import { boardLedgerPart, statementRowOf } from './board-ledger';

const expense = (code: string) => ({ code, kind: 'EXPENSE' as const });
const income = (code: string) => ({ code, kind: 'INCOME' as const });

describe('what the profit board takes from the books (ADR-0238)', () => {
  it('counts class 7 as operating expenses, Bto’s stock accounts among them', () => {
    for (const code of ['700101', '701004', '702008', '710101', '720101', '730101', '730202']) {
      expect(boardLedgerPart(expense(code))).toBe('EXPENSE');
    }
    for (const code of ['730301', '740201', '702007']) {
      expect(boardLedgerPart(expense(code))).toBe('EXPENSE');
    }
  });

  it('never counts the sales and cost rows, nor the period result', () => {
    for (const code of ['510101', '520101', '520201', '520202']) {
      expect(boardLedgerPart(income(code))).toBeNull();
    }
    expect(boardLedgerPart(expense('610101'))).toBeNull();
    expect(boardLedgerPart(expense('610301'))).toBeNull();
    expect(boardLedgerPart(expense('910201'))).toBeNull();
    expect(boardLedgerPart({ code: '920101', kind: 'EQUITY' })).toBeNull();
  });

  it('takes the other income and the income tax', () => {
    for (const code of ['511020', '511030', '511040']) {
      expect(boardLedgerPart(income(code))).toBe('OTHER_INCOME');
    }
    expect(boardLedgerPart(expense('910101'))).toBe('TAX');
  });

  it('follows the accountant’s link to a row of СТ-2, ignoring one of another kind', () => {
    expect(boardLedgerPart(expense('730101'), 'I19')).toBe('TAX');
    expect(boardLedgerPart(expense('730101'), 'I2')).toBeNull();
    expect(boardLedgerPart(expense('910101'), 'I12')).toBe('EXPENSE');
    expect(statementRowOf(expense('730101'), 'I1')).toBe('I12');
    expect(boardLedgerPart(income('511020'), 'I1')).toBeNull();
  });
});
