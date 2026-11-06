import { describe, expect, it } from 'vitest';
import {
  checkReceiptLayout,
  defaultReceiptLayout,
  fillReceiptText,
  newReceiptBlock,
  parsePosReceiptBarcode,
  posReceiptBarcode,
  receiptBlockShown,
  receiptLayoutFor,
  type ReceiptTextBlock,
  type SnapshotReceiptTemplate,
} from './receipt-template';

describe('receipt templates (ADR-0141)', () => {
  it('accepts the built-in layout and cleans texts', () => {
    const layout = defaultReceiptLayout();
    expect(checkReceiptLayout(layout)).toEqual({ ok: true, layout });
    const checked = checkReceiptLayout({
      ...layout,
      blocks: [
        { type: 'TEXT', text: ' Сайн байна уу\r\n ', align: 'LEFT', size: 'SM', bold: false },
        ...layout.blocks,
      ],
    });
    expect(checked.ok && checked.layout.blocks[0]).toMatchObject({ text: 'Сайн байна уу' });
  });

  it('keeps the required blocks exactly once and the single ones at most once', () => {
    const layout = defaultReceiptLayout();
    expect(
      checkReceiptLayout({
        ...layout,
        blocks: layout.blocks.filter((block) => block.type !== 'TOTALS'),
      }),
    ).toMatchObject({ ok: false, rule: 'required' });
    expect(
      checkReceiptLayout({ ...layout, blocks: [...layout.blocks, { type: 'FOOTER' }] }),
    ).toMatchObject({ ok: false, rule: 'single' });
    expect(
      checkReceiptLayout({ ...layout, blocks: [...layout.blocks, { type: 'VIDEO' }] }),
    ).toMatchObject({ ok: false, path: `layout.blocks[${layout.blocks.length}].type` });
    expect(checkReceiptLayout({ ...layout, size: 'XL' })).toMatchObject({
      ok: false,
      path: 'layout.size',
    });
  });

  it('keeps a free block conditions and dates, and refuses a bad logo or date (ADR-0142)', () => {
    const layout = defaultReceiptLayout();
    const checked = checkReceiptLayout({
      ...layout,
      blocks: [
        ...layout.blocks,
        {
          type: 'TEXT',
          text: 'Хямдрал {{total}}',
          align: 'CENTER',
          size: 'MD',
          bold: false,
          inverse: true,
          when: 'MEMBER',
          from: '2026-11-01',
          to: '',
        },
        { type: 'QR', data: 'https://bto.mn', caption: '  ', size: 'SM', when: 'ALWAYS' },
        { type: 'BARCODE', showNumber: true, hidden: true },
      ],
    });
    expect(checked.ok && checked.layout.blocks.slice(-3)).toEqual([
      {
        type: 'TEXT',
        text: 'Хямдрал {{total}}',
        align: 'CENTER',
        size: 'MD',
        bold: false,
        inverse: true,
        when: 'MEMBER',
        from: '2026-11-01',
      },
      { type: 'QR', data: 'https://bto.mn', caption: null, size: 'SM' },
      { type: 'BARCODE', showNumber: true, hidden: true },
    ]);
    const logo = { type: 'LOGO', width: 60, align: 'CENTER' };
    expect(
      checkReceiptLayout({
        ...layout,
        blocks: [...layout.blocks, { ...logo, image: 'data:image/jpeg;base64,AAAA' }],
      }),
    ).toMatchObject({ ok: false, rule: 'image' });
    expect(
      checkReceiptLayout({
        ...layout,
        blocks: [...layout.blocks, { ...logo, image: 'data:image/png;base64,iVBORw0KGgo=' }],
      }).ok,
    ).toBe(true);
    expect(
      checkReceiptLayout({
        ...layout,
        blocks: [
          ...layout.blocks,
          { type: 'SPACE', size: 'SM', from: '2026-12-01', to: '2026-11-01' },
        ],
      }),
    ).toMatchObject({ ok: false, rule: 'range' });
  });

  it('prints a free block only on its receipts and days, with the values filled in', () => {
    const facts = { credit: false, member: true, b2b: false, day: '2026-11-04' };
    const text = newReceiptBlock('TEXT') as ReceiptTextBlock;
    expect(receiptBlockShown(text, facts)).toBe(true);
    expect(receiptBlockShown({ ...text, when: 'CREDIT' }, facts)).toBe(false);
    expect(receiptBlockShown({ ...text, when: 'MEMBER' }, facts)).toBe(true);
    expect(receiptBlockShown({ ...text, from: '2026-11-05' }, facts)).toBe(false);
    expect(receiptBlockShown({ ...text, to: '2026-11-04' }, facts)).toBe(true);
    expect(receiptBlockShown({ ...text, hidden: true }, facts)).toBe(false);
    expect(
      fillReceiptText('№ {{number}}, {{ cashier }} {{nope}} {{member}}', {
        number: 'К1-261104-0042',
        cashier: 'Болд',
      }),
    ).toBe('№ К1-261104-0042, Болд {{nope}} ');
  });

  it('makes and reads the receipt barcode', () => {
    const code = posReceiptBarcode(12, 'К1-261104-0042');
    expect(code).toMatch(/^99300122611040042[0-9]$/);
    expect(parsePosReceiptBarcode(code ?? '')).toEqual({ tillId: 12, day: '261104', seq: '0042' });
    expect(parsePosReceiptBarcode(`${(code ?? '').slice(0, -1)}0`)).toBeNull();
    expect(posReceiptBarcode(1, 'К1-261104-Б0003')).toBeNull();
    expect(posReceiptBarcode(10_000, 'К1-261104-0042')).toBeNull();
  });

  it('prints with the POS choice of the same kind, else the default, else the built-in', () => {
    const base = defaultReceiptLayout();
    const templates: SnapshotReceiptTemplate[] = [
      { id: 1, kind: 'SALE', isDefault: true, version: 1, layout: base },
      { id: 2, kind: 'SALE', isDefault: false, version: 3, layout: { ...base, paper: 'MM58' } },
      { id: 3, kind: 'RETURN', isDefault: false, version: 1, layout: { ...base, size: 'LG' } },
    ];
    expect(receiptLayoutFor(templates, 'SALE', 2)?.paper).toBe('MM58');
    expect(receiptLayoutFor(templates, 'SALE', null)).toBe(base);
    expect(receiptLayoutFor(templates, 'SALE', 3)).toBe(base);
    expect(receiptLayoutFor(templates, 'RETURN', null)).toBeNull();
    expect(receiptLayoutFor(undefined, 'SALE', 2)).toBeNull();
  });
});
