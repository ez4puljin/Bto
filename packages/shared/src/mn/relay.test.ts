import { describe, expect, it } from 'vitest';
import { EbarimtBuildError } from './ebarimt';
import {
  buildRelayReceipt,
  checkRelayReceipt,
  type RelayReceiptLine,
  type RelayReceiptRequest,
  wholesalePaymentCode,
  wholesaleReceiptType,
} from './relay';

const line = (fields: Partial<RelayReceiptLine> = {}): RelayReceiptLine => ({
  name: 'Туршилтын бараа',
  barCode: null,
  barCodeType: 'UNDEFINED',
  classificationCode: null,
  taxType: 'VAT_ABLE',
  taxProductCode: null,
  measureUnit: 'ш',
  qty: '2.000',
  total: '2200.00',
  vat: '200.00',
  cityTax: '0.00',
  ...fields,
});

const request = (fields: Partial<RelayReceiptRequest> = {}): RelayReceiptRequest => ({
  type: 'B2C',
  customerTin: null,
  consumerNo: null,
  lines: [line()],
  payments: [{ code: 'CASH', amount: '2200.00' }],
  ...fields,
});

describe('the wholesale e-Barimt relay rules (ADR-0185)', () => {
  it('chooses the receipt by the buyer: company B2B, TIN pending, individual B2C', () => {
    expect(wholesaleReceiptType({ kind: 'COMPANY', tin: '10000000001', consumerNo: null })).toEqual(
      { type: 'B2B', customerTin: '10000000001', consumerNo: null, tinPending: false },
    );
    expect(wholesaleReceiptType({ kind: 'COMPANY', tin: null, consumerNo: null })).toMatchObject({
      type: 'B2B',
      tinPending: true,
    });
    expect(wholesaleReceiptType({ kind: 'COMPANY', tin: '  ', consumerNo: null }).tinPending).toBe(
      true,
    );
    expect(
      wholesaleReceiptType({ kind: 'INDIVIDUAL', tin: '100000000012', consumerNo: '12345678' }),
    ).toEqual({ type: 'B2B', customerTin: '100000000012', consumerNo: null, tinPending: false });
    expect(wholesaleReceiptType({ kind: 'INDIVIDUAL', tin: null, consumerNo: '12345678' })).toEqual(
      { type: 'B2C', customerTin: null, consumerNo: '12345678', tinPending: false },
    );
    // A consumer number that is not eight digits is not sent.
    expect(
      wholesaleReceiptType({ kind: 'INDIVIDUAL', tin: null, consumerNo: '1234' }).consumerNo,
    ).toBeNull();
  });

  it('maps cash and bank transfer to PosAPI codes and gives a credit sale none', () => {
    expect(wholesalePaymentCode('CASH')).toBe('CASH');
    expect(wholesalePaymentCode('BANK_TRANSFER')).toBe('BANK_TRANSFER');
    expect(wholesalePaymentCode('CREDIT')).toBeNull();
  });

  it('passes a request the store can complete, a missing classification code included', () => {
    expect(checkRelayReceipt(request()).total.toFixed(2)).toBe('2200.00');
  });

  it('catches at the centre what PosAPI would refuse', () => {
    const code = (input: RelayReceiptRequest) => {
      try {
        checkRelayReceipt(input);
        return null;
      } catch (error) {
        if (!(error instanceof EbarimtBuildError)) throw error;
        return error.code;
      }
    };
    expect(code(request({ lines: [] }))).toBe('NO_LINES');
    expect(code(request({ lines: [line({ taxType: 'VAT_FREE' })] }))).toBe(
      'TAX_PRODUCT_CODE_MISSING',
    );
    expect(code(request({ lines: [line({ classificationCode: '12' })] }))).toBe(
      'CLASSIFICATION_CODE_INVALID',
    );
    expect(code(request({ type: 'B2B', customerTin: null }))).toBe('CUSTOMER_TIN_INVALID');
    expect(code(request({ payments: [{ code: 'CASH', amount: '2000.00' }] }))).toBe(
      'PAYMENTS_MISMATCH',
    );
  });

  it('builds with the store’s facts and fills its default classification code', () => {
    const built = buildRelayReceipt(
      request({
        lines: [
          line(),
          line({ classificationCode: '7654321', total: '1100.00', vat: '100.00', qty: '1.000' }),
        ],
        payments: [{ code: 'BANK_TRANSFER', amount: '3300.00' }],
      }),
      {
        merchantTin: '20000000002',
        districtCode: '1234',
        branchNo: '01',
        posNo: '00000001',
        defaultClassificationCode: '1234567',
      },
    );
    expect(built).toMatchObject({
      type: 'B2C_RECEIPT',
      merchantTin: '20000000002',
      districtCode: '1234',
      branchNo: '01',
      posNo: '00000001',
      inactiveId: null,
    });
    expect(built.totalAmount.toFixed(2)).toBe('3300.00');
    expect(built.receipts[0]?.items.map((item) => item.classificationCode)).toEqual([
      '1234567',
      '7654321',
    ]);
    expect(built.payments).toMatchObject([{ code: 'BANK_TRANSFER', status: 'PAID' }]);
    // Without a default the store cannot build it either.
    expect(() =>
      buildRelayReceipt(request(), {
        merchantTin: '20000000002',
        districtCode: '1234',
        branchNo: null,
        posNo: null,
        defaultClassificationCode: null,
      }),
    ).toThrow(EbarimtBuildError);
  });
});
