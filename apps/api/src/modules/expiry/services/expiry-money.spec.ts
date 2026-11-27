import { formatExpiryBarcode, parseExpiryBarcode } from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { expiryReturnShares, splitExpiryLoss } from './expiry-money';

describe('expiry money and physical label identity', () => {
  it('uses an exact internal namespace and refuses unsafe/noncanonical identities', () => {
    expect(parseExpiryBarcode(formatExpiryBarcode(123))).toBe(123);
    for (const value of [
      'BTOEXP-0',
      'BTOEXP-01',
      'btoexp-1',
      'BTOEXP-1x',
      '123',
      'BTOEXP-9007199254740992',
    ])
      expect(parseExpiryBarcode(value)).toBeNull();
    expect(() => formatExpiryBarcode(Number.NaN)).toThrow(RangeError);
  });
  it('deduplicates stable people and allocates every cent deterministically', () => {
    expect(splitExpiryLoss(new Decimal('1'), [9, 2, 9, 5])).toEqual([
      { userId: 2, amount: '0.34' },
      { userId: 5, amount: '0.33' },
      { userId: 9, amount: '0.33' },
    ]);
    expect(() => splitExpiryLoss(new Decimal('NaN'), [1])).toThrow(RangeError);
  });
  it('partial returns credit the original people, with the final remaining cents exact', () => {
    const shares = splitExpiryLoss(new Decimal('1'), [2, 5, 9]);
    const returns = [0, 1, 2].map((before) =>
      expiryReturnShares(shares, new Decimal(3), new Decimal(before), new Decimal(1)),
    );
    for (const original of shares) {
      const credited = returns.reduce(
        (sum, rows) => sum.plus(rows.find((row) => row.userId === original.userId)?.amount ?? 0),
        new Decimal(0),
      );
      expect(credited.eq(new Decimal(original.amount).negated())).toBe(true);
    }
  });
});
