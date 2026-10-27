import { describe, expect, it } from 'vitest';
import {
  formatVoucherCode,
  luhnDigit,
  parseVoucherCode,
  voucherCodeOf,
  voucherDateRefusal,
  voucherPayments,
  voucherSaleRefundable,
} from './vouchers';

describe('voucher codes (ADR-0110)', () => {
  it('makes 16 digits with the kind and a Luhn check digit', () => {
    const coupon = voucherCodeOf('COUPON', '123456789012');
    expect(coupon).toMatch(/^991123456789012[0-9]$/);
    expect(luhnDigit(coupon.slice(0, -1))).toBe(coupon.slice(-1));
    expect(parseVoucherCode(coupon)).toEqual({ code: coupon, kind: 'COUPON' });
    const partner = voucherCodeOf('PARTNER', '000000000042');
    expect(parseVoucherCode(formatVoucherCode(partner))).toEqual({ code: partner, kind: 'PARTNER' });
  });

  it('refuses a wrong check digit, a GTIN and short random parts', () => {
    const code = voucherCodeOf('COUPON', '555555555555');
    const wrong = code.slice(0, -1) + String((Number.parseInt(code.slice(-1), 10) + 1) % 10);
    expect(parseVoucherCode(wrong)).toBeNull();
    expect(parseVoucherCode('4607001771234')).toBeNull();
    expect(parseVoucherCode('9930000000000000')).toBeNull();
    expect(() => voucherCodeOf('COUPON', '123')).toThrow();
  });

  it('formats in groups of four', () => {
    expect(formatVoucherCode('9912345678901234')).toBe('9912 3456 7890 1234');
  });

  it('checks the dates of a batch on a business day', () => {
    expect(voucherDateRefusal('2026-10-27', '2026-10-28', '2026-11-30')).toBe('NOT_YET');
    expect(voucherDateRefusal('2026-12-01', '2026-10-28', '2026-11-30')).toBe('EXPIRED');
    expect(voucherDateRefusal('2026-11-30', '2026-10-28', '2026-11-30')).toBeNull();
  });
});

describe('partner voucher payments', () => {
  it('pays each voucher up to what is left, in order', () => {
    const { amounts, paid, due } = voucherPayments('55000', ['20000', '20000', '20000']);
    expect(amounts.map((amount) => amount.toFixed())).toEqual(['20000', '20000', '15000']);
    expect(paid.toFixed()).toBe('55000');
    expect(due.toFixed()).toBe('0');
    expect(voucherPayments('70000', ['50000']).due.toFixed()).toBe('20000');
  });

  it('refunds only the cash and card paid', () => {
    expect(voucherSaleRefundable({ cashAndCardPaid: '12000', refunded: '5000' }).toFixed()).toBe(
      '7000',
    );
    expect(voucherSaleRefundable({ cashAndCardPaid: '0', refunded: '0' }).toFixed()).toBe('0');
  });
});
