import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { buildTemplate } from './import-template';
import { columnLabels, readSheet } from './sheet-reader';

/** An .xlsx file with the given rows on its first sheet. */
async function workbook(rows: unknown[][], extraSheet = false): Promise<Readable> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Хуудас');
  for (const row of rows) sheet.addRow(row);
  if (extraSheet) book.addWorksheet('Хоёр').addRow(['Код', 'Нэр', 'Ангилал']);
  return Readable.from(Buffer.from(await book.xlsx.writeBuffer()));
}

describe('import sheet reader (ADR-0036 #1)', () => {
  it('finds the header below a title, by labels and aliases in any order', async () => {
    const result = await readSheet(
      await workbook([
        ['Барааны жагсаалт 2026'],
        [],
        ['Ангилал *', 'Барааны нэр', 'SKU', 'Ширхгийн баркод'],
        ['Ундаа', 'Кока кола', '0012', '4006381333931, 5449000000996'],
        [null, null, null, null],
        ['Ус', 'Ус 0.5л', 13, null],
      ]),
      'PRODUCTS',
    );
    if (!result.ok) throw new Error(result.issue.code);
    expect(result.headerRow).toBe(3);
    expect(result.columns.sort()).toEqual(['barcodes', 'category', 'name', 'sku']);
    expect(result.rows).toEqual([
      {
        rowNo: 4,
        values: {
          category: 'Ундаа',
          name: 'Кока кола',
          sku: '0012',
          barcodes: '4006381333931, 5449000000996',
        },
        issues: [],
      },
      {
        rowNo: 6,
        values: { category: 'Ус', name: 'Ус 0.5л', sku: '13', barcodes: null },
        issues: [{ column: 'sku', code: 'NUMERIC_CODE' }],
      },
    ]);
  });

  it('takes the address of a GPS link and the text of other links', async () => {
    const maps = 'https://www.google.com/maps/place/@47.918,106.917,17z';
    const result = await readSheet(
      await workbook([
        ['Код', 'Нэр', 'GPS (Google Maps холбоос)'],
        [
          '7',
          { text: 'Дэлгүүр', hyperlink: 'https://example.mn' },
          { text: 'Байршил', hyperlink: maps },
        ],
      ]),
      'CUSTOMERS',
    );
    if (!result.ok) throw new Error(result.issue.code);
    expect(result.rows[0]?.values).toEqual({ code: '7', name: 'Дэлгүүр', gps: maps });
  });

  it('reports cells it cannot read with their column', async () => {
    const result = await readSheet(
      await workbook([
        ['Код', 'Нэр', 'Ангилал'],
        ['1', new Date(2026, 9, 11), { formula: 'A1' }],
      ]),
      'PRODUCTS',
    );
    if (!result.ok) throw new Error(result.issue.code);
    expect(result.rows[0]?.issues).toEqual([
      { column: 'name', code: 'DATE_IN_CELL' },
      { column: 'category', code: 'FORMULA_WITHOUT_RESULT' },
    ]);
  });

  it('refuses sheets without the required columns, with repeated columns or without data', async () => {
    expect(
      await readSheet(
        await workbook([
          ['Код', 'Нэр'],
          ['1', 'Ус'],
        ]),
        'PRODUCTS',
      ),
    ).toEqual({
      ok: false,
      issue: { code: 'MISSING_COLUMNS', params: { columns: 'Ангилал' } },
    });
    expect(await readSheet(await workbook([['Юу ч биш'], ['1']]), 'PRODUCTS')).toEqual({
      ok: false,
      issue: { code: 'NO_HEADER', params: { rows: 10 } },
    });
    expect(await readSheet(await workbook([['Код', 'Нэр', 'Ангилал', 'SKU']]), 'PRODUCTS')).toEqual(
      { ok: false, issue: { code: 'DUPLICATE_COLUMNS', params: { columns: 'Код' } } },
    );
    expect(await readSheet(await workbook([['Код', 'Нэр', 'Ангилал']], true), 'PRODUCTS')).toEqual({
      ok: false,
      issue: { code: 'EMPTY' },
    });
    expect(await readSheet(Readable.from(Buffer.from('not a zip file')), 'PRODUCTS')).toEqual({
      ok: false,
      issue: { code: 'UNREADABLE' },
    });
  });

  it('builds templates the reader accepts once filled', async () => {
    for (const kind of ['PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK'] as const) {
      const template = await buildTemplate(kind);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(template as unknown as ArrayBuffer);
      const sheet = book.worksheets[0];
      if (!sheet) throw new Error('no sheet');
      expect(book.worksheets).toHaveLength(2);
      const labels = (sheet.getRow(1).values as unknown[]).slice(1);
      expect(labels.length).toBeGreaterThan(0);
      sheet.addRow(labels.map(() => 'x'));
      const result = await readSheet(
        Readable.from(Buffer.from(await book.xlsx.writeBuffer())),
        kind,
      );
      expect(result.ok).toBe(true);
    }
    expect(columnLabels('OPENING_STOCK', 'qty')).toEqual(['Тоо', 'Тоо ширхэг', 'Үлдэгдэл']);
  });

  it('fills the price sheet with its rows and a reference sheet the reader skips (ADR-0054)', async () => {
    const template = await buildTemplate('PRICES', {
      rows: [
        { sku: '0012', name: 'Ус', baseUnit: 'ш', warehousePrice: 1500, validFrom: null },
        { sku: '0013', name: 'Кола', packs: 'хайрцаг 24', profile: 'Ундаа', wholePack: 'хайрцаг' },
      ],
      sheets: [{ name: 'Тохиргоо', header: ['Нэр', 'Задгай, %'], rows: [['Ундаа', '15']] }],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template as unknown as ArrayBuffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Үнэ', 'Тохиргоо', 'Заавар']);
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error('no sheet');
    expect(sheet.getCell('A2').numFmt).toBe('@');
    expect(sheet.getCell('H2').numFmt).toBe('@');
    sheet.getCell('H2').value = '2026-12-01';
    const result = await readSheet(
      Readable.from(Buffer.from(await book.xlsx.writeBuffer())),
      'PRICES',
    );
    if (!result.ok) throw new Error(result.issue.code);
    expect(result.rows.map((row) => row.values)).toEqual([
      expect.objectContaining({ sku: '0012', warehousePrice: '1500', validFrom: '2026-12-01' }),
      expect.objectContaining({ sku: '0013', profile: 'Ундаа', wholePack: 'хайрцаг' }),
    ]);
  });
});
