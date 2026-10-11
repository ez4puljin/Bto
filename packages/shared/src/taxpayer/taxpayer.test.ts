import { describe, expect, it } from 'vitest';
import { cleanTaxNumber, isConsumerNo, isTinFor, normalizeRegNo, regNoShape } from './index';

describe('registration numbers', () => {
  it('normalises spacing, case and Latin look-alikes into the stored form', () => {
    expect(normalizeRegNo(' 203 4567 ')).toBe('2034567');
    expect(normalizeRegNo('уб99010112')).toBe('УБ99010112');
    // "AA" typed on a Latin keyboard is the Cyrillic "АА" of a citizen ID.
    expect(normalizeRegNo('AA 99010112')).toBe('АА99010112');
    // Full-width digits from some keyboards fold to ASCII (NFKC).
    expect(normalizeRegNo('２０３４５６７')).toBe('2034567');
  });

  it('recognises the company and citizen shapes', () => {
    expect(regNoShape('2034567')).toBe('COMPANY');
    expect(regNoShape('УБ99010112')).toBe('INDIVIDUAL');
    expect(regNoShape('ye99010112')).toBe('INDIVIDUAL');
    expect(regNoShape('ӨҮ01234567')).toBe('INDIVIDUAL');
    expect(regNoShape('203456')).toBeNull();
    expect(regNoShape('УБ9901011')).toBeNull();
    expect(regNoShape('12345678901')).toBeNull();
  });
});

describe('TINs and consumer numbers', () => {
  it('wants 11 digits for a company and 12–14 for a citizen', () => {
    expect(isTinFor('COMPANY', '12345678901')).toBe(true);
    expect(isTinFor('COMPANY', '123456789012')).toBe(false);
    expect(isTinFor('INDIVIDUAL', '123456789012')).toBe(true);
    expect(isTinFor('INDIVIDUAL', '12345678901234')).toBe(true);
    expect(isTinFor('INDIVIDUAL', '12345678901')).toBe(false);
    expect(isTinFor('COMPANY', '2034567')).toBe(false);
    expect(isTinFor('COMPANY', '1234567890a')).toBe(false);
  });

  it('cleans typed numbers and checks consumer numbers', () => {
    expect(cleanTaxNumber('123 456-789 01')).toBe('12345678901');
    expect(isConsumerNo('11234567')).toBe(true);
    expect(isConsumerNo('1123456')).toBe(false);
    expect(isConsumerNo('1123456a')).toBe(false);
  });
});
