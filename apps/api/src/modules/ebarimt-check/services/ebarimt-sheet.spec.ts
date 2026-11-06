import { Readable } from 'node:stream';
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
  '033000925',
  '2026-10-08',
  'Туршилт ХХК',
  '7100011',
  90909.09,
  909090.91,
  1000000,
  'Энгийн',
];

describe('readEbarimtSheet', () => {
  it('reads the export as e-Barimt writes it', async () => {
    const sheet = await readEbarimtSheet(await streamOf([LINE]));
    expect(sheet.period).toBe(202610);
    expect(sheet.totalAmount.toFixed(2)).toBe('1000000.00');
    expect(sheet.vatAmount.toFixed(2)).toBe('90909.09');
    expect(sheet.rows[0]).toMatchObject({
      receiptKey: '033000925',
      ddtd: '033000925',
      deliveryNoteNo: '9000000001',
      docDate: '2026-10-08',
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
});
