import { describe, expect, it } from 'vitest';
import {
  checkDocumentLayout,
  defaultDocumentLayout,
  documentBlockShown,
  documentLayoutFor,
  newDocumentBlock,
  type PublishedDocumentTemplate,
} from './document-template';

describe('wholesale document templates (ADR-0143)', () => {
  it('accepts the built-in layouts of both kinds', () => {
    for (const kind of ['PICK_LIST', 'DELIVERY_NOTE'] as const) {
      const layout = defaultDocumentLayout(kind);
      expect(checkDocumentLayout(layout, kind)).toEqual({ ok: true, layout });
    }
  });

  it('keeps the required blocks and columns and refuses what a kind has not', () => {
    const note = defaultDocumentLayout('DELIVERY_NOTE');
    expect(
      checkDocumentLayout(
        { ...note, blocks: note.blocks.filter((block) => block.type !== 'TOTALS') },
        'DELIVERY_NOTE',
      ),
    ).toMatchObject({ ok: false, rule: 'required' });
    const pick = defaultDocumentLayout('PICK_LIST');
    expect(
      checkDocumentLayout(
        { ...pick, blocks: [...pick.blocks, newDocumentBlock('TOTALS', 'PICK_LIST')] },
        'PICK_LIST',
      ),
    ).toMatchObject({ ok: false, rule: 'kind' });
    // A delivery note's lines in a pick list: its columns are not the pick list's.
    expect(
      checkDocumentLayout(
        {
          ...pick,
          blocks: pick.blocks.map((block) =>
            block.type === 'LINES' ? newDocumentBlock('LINES', 'DELIVERY_NOTE') : block,
          ),
        },
        'PICK_LIST',
      ),
    ).toMatchObject({ ok: false, rule: 'enum' });
    const lines = newDocumentBlock('LINES', 'DELIVERY_NOTE');
    if (lines.type !== 'LINES') throw new Error('lines');
    expect(
      checkDocumentLayout(
        {
          ...note,
          blocks: note.blocks.map((block) =>
            block.type === 'LINES'
              ? {
                  ...lines,
                  columns: lines.columns.map((column) =>
                    column.key === 'QTY' ? { ...column, on: false } : column,
                  ),
                }
              : block,
          ),
        },
        'DELIVERY_NOTE',
      ),
    ).toMatchObject({ ok: false, rule: 'required' });
  });

  it('cleans the free blocks and the signatures', () => {
    const note = defaultDocumentLayout('DELIVERY_NOTE');
    const checked = checkDocumentLayout(
      {
        ...note,
        blocks: [
          ...note.blocks.filter((block) => block.type !== 'SIGNATURES'),
          { type: 'SIGNATURES', labels: [' Нягтлан ', 'Жолооч'] },
          {
            type: 'TEXT',
            text: ' Баярлалаа ',
            align: 'CENTER',
            size: 'SM',
            bold: false,
            when: 'MEMBER',
            to: '2026-12-31',
          },
        ],
      },
      'DELIVERY_NOTE',
    );
    expect(checked.ok && checked.layout.blocks.slice(-2)).toEqual([
      { type: 'SIGNATURES', labels: ['Нягтлан', 'Жолооч'] },
      {
        type: 'TEXT',
        text: 'Баярлалаа',
        align: 'CENTER',
        size: 'SM',
        bold: false,
        to: '2026-12-31',
      },
    ]);
    expect(
      checkDocumentLayout(
        { ...note, blocks: [...note.blocks.slice(0, -1), { type: 'SIGNATURES', labels: [] }] },
        'DELIVERY_NOTE',
      ),
    ).toMatchObject({ ok: false, rule: 'count' });
  });

  it('prints a block within its dates and with the pipeline choice of the kind', () => {
    const text = newDocumentBlock('TEXT', 'PICK_LIST');
    expect(documentBlockShown({ ...text, to: '2026-11-03' } as typeof text, '2026-11-04')).toBe(
      false,
    );
    expect(documentBlockShown(text, '2026-11-04')).toBe(true);
    const base = defaultDocumentLayout('DELIVERY_NOTE');
    const templates: PublishedDocumentTemplate[] = [
      { id: 1, kind: 'DELIVERY_NOTE', isDefault: true, layout: base },
      { id: 2, kind: 'DELIVERY_NOTE', isDefault: false, layout: { ...base, size: 'SM' } },
    ];
    expect(documentLayoutFor(templates, 'DELIVERY_NOTE', 2)?.size).toBe('SM');
    expect(documentLayoutFor(templates, 'DELIVERY_NOTE', null)).toBe(base);
    expect(documentLayoutFor(templates, 'PICK_LIST', 2)).toBeNull();
  });
});
