import { describe, expect, it } from 'vitest';
import {
  checkedAtFrom,
  chunksOf,
  THUMBS_EVERY_MS,
  thumbsDue,
  thumbsKept,
  thumbsKey,
} from './thumbs';

describe('keeping the shop thumbnails on the phone', () => {
  it('asks again only after six hours, or when the clock went back', () => {
    const now = 1_000_000_000;
    expect(thumbsDue(0, now)).toBe(true);
    expect(thumbsDue(now - THUMBS_EVERY_MS + 1, now)).toBe(false);
    expect(thumbsDue(now - THUMBS_EVERY_MS, now)).toBe(true);
    expect(thumbsDue(now + 60_000, now)).toBe(true);
  });

  it('reads a stored moment and ignores anything else', () => {
    expect(checkedAtFrom(1234)).toBe(1234);
    for (const value of [null, '1234', -5, Number.NaN, { at: 1 }]) {
      expect(checkedAtFrom(value)).toBe(0);
    }
  });

  it('waits for the next interval unless more than a tenth of the pictures failed', () => {
    expect(thumbsKept(0, 0)).toBe(true);
    expect(thumbsKept(100, 10)).toBe(true);
    expect(thumbsKept(100, 11)).toBe(false);
  });

  it('downloads in runs, in order, one key per server', () => {
    expect(chunksOf([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunksOf([], 6)).toEqual([]);
    expect(thumbsKey('http://192.168.1.10:3300')).toBe('bto.thumbs.v1:http://192.168.1.10:3300');
  });
});
