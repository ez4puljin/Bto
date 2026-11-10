import { describe, expect, it } from 'vitest';
import { amountOf, orderedStops, progressOf } from './stops';

const stop = (customerId: number, planned: boolean, result: string | null) => ({
  customerId,
  planned,
  visit: result === null ? null : { result },
});

describe('the rep visit list (ADR-0183)', () => {
  const stops = [
    stop(1, true, null),
    stop(2, true, 'ORDERED'),
    stop(3, true, null),
    stop(4, false, 'CLOSED'),
  ];

  it('works the open stores first, in the plan order', () => {
    const { open, done } = orderedStops(stops);
    expect(open.map((one) => one.customerId)).toEqual([1, 3]);
    expect(done.map((one) => one.customerId)).toEqual([2, 4]);
  });

  it('counts the planned stores visited, not the extra ones', () => {
    expect(progressOf(stops)).toEqual({ visited: 1, planned: 3 });
    expect(progressOf([])).toEqual({ visited: 0, planned: 0 });
  });

  it('reads a typed amount as money', () => {
    expect(amountOf('1 500 000')).toBe('1500000');
    expect(amountOf('25,000.50')).toBe('25000.50');
    expect(amountOf('0')).toBeNull();
    expect(amountOf('12.345')).toBeNull();
    expect(amountOf('abc')).toBeNull();
    expect(amountOf('')).toBeNull();
  });
});
