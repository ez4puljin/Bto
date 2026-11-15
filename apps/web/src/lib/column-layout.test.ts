import { describe, expect, it } from 'vitest';
import { columnLayout, type ColumnSpec, fitColumns, fixedWidth } from '@/lib/column-layout';

describe('columnLayout (ADR-0119)', () => {
  const COLUMNS: ColumnSpec[] = [
    { key: 'number', kind: 'number' },
    { key: 'date', kind: 'date' },
    { key: 'description', kind: 'text', weight: 3, min: 12 },
    { key: 'party', kind: 'text', weight: 2 },
    { key: 'amount', kind: 'money' },
    { key: 'chevron', kind: 'chevron' },
  ];

  it('gives fixed kinds their width and text columns their minimum when there is no room', () => {
    // 10.5 + 7.25 + 8.5 + 2.25 = 28.5rem fixed; 12 + 7 = 19rem of minimums.
    expect(columnLayout(COLUMNS)).toEqual({
      widths: [10.5, 7.25, 12, 7, 8.5, 2.25],
      minWidth: 47.5,
    });
    expect(columnLayout(COLUMNS, 40).widths).toEqual([10.5, 7.25, 12, 7, 8.5, 2.25]);
  });

  it('shares the room above the minimum among the text columns by weight', () => {
    // 57.5 − 47.5 = 10rem spare: 6 to the description, 4 to the party.
    expect(columnLayout(COLUMNS, 57.5).widths).toEqual([10.5, 7.25, 18, 11, 8.5, 2.25]);
  });

  it('takes a spacer as a text column that may vanish, and an override width', () => {
    const layout = columnLayout(
      [
        { key: 'name', kind: 'text', min: 12 },
        { key: 'count', kind: 'count', width: 6 },
        { key: 'spacer', kind: 'spacer' },
        { key: 'actions', kind: 'actions', actions: 3 },
      ],
      34.75,
    );
    // 6 + (1.5 + 3 × 1.75) = 12.75rem fixed, 12rem of minimums, 10rem spare split in two.
    expect(layout).toEqual({ widths: [17, 6, 5, 6.75], minWidth: 24.75 });
  });

  it('has a width for every fixed kind and none for text', () => {
    const kinds: ColumnSpec['kind'][] = [
      'check',
      'image',
      'icon',
      'code',
      'number',
      'date',
      'datetime',
      'money',
      'qty',
      'count',
      'percent',
      'status',
      'actions',
      'chevron',
    ];
    for (const kind of kinds) expect(fixedWidth({ key: kind, kind })).toBeGreaterThan(0);
    expect(() => fixedWidth({ key: 'name', kind: 'text' })).toThrow();
    expect(columnLayout([{ key: 'a', kind: 'code' }], 50).minWidth).toBe(7);
  });
});

describe('fitColumns (ADR-0201)', () => {
  const COLUMNS: ColumnSpec[] = [
    { key: 'number', kind: 'number' },
    { key: 'date', kind: 'date' },
    { key: 'description', kind: 'text', weight: 3, min: 12 },
    { key: 'author', kind: 'text', drop: 1 },
    { key: 'at', kind: 'datetime', drop: 1 },
    { key: 'lines', kind: 'count', drop: 2 },
    { key: 'amount', kind: 'money' },
    { key: 'chevron', kind: 'chevron' },
  ];
  // 10.5 + 7.25 + 12 + 7 + 11.5 + 4.5 + 8.5 + 2.25 = 63.5rem at least.

  it('shows every column in a table wide enough', () => {
    const fit = fitColumns(COLUMNS, 80);
    expect(fit.dropped).toEqual([]);
    expect(fit.fits).toBe(true);
    expect(fit.layout.widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(80, 2);
  });

  it('lets the least needed columns go first, equal numbers together', () => {
    // 60rem: the 1s leave (7 + 11.5), and 45rem of columns fit; the count stays.
    const fit = fitColumns(COLUMNS, 60);
    expect(fit.dropped).toEqual([3, 4]);
    expect(fit.kept).toEqual([0, 1, 2, 5, 6, 7]);
    expect(fit.fits).toBe(true);
    expect(fit.layout.widths).toHaveLength(6);
    // What is left over goes to the one text column still shown.
    expect(fit.layout.widths[2]).toBeCloseTo(12 + 15, 2);
  });

  it('goes on to the next ones while the table is still too narrow', () => {
    const fit = fitColumns(COLUMNS, 42);
    expect(fit.dropped).toEqual([3, 4, 5]);
    expect(fit.fits).toBe(true);
  });

  it('never lets go of a column that is not marked, even when nothing fits', () => {
    const fit = fitColumns(COLUMNS, 30);
    expect(fit.kept).toEqual([0, 1, 2, 6, 7]);
    expect(fit.fits).toBe(false);
    const plain = fitColumns(
      COLUMNS.map(({ drop: _drop, ...column }) => column),
      30,
    );
    expect(plain.dropped).toEqual([]);
    expect(plain.fits).toBe(false);
  });
});
