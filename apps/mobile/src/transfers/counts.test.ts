import { describe, expect, it } from 'vitest';
import {
  dropHead,
  dropsCount,
  enqueueCount,
  findLineByProduct,
  finishReadiness,
  lineState,
  queuedByLine,
  shippedGroups,
} from './counts';

const line = (
  id: number,
  productId: number,
  counted: string | null,
  shipped: string | null = '48.000',
  unrequested = false,
) => ({ id, productId, countedQtyBase: counted, shippedQtyBase: shipped, unrequested });

describe('a shipped line’s state (ADR-0116 #4)', () => {
  it('is unchecked, not arrived, short, over or exact against what was shipped', () => {
    expect(lineState(line(1, 1, null))).toEqual({ kind: 'unchecked' });
    expect(lineState(line(1, 1, '0.000'))).toEqual({ kind: 'notArrived' });
    expect(lineState(line(1, 1, '46.000'))).toEqual({ kind: 'short', diffBase: '2' });
    expect(lineState(line(1, 1, '50.000'))).toEqual({ kind: 'over', diffBase: '2' });
    expect(lineState(line(1, 1, '48.000'))).toEqual({ kind: 'exact' });
  });

  it('marks a product the store added as extra, whatever its count', () => {
    expect(lineState(line(1, 1, '3', '0', true))).toEqual({ kind: 'extra' });
    expect(lineState(line(1, 1, null, null, true))).toEqual({ kind: 'extra' });
  });
});

describe('the line a scan lands on', () => {
  const groups = [
    { id: 10, status: 'RECEIVED' as const, lines: [line(1, 100, null)] },
    { id: 11, status: 'SHIPPED' as const, lines: [line(2, 100, null), line(3, 200, null)] },
    { id: 12, status: 'SHIPPED' as const, lines: [line(4, 300, null)] },
  ];

  it('searches the shipped groups only, in order', () => {
    expect(shippedGroups(groups).map((group) => group.id)).toEqual([11, 12]);
    expect(findLineByProduct(groups, 100)?.line.id).toBe(2);
    expect(findLineByProduct(groups, 300)?.group.id).toBe(12);
    expect(findLineByProduct(groups, 999)).toBeNull();
  });
});

describe('the count queue', () => {
  const a = { groupId: 11, lineId: 2, productUnitId: 7, qty: '2' };
  const b = { groupId: 11, lineId: 3, productUnitId: 8, qty: '0' };

  it('sends in order; a line counted again replaces its unsent entry in place', () => {
    const queue = enqueueCount(enqueueCount([], a), b);
    expect(queue).toEqual([a, b]);
    const again = enqueueCount(queue, { ...a, qty: '3' });
    expect(again).toEqual([{ ...a, qty: '3' }, b]);
    expect(dropHead(again)).toEqual([b]);
    expect(queuedByLine(again).get(2)?.qty).toBe('3');
  });

  it('drops a count only when the group moved on (409 DOC_STATE_INVALID / DOC_ALREADY_POSTED)', () => {
    expect(dropsCount(409, 'DOC_STATE_INVALID')).toBe(true);
    expect(dropsCount(409, 'DOC_ALREADY_POSTED')).toBe(true);
    expect(dropsCount(409, 'DUPLICATE_VALUE')).toBe(false);
    expect(dropsCount(500, 'DOC_STATE_INVALID')).toBe(false);
    expect(dropsCount(0, 'NETWORK')).toBe(false);
  });

  it('lets a group finish only with nothing unsent and every requested line counted', () => {
    const group = {
      id: 11,
      lines: [line(2, 100, '48'), line(3, 200, null), line(5, 500, null, '0', true)],
    };
    expect(finishReadiness(group, [])).toEqual({ ready: false, unchecked: 1, unsent: 0 });
    const counted = { id: 11, lines: [line(2, 100, '48'), line(3, 200, '0')] };
    expect(finishReadiness(counted, [b])).toEqual({ ready: false, unchecked: 0, unsent: 1 });
    expect(finishReadiness(counted, [{ ...b, groupId: 12 }])).toEqual({
      ready: true,
      unchecked: 0,
      unsent: 0,
    });
  });
});
