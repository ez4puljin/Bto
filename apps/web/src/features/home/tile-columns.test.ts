import { describe, expect, it } from 'vitest';
import { tileColumns } from './tile-columns';

/** The rows a grid of `count` tiles in `columns` columns fills, e.g. [3, 3, 3]. */
const rows = (count: number, columns: number) =>
  Array.from({ length: Math.ceil(count / columns) }, (_, row) =>
    Math.min(columns, count - row * columns),
  );

describe('home shortcut columns (ADR-0066)', () => {
  it('lays an admin’s nine shortcuts out without a lone tile at the desktop sizes', () => {
    // The left column beside the recent pages at 1366 / 1536 / 1920, then the whole page width.
    expect(rows(9, tileColumns(9, 678))).toEqual([3, 3, 3]);
    expect(rows(9, tileColumns(9, 848))).toEqual([3, 3, 3]);
    expect(rows(9, tileColumns(9, 1224))).toEqual([5, 4]);
    expect(rows(9, tileColumns(9, 1054))).toEqual([3, 3, 3]);
    expect(rows(9, tileColumns(9, 1600))).toEqual([5, 4]);
  });

  it('keeps the tiles wide enough for a label on one line', () => {
    for (const width of [678, 848, 1054, 1224, 1600]) {
      const columns = tileColumns(9, width);
      expect((width - 12 * (columns - 1)) / columns).toBeGreaterThanOrEqual(208);
    }
  });

  it('narrows the tiles a little rather than leave one alone, and keeps two on a phone', () => {
    expect(rows(7, tileColumns(7, 678))).toEqual([4, 3]);
    expect(rows(5, tileColumns(5, 678))).toEqual([3, 2]);
    expect(rows(3, tileColumns(3, 678))).toEqual([3]);
    expect(tileColumns(9, 343)).toBe(2);
    expect(tileColumns(1, 678)).toBe(1);
  });
});
