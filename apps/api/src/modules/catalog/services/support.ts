import { Decimal } from '@tugeel/shared/money';

// Shared with other modules through src/common; re-exported so catalog imports stay unchanged.
export { escapeLike } from '../../../common/db/like';
export { invalid, notFound } from '../../../common/errors/app-error';

/** A decimal string validated by the DTO as a Decimal (never a JS number: ESLint G3). */
export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}
