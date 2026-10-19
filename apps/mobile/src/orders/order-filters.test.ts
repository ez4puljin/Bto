import { describe, expect, it } from 'vitest';
import {
  activeOrderFilters,
  EMPTY_ORDER_FILTERS,
  type OrderFilters,
  orderFilterCount,
  orderFilterParams,
  toggleChoice,
  withoutFilter,
} from './order-filters';

const all: OrderFilters = {
  customer: { id: 4, name: 'Наран дэлгүүр' },
  product: { id: 17, name: 'Сүү 1л' },
  paymentMethod: 'CREDIT',
  fulfilment: 'DELIVERY',
  state: 'ACTIVE',
};

describe('order filters', () => {
  it('asks nothing beyond the days when no filter is on', () => {
    expect(orderFilterParams(EMPTY_ORDER_FILTERS)).toEqual({});
    expect(orderFilterCount(EMPTY_ORDER_FILTERS)).toBe(0);
    expect(activeOrderFilters(EMPTY_ORDER_FILTERS)).toEqual([]);
  });

  it('turns every filter that is on into its query parameter', () => {
    expect(orderFilterParams(all)).toEqual({
      customerId: 4,
      productId: 17,
      paymentMethod: 'CREDIT',
      fulfilment: 'DELIVERY',
      state: 'ACTIVE',
    });
    expect(orderFilterParams({ ...EMPTY_ORDER_FILTERS, state: 'DRAFT' })).toEqual({
      state: 'DRAFT',
    });
  });

  it('counts the filters that are on and lists them in the chips order', () => {
    expect(orderFilterCount(all)).toBe(5);
    expect(
      activeOrderFilters({ ...EMPTY_ORDER_FILTERS, state: 'SOLD', customer: all.customer }),
    ).toEqual(['customer', 'state']);
  });

  it('takes one filter off with its chip and keeps the others', () => {
    const left = withoutFilter(all, 'product');
    expect(left.product).toBeNull();
    expect(orderFilterCount(left)).toBe(4);
    expect(orderFilterParams(left)).not.toHaveProperty('productId');
    expect(all.product).not.toBeNull();
  });

  it('takes a chosen chip off when it is chosen again', () => {
    expect(toggleChoice(null, 'CASH')).toBe('CASH');
    expect(toggleChoice('CASH', 'CREDIT')).toBe('CREDIT');
    expect(toggleChoice('CASH', 'CASH')).toBeNull();
  });
});
