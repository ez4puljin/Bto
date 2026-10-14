import { describe, expect, it } from 'vitest';
import {
  conditionKey,
  MAX_CONDITION_IDS,
  MAX_GROUP_CONDITIONS,
  MAX_SEGMENT_GROUPS,
  needsUniverse,
  SEGMENT_ENTITIES,
  SEGMENT_FIELDS,
  type SegmentCondition,
  type SegmentDefinition,
  segmentIssue,
} from '.';

const one = (condition: SegmentCondition): SegmentDefinition => ({
  match: 'ALL',
  groups: [{ match: 'ALL', conditions: [condition] }],
});

describe('the field registry', () => {
  it('gives every field at least one operator and every values field its values', () => {
    for (const entity of SEGMENT_ENTITIES) {
      for (const field of Object.values(SEGMENT_FIELDS[entity])) {
        expect(field.ops.length).toBeGreaterThan(0);
        if (field.input === 'values') expect(field.values?.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('segmentIssue', () => {
  it('accepts the owner examples: (category ∧ supplier) ∨ (out of stock in a warehouse)', () => {
    const definition: SegmentDefinition = {
      match: 'ANY',
      groups: [
        {
          match: 'ALL',
          conditions: [
            { field: 'category', op: 'IN', ids: [12, 13] },
            { field: 'supplier', op: 'MAIN_IN', ids: [5] },
          ],
        },
        { match: 'ALL', conditions: [{ field: 'stock', op: 'OUT_OF_STOCK', warehouseId: 4 }] },
      ],
    };
    expect(segmentIssue('PRODUCT', definition)).toBeNull();
  });

  it.each<[string, unknown, string, string]>([
    ['not an object', 'x', 'NOT_AN_OBJECT', ''],
    ['a bad match', { match: 'SOME', groups: [] }, 'MATCH_INVALID', 'match'],
    ['no groups', { match: 'ALL', groups: [] }, 'NO_GROUPS', 'groups'],
    [
      'an empty group',
      { match: 'ALL', groups: [{ match: 'ANY', conditions: [] }] },
      'NO_CONDITIONS',
      'groups.0.conditions',
    ],
  ])('refuses %s', (_label, definition, issue, path) => {
    expect(segmentIssue('PRODUCT', definition)).toEqual({ issue, path });
  });

  it('counts groups and conditions against their limits', () => {
    const group = {
      match: 'ALL' as const,
      conditions: [{ field: 'supplier', op: 'ANY' as const }],
    };
    expect(
      segmentIssue('PRODUCT', {
        match: 'ALL',
        groups: Array.from({ length: MAX_SEGMENT_GROUPS + 1 }, () => group),
      }),
    ).toEqual({ issue: 'TOO_MANY_GROUPS', path: 'groups' });
    expect(
      segmentIssue('PRODUCT', {
        match: 'ALL',
        groups: [
          {
            match: 'ALL',
            conditions: Array.from({ length: MAX_GROUP_CONDITIONS + 1 }, () => group.conditions[0]),
          },
        ],
      }),
    ).toEqual({ issue: 'TOO_MANY_CONDITIONS', path: 'groups.0.conditions' });
    const full = {
      match: 'ALL' as const,
      conditions: Array.from({ length: 10 }, () => group.conditions[0]),
    };
    expect(segmentIssue('PRODUCT', { match: 'ALL', groups: [full, full, full, group] })).toEqual({
      issue: 'TOO_MANY_CONDITIONS',
      path: 'groups.3.conditions',
    });
  });

  it.each<[string, SegmentCondition, string, string]>([
    ['a field of another entity', { field: 'creditHold', op: 'YES' }, 'FIELD_NOT_ALLOWED', 'field'],
    ['a prototype key as a field', { field: 'toString', op: 'IN' }, 'FIELD_NOT_ALLOWED', 'field'],
    [
      'an operator of another field',
      { field: 'category', op: 'ANY' },
      'OPERATOR_NOT_ALLOWED',
      'op',
    ],
    ['ids missing', { field: 'category', op: 'IN' }, 'VALUE_MISSING', 'ids'],
    ['an extra slot', { field: 'supplier', op: 'NONE', ids: [1] }, 'VALUE_NOT_ALLOWED', 'ids'],
    ['empty ids', { field: 'category', op: 'IN', ids: [] }, 'IDS_INVALID', 'ids'],
    ['a fractional id', { field: 'category', op: 'IN', ids: [1.5] }, 'IDS_INVALID', 'ids'],
    [
      'too many ids',
      {
        field: 'category',
        op: 'IN',
        ids: Array.from({ length: MAX_CONDITION_IDS + 1 }, (_, i) => i + 1),
      },
      'TOO_MANY_VALUES',
      'ids',
    ],
    [
      'an unknown stage',
      { field: 'stage', op: 'IN', values: ['GONE'] },
      'VALUES_INVALID',
      'values',
    ],
    [
      'a repeated stage',
      { field: 'stage', op: 'IN', values: ['ACTIVE', 'ACTIVE'] },
      'VALUES_INVALID',
      'values',
    ],
    [
      'two missing kinds in one condition',
      { field: 'missing', op: 'IS', values: ['PHOTO', 'WEIGHT'] },
      'TOO_MANY_VALUES',
      'values',
    ],
    ['dates without an end', { field: 'createdAt', op: 'BETWEEN' }, 'VALUE_MISSING', 'from'],
    [
      'a calendar error',
      { field: 'createdAt', op: 'BETWEEN', from: '2026-02-30' },
      'DATE_INVALID',
      'from',
    ],
    [
      'dates backwards',
      { field: 'updatedAt', op: 'BETWEEN', from: '2026-10-14', to: '2026-10-01' },
      'DATE_ORDER',
      'to',
    ],
    ['zero days', { field: 'createdAt', op: 'LAST_DAYS', days: 0 }, 'DAYS_RANGE', 'days'],
    [
      'a price with cents',
      { field: 'warehousePrice', op: 'BETWEEN', min: '10.5' },
      'MONEY_INVALID',
      'min',
    ],
    [
      'prices backwards',
      { field: 'warehousePrice', op: 'BETWEEN', min: '5000', max: '1000' },
      'MONEY_ORDER',
      'max',
    ],
    ['a blank search', { field: 'search', op: 'CONTAINS', text: '   ' }, 'TEXT_INVALID', 'text'],
    [
      'a bad warehouse',
      { field: 'stock', op: 'IN_STOCK', warehouseId: -1 },
      'IDS_INVALID',
      'warehouseId',
    ],
  ])('refuses %s', (_label, condition, issue, slot) => {
    expect(segmentIssue('PRODUCT', one(condition))).toEqual({
      issue,
      path: `groups.0.conditions.0.${slot}`,
    });
  });

  it('accepts open date and price ranges, last days, and a stock state in any warehouse', () => {
    for (const condition of [
      { field: 'createdAt', op: 'BETWEEN', from: '2026-10-01' },
      { field: 'updatedAt', op: 'BETWEEN', to: '2026-10-14' },
      { field: 'createdAt', op: 'LAST_DAYS', days: 30 },
      { field: 'warehousePrice', op: 'BETWEEN', min: '0' },
      { field: 'stock', op: 'AT_OR_BELOW_MIN' },
      { field: 'missing', op: 'IS', values: ['BASE_BARCODE'] },
    ] satisfies SegmentCondition[]) {
      expect(segmentIssue('PRODUCT', one(condition))).toBeNull();
    }
  });

  it('checks customer and supplier fields by their own registry', () => {
    expect(
      segmentIssue('CUSTOMER', one({ field: 'kind', op: 'IN', values: ['COMPANY'] })),
    ).toBeNull();
    expect(segmentIssue('CUSTOMER', one({ field: 'creditHold', op: 'YES' }))).toBeNull();
    expect(segmentIssue('SUPPLIER', one({ field: 'products', op: 'NONE' }))).toBeNull();
    expect(segmentIssue('SUPPLIER', one({ field: 'category', op: 'IN', ids: [1] }))).toEqual({
      issue: 'FIELD_NOT_ALLOWED',
      path: 'groups.0.conditions.0.field',
    });
  });
});

describe('evaluation helpers', () => {
  it('needs the universe only for negative operators', () => {
    expect(needsUniverse(one({ field: 'supplier', op: 'ANY' }))).toBe(false);
    expect(needsUniverse(one({ field: 'supplier', op: 'NONE' }))).toBe(true);
    expect(needsUniverse(one({ field: 'stock', op: 'OUT_OF_STOCK' }))).toBe(true);
  });

  it('keys equal conditions alike whatever the order of their ids', () => {
    expect(conditionKey({ field: 'category', op: 'IN', ids: [3, 1] })).toBe(
      conditionKey({ field: 'category', op: 'IN', ids: [1, 3] }),
    );
    expect(conditionKey({ field: 'category', op: 'IN', ids: [1] })).not.toBe(
      conditionKey({ field: 'category', op: 'NOT_IN', ids: [1] }),
    );
  });
});
