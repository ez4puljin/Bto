import { describe, expect, it } from 'vitest';
import {
  activeCount,
  defaultWarehouseId,
  EMPTY_FILTERS,
  filtersFrom,
  initialFilters,
  MAX_FILTER_IDS,
  supplierInitial,
  toggleId,
  topCategories,
  withKnownWarehouse,
} from './filters';

const warehouses = [{ id: 3 }, { id: 7 }];

describe('shop filters', () => {
  it('starts a scoped rep in their one wholesale warehouse, others in every warehouse', () => {
    expect(defaultWarehouseId(warehouses, [1, 3])).toBe(3);
    expect(defaultWarehouseId(warehouses, [3, 7])).toBeNull();
    expect(defaultWarehouseId(warehouses, [1])).toBeNull();
    expect(defaultWarehouseId(warehouses, null)).toBeNull();
    expect(initialFilters(warehouses, [7])).toEqual({ ...EMPTY_FILTERS, warehouseId: 7 });
  });

  it('counts the filters that are on, never the order', () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
    expect(activeCount({ ...EMPTY_FILTERS, sort: 'PRICE_DESC' })).toBe(0);
    expect(activeCount({ ...EMPTY_FILTERS, warehouseId: 3 })).toBe(1);
    expect(
      activeCount({
        sort: 'NEW',
        categoryIds: [1, 2],
        warehouseId: 3,
        supplierIds: [4],
        inStock: true,
      }),
    ).toBe(4);
  });

  it('toggles an id in a list and holds at most the API limit', () => {
    expect(toggleId([1, 2], 2)).toEqual([1]);
    expect(toggleId([1], 2)).toEqual([1, 2]);
    const full = Array.from({ length: MAX_FILTER_IDS }, (_, index) => index + 1);
    expect(toggleId(full, 999)).toHaveLength(MAX_FILTER_IDS);
  });

  it('reads stored filters back, refusing anything else', () => {
    expect(
      filtersFrom({
        sort: 'PRICE_ASC',
        categoryIds: [5, 5, -1, 'x', 6],
        warehouseId: 3,
        supplierIds: [9],
        inStock: true,
      }),
    ).toEqual({
      sort: 'PRICE_ASC',
      categoryIds: [5, 6],
      warehouseId: 3,
      supplierIds: [9],
      inStock: true,
    });
    expect(filtersFrom({ sort: 'NAME' })).toBeNull();
    expect(filtersFrom(null)).toBeNull();
    expect(filtersFrom({ sort: 'NEW', warehouseId: 1.5 })).toEqual(EMPTY_FILTERS);
  });

  it('drops a warehouse the server no longer lists', () => {
    expect(withKnownWarehouse({ ...EMPTY_FILTERS, warehouseId: 9 }, warehouses).warehouseId).toBe(
      null,
    );
    expect(withKnownWarehouse({ ...EMPTY_FILTERS, warehouseId: 7 }, warehouses).warehouseId).toBe(
      7,
    );
  });
});

describe('the filter lists', () => {
  it('offers the top categories with products somewhere under them', () => {
    const categories = [
      { id: 1, parentId: null, name: 'Ундаа', productCount: 0 },
      { id: 2, parentId: 1, name: 'Ус', productCount: 0 },
      { id: 3, parentId: 2, name: 'Рашаан', productCount: 4 },
      { id: 4, parentId: null, name: 'Хоосон', productCount: 0 },
      { id: 5, parentId: null, name: 'Дарс', productCount: 2 },
    ];
    expect(topCategories(categories)).toEqual([
      { id: 1, name: 'Ундаа' },
      { id: 5, name: 'Дарс' },
    ]);
  });

  it('takes a supplier’s letter from its last word, past the legal form', () => {
    expect(supplierInitial('Туршилт Хүнс ХХК')).toBe('Х');
    expect(supplierInitial('МСМ ХХК')).toBe('М');
    expect(supplierInitial('апу')).toBe('А');
    expect(supplierInitial('ХХК')).toBe('Х');
  });
});
