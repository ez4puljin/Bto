import type { Decimal } from '@tugeel/shared/money';
import type { StockBookKind } from '../hooks';

/**
 * What a ledger row does to the books (F4, ADR-0095; TODO-VERIFY D8); null for a value-neutral move.
 * An adjustment's reason decides; a count correction and an unknown reason go by the value's sign.
 */
export function bookKindOf(
  movementType: string,
  reason: string | null,
  value: Decimal,
): StockBookKind | null {
  switch (movementType) {
    case 'RECEIPT':
      return 'RECEIPT';
    case 'DELIVERY_ISSUE':
    case 'POS_SALE':
      return 'SALE';
    case 'RETURN_IN':
      return 'SALE_RETURN';
    case 'GOODS_ISSUE':
      return 'ISSUE';
    case 'ADJUSTMENT':
      if (reason === 'OPENING' || reason === 'OPENING_REVERSAL') return 'OPENING';
      if (reason === 'DAMAGED' || reason === 'EXPIRED' || reason === 'SHORTAGE') return 'LOSS';
      if (reason === 'SURPLUS' || reason === 'POS_SHORTFALL') return 'GAIN';
      return value.isNegative() ? 'LOSS' : 'GAIN';
    case 'COUNT_CORRECTION':
      return value.isNegative() ? 'LOSS' : 'GAIN';
    default:
      return null;
  }
}
