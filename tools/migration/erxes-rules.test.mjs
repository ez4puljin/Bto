// The Erxes master conversion rules (ADR-0098) on synthetic rows only: never the owner's data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitCell,
  homeOf,
  placeCategory,
  planBarcodes,
  planSuppliers,
  reassignCodes,
  splitBarcodes,
} from './erxes-rules.mjs';

const map = {
  skipCategories: ['Өөр салбар'],
  topGroups: { 1: 'Ундаа', 9: 'Бусад' },
  unnumberedInto: { Хүүхдийн: '9' },
  directInTopGroup: 'Ангилаагүй',
  warehouses: [
    { tag: 'Агуулах А', code: 'WH1' },
    { tag: 'Заал', code: 'WH2' },
  ],
};

test('places numbered, «+», unnumbered, group-named and skipped categories', () => {
  assert.deepEqual(placeCategory('101 Ус', map), {
    path: ['Ундаа', '101 Ус'],
    range: { from: 101000n, to: 101999n },
  });
  assert.deepEqual(placeCategory('905 - Хятад', map).path, ['Бусад', '905 - Хятад']);
  assert.deepEqual(placeCategory('+Тамхи', map), { path: ['Тамхи'], range: null });
  assert.deepEqual(placeCategory('Хүүхдийн', map), { path: ['Бусад', 'Хүүхдийн'], range: null });
  assert.deepEqual(placeCategory('ундаа', map), { path: ['Ундаа', 'Ангилаагүй'], range: null });
  assert.deepEqual(placeCategory('Өөр салбар', map), { skip: true });
  assert.deepEqual(placeCategory('501 Саван', map), { error: 'NO_TOP_GROUP' });
  assert.deepEqual(placeCategory('Шинэ', map), { error: 'UNKNOWN_CATEGORY' });
  assert.deepEqual(placeCategory('A / B', map), { error: 'SEPARATOR_IN_NAME' });
});

test('gives codes with letters the lowest free code of their range, then of the group', () => {
  const sub = placeCategory('101 Ус', map);
  const rows = [
    { sku: '101000', place: sub },
    { sku: '10Q0001', place: sub },
    { sku: 'td_101002', place: sub },
    { sku: '102000', place: placeCategory('102 Шүүс', map) },
  ];
  assert.deepEqual(
    [...reassignCodes(rows, map)],
    [
      ['10Q0001', '101001'],
      ['td_101002', '101002'],
    ],
  );
  const full = { path: ['Ундаа', '103 Дүүрэн'], range: { from: 103000n, to: 103000n } };
  const crowded = [
    { sku: '103000', place: full },
    { sku: '10Q9', place: full },
    { sku: '100000', place: sub },
    { sku: '101000', place: sub },
  ];
  // 103's range is full: the group's range outside 101000–101999 and 103000–103000.
  assert.equal(reassignCodes(crowded, map).get('10Q9'), '100001');
});

test('keeps one key per product and lists barcodes several products share', () => {
  const plan = planBarcodes([
    { sku: '1', codes: ['4006381333931', '04006381333931', '12345'] },
    { sku: '2', codes: ['12345', '4006381333932', 'abc-1'] },
    { sku: '3', codes: ['АБВ'] },
  ]);
  assert.deepEqual(plan.kept.get('1'), ['4006381333931']);
  assert.deepEqual(plan.kept.get('2'), ['4006381333932', 'abc-1']);
  assert.deepEqual(plan.kept.get('3'), []);
  assert.deepEqual(plan.shared, [{ key: '12345', code: '12345', skus: ['1', '2'] }]);
  assert.deepEqual(plan.dropped, [{ sku: '3', code: 'АБВ', reason: 'CHARACTERS' }]);
  assert.deepEqual(splitBarcodes('1, 2;3  4'), ['1', '2', '3', '4']);
});

test('makes one supplier per code with unique names', () => {
  const { suppliers, problems } = planSuppliers([
    { code: '20', name: 'Ази' },
    { code: '10', name: 'Ази' },
    { code: '10', name: 'Ази' },
    { code: 'X1', name: 'Буруу' },
    { code: '', name: 'Хоосон' },
  ]);
  assert.deepEqual(suppliers, [
    { code: '10', name: 'Ази' },
    { code: '20', name: 'Ази (20)' },
  ]);
  assert.deepEqual(
    problems.map((p) => p.reason),
    ['CODE_FORMAT', 'NAME_TAKEN'],
  );
});

test('takes the first tag of a combination as the home warehouse', () => {
  assert.deepEqual(homeOf('Заал', map), { code: 'WH2' });
  assert.deepEqual(homeOf('Агуулах А, Заал', map), { code: 'WH1' });
  assert.deepEqual(homeOf('', map), { code: null });
  assert.deepEqual(homeOf('Шинэ таг', map), { error: 'UNKNOWN_TAG', tag: 'Шинэ таг' });
});

test('fits barcodes into one import cell and keeps the rest for the api', () => {
  assert.deepEqual(fitCell(['1234', '5678', '9012'], 10), { cell: '1234, 5678', rest: ['9012'] });
  assert.deepEqual(fitCell(['1234'], 10), { cell: '1234', rest: [] });
  assert.deepEqual(fitCell([], 10), { cell: '', rest: [] });
});
