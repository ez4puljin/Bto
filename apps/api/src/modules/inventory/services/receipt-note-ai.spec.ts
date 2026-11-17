import { gtinCheckDigit } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import { scannerUrlOf } from './note-scanner';
import {
  MAX_NOTE_LINES,
  noteBarcodes,
  noteDateOf,
  noteLineKey,
  type NoteMatchContext,
  notePriceOf,
  noteProposalOf,
  type NoteReadAnswer,
  noteReadData,
  numberOf,
  supplierOf,
} from './receipt-note-ai';

const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;

type AnswerLine = NoteReadAnswer['lines'][number];

const line = (patch: Partial<AnswerLine> = {}): AnswerLine => ({
  page: 1,
  name: 'Coca Cola 0.5л',
  code: null,
  barcode: null,
  unit: 'ш',
  qty: '24',
  unitPrice: '1500',
  amount: '36000',
  free: false,
  productUnitId: null,
  unsure: false,
  ...patch,
});

const answer = (patch: Partial<NoteReadAnswer> = {}): NoteReadAnswer => ({
  supplierName: 'МСМ ХХК',
  supplierRegNo: '2075385',
  docNo: 'A-1042',
  docDate: '2026.11.17',
  totalQty: null,
  totalAmount: null,
  pricesIncludeVat: true,
  lines: [line()],
  layoutNotes: 'Columns: №, name, unit, quantity, price, amount.',
  remark: '',
  ...patch,
});

const context = (patch: Partial<NoteMatchContext> = {}): NoteMatchContext => ({
  offered: new Set(),
  remembered: new Map(),
  barcodes: new Map(),
  ...patch,
});

describe('delivery note numbers and dates', () => {
  it('reads printed numbers: spaces, thousands commas, a decimal comma', () => {
    expect(numberOf('1 250 000', 2)).toBe('1250000');
    expect(numberOf('1,250,000.50', 2)).toBe('1250000.5');
    expect(numberOf('12,5', 3)).toBe('12.5');
    expect(numberOf('36000.00₮', 2)).toBe('36000');
  });

  it('refuses what is not a plain number of the allowed places', () => {
    for (const text of ['', 'арван', '-5', '1.2345', '12x', '1e5']) {
      expect(numberOf(text, 3)).toBeNull();
    }
    expect(numberOf('10.125', 2)).toBeNull();
    expect(numberOf(null, 2)).toBeNull();
  });

  it('takes a date as the receipt does and refuses a day that does not exist', () => {
    expect(noteDateOf('2026.11.17')).toBe('2026-11-17');
    expect(noteDateOf('2026-1-5')).toBe('2026-01-05');
    expect(noteDateOf('2026/02/30')).toBeNull();
    expect(noteDateOf('17.11.2026')).toBeNull();
    expect(noteDateOf(null)).toBeNull();
  });
});

describe('a note line’s key in the supplier’s memory', () => {
  it('is the supplier’s code with the unit when a code is printed, whatever the name reads as', () => {
    const boxed = { code: 'CC-050', name: 'Coca Cola 0.5л', unit: 'Хайрцаг' };
    expect(noteLineKey(boxed)).toBe('c:cc 050|хайрцаг');
    expect(noteLineKey({ ...boxed, name: 'Coca-Cola 0,5 л.' })).toBe(noteLineKey(boxed));
    expect(noteLineKey({ ...boxed, unit: 'ш' })).not.toBe(noteLineKey(boxed));
  });

  it('is the name with the unit otherwise, without case, spaces or punctuation', () => {
    expect(noteLineKey({ code: null, name: '  COCA-COLA  0.5л ', unit: 'ш.' })).toBe(
      noteLineKey({ code: '', name: 'coca cola 0 5л', unit: 'Ш' }),
    );
    expect(noteLineKey({ code: null, name: ' . ', unit: null })).toBeNull();
  });
});

