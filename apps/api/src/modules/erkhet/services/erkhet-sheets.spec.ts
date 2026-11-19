import ExcelJS from 'exceljs';
import {
  ErkhetFileError,
  readErkhetCustomers,
  readErkhetItems,
  splitBarcodes,
} from './erkhet-sheets';

// Synthetic sheets in the shape of Erkhet's exports; no row here is the company's.

async function workbook(rows: (string | number | null)[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet_0');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

const ITEM_HEAD = ['Код', 'Нэр', 'Ангилал код', 'Ангилал нэр', 'Гадаад нэр', 'Баркод', 'Нэгж үнэ'];
const CUSTOMER_HEAD = ['Код', 'Нэр', 'Бүлэг код', 'Бүлэг нэр', 'мэйл', 'Хаяг', 'Утас'];

describe("Erkhet's lists (ADR-0203)", () => {
  it('reads the item list by its heads, wherever the columns stand', async () => {
    const data = await workbook([
      ITEM_HEAD,
      ['100001', ' Ундаа  0.5л ', '101', 'Ус ундаа', 'Drink', '4006381333931, 5901234123457', 1500],
      ['100002', 'Чихэр', '102', 'Амттан', '', '-', '2,500'],
      ['100003', 'Жин', '102', 'Амттан', '', '', null],
      ['', 'мөргүй', '', '', '', '', 5],
    ]);
    const items = await readErkhetItems(data);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      code: '100001',
      name: 'Ундаа 0.5л',
      category: 'Ус ундаа',
      barcodes: ['4006381333931', '5901234123457'],
    });
    expect(items[0]?.price?.toFixed(2)).toBe('1500.00');
    expect(items[1]?.barcodes).toEqual([]);
    expect(items[1]?.price?.toFixed(2)).toBe('2500.00');
    expect(items[2]?.price).toBeNull();
  });

  it('reads the unit, the pack ratio and the weight when the list has them (ADR-0222)', async () => {
    const data = await workbook([
      [...ITEM_HEAD, 'Хэмжих нэгж код', 'Хэмжих нэгж нэр', 'Задрах харьцаа', 'Жин'],
      ['100001', 'Ус', '101', 'Ус ундаа', '', '4006381333931', 1500, 'ш', 'ширхэг', 1 / 12, 0.5],
      ['100002', 'Гурил', '102', 'Гурил', '', '5901234123457', 2500, 'кг', 'Килограмм', '', '-'],
    ]);
    const items = await readErkhetItems(data);
    expect(items[0]).toMatchObject({ unitCode: 'ш', unitName: 'ширхэг', weight: '0.5' });
    expect(items[0]?.packRatio).toMatch(/^0\.08333/);
    expect(items[1]).toMatchObject({ unitCode: 'кг', packRatio: null, weight: null });
    // A list without those columns is still read: the rows carry nothing of them.
    const plain = await readErkhetItems(await workbook([ITEM_HEAD, ['1', 'a', '', '', '', '', 5]]));
    expect(plain[0]).toMatchObject({ unitCode: '', unitName: '', packRatio: null, weight: null });
  });

  it('reads the customer list', async () => {
    const data = await workbook([
      CUSTOMER_HEAD,
      ['50001', 'Дэлгүүр нэг', '501', '1-р хороо', '', 'хаяг', '99112233'],
      [50002, 'Дэлгүүр хоёр', 501, '1-р хороо', '', '', ''],
    ]);
    expect(await readErkhetCustomers(data)).toEqual([
      {
        code: '50001',
        name: 'Дэлгүүр нэг',
        groupCode: '501',
        groupName: '1-р хороо',
        phone: '99112233',
      },
      { code: '50002', name: 'Дэлгүүр хоёр', groupCode: '501', groupName: '1-р хороо', phone: '' },
    ]);
  });

  it('refuses a file that is not the list', async () => {
    await expect(readErkhetItems(await workbook([CUSTOMER_HEAD, ['1', 'a']]))).rejects.toThrow(
      ErkhetFileError,
    );
    await expect(readErkhetCustomers(await workbook([CUSTOMER_HEAD]))).rejects.toThrow(
      ErkhetFileError,
    );
    await expect(readErkhetItems(Buffer.from('<html>'))).rejects.toThrow(ErkhetFileError);
  });

  it('splits a barcode cell at its commas', () => {
    expect(splitBarcodes('111, 222 ,111;333')).toEqual(['111', '222', '333']);
    expect(splitBarcodes(' - ')).toEqual([]);
  });
});
