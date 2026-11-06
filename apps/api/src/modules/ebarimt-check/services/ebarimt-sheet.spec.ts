import { Readable } from 'node:stream';
import { EBARIMT_LIMITS } from '@tugeel/shared/ebarimt-check';
import ExcelJS from 'exceljs';
import { readEbarimtSheet } from './ebarimt-sheet';

const HEADS = [
  'Падаан №',
  'ДДТД',
  'Огноо',
  'Харилцагчийн нэр',
  'Харилцагчийн ТТД',
  'НӨАТ',
  'Цэвэр дүн',
  'Нийт дүн',
  'Төрөл',
];

async function streamOf(rows: readonly unknown[][], options: { above?: unknown[][] } = {}) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  for (const row of options.above ?? []) sheet.addRow(row);
  sheet.addRow(HEADS);
  for (const row of rows) sheet.addRow(row);
  return Readable.from(Buffer.from(await book.xlsx.writeBuffer()));
}

const LINE = [
  '9000000001',
  'TEST-DDTD-1',
  '2026-10-15',
  'Туршилт ХХК',
  '7100011',
  200000,
  2000000,
  2200000,
  'Энгийн',
];

describe('readEbarimtSheet', () => {
  it('reads the export as e-Barimt writes it', async () => {
    const sheet = await readEbarimtSheet(await streamOf([LINE]));
    expect(sheet.period).toBe(202610);
    expect(sheet.totalAmount.toFixed(2)).toBe('2200000.00');
    expect(sheet.vatAmount.toFixed(2)).toBe('200000.00');
    expect(sheet.rows[0]).toMatchObject({
      receiptKey: 'TEST-DDTD-1',
      ddtd: 'TEST-DDTD-1',
      deliveryNoteNo: '9000000001',
      docDate: '2026-10-15',
      partnerName: 'Туршилт ХХК',
      ttd: '7100011',
      kind: 'Энгийн',
    });
  });

  it('finds the head row under a title, and skips a line without a register', async () => {
    const sheet = await readEbarimtSheet(
      await streamOf([LINE, [null, null, null, 'Нийт', null, 1, 1, 2, null]], {
        above: [['EBARIMT Падаан'], []],
      }),
    );
    expect(sheet.rows).toHaveLength(1);
  });

  it('takes numbers and dates however the cell holds them', async () => {
    const sheet = await readEbarimtSheet(
      await streamOf([
        [
          55,
          null,
          new Date(Date.UTC(2026, 9, 9)),
          'A',
          7100011,
          '1,000',
          '10,000.50',
          '11,000.50',
          null,
        ],
        ['56', null, '2026/10/10', 'B', '011', 1, 2, 3, null],
      ]),
    );
    expect(sheet.rows[0]).toMatchObject({
      docDate: '2026-10-09',
      ttd: '7100011',
      deliveryNoteNo: '55',
    });
    expect(sheet.rows[0]?.totalAmount.toFixed(2)).toBe('11000.50');
    expect(sheet.rows[0]?.receiptKey).toBe('P55|2026-10-09|7100011|11000.50');
    expect(sheet.rows[1]).toMatchObject({ docDate: '2026-10-10', ttd: '11' });
  });

  it('refuses what is not such a file', async () => {
    await expect(
      readEbarimtSheet(Readable.from(Buffer.from('not a workbook'))),
    ).rejects.toMatchObject({
      code: 'EBARIMT_FILE_UNREADABLE',
    });
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Sheet1').addRow(['Код', 'Нэр']);
    await expect(
      readEbarimtSheet(Readable.from(Buffer.from(await book.xlsx.writeBuffer()))),
    ).rejects.toMatchObject({ code: 'EBARIMT_FILE_COLUMNS' });
    await expect(readEbarimtSheet(await streamOf([]))).rejects.toMatchObject({
      code: 'EBARIMT_FILE_EMPTY',
    });
  });

  it('refuses a line it cannot read, naming the row', async () => {
    await expect(
      readEbarimtSheet(
        await streamOf([LINE, ['1', 'x', 'өчигдөр', 'A', '7100011', 1, 1, 2, null]]),
      ),
    ).rejects.toMatchObject({ code: 'EBARIMT_FILE_ROW', params: { row: 3 } });
    await expect(
      readEbarimtSheet(
        await streamOf([['1', 'x', '2026-10-01', 'A', '7100011', 1, 1, 'олон', null]]),
      ),
    ).rejects.toMatchObject({ code: 'EBARIMT_FILE_ROW', params: { row: 2 } });
  });

  it('refuses two months in one file, naming them', async () => {
    await expect(
      readEbarimtSheet(
        await streamOf([LINE, ['1', 'x', '2026-09-30', 'A', '7100011', 1, 1, 2, null]]),
      ),
    ).rejects.toMatchObject({
      code: 'EBARIMT_FILE_MONTHS',
      params: { months: '2026-09, 2026-10' },
    });
  });

  const lineWith = (over: {
    date?: unknown;
    total?: unknown;
    ttd?: unknown;
    vat?: unknown;
    net?: unknown;
  }) => [
    '1',
    'x',
    over.date === undefined ? '2026-10-01' : over.date,
    'A',
    over.ttd === undefined ? '7100011' : over.ttd,
    over.vat === undefined ? 1 : over.vat,
    over.net === undefined ? 1 : over.net,
    over.total === undefined ? 2 : over.total,
    null,
  ];
  const refusedRow = { code: 'EBARIMT_FILE_ROW', params: { row: 2 } };

  it('refuses a blank total, an error cell and a formula nobody worked out', async () => {
    for (const total of [null, '', { error: '#REF!' }, { formula: 'F2+G2' }]) {
      await expect(readEbarimtSheet(await streamOf([lineWith({ total })]))).rejects.toMatchObject(
        refusedRow,
      );
    }
  });

  it('does not guess the notation of an amount written as text', async () => {
    for (const total of ['1234,56', '1.234,50', '12,34', '1.234', '1,23,456']) {
      await expect(readEbarimtSheet(await streamOf([lineWith({ total })]))).rejects.toMatchObject(
        refusedRow,
      );
    }
    const sheet = await readEbarimtSheet(await streamOf([lineWith({ total: '1,234,567.50' })]));
    expect(sheet.totalAmount.toFixed(2)).toBe('1234567.50');
  });

  it('refuses a register it cannot read, rather than losing the line', async () => {
    for (const ttd of [{ error: '#N/A' }, { formula: 'F2+G2' }]) {
      await expect(readEbarimtSheet(await streamOf([lineWith({ ttd })]))).rejects.toMatchObject(
        refusedRow,
      );
    }
  });

  it('takes a worked-out formula by its result', async () => {
    const sheet = await readEbarimtSheet(
      await streamOf([lineWith({ total: { formula: 'F2+G2', result: 2 } })]),
    );
    expect(sheet.totalAmount.toFixed(2)).toBe('2.00');
  });

  it('takes a formula worked out to nothing as 0, not as never worked out', async () => {
    const sheet = await readEbarimtSheet(
      await streamOf([lineWith({ vat: { formula: 'G2-G2', result: 0 } })]),
    );
    expect(sheet.vatAmount.toFixed(2)).toBe('0.00');
    const zero = await readEbarimtSheet(
      await streamOf([lineWith({ total: { formula: 'G2-G2', result: 0 } })]),
    );
    expect(zero.totalAmount.toFixed(2)).toBe('0.00');
  });

  it('refuses a date cell past what a date can hold, naming the row', async () => {
    const book = new ExcelJS.Workbook();
    const page = book.addWorksheet('Sheet1');
    page.addRow(HEADS);
    page.addRow(lineWith({ date: 1000000000 }));
    page.getCell('C2').numFmt = 'yyyy-mm-dd';
    await expect(
      readEbarimtSheet(Readable.from(Buffer.from(await book.xlsx.writeBuffer()))),
    ).rejects.toMatchObject(refusedRow);
  });

  it('refuses an amount that rounds up to what cannot be held', async () => {
    await expect(
      readEbarimtSheet(await streamOf([lineWith({ net: 999999999999.995 })])),
    ).rejects.toMatchObject(refusedRow);
  });

  it('refuses a day that does not exist', async () => {
    for (const date of ['2026-02-31', '2026-10-00', '2026-13-01']) {
      await expect(readEbarimtSheet(await streamOf([lineWith({ date })]))).rejects.toMatchObject(
        refusedRow,
      );
    }
  });

  it('wants the date column: without it no line has a month', async () => {
    const book = new ExcelJS.Workbook();
    const page = book.addWorksheet('Sheet1');
    page.addRow(HEADS.filter((head) => head !== 'Огноо'));
    page.addRow(['1', 'x', 'A', '7100011', 1, 1, 2, null]);
    await expect(
      readEbarimtSheet(Readable.from(Buffer.from(await book.xlsx.writeBuffer()))),
    ).rejects.toMatchObject({ code: 'EBARIMT_FILE_COLUMNS' });
  });

  it('refuses an amount too large to hold', async () => {
    await expect(
      readEbarimtSheet(await streamOf([lineWith({ total: 1_000_000_000_000 })])),
    ).rejects.toMatchObject(refusedRow);
  });

  it('refuses a file whose total does not fit', async () => {
    const big = lineWith({ total: 600_000_000_000 });
    await expect(readEbarimtSheet(await streamOf([big, big]))).rejects.toMatchObject({
      code: 'EBARIMT_FILE_LIMIT',
    });
  });

  it('refuses more lines than a file may hold', async () => {
    const lines = Array.from({ length: EBARIMT_LIMITS.maxRows + 1 }, () => lineWith({}));
    await expect(readEbarimtSheet(await streamOf(lines))).rejects.toMatchObject({
      code: 'EBARIMT_FILE_LIMIT',
      params: { max: EBARIMT_LIMITS.maxRows },
    });
  }, 60_000);
});
