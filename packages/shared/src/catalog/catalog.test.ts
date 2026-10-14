import { describe, expect, it } from 'vitest';
import {
  categoryPaths,
  categoryTree,
  checkSku,
  EXPORTABLE_PRODUCT_COLUMNS,
  PRODUCT_LIST_COLUMNS,
  productStage,
  holesOf,
  innermostOwner,
  lowestFree,
  nextAfter,
  type RangedCategory,
  rangeConflict,
  rangeOwner,
  SKU_MAX,
  SKU_PATTERN,
} from './index';

const category = (
  id: number,
  parentId: number | null,
  range: [string, string] | null,
  name = `C${id}`,
): RangedCategory => ({
  id,
  parentId,
  name,
  skuFrom: range?.[0] ?? null,
  skuTo: range?.[1] ?? null,
});

// Хүнс 20000–29999 with Гурил inside (21000–21999) and Будаа without a range; Ундаа 10000–19999;
// Бусад without a range anywhere up the tree.
const FOOD = category(1, null, ['20000', '29999'], 'Хүнс');
const FLOUR = category(2, 1, ['21000', '21999'], 'Гурил');
const RICE = category(3, 1, null, 'Будаа');
const DRINKS = category(4, null, ['10000', '19999'], 'Ундаа');
const OTHER = category(5, null, null, 'Бусад');
const TREE = [FOOD, FLOUR, RICE, DRINKS, OTHER];
const range = (from: bigint, to: bigint) => ({ from, to });

describe('product codes and category ranges (ADR-0044 #1)', () => {
  it('reads digit codes of 1 to 20 characters', () => {
    expect(SKU_PATTERN.test('10023')).toBe(true);
    expect(SKU_PATTERN.test('0')).toBe(true);
    expect(SKU_PATTERN.test('1'.repeat(21))).toBe(false);
    expect(SKU_PATTERN.test('12a')).toBe(false);
    expect(SKU_MAX.toString()).toBe('9'.repeat(20));
  });

  it('gives a category its own range or its nearest ancestor’s', () => {
    expect(rangeOwner(TREE, FLOUR.id)?.id).toBe(FLOUR.id);
    expect(rangeOwner(TREE, RICE.id)?.id).toBe(FOOD.id);
    expect(rangeOwner(TREE, OTHER.id)).toBeNull();
    expect(innermostOwner(TREE, 21_500n)?.id).toBe(FLOUR.id);
    expect(innermostOwner(TREE, 20_500n)?.id).toBe(FOOD.id);
    expect(innermostOwner(TREE, 30_000n)).toBeNull();
  });

  it('lets a code into its category’s own part of the range only', () => {
    expect(checkSku(TREE, RICE.id, '20500')).toEqual({ ok: true });
    expect(checkSku(TREE, FLOUR.id, '21500')).toEqual({ ok: true });
    // Inside Хүнс but in Гурил's block.
    expect(checkSku(TREE, RICE.id, '21500')).toMatchObject({
      ok: false,
      problem: 'RESERVED',
      owner: { name: 'Гурил' },
    });
    // Outside the category's range altogether.
    expect(checkSku(TREE, FLOUR.id, '20500')).toMatchObject({
      ok: false,
      problem: 'OUT_OF_RANGE',
      range: { from: 21_000n, to: 21_999n },
    });
    // A category without a range may not take another category's codes; leading zeros count as
    // the same number.
    expect(checkSku(TREE, OTHER.id, '30000')).toEqual({ ok: true });
    expect(checkSku(TREE, OTHER.id, '015000')).toMatchObject({ ok: false, problem: 'RESERVED' });
  });

  it('allows nested ranges only down the tree and refuses every other overlap', () => {
    expect(rangeConflict(TREE)).toBeNull();
    // A sibling overlapping Ундаа.
    expect(rangeConflict([...TREE, category(6, null, ['19000', '20500'])])).toMatchObject({
      other: { id: expect.any(Number) },
    });
    // Nested, but not under its ancestor: Ундаа's block inside Хүнс's range.
    expect(rangeConflict([FOOD, category(7, null, ['22000', '22999'])])).not.toBeNull();
    // The same range twice.
    expect(rangeConflict([FOOD, category(8, 1, ['20000', '29999'])])).not.toBeNull();
    // A grandchild inside its grandparent.
    expect(
      rangeConflict([FOOD, category(9, 1, null), category(10, 9, ['25000', '25999'])]),
    ).toBeNull();
  });

  it('suggests past the largest code, skipping subcategories, then the lowest free one', () => {
    const food = range(20_000n, 29_999n);
    const holes = holesOf(TREE, food);
    expect(holes).toEqual([range(21_000n, 21_999n)]);
    expect(nextAfter(food, holes, null)).toBe(20_000n);
    expect(nextAfter(food, holes, 20_041n)).toBe(20_042n);
    expect(nextAfter(food, holes, 20_999n)).toBe(22_000n);
    expect(nextAfter(food, holes, 29_999n)).toBeNull();
    expect(lowestFree(food, holes, new Set([20_000n, 20_001n, 20_003n]))).toBe(20_002n);
    const small = range(1n, 3n);
    expect(lowestFree(small, [], new Set([1n, 2n, 3n]))).toBeNull();
    // Without a range: past every range.
    const everything = range(1n, SKU_MAX);
    const all = holesOf(TREE, everything);
    expect(nextAfter(everything, all, 9_999n)).toBe(30_000n);
  });
});

describe('product stage, list columns and category paths (ADR-0044, ADR-0049)', () => {
  it('puts a product in one of three stages', () => {
    expect(productStage({ status: 'INACTIVE', saleReadyAt: null })).toBe('INACTIVE');
    expect(productStage({ status: 'ACTIVE', saleReadyAt: null })).toBe('PENDING');
    expect(productStage({ status: 'ACTIVE', saleReadyAt: '2026-10-01T00:00:00Z' })).toBe('ACTIVE');
  });

  it('exports every list column but the photo, in the same order', () => {
    expect(EXPORTABLE_PRODUCT_COLUMNS).toEqual(
      PRODUCT_LIST_COLUMNS.filter((column) => column !== 'image'),
    );
  });

  it('walks categories depth-first with their full paths', () => {
    const categories = [
      { id: 1, parentId: null, name: 'Хүнс' },
      { id: 2, parentId: 1, name: 'Гурил' },
      { id: 3, parentId: null, name: 'Ундаа' },
      { id: 4, parentId: 1, name: 'Будаа' },
    ];
    expect(categoryTree(categories).map((node) => [node.depth, node.path])).toEqual([
      [0, 'Ундаа'],
      [0, 'Хүнс'],
      [1, 'Хүнс / Будаа'],
      [1, 'Хүнс / Гурил'],
    ]);
    expect(categoryPaths(categories).get(2)).toBe('Хүнс / Гурил');
  });
});
