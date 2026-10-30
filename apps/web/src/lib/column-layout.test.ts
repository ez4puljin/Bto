import { describe, expect, it } from 'vitest';
import { columnLayout, type ColumnSpec, fixedWidth } from '@/lib/column-layout';

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
