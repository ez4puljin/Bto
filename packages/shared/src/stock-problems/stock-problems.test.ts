import { describe, expect, it } from 'vitest';
import {
  STOCK_PROBLEM_QTY_PATTERN,
  stockProblemDifference,
  stockProblemGroup,
  stockProblemOutcome,
} from './index';

describe('stock problems', () => {
  it('groups a till shortfall as red and both order cuts as cut', () => {
    expect(stockProblemGroup('POS_SHORTFALL')).toBe('RED');
    expect(stockProblemGroup('BACKORDER')).toBe('CUT');
    expect(stockProblemGroup('SHORT_PICK')).toBe('CUT');
  });

  it('reads a count against the system quantity', () => {
    expect(stockProblemDifference('7', '10').toFixed()).toBe('-3');
    expect(stockProblemOutcome(stockProblemDifference('7', '10'))).toBe('SHORTAGE');
    expect(stockProblemOutcome(stockProblemDifference('12.5', '10'))).toBe('SURPLUS');
    expect(stockProblemOutcome(stockProblemDifference('10.000', '10'))).toBe('EQUAL');
  });

  it('accepts base quantities with up to three decimals', () => {
    expect(STOCK_PROBLEM_QTY_PATTERN.test('0')).toBe(true);
    expect(STOCK_PROBLEM_QTY_PATTERN.test('12.125')).toBe(true);
    expect(STOCK_PROBLEM_QTY_PATTERN.test('-1')).toBe(false);
    expect(STOCK_PROBLEM_QTY_PATTERN.test('1.2345')).toBe(false);
  });
});
