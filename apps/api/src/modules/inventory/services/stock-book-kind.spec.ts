import { Decimal } from '@tugeel/shared/money';
import { bookKindOf } from './stock-book-kind';

const out = new Decimal('-700');
const into = new Decimal('700');

/** What each ledger row books (F4, ADR-0097): the account follows the movement and the reason. */
describe('bookKindOf', () => {
  it('books receipts, sales, returns and issues by their movement', () => {
    expect(bookKindOf('RECEIPT', null, into)).toBe('RECEIPT');
    expect(bookKindOf('DELIVERY_ISSUE', null, out)).toBe('SALE');
    expect(bookKindOf('POS_SALE', null, out)).toBe('SALE');
    expect(bookKindOf('RETURN_IN', null, into)).toBe('SALE_RETURN');
    expect(bookKindOf('GOODS_ISSUE', null, out)).toBe('ISSUE');
  });

  it('books an adjustment by its reason and a count correction by its sign', () => {
    for (const reason of ['DAMAGED', 'EXPIRED', 'SHORTAGE']) {
      expect(bookKindOf('ADJUSTMENT', reason, out)).toBe('LOSS');
    }
    expect(bookKindOf('ADJUSTMENT', 'SURPLUS', into)).toBe('GAIN');
    expect(bookKindOf('ADJUSTMENT', 'POS_SHORTFALL', into)).toBe('GAIN');
    expect(bookKindOf('ADJUSTMENT', 'OPENING', into)).toBe('OPENING');
    expect(bookKindOf('ADJUSTMENT', 'OPENING_REVERSAL', out)).toBe('OPENING');
    expect(bookKindOf('COUNT_CORRECTION', null, out)).toBe('LOSS');
    expect(bookKindOf('COUNT_CORRECTION', null, into)).toBe('GAIN');
  });

  it('leaves transfers, picks and bin moves value-neutral', () => {
    for (const movement of [
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'PICK_OUT',
      'PICK_IN',
      'PUTAWAY_OUT',
      'PUTAWAY_IN',
      'BIN_MOVE_OUT',
      'BIN_MOVE_IN',
    ]) {
      expect(bookKindOf(movement, null, out)).toBeNull();
    }
  });
});
