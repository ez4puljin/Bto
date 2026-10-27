import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  buildPosapiReceipt,
  EbarimtBuildError,
  type EbarimtLineInput,
  type EbarimtReceiptInput,
  posapiJson,
} from './ebarimt';

const line = (over: Partial<EbarimtLineInput> = {}): EbarimtLineInput => ({
  name: 'Кола',
  barCode: '4006381333931',
  barCodeType: 'GS1',
  classificationCode: '1234567',
  taxType: 'VAT_ABLE',
  taxProductCode: null,
  measureUnit: 'ш',
  qty: '2',
  total: '2600.00',
  vat: '236.36',
  cityTax: '0',
  ...over,
});

const receipt = (over: Partial<EbarimtReceiptInput> = {}): EbarimtReceiptInput => ({
  type: 'B2C',
  merchantTin: '20000000002',
  districtCode: '1234',
  branchNo: null,
  posNo: null,
  customerTin: null,
  consumerNo: null,
  inactiveId: null,
  lines: [line()],
  payments: [{ code: 'CASH', amount: '2600' }],
  ...over,
});

const codeOf = (work: () => unknown): string | null => {
  try {
    work();
    return null;
  } catch (error) {
    return error instanceof EbarimtBuildError ? error.code : 'OTHER';
  }
};

describe('the PosAPI 3.0 receipt (ADR-0065)', () => {
  it('builds a citizen’s receipt whose header, sub-receipt and payments agree', () => {
    const built = buildPosapiReceipt(receipt());
    expect(built.type).toBe('B2C_RECEIPT');
    expect(built.totalAmount.toFixed(2)).toBe('2600.00');
    expect(built.totalVAT.toFixed(2)).toBe('236.36');
    expect(built.customerTin).toBeNull();
    expect(built.receipts).toHaveLength(1);
    expect(built.receipts[0]?.items[0]?.unitPrice.toFixed(2)).toBe('1300.00');
    expect(built.payments).toEqual([
      { code: 'CASH', status: 'PAID', paidAmount: new Decimal('2600.00') },
    ]);
    expect(built).not.toHaveProperty('billIdSuffix');
  });

  it('sends the branch and PosAPI numbers, and an empty barcode for a unit without one', () => {
    const built = buildPosapiReceipt(
      receipt({ branchNo: '01', posNo: '00000001', lines: [line({ barCode: null })] }),
    );
    expect(built).toMatchObject({ branchNo: '01', posNo: '00000001' });
    expect(built.receipts[0]?.items[0]).toMatchObject({ barCode: '', barCodeType: 'UNDEFINED' });
  });

  it('splits the tax types into sub-receipts and keeps the exempt line’s product code', () => {
    const built = buildPosapiReceipt(
      receipt({
        lines: [
          line(),
          line({
            name: 'Талх',
            taxType: 'VAT_FREE',
            taxProductCode: '305',
            total: '1000',
            vat: '0',
          }),
        ],
        payments: [
          { code: 'CASH', amount: '600' },
          { code: 'PAYMENT_CARD', amount: '3000' },
        ],
      }),
    );
    expect(built.receipts.map((sub) => [sub.taxType, sub.totalAmount.toFixed(2)])).toEqual([
      ['VAT_ABLE', '2600.00'],
      ['VAT_FREE', '1000.00'],
    ]);
    expect(built.receipts[1]?.items[0]?.taxProductCode).toBe('305');
    expect(built.receipts[0]?.items[0]?.taxProductCode).toBeNull();
    expect(built.totalAmount.toFixed(2)).toBe('3600.00');
  });

  it('makes a company’s receipt with its TIN and replaces an earlier one', () => {
    const built = buildPosapiReceipt(
      receipt({ type: 'B2B', customerTin: '10000000001', consumerNo: '12345678', inactiveId: 'X' }),
    );
    expect(built.type).toBe('B2B_RECEIPT');
    expect(built.customerTin).toBe('10000000001');
    expect(built.receipts[0]?.customerTin).toBe('10000000001');
    expect(built.consumerNo).toBeNull();
    expect(built.inactiveId).toBe('X');
  });

  it('refuses what PosAPI would refuse, before sending anything', () => {
    expect(codeOf(() => buildPosapiReceipt(receipt({ lines: [] })))).toBe('NO_LINES');
    expect(codeOf(() => buildPosapiReceipt(receipt({ districtCode: '' })))).toBe(
      'DISTRICT_CODE_INVALID',
    );
    expect(
      codeOf(() => buildPosapiReceipt(receipt({ lines: [line({ classificationCode: '' })] }))),
    ).toBe('CLASSIFICATION_CODE_INVALID');
    expect(
      codeOf(() => buildPosapiReceipt(receipt({ lines: [line({ taxType: 'VAT_ZERO' })] }))),
    ).toBe('TAX_PRODUCT_CODE_MISSING');
    expect(codeOf(() => buildPosapiReceipt(receipt({ type: 'B2B' })))).toBe('CUSTOMER_TIN_INVALID');
    expect(
      codeOf(() => buildPosapiReceipt(receipt({ payments: [{ code: 'CASH', amount: '2599' }] }))),
    ).toBe('PAYMENTS_MISMATCH');
  });

  it('writes money as plain JSON numbers with their own digits', () => {
    const json = posapiJson(buildPosapiReceipt(receipt()));
    expect(json).toContain('"totalAmount":2600');
    expect(json).toContain('"totalVAT":236.36');
    expect(json).toContain('"qty":2');
    expect(json).not.toContain('dec:');
    expect(JSON.parse(json).payments[0].paidAmount).toBe(2600);
  });
});
