import { Decimal } from '@tugeel/shared/money';
import type { EbarimtPurchase } from '../../../integrations/ebarimt';
import { pullWindows, sheetOfPurchases } from './ebarimt-api-lines';

const purchase = (overrides: Partial<EbarimtPurchase>): EbarimtPurchase => ({
  ddtd: 'D-1',
  sellerName: 'Нэгдүгээр ХХК',
  sellerRegNo: '7000001',
  buyerRegNo: '1234567',
  date: '2026-10-05 10:00:00',
  vat: new Decimal('100'),
  cityTax: new Decimal('0'),
  total: new Decimal('1100'),
  net: new Decimal('1000'),
  fromType: 'INVOICE',
  receiptType: 'НЭХЭМЖЛЭХ',
  ...overrides,
});

describe('e-Barimt API lines', () => {
  it('splits a span into weeks', () => {
    expect(pullWindows('2026-10-01', '2026-10-31')).toEqual([
      { from: '2026-10-01', to: '2026-10-07' },
      { from: '2026-10-08', to: '2026-10-14' },
      { from: '2026-10-15', to: '2026-10-21' },
      { from: '2026-10-22', to: '2026-10-28' },
      { from: '2026-10-29', to: '2026-10-31' },
    ]);
    expect(pullWindows('2026-11-01', '2026-11-01')).toEqual([
      { from: '2026-11-01', to: '2026-11-01' },
    ]);
    expect(pullWindows('2026-11-02', '2026-11-01')).toEqual([]);
  });

  it('maps the fields, rounds half up and keeps a hidden register as it came', () => {
    const sheet = sheetOfPurchases(202610, [
      purchase({
        ddtd: 'D-2',
        date: '2026-10-07 03:34:36',
        sellerRegNo: '57***85',
        sellerName: 'ГУР*****МБА',
        vat: new Decimal('252.272727'),
        net: new Decimal('2522.725'),
        total: new Decimal('2775'),
        receiptType: null,
        fromType: 'POS API',
      }),
      purchase({ sellerRegNo: '07000001' }),
    ]);
    expect(sheet.period).toBe(202610);
    expect(sheet.masked).toBe(1);
    expect(sheet.skipped).toBe(0);
    expect(
      sheet.rows.map((row) => ({
        ...row,
        vatAmount: row.vatAmount.toFixed(2),
        netAmount: row.netAmount.toFixed(2),
        totalAmount: row.totalAmount.toFixed(2),
      })),
    ).toEqual([
      {
        rowNo: 1,
        receiptKey: 'D-1',
        ddtd: 'D-1',
        deliveryNoteNo: null,
        docDate: '2026-10-05',
        partnerName: 'Нэгдүгээр ХХК',
        ttd: '7000001',
        vatAmount: '100.00',
        netAmount: '1000.00',
        totalAmount: '1100.00',
        kind: 'НЭХЭМЖЛЭХ',
      },
      {
        rowNo: 2,
        receiptKey: 'D-2',
        ddtd: 'D-2',
        deliveryNoteNo: null,
        docDate: '2026-10-07',
        partnerName: 'ГУР*****МБА',
        ttd: '57***85',
        vatAmount: '252.27',
        netAmount: '2522.73',
        totalAmount: '2775.00',
        kind: 'POS API',
      },
    ]);
    expect(sheet.totalAmount.toFixed(2)).toBe('3875.00');
    expect(sheet.vatAmount.toFixed(2)).toBe('352.27');
  });

  it('keys a receipt without ДДТД as a file does, and counts a receipt listed twice once', () => {
    const sheet = sheetOfPurchases(202610, [
      purchase({ ddtd: null }),
      purchase({ ddtd: null }),
      purchase({ ddtd: 'D-9' }),
      purchase({ ddtd: 'D-9' }),
    ]);
    expect(sheet.rows.map((row) => row.receiptKey)).toEqual([
      'D-9',
      'P|2026-10-05|7000001|1100.00',
    ]);
  });

  it('leaves out a line of another month or with no register', () => {
    const sheet = sheetOfPurchases(202610, [
      purchase({ date: '2026-11-01 00:00:01' }),
      purchase({ sellerRegNo: null }),
      purchase({ date: null }),
      purchase({}),
    ]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.skipped).toBe(3);
  });
});
