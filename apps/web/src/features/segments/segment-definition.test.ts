import { segmentIssue } from '@tugeel/shared/segments';
import { describe, expect, it } from 'vitest';
import {
  definitionFromProductList,
  newCondition,
  newDefinition,
  withOperator,
} from './segment-definition';

describe('segment definitions in the editor (ADR-0049)', () => {
  it('starts a condition on a field with its first operator', () => {
    expect(newCondition('PRODUCT', 'supplier')).toEqual({ field: 'supplier', op: 'IN' });
    expect(newCondition('CUSTOMER', 'creditHold')).toEqual({ field: 'creditHold', op: 'YES' });
    expect(newDefinition('SUPPLIER')).toEqual({
      match: 'ALL',
      groups: [{ match: 'ALL', conditions: [{ field: 'search', op: 'CONTAINS' }] }],
    });
  });

  it('keeps only the values the new operator takes', () => {
    const chosen = { field: 'supplier', op: 'IN' as const, ids: [1, 2] };
    expect(withOperator('PRODUCT', chosen, 'MAIN_IN')).toEqual({ ...chosen, op: 'MAIN_IN' });
    expect(withOperator('PRODUCT', chosen, 'NONE')).toEqual({ field: 'supplier', op: 'NONE' });
    const days = { field: 'createdAt', op: 'LAST_DAYS' as const, days: 30 };
    expect(withOperator('PRODUCT', days, 'BETWEEN')).toEqual({ field: 'createdAt', op: 'BETWEEN' });
  });

  it('turns the product list filters into a valid definition', () => {
    const definition = definitionFromProductList(
      new URLSearchParams('q=кола&category=3&status=PENDING&supplier=1&missing=photo&segment=9'),
    );
    expect(definition).toEqual({
      match: 'ALL',
      groups: [
        {
          match: 'ALL',
          conditions: [
            { field: 'search', op: 'CONTAINS', text: 'кола' },
            { field: 'category', op: 'IN', ids: [3] },
            { field: 'stage', op: 'IN', values: ['PENDING'] },
            { field: 'supplier', op: 'IN', ids: [1] },
          ],
        },
        { match: 'ANY', conditions: [{ field: 'missing', op: 'IS', values: ['PHOTO'] }] },
      ],
    });
    expect(segmentIssue('PRODUCT', definition)).toBeNull();
    // Only missing data: the search goes into a group of its own.
    expect(definitionFromProductList(new URLSearchParams('q=ус&missing=weight')).groups).toEqual([
      { match: 'ALL', conditions: [{ field: 'search', op: 'CONTAINS', text: 'ус' }] },
      { match: 'ANY', conditions: [{ field: 'missing', op: 'IS', values: ['WEIGHT'] }] },
    ]);
    expect(definitionFromProductList(new URLSearchParams(''))).toEqual(newDefinition('PRODUCT'));
  });
});
