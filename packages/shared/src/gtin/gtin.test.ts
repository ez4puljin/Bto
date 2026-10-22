import { describe, expect, it } from 'vitest';
import {
  classifyBarcode,
  expandUpcE,
  gtinCheckDigit,
  internalEan13,
  isMisreadGtin,
  lookupCandidates,
  toGtin14,
} from './index';

const classify = (code: string) => {
  const result = classifyBarcode(code);
  if (!result.ok) throw new Error(`expected a valid barcode, got ${result.problem}`);
  return result.value;
};

describe('GTIN normalisation (ADR-0028)', () => {
  it('computes GS1 check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(gtinCheckDigit('9638507')).toBe(4);
    expect(gtinCheckDigit('03600029145')).toBe(2);
  });

  it('pads valid GTIN-8/12/13/14 to 14 digits and refuses wrong check digits', () => {
    expect(toGtin14('96385074')).toBe('00000096385074');
    expect(toGtin14('036000291452')).toBe('00036000291452');
    expect(toGtin14('0036000291452')).toBe('00036000291452');
    expect(toGtin14('4006381333931')).toBe('04006381333931');
    expect(toGtin14('10012345000017')).toBe('10012345000017');
    expect(toGtin14('4006381333932')).toBeNull();
    expect(toGtin14('12345')).toBeNull();
  });

  it('expands UPC-E to UPC-A', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(expandUpcE('04252615')).toBeNull();
    expect(expandUpcE('96385074')).toBeNull();
  });

  it('gives UPC-A and its EAN-13 form one lookup key', () => {
    expect(classify('036000291452').lookupKey).toBe(classify('0036000291452').lookupKey);
    expect(classify('04252614')).toMatchObject({ gtin14: '00042100005264', barcodeType: 'GS1' });
  });

  it('classifies e-Barimt barcode types', () => {
    expect(classify('4006381333931').barcodeType).toBe('GS1');
    expect(classify('10012345000017').barcodeType).toBe('GS1');
    expect(classify('9780306406157').barcodeType).toBe('ISBN');
    expect(classify(internalEan13(1)).barcodeType).toBe('UNDEFINED');
    expect(classify('abc-123')).toEqual({
      code: 'abc-123',
      gtin14: null,
      barcodeType: 'UNDEFINED',
      lookupKey: 'ABC-123',
    });
  });

  it('refuses empty, long and non-ASCII codes', () => {
    expect(classifyBarcode('  ')).toEqual({ ok: false, problem: 'EMPTY' });
    expect(classifyBarcode('1'.repeat(49))).toEqual({ ok: false, problem: 'TOO_LONG' });
    expect(classifyBarcode('АВ123')).toEqual({ ok: false, problem: 'CHARACTERS' });
    expect(classify(' 4006 3813 3393 1 ').code).toBe('4006381333931');
  });

  it('keeps digits of GTIN length with a wrong check digit as printed (ADR-0098 #6)', () => {
    expect(classify('4006381333932')).toEqual({
      code: '4006381333932',
      gtin14: null,
      barcodeType: 'UNDEFINED',
      lookupKey: '4006381333932',
    });
    expect(isMisreadGtin('4006381333932')).toBe(true);
    expect(isMisreadGtin(' 4006 3813 3393 1 ')).toBe(false);
    expect(isMisreadGtin('00000116')).toBe(false);
    expect(isMisreadGtin('abc-123')).toBe(false);
    expect(isMisreadGtin('40063813339')).toBe(false);
  });

  it('lists every key an 8-digit scan may be stored under', () => {
    expect(lookupCandidates('00000116')).toEqual(['00000000000116', '00000100000016']);
    expect(lookupCandidates('96385074')).toEqual(['00000096385074']);
    expect(lookupCandidates('4006381333932')).toEqual(['4006381333932']);
    expect(lookupCandidates('АВ123')).toEqual([]);
    expect(lookupCandidates('abc-123')).toEqual(['ABC-123']);
  });

  it('builds internal EAN-13 codes with the restricted prefix 20', () => {
    expect(internalEan13(1)).toMatch(/^200000000001\d$/);
    expect(toGtin14(internalEan13(1234567))).not.toBeNull();
    expect(() => internalEan13(0)).toThrow(RangeError);
    expect(() => internalEan13(10 ** 10)).toThrow(RangeError);
  });
});
