import { parseStockNotice, STOCK_NOTICE_RESYNC } from './stock-notify';

describe('the live stock notice (ADR-0173 #4)', () => {
  it('reads comma-joined product ids', () => {
    expect(parseStockNotice('3,17,42')).toEqual([3, 17, 42]);
    expect(parseStockNotice('9')).toEqual([9]);
  });

  it('turns the resync payload, nothing, or anything malformed into RESYNC', () => {
    expect(parseStockNotice(STOCK_NOTICE_RESYNC)).toBe('RESYNC');
    expect(parseStockNotice(undefined)).toBe('RESYNC');
    expect(parseStockNotice('')).toBe('RESYNC');
    expect(parseStockNotice('1,,2')).toBe('RESYNC');
    expect(parseStockNotice('1,x')).toBe('RESYNC');
    expect(parseStockNotice('0')).toBe('RESYNC');
  });
});