describe('the supplier a note names', () => {
  const suppliers = [
    { id: 1, name: 'МСМ ХХК', regNo: '2075385', tin: null },
    { id: 2, name: 'Алтан тариа ХК', regNo: null, tin: '37900846788' },
    { id: 3, name: 'Номин', regNo: null, tin: null },
    { id: 4, name: '"Номин" ХХК', regNo: null, tin: null },
  ];

  it('is found by its registration or taxpayer number first', () => {
    expect(supplierOf({ name: 'Өөр нэр', regNo: ' 2075385 ' }, suppliers)?.id).toBe(1);
    expect(supplierOf({ name: null, regNo: '37900846788' }, suppliers)?.id).toBe(2);
  });

  it('then by its name without the company form, only when one supplier fits', () => {
    expect(supplierOf({ name: 'мсм ххк', regNo: null }, suppliers)?.id).toBe(1);
    expect(supplierOf({ name: 'Алтан Тариа', regNo: '0000000' }, suppliers)?.id).toBe(2);
    expect(supplierOf({ name: 'Номин ХХК', regNo: null }, suppliers)).toBeNull();
    expect(supplierOf({ name: 'Танихгүй ХХК', regNo: null }, suppliers)).toBeNull();
    expect(supplierOf({ name: null, regNo: null }, suppliers)).toBeNull();
  });
});

describe('the proposal of a reading', () => {
  it('matches by the printed barcode first, then by the memory, then by the model’s choice', () => {
    const code = ean('865000100001');
    const read = answer({
      lines: [
        line({ name: 'A', barcode: code, productUnitId: 30, code: 'X1' }),
        line({ name: 'B', code: 'X2', productUnitId: 30 }),
        line({ name: 'C', productUnitId: 30 }),
        line({ name: 'D', productUnitId: 999 }),
        line({ name: 'E' }),
      ],
    });
    const proposal = noteProposalOf(
      read,
      context({
        offered: new Set([30]),
        remembered: new Map([['c:x2|ш', 20]]),
        barcodes: new Map([[code, 10]]),
      }),
    );
    expect(proposal.lines.map((row) => row.match)).toEqual([
      { how: 'BARCODE', productUnitId: 10 },
      { how: 'MEMORY', productUnitId: 20 },
      { how: 'MODEL', productUnitId: 30 },
      // An id that was never offered is not a match.
      null,
      null,
    ]);
    expect(noteBarcodes(read)).toEqual([code]);
  });

  it('keeps the header as printed and the date as the receipt takes it', () => {
    const proposal = noteProposalOf(
      answer({ totalQty: '24', totalAmount: '36,000.00', docNo: '  A-1042 ' }),
      context(),
    );
    expect(proposal).toMatchObject({
      supplierRead: { name: 'МСМ ХХК', regNo: '2075385' },
      docNo: 'A-1042',
      docDate: '2026-11-17',
      totalQty: '24',
      totalAmount: '36000',
      vat: 'INCLUDED',
      cut: 0,
    });
  });

  it('marks a line whose figures do not agree, or whose quantity did not read', () => {
    const proposal = noteProposalOf(
      answer({
        lines: [
          line(),
          line({ qty: '24', unitPrice: '1500', amount: '63000' }),
          line({ qty: 'xx' }),
          line({ qty: '0' }),
          line({ unsure: true }),
        ],
      }),
      context(),
    );
    expect(proposal.lines.map((row) => row.unsure)).toEqual([false, true, true, true, true]);
    expect(proposal.lines.map((row) => row.qty)).toEqual(['24', '24', null, null, '24']);
  });

  it('carries no price on free goods and drops a line without a name', () => {
    const proposal = noteProposalOf(
      answer({ lines: [line({ free: true, unitPrice: '0', amount: '0' }), line({ name: '  ' })] }),
      context(),
    );
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]).toMatchObject({ free: true, unitPrice: null, amount: null });
  });

  it('raises amounts printed without VAT to the note’s total, to the last tugrik', () => {
    const proposal = noteProposalOf(
      answer({
        pricesIncludeVat: false,
        totalAmount: '110000.01',
        lines: [
          line({ qty: '10', unitPrice: '3333.33', amount: '33333.33' }),
          line({ qty: '10', unitPrice: '6666.67', amount: '66666.67' }),
          line({ free: true }),
        ],
      }),
      context(),
    );
    expect(proposal.vat).toBe('ADDED');
    const amounts = proposal.lines.map((row) => row.amount);
    expect(amounts).toEqual(['36666.67', '73333.34', null]);
    expect(new Decimal(amounts[0] ?? 0).plus(amounts[1] ?? 0).toFixed(2)).toBe('110000.01');
    // A price without VAT no longer makes the amount.
    expect(proposal.lines.map((row) => row.unitPrice)).toEqual([null, null, null]);
  });

  it('leaves the amounts alone when the totals do not look like added VAT', () => {
    const untouched = (patch: Partial<NoteReadAnswer>) =>
      noteProposalOf(answer({ pricesIncludeVat: false, ...patch }), context());
    expect(untouched({ totalAmount: null }).vat).toBe('UNKNOWN');
    expect(untouched({ totalAmount: '36000' }).vat).toBe('UNKNOWN');
    expect(untouched({ totalAmount: '90000' }).vat).toBe('UNKNOWN');
    expect(untouched({ totalAmount: '90000' }).lines[0]?.amount).toBe('36000');
    expect(noteProposalOf(answer({ pricesIncludeVat: null }), context()).vat).toBe('UNKNOWN');
  });

  it('cuts a note longer than the limit and says by how much', () => {
    const proposal = noteProposalOf(
      answer({ lines: Array.from({ length: MAX_NOTE_LINES + 3 }, () => line()) }),
      context(),
    );
    expect(proposal.lines).toHaveLength(MAX_NOTE_LINES);
    expect(proposal.cut).toBe(3);
  });
});

