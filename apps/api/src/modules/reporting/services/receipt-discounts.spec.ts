import { Decimal } from '@tugeel/shared/money';
import {
  entryDiscounts,
  type ReceiptCostingRow,
  type ReceiptEntryRef,
  receiptOfEntry,
} from './receipt-discounts';

const row = (
  receiptId: number,
  lineId: number,
  version: number,
  discount: string | null,
  freeGoods = false,
): ReceiptCostingRow => ({
  receiptId,
  lineId,
  version,
  discount: discount === null ? null : new Decimal(discount),
  freeGoods,
});
const entry = (
  entryId: number,
  sourceDocType: string,
  sourceDocId: string,
  reversal = false,
): ReceiptEntryRef => ({ entryId, sourceDocType, sourceDocId, reversal });
const texts = (map: Map<number, Decimal>) =>
  Object.fromEntries([...map].map(([id, value]) => [id, value.toFixed(2)]));

describe('the receipt discount of each payable entry (ADR-0234)', () => {
  it('reads the receipt behind a bill and a re-costing', () => {
    expect(receiptOfEntry('GOODS_RECEIPT', '61')).toEqual({ receiptId: 61, version: null });
    expect(receiptOfEntry('RECEIPT_RECOST', '61:3')).toEqual({ receiptId: 61, version: 3 });
    expect(receiptOfEntry('RECEIPT_RECOST', '61')).toBeNull();
    expect(receiptOfEntry('SUPPLIER_RETURN', '7:2')).toBeNull();
    expect(receiptOfEntry('GOODS_RECEIPT', null)).toBeNull();
  });

  it('gives the bill its discount, a re-costing the change, without free goods', () => {
    const costing = [
      row(1, 10, 1, '300'),
      row(1, 11, 1, '200'),
      row(1, 12, 1, null, true),
      row(1, 10, 2, '250'),
      row(1, 11, 2, '200'),
      row(1, 12, 2, null, true),
    ];
    const entries = [entry(100, 'GOODS_RECEIPT', '1'), entry(101, 'RECEIPT_RECOST', '1:2')];
    expect(texts(entryDiscounts(entries, costing))).toEqual({ 100: '500.00', 101: '-50.00' });
  });

  it('folds a version booked without a payable into the next one booked', () => {
    const costing = [row(2, 20, 1, '100'), row(2, 20, 2, '120'), row(2, 20, 3, '150')];
    // Version 2 moved only the stock: no payable entry.
    const entries = [entry(200, 'GOODS_RECEIPT', '2'), entry(201, 'RECEIPT_RECOST', '2:3')];
    expect(texts(entryDiscounts(entries, costing))).toEqual({ 200: '120.00', 201: '30.00' });
  });

  it('gives a bill booked at the latest version that version’s discount, and turns a reversal', () => {
    const costing = [row(3, 30, 1, '100'), row(3, 30, 2, '80')];
    const entries = [
      entry(300, 'GOODS_RECEIPT', '3'),
      entry(301, 'GOODS_RECEIPT', '3', true),
      entry(302, 'GOODS_RECEIPT', '3'),
    ];
    expect(texts(entryDiscounts(entries, costing))).toEqual({
      300: '80.00',
      301: '-80.00',
      302: '80.00',
    });
  });

  it('carries nothing for a receipt without discounts or an entry of no receipt', () => {
    const costing = [row(4, 40, 1, '0'), row(4, 41, 1, null)];
    const entries = [entry(400, 'GOODS_RECEIPT', '4'), entry(401, 'SUPPLIER_RETURN', '9:1')];
    expect(texts(entryDiscounts(entries, costing))).toEqual({ 400: '0.00' });
  });
});
