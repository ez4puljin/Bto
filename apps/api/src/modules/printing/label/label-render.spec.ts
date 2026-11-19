import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labelEscPos } from './escpos';
import { type LabelFace, labelPng, renderLabel } from './label-render';

// The old system's label drawn on the server (ADR-0226 #2). A sample PNG is written to the
// repository's git-ignored tmp/labels/ so a person can look at it.

const FACE: LabelFace = {
  name: 'Сүү «Сайн» 1л цагаан шилтэй, тослог 3.2% — Monster energy drink',
  code: '101007',
  date: '2026-11-19',
  price: '29,700',
  bulkQty: '2',
  bulkPrice: '29,130',
};

const SAMPLES = join(__dirname, '../../../../../../tmp/labels');

describe('price label (ADR-0226)', () => {
  it('draws the label 576 dots wide with its frame and text, and encodes it for the printer', async () => {
    const bitmap = await renderLabel(FACE);
    expect(bitmap.width).toBe(576);
    expect(bitmap.height).toBeGreaterThan(200);
    expect(bitmap.height).toBeLessThan(500);
    // The frame: the first and last rows are black across.
    const row = (y: number) => bitmap.grey.subarray(y * 576, (y + 1) * 576);
    expect(row(0).every((value) => value < 150)).toBe(true);
    expect(row(bitmap.height - 1).every((value) => value < 150)).toBe(true);
    // Text inside the frame: dark dots away from the borders.
    const inside = bitmap.grey.subarray(20 * 576, (bitmap.height - 20) * 576);
    const ink = inside.filter(
      (value, index) => value < 150 && index % 576 > 12 && index % 576 < 564,
    );
    expect(ink.length).toBeGreaterThan(2000);

    const bytes = labelEscPos(bitmap);
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(2, 6)]).toEqual([0x1d, 0x76, 0x30, 0x00]);
    expect(bytes.readUInt16LE(6)).toBe(72);
    expect([...bytes.subarray(bytes.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    const bands = Math.ceil(bitmap.height / 255);
    expect(bytes.length).toBe(2 + bands * 8 + 72 * bitmap.height + 4);

    mkdirSync(SAMPLES, { recursive: true });
    writeFileSync(join(SAMPLES, 'sample-label.png'), await labelPng(bitmap));
  });

  it('keeps an empty bulk line and draws 384 dots for 58 mm paper', async () => {
    const plain = await renderLabel({ ...FACE, name: 'Ус', bulkQty: '', bulkPrice: '' }, 384);
    expect(plain.width).toBe(384);
    mkdirSync(SAMPLES, { recursive: true });
    writeFileSync(join(SAMPLES, 'sample-label-58mm.png'), await labelPng(plain));
  });
});
