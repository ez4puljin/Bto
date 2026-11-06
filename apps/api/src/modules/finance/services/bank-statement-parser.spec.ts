import { Decimal } from '@tugeel/shared/money';
import ExcelJS from 'exceljs';
import {
  accountOfFileName,
  dateInDescription,
  kindOfLine,
  parseBankStatement,
  readBankAmount,
  readBankDate,
} from './bank-statement-parser';

const NAME = 'Statement_MNT_5000000001 (3).xlsx';

/** A workbook laid out like Khan Bank's: a meta row, the header, the lines, the totals. Fictitious. */
async function workbook(rows: readonly (readonly unknown[])[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow([...row]));
  return Buffer.from(await book.xlsx.writeBuffer());
}

const HEADER = [
  'Гүйлгээний огноо',
  'Салбар',
  'Эхний үлдэгдэл',
  'Дебит гүйлгээ',
  'Кредит гүйлгээ',
  'Эцсийн үлдэгдэл',
  'Гүйлгээний утга',
  'Харьцсан данс',
];

describe('bank statement parser', () => {
  it('reads the lines, skips the meta and totals rows and names the kinds', async () => {
    const parsed = await parseBankStatement(
      await workbook([
        ['Хэвлэсэн огноо:', '11/05/2026', null, null, null, 'Интервал:', '2026/11/05'],
        HEADER,
        [
          new Date(Date.UTC(2026, 10, 5, 9, 5)),
          '5',
          0,
          0,
          168980,
          0,
          'Туршилтын дэлгүүр',
          5000000002,
        ],
        ['2026/11/05 17:35', '5', 0, -2180000, 0, 0, 'пос цаас урдаас', '5000000003'],
        ['2026/11/05 17:35:00', '5', 0, 50, 0, 0, 'Ухаалаг банкны гүйлгээний хураамж', ''],
        ['2026-11-05 18:00', '5', 0, 0, '1,250.50', 0, '04/11/2026 SETTLEMENT - TURSHILT', null],
        ['Нийт дүн:', null, null, 2180050, 170230.5],
      ]),
      NAME,
    );
    expect(parsed).toMatchObject({
      accountNumber: '5000000001',
      currency: 'MNT',
      statementDate: '2026-11-05',
      dateTo: '2026-11-05',
    });
    expect(parsed.lines.map((line) => line.kind)).toEqual([
      'NORMAL',
      'NORMAL',
      'FEE',
      'SETTLEMENT',
    ]);
    const [first, second, , settlement] = parsed.lines;
    expect(first?.credit.toFixed(2)).toBe('168980.00');
    expect(first?.bankCounterpart).toBe('5000000002');
    // The bank's Ulaanbaatar wall clock, stored as the instant it is.
    expect(first?.txnAt.toISOString()).toBe('2026-11-05T01:05:00.000Z');
    expect(second?.debit.toFixed(2)).toBe('2180000.00');
    expect(second?.credit.isZero()).toBe(true);
    expect(settlement?.credit.toFixed(2)).toBe('1250.50');
    expect(settlement?.lineNo).toBe(4);
  });

  it('follows the header when the bank swaps the debit and credit columns', async () => {
    const parsed = await parseBankStatement(
      await workbook([
        ['meta'],
        ['Огноо', 'x', 'x', 'Кредит', 'Дебит', 'x', 'Утга', 'Харьцсан данс'],
        ['2026/11/05 10:00', '', '', 700, 0, '', 'орлого', '1'],
      ]),
      NAME,
    );
    expect(parsed.lines[0]?.credit.toFixed(2)).toBe('700.00');
    expect(parsed.lines[0]?.debit.isZero()).toBe(true);
  });

  it('keeps identical rows as two lines, and the same file gives the same keys', async () => {
    const rows = [
      ['meta'],
      HEADER,
      ['2026/11/05 10:00', '', 0, 0, 500, 0, 'орлого', '1'],
      ['2026/11/05 10:00', '', 0, 0, 500, 0, 'орлого', '1'],
    ];
    const first = await parseBankStatement(await workbook(rows), NAME);
    const again = await parseBankStatement(await workbook(rows), 'Statement_MNT_5000000001.xlsx');
    expect(first.lines).toHaveLength(2);
    expect(first.lines[0]?.dedupeKey).not.toBe(first.lines[1]?.dedupeKey);
    expect(again.lines.map((line) => line.dedupeKey)).toEqual(
      first.lines.map((line) => line.dedupeKey),
    );
    const other = await parseBankStatement(await workbook(rows), 'Statement_MNT_5000000009.xlsx');
    expect(other.lines[0]?.dedupeKey).not.toBe(first.lines[0]?.dedupeKey);
  });

  it('dates a statement by the first and the last day of its lines', async () => {
    const parsed = await parseBankStatement(
      await workbook([
        ['meta'],
        HEADER,
        ['2026/11/06 10:00', '', 0, 0, 500, 0, 'б', '1'],
        ['2026/11/04 10:00', '', 0, 0, 500, 0, 'а', '1'],
      ]),
      NAME,
    );
    expect(parsed.statementDate).toBe('2026-11-04');
    expect(parsed.dateTo).toBe('2026-11-06');
  });

  it('refuses a file without an account, a broken file and a file without lines', async () => {
    await expect(parseBankStatement(await workbook([HEADER]), 'huulga.xlsx')).rejects.toMatchObject(
      {
        code: 'BANK_STATEMENT_NO_ACCOUNT',
      },
    );
    await expect(parseBankStatement(Buffer.from('not excel'), NAME)).rejects.toMatchObject({
      code: 'BANK_STATEMENT_UNREADABLE',
    });
    await expect(
      parseBankStatement(await workbook([['meta'], HEADER, ['Нийт дүн:', 0, 0, 0, 0]]), NAME),
    ).rejects.toMatchObject({ code: 'BANK_STATEMENT_EMPTY' });
  });

  it('calls only money out a fee: a customer paying a service fee is income', () => {
    const zero = new Decimal(0);
    const some = new Decimal(100);
    expect(kindOfLine('Гүйлгээний хураамж', some, zero)).toBe('FEE');
    expect(kindOfLine('Annual fee', some, zero)).toBe('FEE');
    expect(kindOfLine('үйлчилгээний төлбөр', zero, some)).toBe('NORMAL');
    expect(kindOfLine('coffee shop', some, zero)).toBe('NORMAL');
    expect(kindOfLine('settlement today', zero, some)).toBe('SETTLEMENT');
    expect(kindOfLine('settlement back', some, zero)).toBe('NORMAL');
  });

  it('reads dates the ways a statement writes them', () => {
    expect(readBankDate('2026/11/05 09:05')).toBe('2026-11-05 09:05:00');
    expect(readBankDate('2026.11.05')).toBe('2026-11-05 00:00:00');
    expect(readBankDate('11/05/2026 2:30 PM')).toBe('2026-11-05 14:30:00');
    expect(readBankDate(new Date(Date.UTC(2026, 10, 5, 23, 59, 1)))).toBe('2026-11-05 23:59:01');
    expect(readBankDate(46331.5)).toBe('2026-11-05 12:00:00');
    expect(readBankDate('Нийт дүн:')).toBeNull();
    expect(readBankDate('2026/13/05')).toBeNull();
    expect(readBankDate(12)).toBeNull();
    expect(readBankDate(null)).toBeNull();
  });

  it('reads amounts to two decimals, whichever sign', () => {
    expect(readBankAmount(-50).toFixed(2)).toBe('50.00');
    expect(readBankAmount(24873707.26).toFixed(2)).toBe('24873707.26');
    expect(readBankAmount('1,000,000.5').toFixed(2)).toBe('1000000.50');
    expect(readBankAmount('abc').isZero()).toBe(true);
    expect(readBankAmount(null).isZero()).toBe(true);
    expect(readBankAmount({ formula: 'A1', result: 12 }).toFixed(2)).toBe('12.00');
  });

  it('finds the account in Khan Bank’s file name and a date in a settlement’s text', () => {
    expect(accountOfFileName('Statement_USD_123 (2).xlsx')).toEqual({
      currency: 'USD',
      accountNumber: '123',
    });
    expect(dateInDescription('29/04/2026 SETTLEMENT - TURSHILT')).toBe('2026-04-29');
    expect(dateInDescription('2026-04-29 SETTLEMENT')).toBe('2026-04-29');
    expect(dateInDescription('SETTLEMENT')).toBeNull();
    expect(dateInDescription('31/02/2026 SETTLEMENT')).toBeNull();
  });
});
