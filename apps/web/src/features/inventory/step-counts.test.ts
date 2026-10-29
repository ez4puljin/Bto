import type { components } from '@tugeel/api-client';
import { describe, expect, it } from 'vitest';
import {
  basisOf,
  type LineCount,
  readStepCounts,
  restoreCounts,
  STEP_COUNTS_MAX_AGE_MS,
  stepCountsKey,
  sweepStepCounts,
} from './step-counts';

type TransferLine = components['schemas']['TransferLine'];

const LINE: TransferLine = {
  id: 1,
  productId: 10,
  productSku: '10',
  productName: 'Кока кола',
  requestUnitId: 77,
  unitName: 'хайрцаг',
  requestFactor: '24',
  requestedQty: '2',
  baseUnitId: 70,
  baseUnitName: 'ш',
  shippedQtyBase: '48',
  countedQtyBase: null,
  countedAt: null,
  unrequested: false,
  receivedQtyBase: null,
  fromBinId: 31,
  fromBinCode: 'A-01-03',
  toBinId: null,
  toBinCode: null,
};
const count = (qty: string): LineCount => ({ qty, base: false, binId: 31, binCode: 'A-01-03' });

describe('step counts kept on the device (ADR-0047 #6)', () => {
  it('checks a line against what it was counted for', () => {
    expect(basisOf(LINE, 'ship')).toBe('10|77|2');
    expect(basisOf(LINE, 'receive')).toBe('10|48');
  });

  it('restores lines whose basis still matches and drops the others', () => {
    const bases = new Map([
      [1, '10|77|2'],
      [2, '11|80|5'],
    ]);
    const stored = {
      savedAt: Date.now(),
      lines: {
        '1': { ...count('1.5'), basis: '10|77|2' },
        '2': { ...count('4'), basis: '11|80|10' },
        '3': { ...count('9'), basis: 'gone' },
      },
    };
    const result = restoreCounts({ 1: count('2'), 2: count('5') }, stored, bases);
    expect(result.counts).toEqual({ 1: count('1.5'), 2: count('5') });
    expect(result).toMatchObject({ restored: 1, dropped: 2 });
  });

  it('forgets entries older than a week, and sweeps them', () => {
    const now = Date.now();
    const fresh = stepCountsKey(2, 7, 'ship');
    const old = stepCountsKey(2, 8, 'receive');
    localStorage.setItem(fresh, JSON.stringify({ savedAt: now, lines: {} }));
    localStorage.setItem(
      old,
      JSON.stringify({ savedAt: now - STEP_COUNTS_MAX_AGE_MS - 1, lines: {} }),
    );
    localStorage.setItem('tugeel.other', 'kept');
    expect(readStepCounts(fresh, now)).not.toBeNull();
    sweepStepCounts(now);
    expect(localStorage.getItem(old)).toBeNull();
    expect(localStorage.getItem(fresh)).not.toBeNull();
    expect(localStorage.getItem('tugeel.other')).toBe('kept');
    localStorage.setItem(fresh, '{not json');
    expect(readStepCounts(fresh, now)).toBeNull();
  });
});
