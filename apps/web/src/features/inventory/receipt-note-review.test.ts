import { describe, expect, it } from 'vitest';
import {
  amountOf,
  draftOf,
  failureKeyOf,
  problemOf,
  qtyOf,
  type ReviewLine,
  reviewLinesOf,
  totalAgrees,
} from './receipt-note-review';
import type { NoteLine, NoteReading } from './receipt-notes-api';

const readLine = (patch: Partial<NoteLine> = {}): NoteLine => ({
  index: 0,
  page: 1,
  name: 'Coca Cola 0.5л',
  code: null,
  unit: 'ш',
  barcode: null,
  qty: '24',
  unitPrice: '1500',
  amount: '36000',
  free: false,
  unsure: false,
  match: {
    how: 'MEMORY',
    productUnitId: 7,
    productId: 1,
    sku: '700',
    productName: 'Coca Cola 0.5л',
    units: [
      { unitId: 7, name: 'ш', factor: '1' },
      { unitId: 8, name: 'хайрцаг', factor: '24' },
    ],
  },
  ...patch,
});

const reading = (lines: NoteLine[]): Pick<NoteReading, 'proposal'> => ({
  proposal: {
    supplierRead: { name: 'МСМ ХХК', regNo: null },
    docNo: 'A-1',
    docDate: '2026-11-17',
    totalQty: null,
    totalAmount: '36000',
    vat: 'INCLUDED',
    cut: 0,
    remark: '',
    lines,
  },
});

const header = { supplierId: 5, docNo: ' A-1 ', docDate: '2026-11-17' };

describe('a typed quantity', () => {
  it('is a positive number of at most three places, a decimal comma read as a dot', () => {
    expect(qtyOf(' 24 ')).toBe('24');
    expect(qtyOf('2,5')).toBe('2.5');
    expect(qtyOf('0.125')).toBe('0.125');
  });

  it('is nothing otherwise', () => {
    for (const text of ['', '0', '-1', '1.2345', 'арав', '1e3']) expect(qtyOf(text)).toBeNull();
  });
});

describe('the lines of a reading under check', () => {
  it('start as the reading proposes them, every line in', () => {
    const lines = reviewLinesOf(
      reading([readLine(), readLine({ index: 1, match: null, qty: null })]),
    );
    expect(lines).toEqual([
      {
        index: 0,
        include: true,
        qty: '24',
        how: 'MEMORY',
        product: {
          productUnitId: 7,
          sku: '700',
          name: 'Coca Cola 0.5л',
          units: [
            { unitId: 7, name: 'ш', factor: '1' },
            { unitId: 8, name: 'хайрцаг', factor: '24' },
          ],
        },
      },
      { index: 1, include: true, qty: '', how: null, product: null },
    ]);
  });

  it('say what a line still lacks, and nothing of a line left out', () => {
    const [matched, unmatched] = reviewLinesOf(
      reading([readLine(), readLine({ index: 1, match: null })]),
    ) as [ReviewLine, ReviewLine];
    expect(problemOf(matched)).toBeNull();
    expect(problemOf({ ...matched, qty: '0' })).toBe('qty');
    expect(problemOf(unmatched)).toBe('product');
    expect(problemOf({ ...unmatched, include: false })).toBeNull();
  });
});

describe('the draft a checked reading is saved as', () => {
  const lines = reviewLinesOf(reading([readLine(), readLine({ index: 1, match: null })]));

  it('waits for the supplier and for every line that goes in', () => {
    expect(draftOf({ ...header, supplierId: null }, lines)).toBeNull();
    expect(draftOf(header, lines)).toBeNull();
    expect(
      draftOf(
        header,
        lines.map((line) => ({ ...line, include: false })),
      ),
    ).toBeNull();
  });

  it('carries the lines kept in, each with its unit and quantity, and the trimmed header', () => {
    const kept = lines.map((line) => (line.index === 1 ? { ...line, include: false } : line));
    expect(draftOf(header, kept)).toEqual({
      supplierId: 5,
      supplierDocNo: 'A-1',
      supplierDocDate: '2026-11-17',
      lines: [{ index: 0, productUnitId: 7, enteredQty: '24' }],
    });
    expect(draftOf({ supplierId: 5, docNo: '  ', docDate: '' }, kept)).toEqual({
      supplierId: 5,
      lines: [{ index: 0, productUnitId: 7, enteredQty: '24' }],
    });
  });
});

describe('the amounts against the note’s total', () => {
  const note = reading([readLine(), readLine({ index: 1, amount: '4500' })]);
  const lines = reviewLinesOf(note);

  it('add up the lines going in', () => {
    expect(amountOf(note, lines)).toBe('40500.00');
    expect(amountOf(note, [{ ...(lines[0] as ReviewLine) }])).toBe('36000.00');
    expect(
      amountOf(
        note,
        lines.map((line) => ({ ...line, include: false })),
      ),
    ).toBeNull();
  });

  it('are unknown to a reader who sees no prices', () => {
    const hidden = reading([readLine({ amount: null, unitPrice: null })]);
    expect(amountOf(hidden, reviewLinesOf(hidden))).toBeNull();
    expect(totalAgrees(null, '36000')).toBeNull();
    expect(totalAgrees('36000.00', null)).toBeNull();
  });

  it('agree within a tugrik', () => {
    expect(totalAgrees('36000.00', '36000')).toBe(true);
    expect(totalAgrees('36000.90', '36000')).toBe(true);
    expect(totalAgrees('40500.00', '36000')).toBe(false);
  });
});

describe('a failed reading’s message', () => {
  const failed = (reason: string, status: number | null = null) => ({ reason, status });

  it('is the reason’s own, or the general one for a reason it does not know', () => {
    expect(failureKeyOf(failed('TIMEOUT'))).toBe('inventory.noteReading.failure.TIMEOUT');
    expect(failureKeyOf(failed('UNREADABLE_PAGE', 2))).toBe(
      'inventory.noteReading.failure.UNREADABLE_PAGE',
    );
    expect(failureKeyOf(failed('HTTP', 529))).toBe('inventory.noteReading.failure.HTTP');
    expect(failureKeyOf(failed('INTERNAL'))).toBe('inventory.noteReading.failure.OTHER');
    expect(failureKeyOf(null)).toBe('inventory.noteReading.failure.OTHER');
  });

  it('says the key is not accepted when the provider answered 401 or 403', () => {
    expect(failureKeyOf(failed('HTTP', 401))).toBe('inventory.noteReading.failure.KEY');
    expect(failureKeyOf(failed('HTTP', 403))).toBe('inventory.noteReading.failure.KEY');
  });
});
