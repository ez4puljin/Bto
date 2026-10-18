import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  ADJUSTMENT_REASONS,
  averageAfterWithdrawal,
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
  receiptLineCost,
  receiptLineVat,
  reaverage,
  revalue,
  systemBinTypes,
  transferReceiveLegs,
  USER_ADJUSTMENT_REASONS,
  unitCostOf,
} from './index';

const text = (value: Decimal) => value.toFixed();
const zero = new Decimal(0);

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
    expect(MOVEMENT_TYPES.TRANSFER_OUT.legs).toEqual([1, 3, 5]);
    expect(MOVEMENT_TYPES.TRANSFER_IN.legs).toEqual([2, 4, 6]);
  });

  it('receives a transfer line exactly, short or over (ADR-0035)', () => {
    const legs = (shipped: string, received: string) =>
      transferReceiveLegs(shipped, received).map(
        ({ leg, place, qty }) => `${leg}:${place}:${qty.toFixed()}`,
      );
    expect(legs('24', '24')).toEqual(['3:TRANSIT:-24', '4:DESTINATION:24']);
    // Two short: TRANSIT empties, the sender gets them back.
    expect(legs('24', '22')).toEqual(['3:TRANSIT:-24', '4:DESTINATION:22', '6:SOURCE:2']);
    // Two over: they leave the sender's bin for the destination.
    expect(legs('10', '12')).toEqual([
      '3:TRANSIT:-10',
      '4:DESTINATION:10',
      '5:SOURCE:-2',
      '6:DESTINATION:2',
    ]);
    expect(legs('10', '0')).toEqual(['3:TRANSIT:-10', '6:SOURCE:10']);
    expect(legs('0', '3')).toEqual(['5:SOURCE:-3', '6:DESTINATION:3']);
    expect(legs('0', '0')).toEqual([]);
    for (const [shipped, received] of [
      ['24', '22'],
      ['10', '12'],
      ['5.5', '5.25'],
    ] as const) {
      const all = transferReceiveLegs(shipped, received);
      // TRANSIT gives up exactly what was shipped; the destination ends up with what arrived.
      const sum = (place: string) =>
        all.filter((leg) => leg.place === place).reduce((total, leg) => total.plus(leg.qty), zero);
      expect(sum('TRANSIT').negated().toFixed()).toBe(shipped);
      expect(sum('DESTINATION').toFixed()).toBe(received);
      for (const leg of all) {
        expect(leg.qty.isNegative()).toBe(leg.movementType === 'TRANSFER_OUT');
      }
    }
  });

  it('keeps the system adjustment reasons out of the people’s list', () => {
    expect(ADJUSTMENT_REASONS.OPENING_REVERSAL).toBe(-1);
    expect(USER_ADJUSTMENT_REASONS).not.toContain('OPENING_REVERSAL');
    expect(USER_ADJUSTMENT_REASONS).not.toContain('OPENING');
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

  it('keeps what stays at its value when goods leave at their own cost (TRANSIT)', () => {
    // 10 shipped at 1000 and 10 at 1500 are in transit together (average 1250).
    const pooled = reaverage('10', '1000', '10', '1500');
    expect(text(pooled)).toBe('1250');
    expect(text(averageAfterWithdrawal('20', pooled, '10', '1000'))).toBe('1500');
    expect(text(averageAfterWithdrawal('10', '1500', '10', '1500'))).toBe('1500');
    expect(text(averageAfterWithdrawal('3', '0.0001', '2', '0.0002'))).toBe('0');
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

describe('receipt prices (ADR-0078)', () => {
  it('takes the VAT out of a delivery-note amount at the receipt rate', () => {
    expect(text(receiptLineVat('1100', '10'))).toBe('100');
    expect(text(receiptLineCost('1100', '10'))).toBe('1000');
    // 2,500 × 10 / 110 = 227.2727… → 227.27; the cost keeps the rest.
    expect(text(receiptLineVat('2500', '10'))).toBe('227.27');
    expect(text(receiptLineCost('2500', '10'))).toBe('2272.73');
  });

  it('keeps the whole amount as cost when no VAT applies', () => {
    expect(text(receiptLineVat('2500', '0'))).toBe('0');
    expect(text(receiptLineCost('2500', '0'))).toBe('2500');
  });
});
