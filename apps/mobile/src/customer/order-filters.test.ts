import { describe, expect, it } from 'vitest';
import {
  activeStoreFilters,
  EMPTY_STORE_ORDER_FILTERS,
  sameTaker,
  storeOrderParams,
  toggleTaker,
  withoutStoreFilter,
} from './order-filters';

describe('«Bto300»: the orders’ filters (the owner 2026-10-20)', () => {
  it('sends only the filters that are on, one rep with its id', () => {
    expect(storeOrderParams(EMPTY_STORE_ORDER_FILTERS)).toEqual({});
    expect(
      storeOrderParams({
        taker: { kind: 'REP', rep: { id: 7, name: 'Бат' } },
        product: { id: 12, name: 'Coca-Cola 0.5л' },
        paymentMethod: 'CREDIT',
        fulfilment: 'DELIVERY',
        state: 'PENDING',
      }),
    ).toEqual({
      taker: 'REP',
      repId: 7,
      productId: 12,
      paymentMethod: 'CREDIT',
      fulfilment: 'DELIVERY',
      state: 'PENDING',
    });
    expect(
      storeOrderParams({ ...EMPTY_STORE_ORDER_FILTERS, taker: { kind: 'REP', rep: null } }),
    ).toEqual({ taker: 'REP' });
    expect(storeOrderParams({ ...EMPTY_STORE_ORDER_FILTERS, taker: { kind: 'APP' } })).toEqual({
      taker: 'APP',
    });
  });

  it('lists, removes and toggles the chosen filters', () => {
    const filters = {
      ...EMPTY_STORE_ORDER_FILTERS,
      taker: { kind: 'OFFICE' as const },
      state: 'DELIVERED' as const,
    };
    expect(activeStoreFilters(filters)).toEqual(['taker', 'state']);
    expect(activeStoreFilters(withoutStoreFilter(filters, 'taker'))).toEqual(['state']);
    const bat = { kind: 'REP' as const, rep: { id: 7, name: 'Бат' } };
    const dorj = { kind: 'REP' as const, rep: { id: 8, name: 'Дорж' } };
    expect(sameTaker(bat, { kind: 'REP', rep: { id: 7, name: 'Бат' } })).toBe(true);
    expect(sameTaker(bat, dorj)).toBe(false);
    expect(sameTaker(bat, { kind: 'REP', rep: null })).toBe(false);
    expect(sameTaker({ kind: 'APP' }, { kind: 'APP' })).toBe(true);
    expect(sameTaker(null, null)).toBe(true);
    expect(toggleTaker(bat, bat)).toBeNull();
    expect(toggleTaker(bat, dorj)).toBe(dorj);
    expect(toggleTaker(null, { kind: 'APP' })).toEqual({ kind: 'APP' });
  });
});
