import { segmentIssue } from '@tugeel/shared/segments';
import { describe, expect, it } from 'vitest';
import {
  activeFilterFields,
  filterParam,
  PRODUCT_FILTER_FIELDS,
  type ProductFilters,
  priceIssue,
  readFilters,
  whereOf,
} from './product-filters';

const read = (query: string) => readFilters(new URLSearchParams(query));

describe('product list filters in the URL (ADR-0049)', () => {
  it('reads every field and writes it back the same way', () => {
    const query =
      'segment=7&supplier=main:1,2&home=3&profile=5,6&price=1000~5000&stock=low:3&created=30d&updated=2026-10-01~2026-10-14&missing=photo,supplier';
    const filters = read(query);
    expect(filters).toEqual({
      segment: 7,
      supplier: { main: true, ids: [1, 2] },
      home: [3],
      profile: [5, 6],
      price: { min: '1000', max: '5000' },
      stock: { kind: 'low', warehouseId: 3 },
      created: { days: 30 },
      updated: { from: '2026-10-01', to: '2026-10-14' },
      missing: ['photo', 'supplier'],
    });
    const params = new URLSearchParams(query);
    for (const field of PRODUCT_FILTER_FIELDS) {
      expect(filterParam(field, filters)).toBe(params.get(field));
    }
    expect(activeFilterFields(filters)).toEqual(PRODUCT_FILTER_FIELDS);
  });

  it('keeps open ranges and drops what does not read', () => {
    expect(read('price=~5000&created=~2026-10-14&updated=2026-10-01~&stock=out')).toEqual({
      price: { max: '5000' },
      created: { to: '2026-10-14' },
      updated: { from: '2026-10-01' },
      stock: { kind: 'out' },
    });
    expect(
      read(
        'segment=x&supplier=1,a&home=0&price=5000~1000&stock=all&created=0d&updated=2026-10-14~2026-10-01&missing=nothing',
      ),
    ).toEqual({});
    expect(read('supplier=2,2,1')).toEqual({ supplier: { main: false, ids: [2, 1] } });
    expect(activeFilterFields({})).toEqual([]);
  });

  it('checks a price range of whole tugriks', () => {
    expect(priceIssue('1000', '')).toBeNull();
    expect(priceIssue('', '')).toBe('MONEY_INVALID');
    expect(priceIssue('10.5', '')).toBe('MONEY_INVALID');
    expect(priceIssue('5000', '1000')).toBe('MONEY_ORDER');
  });

  it('sends the fields ANDed and the missing data ORed, as the shared rules accept', () => {
    const filters: ProductFilters = read(
      'supplier=1&stock=out:3&created=7d&price=1000~&missing=base-barcode,home,price',
    );
    const where = whereOf(filters);
    expect(where).toEqual({
      match: 'ALL',
      groups: [
        {
          match: 'ALL',
          conditions: [
            { field: 'supplier', op: 'IN', ids: [1] },
            { field: 'warehousePrice', op: 'BETWEEN', min: '1000' },
            { field: 'stock', op: 'OUT_OF_STOCK', warehouseId: 3 },
            { field: 'createdAt', op: 'LAST_DAYS', days: 7 },
          ],
        },
        {
          match: 'ANY',
          conditions: [
            { field: 'missing', op: 'IS', values: ['BASE_BARCODE'] },
            { field: 'homeWarehouse', op: 'NONE' },
            { field: 'priceProfile', op: 'NONE' },
          ],
        },
      ],
    });
    expect(segmentIssue('PRODUCT', where)).toBeNull();
    // Every field alone is a valid definition too; a segment alone sends no conditions.
    const all = read(
      'supplier=main:1&home=3&profile=5&price=~5000&stock=low&created=2026-10-01~&updated=1d&missing=barcode,photo,weight,ebarimt,supplier',
    );
    expect(segmentIssue('PRODUCT', whereOf(all))).toBeNull();
    expect(whereOf(read('segment=7'))).toBeUndefined();
  });
});
