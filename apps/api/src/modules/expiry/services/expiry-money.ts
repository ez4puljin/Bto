import { Decimal, roundHalfUp } from '@tugeel/shared/money';

export interface ExpiryShare {
  userId: number;
  amount: string;
}
/** Equal cents, remainder to stable ascending employee IDs. Never distribute floating money. */
export function splitExpiryLoss(amount: Decimal, userIds: readonly number[]): ExpiryShare[] {
  if (!amount.isFinite() || amount.lt(0)) throw new RangeError('finite nonnegative loss');
  const ids = [...new Set(userIds)].sort((a, b) => a - b);
  if (!ids.length) return [];
  const cents = roundHalfUp(amount, 2).mul(100);
  const each = cents.div(ids.length).floor();
  const remainder = cents.minus(each.mul(ids.length)).toNumber();
  return ids.map((userId, i) => ({
    userId,
    amount: each
      .plus(i < remainder ? 1 : 0)
      .div(100)
      .toFixed(2),
  }));
}
/** Reversals follow each original employee share, cumulative rounding makes final return exact. */
export function expiryReturnShares(
  shares: readonly ExpiryShare[],
  originalQty: Decimal,
  returnedBefore: Decimal,
  qty: Decimal,
): ExpiryShare[] {
  return shares.map(({ userId, amount }) => ({
    userId,
    amount: roundHalfUp(new Decimal(amount).mul(returnedBefore.plus(qty)).div(originalQty), 2)
      .minus(roundHalfUp(new Decimal(amount).mul(returnedBefore).div(originalQty), 2))
      .negated()
      .toFixed(2),
  }));
}