describe('the price a draft line takes from the note', () => {
  const read = { qty: '24', unitPrice: '1500', amount: '36000', free: false };

  it('is the unit price when it makes the amount, so it follows a corrected quantity', () => {
    expect(notePriceOf(read, new Decimal(24))).toEqual({ docUnitPrice: new Decimal(1500) });
    expect(notePriceOf(read, new Decimal(20))).toEqual({ docUnitPrice: new Decimal(1500) });
    expect(notePriceOf({ ...read, amount: null }, new Decimal(24))).toEqual({
      docUnitPrice: new Decimal(1500),
    });
  });

  it('is the amount as printed when the price does not make it, for the printed quantity only', () => {
    const rounded = { ...read, unitPrice: '1499.99', amount: '36000' };
    expect(notePriceOf(rounded, new Decimal(24))).toEqual({ docAmount: new Decimal(36000) });
    expect(notePriceOf(rounded, new Decimal(20))).toEqual({});
    expect(notePriceOf({ ...read, unitPrice: null }, new Decimal(24))).toEqual({
      docAmount: new Decimal(36000),
    });
  });

  it('is nothing for free goods and for a line without prices', () => {
    expect(notePriceOf({ ...read, free: true }, new Decimal(24))).toEqual({ freeGoods: true });
    expect(notePriceOf({ ...read, unitPrice: null, amount: null }, new Decimal(24))).toEqual({});
  });
});

describe('what the model is given', () => {
  it('lists the supplier’s product units a row each, with the layout notes', () => {
    const data = JSON.parse(
      noteReadData({
        supplier: { name: 'МСМ ХХК', regNo: '2075385' },
        layoutNotes: 'Quantity counts boxes.',
        units: [
          { unitId: 7, productId: 1, sku: '100', name: 'Cola 0.5л', unit: 'ш', factor: '1' },
          { unitId: 8, productId: 1, sku: '100', name: 'Cola 0.5л', unit: 'хайрцаг', factor: '24' },
        ],
      }),
    ) as Record<string, unknown>;
    expect(data).toEqual({
      supplier: { name: 'МСМ ХХК', regNo: '2075385' },
      layoutNotes: 'Quantity counts boxes.',
      products: ['7 | 100 | Cola 0.5л | ш x 1', '8 | 100 | Cola 0.5л | хайрцаг x 24'],
    });
  });
});

describe('a scanner’s address', () => {
  it('is a private IPv4 address over http or https, kept without a path', () => {
    expect(scannerUrlOf('192.168.1.60')).toBe('http://192.168.1.60');
    expect(scannerUrlOf(' http://192.168.1.60/ ')).toBe('http://192.168.1.60');
    expect(scannerUrlOf('https://10.0.0.5:8443')).toBe('https://10.0.0.5:8443');
    expect(scannerUrlOf('http://172.20.1.9:8080')).toBe('http://172.20.1.9:8080');
  });

  it('is never a name, a public address, this machine or anything with a path or a sign-in', () => {
    for (const address of [
      'http://printer.local',
      'http://example.com',
      'http://8.8.8.8',
      'http://127.0.0.1',
      'http://localhost:8080',
      'http://169.254.169.254',
      'http://172.32.0.1',
      'http://192.168.1.60/eSCL',
      'http://user:pass@192.168.1.60',
      'http://192.168.1.60?x=1',
      'ftp://192.168.1.60',
      'http://[::1]',
      'http://192.168.1.999',
      '',
    ]) {
      expect(scannerUrlOf(address)).toBeNull();
    }
  });
});
