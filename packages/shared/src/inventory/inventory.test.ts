import { describe, expect, it } from 'vitest';
import type { Decimal } from '../money';
import {
  BinRangeError,
  binCodeRange,
  canRecost,
  costingDeadline,
  formatDocNumber,
  isBinCode,
  isSellableBinType,
  lineAmountOf,
  MOVEMENT_TYPES,
  normalizeBinCode,
  reaverage,
  revalue,
  systemBinTypes,
  unitCostOf,
} from './index';

const text = (value: Decimal) => value.toFixed();

describe('bin codes', () => {
  it('stores the label text in one form whatever the keyboard typed', () => {
    expect(normalizeBinCode(' a-01-03 ')).toBe('A-01-03');
    // Cyrillic look-alikes typed on the Mongolian layout and a long dash from a word processor.
    expect(normalizeBinCode('А–01–03')).toBe('A-01-03');
    expect(normalizeBinCode('с 12')).toBe('C12');
    expect(normalizeBinCode('Ａ－０１')).toBe('A-01');
  });

  it('accepts Latin capitals, digits and separators only', () => {
    expect(isBinCode('A-01-03')).toBe(true);
    expect(isBinCode('RECEIVING')).toBe(true);
    expect(isBinCode('B.2/7_1')).toBe(true);
    expect(isBinCode('-A')).toBe(false);
    expect(isBinCode('Ф-01')).toBe(false);
    expect(isBinCode('A'.repeat(33))).toBe(false);
  });

  it('generates a block of shelves in the owner’s label format', () => {
    const codes = binCodeRange({
      rows: { from: 'A', to: 'B' },
      racks: { from: 1, to: 2 },
      levels: { from: 1, to: 3 },
    });
    expect(codes).toHaveLength(12);
    expect(codes.slice(0, 4)).toEqual(['A-01-01', 'A-01-02', 'A-01-03', 'A-02-01']);
    expect(codes.at(-1)).toBe('B-02-03');
    expect(
      binCodeRange({
        rows: { from: 'C', to: 'C' },
        racks: { from: 9, to: 10 },
        levels: { from: 1, to: 1 },
        pad: 1,
      }),
    ).toEqual(['C-9-1', 'C-10-1']);
  });

  it('refuses inverted, invalid and oversized ranges', () => {
    const range =
      (rows: [string, string], racks: [number, number], levels: [number, number]) => () =>
        binCodeRange({
          rows: { from: rows[0], to: rows[1] },
          racks: { from: racks[0], to: racks[1] },
          levels: { from: levels[0], to: levels[1] },
        });
    expect(range(['B', 'A'], [1, 1], [1, 1])).toThrow(BinRangeError);
    expect(range(['a', 'b'], [1, 1], [1, 1])).toThrow(BinRangeError);
    expect(range(['A', 'A'], [3, 1], [1, 1])).toThrow(BinRangeError);
    expect(range(['A', 'A'], [1, 1.5], [1, 1])).toThrow(BinRangeError);
    // 26 × 20 × 1 = 520 > 500.
    expect(range(['A', 'Z'], [1, 20], [1, 1])).toThrow(BinRangeError);
    expect(range(['A', 'Y'], [1, 20], [1, 1])()).toHaveLength(500);
  });

  it('creates the system bins of each warehouse kind', () => {
    expect(systemBinTypes('WHOLESALE')).toEqual([
      'RECEIVING',
      'STAGING',
      'SHIP',
      'DAMAGED',
      'RETURNS',
    ]);
    expect(systemBinTypes('STORE')).toContain('SALESFLOOR');
    expect(systemBinTypes('VEHICLE')).toContain('CARGO');
    expect(systemBinTypes('TRANSIT')).toEqual(['TRANSIT']);
    expect(isSellableBinType('STORAGE')).toBe(true);
    expect(isSellableBinType('RECEIVING')).toBe(false);
  });
});

describe('movements and documents', () => {
  it('pairs out and in legs, and gives a transfer receive its own legs', () => {
    for (const [type, rule] of Object.entries(MOVEMENT_TYPES)) {
      if (type.endsWith('_OUT')) expect(rule.sign).toBe(-1);
      if (type.endsWith('_IN')) expect(rule.sign).toBe(1);
    }
    expect(MOVEMENT_TYPES.TRANSFER_OUT.legs).toEqual([1, 3]);
    expect(MOVEMENT_TYPES.TRANSFER_IN.legs).toEqual([2, 4]);
  });

  it('formats gapless yearly numbers', () => {
    expect(formatDocNumber('GR', '2026', 1)).toBe('GR-2026-000001');
    expect(formatDocNumber('ADJ', '2027', 1234567)).toBe('ADJ-2027-1234567');
  });
});

describe('cost arithmetic', () => {
  it('re-averages inbound stock and starts empty stock at the incoming cost', () => {
    expect(text(reaverage('10', '1000', '100', '1500'))).toBe('1454.5455');
    expect(text(reaverage('0', '0', '24', '83.3333'))).toBe('83.3333');
    // Same cost in, same average out: intra-warehouse moves never move the average.
    expect(text(reaverage('7', '1234.5678', '3', '1234.5678'))).toBe('1234.5678');
  });

  it('turns prices into amounts and amounts into costs per base unit', () => {
    expect(text(lineAmountOf('24000', '12'))).toBe('288000');
    expect(text(lineAmountOf('1666.67', '3'))).toBe('5000.01');
    expect(text(unitCostOf('288000', '288'))).toBe('1000');
    expect(text(unitCostOf('10000', '3'))).toBe('3333.3333');
  });

  it('absorbs a price difference into the stock still on hand only (ADR-0033)', () => {
    // 10 at 1000, 100 received at the provisional 1000, 95 sold, then costed at 1500.
    const sold = revalue({ onHand: '15', avg: '1000', receivedQty: '100', valueDelta: '50000' });
    expect(text(sold.avgAfter)).toBe('1500');
    expect(text(sold.absorbed)).toBe('7500');
    expect(text(sold.variance)).toBe('42500');
    // Nothing issued: the exact moving average.
    const kept = revalue({ onHand: '110', avg: '1000', receivedQty: '100', valueDelta: '50000' });
    expect(text(kept.avgAfter)).toBe('1454.5455');
    expect(kept.absorbed.plus(kept.variance).toFixed()).toBe('50000');
  });

  it('never drives the average below zero and parks the rest as variance', () => {
    const cut = revalue({ onHand: '10', avg: '100', receivedQty: '10', valueDelta: '-5000' });
    expect(text(cut.avgAfter)).toBe('0');
    expect(text(cut.absorbed)).toBe('-1000');
    expect(text(cut.variance)).toBe('-4000');
    const gone = revalue({ onHand: '0', avg: '100', receivedQty: '10', valueDelta: '700' });
    expect(text(gone.avgAfter)).toBe('100');
    expect(text(gone.variance)).toBe('700');
  });

  it('lets a receipt be costed again until the end of the next month', () => {
    expect(costingDeadline('2026-10-15')).toBe('2026-11-30');
    expect(costingDeadline('2026-12-01')).toBe('2027-01-31');
    expect(costingDeadline('2028-01-31')).toBe('2028-02-29');
    expect(canRecost('2026-10-15', '2026-11-30')).toBe(true);
    expect(canRecost('2026-10-15', '2026-12-01')).toBe(false);
  });
});
