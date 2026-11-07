// The expiry carry's rules (ADR-0172 #12) on made-up rows only: never the owner's data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cachedPerCode,
  failureFields,
  failureText,
  findProductId,
  indexLookups,
  mapChange,
  mapRecord,
  normalizeCode,
  OLD_SYSTEM_NAME,
  oldLiableLabels,
  quantityText,
  splitOldBarcodes,
  toInstant,
} from './rules.mjs';

const lookups = indexLookups(
  [
    { value: 'clerk', label: 'Жишээ нярав', color: '' },
    { value: 'blank', label: '', color: '' },
  ],
  [
    { id: 7, username: 'tester', nickname: 'Туршилт', role: 'clerk' },
    { id: 8, username: 'plain', nickname: '', role: 'clerk' },
  ],
);

const oldRow = (over = {}) => ({
  id: 41,
  product_id: 900,
  product_name: 'Жишээ бараа',
  product_code: '100200',
  product_brand: 'Жишээ брэнд',
  product_barcode: '4600000000000',
  location_tags: ['Заал'],
  expiration_date: '2026-12-31',
  days_left: 54,
  is_expired: false,
  is_expiring_soon: false,
  qty_floor: 12,
  qty_warehouse: 2.5,
  qty_total: 14.5,
  status: 'review',
  liability_type: 'none',
  liability_role_ids: [],
  liability_user_ids: [],
  liability_note: '',
  notes: '',
  archived_at: null,
  archived_by_username: '',
  created_at: '2026-03-05T04:10:00',
  created_by_username: 'tester',
  updated_at: '2026-03-05T04:10:00',
  ...over,
});

const oldChange = (over = {}) => ({
  id: 301,
  kind: 'create',
  qty_floor_old: 12,
  qty_floor_new: 12,
  qty_warehouse_old: 2.5,
  qty_warehouse_new: 2.5,
  changed_at: '2026-03-05T04:10:00.250000',
  changed_by_username: 'tester',
  ...over,
});

test('maps a whole old row and its history to the carry body', () => {
  const mapped = mapRecord(oldRow(), [oldChange()], lookups);
  assert.deepEqual(mapped, {
    body: {
      legacyId: 41,
      expiryDate: '2026-12-31',
      qtyFloor: '12',
      qtyWarehouse: '2.5',
      status: 'REVIEW',
      liabilityType: 'NONE',
      liabilityRoleIds: [],
      liabilityUserIds: [],
      createdAt: '2026-03-05T04:10:00Z',
      createdByName: 'tester',
      history: [
        {
          legacyId: 301,
          kind: 'CREATE',
          qtyFloorOld: '12',
          qtyFloorNew: '12',
          qtyWarehouseOld: '2.5',
          qtyWarehouseNew: '2.5',
          changedAt: '2026-03-05T04:10:00.250000Z',
          changedByName: 'tester',
        },
      ],
    },
    noteTruncated: false,
    liabilityNoteTruncated: false,
    historyLeftOut: 0,
  });
});

test('maps every old status and liability word', () => {
  for (const [word, status] of [
    ['review', 'REVIEW'],
    ['city_return', 'CITY_RETURN'],
    ['internal_sale', 'INTERNAL_SALE'],
    ['archived', 'ARCHIVED'],
  ]) {
    assert.equal(mapRecord(oldRow({ status: word }), [], lookups).body.status, status);
  }
  for (const [word, type] of [
    ['none', 'NONE'],
    ['specific', 'SPECIFIC'],
    ['all_staff', 'ALL_STAFF'],
  ]) {
    assert.equal(mapRecord(oldRow({ liability_type: word }), [], lookups).body.liabilityType, type);
  }
});

test('gives a naive UTC time its Z, keeps a zone, refuses what cannot be read', () => {
  assert.equal(toInstant('2026-03-05T04:10:00'), '2026-03-05T04:10:00Z');
  assert.equal(toInstant('2026-03-05T04:10:00.123456'), '2026-03-05T04:10:00.123456Z');
  assert.equal(toInstant('2026-03-05T04:10:00Z'), '2026-03-05T04:10:00Z');
  assert.equal(toInstant('2026-03-05T04:10:00+08:00'), '2026-03-05T04:10:00+08:00');
  for (const bad of [null, undefined, '', '2026-03-05', '2026-13-05T04:10:00', 'yesterday', 5]) {
    assert.equal(toInstant(bad), null);
  }
});

test('writes old floats as quantity strings with up to three decimals', () => {
  assert.equal(quantityText(12), '12');
  assert.equal(quantityText(100), '100');
  assert.equal(quantityText(0), '0');
  assert.equal(quantityText(-0), '0');
  assert.equal(quantityText(2.5), '2.5');
  assert.equal(quantityText(0.1 + 0.2), '0.3');
  assert.equal(quantityText(1.2346), '1.235');
  assert.equal(quantityText(99_999_999_999), '99999999999');
});

test('refuses a quantity that is negative, not a number or too large', () => {
  for (const bad of [-1, -0.001, NaN, Infinity, 100_000_000_000, 1e21, '5', null, undefined]) {
    assert.equal(quantityText(bad), null);
  }
  assert.deepEqual(mapRecord(oldRow({ qty_floor: -1 }), [], lookups), {
    leftOut: 'unusable quantity',
  });
  assert.deepEqual(mapRecord(oldRow({ qty_warehouse: NaN }), [], lookups), {
    leftOut: 'unusable quantity',
  });
});

test('strips the old code’s trailing .0 and reads the comma-joined barcodes', () => {
  assert.equal(normalizeCode('100200.0'), '100200');
  assert.equal(normalizeCode(' 100200 '), '100200');
  assert.equal(normalizeCode(100200), '100200');
  assert.equal(normalizeCode('10.05'), '10.05');
  assert.equal(normalizeCode('ab-1'), 'ab-1');
  for (const empty of ['', null, undefined, 'nan', 'None']) assert.equal(normalizeCode(empty), '');
  assert.deepEqual(splitOldBarcodes('111, 222.0,,111 ,nan'), ['111', '222']);
  assert.deepEqual(splitOldBarcodes(null), []);
});

test('an empty old author becomes the words for the old system', () => {
  const mapped = mapRecord(
    oldRow({ created_by_username: '' }),
    [oldChange({ changed_by_username: '  ' })],
    lookups,
  );
  assert.equal(OLD_SYSTEM_NAME, 'Хуучин систем');
  assert.equal(mapped.body.createdByName, OLD_SYSTEM_NAME);
  assert.equal(mapped.body.history[0].changedByName, OLD_SYSTEM_NAME);
});

test('sends the archive fields of an archived row only', () => {
  const archived = {
    status: 'archived',
    archived_at: '2026-04-01T09:00:00',
    archived_by_username: 'tester',
  };
  const full = mapRecord(oldRow(archived), [], lookups).body;
  assert.equal(full.archivedAt, '2026-04-01T09:00:00Z');
  assert.equal(full.archivedByName, 'tester');

  const bare = mapRecord(
    oldRow({ status: 'archived', archived_at: null, archived_by_username: '' }),
    [],
    lookups,
  ).body;
  assert.equal('archivedAt' in bare, false);
  assert.equal('archivedByName' in bare, false);

  const open = mapRecord(oldRow({ ...archived, status: 'review' }), [], lookups).body;
  assert.equal('archivedAt' in open, false);
  assert.equal('archivedByName' in open, false);

  assert.deepEqual(mapRecord(oldRow({ ...archived, archived_at: 'soon' }), [], lookups), {
    leftOut: 'no usable archive time',
  });
});

test('writes old liable roles and people into the note, and sends no ids', () => {
  const body = mapRecord(
    oldRow({
      liability_type: 'specific',
      liability_role_ids: ['clerk', 'gone'],
      liability_user_ids: [7, 8, 99],
      liability_note: ' төлнө ',
    }),
    [],
    lookups,
  ).body;
  assert.deepEqual(body.liabilityRoleIds, []);
  assert.deepEqual(body.liabilityUserIds, []);
  assert.equal(body.liabilityNote, 'төлнө · Хуучин: Жишээ нярав, gone, Туршилт, plain, #99');

  const onlyOld = mapRecord(
    oldRow({ liability_type: 'specific', liability_role_ids: ['blank'] }),
    [],
    lookups,
  ).body;
  assert.equal(onlyOld.liabilityNote, 'Хуучин: blank');
});

test('names nobody but on a specific liability, and keeps an old note on the others', () => {
  const stale = { liability_role_ids: ['clerk'], liability_user_ids: [7] };
  assert.deepEqual(oldLiableLabels(oldRow({ liability_type: 'none', ...stale }), lookups), []);
  assert.deepEqual(oldLiableLabels(oldRow({ liability_type: 'all_staff', ...stale }), lookups), []);
  const body = mapRecord(
    oldRow({ liability_type: 'all_staff', ...stale, liability_note: 'бүгд' }),
    [],
    lookups,
  ).body;
  assert.equal(body.liabilityNote, 'бүгд');
  assert.equal('liabilityNote' in mapRecord(oldRow(), [], lookups).body, false);
});

test('truncates a long note and a long liability note, and says so', () => {
  const exact = mapRecord(oldRow({ notes: 'н'.repeat(1000) }), [], lookups);
  assert.equal(exact.noteTruncated, false);
  assert.equal(exact.body.note.length, 1000);

  const long = mapRecord(oldRow({ notes: 'н'.repeat(1001) }), [], lookups);
  assert.equal(long.noteTruncated, true);
  assert.equal(long.body.note.length, 1000);

  const liable = mapRecord(
    oldRow({
      liability_type: 'specific',
      liability_user_ids: [7],
      liability_note: 'т'.repeat(495),
    }),
    [],
    lookups,
  );
  assert.equal(liable.liabilityNoteTruncated, true);
  assert.equal(liable.noteTruncated, false);
  assert.equal(Array.from(liable.body.liabilityNote).length, 500);
  assert.equal(liable.body.liabilityNote.endsWith(' · Ху'), true);

  // Two UTF-16 units, one character to the route and the database: never cut in two.
  const emoji = mapRecord(oldRow({ notes: '😀'.repeat(1001) }), [], lookups);
  assert.equal(Array.from(emoji.body.note).length, 1000);
  assert.equal(emoji.body.note.endsWith('😀'), true);
});

test('leaves out a record it cannot send, and says why', () => {
  const cases = [
    [{ id: 0 }, 'no usable old id'],
    [{ id: '41' }, 'no usable old id'],
    [{ status: 'lost' }, 'unknown status'],
    [{ status: 'constructor' }, 'unknown status'],
    [{ liability_type: 'some' }, 'unknown liability type'],
    [{ expiration_date: null }, 'no usable expiry date'],
    [{ expiration_date: '2026-02-30' }, 'no usable expiry date'],
    [{ created_at: null }, 'no usable creation time'],
  ];
  for (const [over, leftOut] of cases) {
    assert.deepEqual(mapRecord(oldRow(over), [], lookups), { leftOut });
  }
  assert.deepEqual(mapRecord(null, [], lookups), { leftOut: 'no usable old id' });
});

test('drops and counts a history row it cannot send, and keeps the record', () => {
  assert.equal(mapChange(oldChange({ kind: 'moved' })), null);
  assert.equal(mapChange(oldChange({ id: 0 })), null);
  assert.equal(mapChange(oldChange({ changed_at: null })), null);
  assert.equal(mapChange(oldChange({ qty_floor_new: -1 })), null);
  assert.equal(mapChange(null), null);

  const mapped = mapRecord(
    oldRow(),
    [
      oldChange(),
      oldChange({ id: 302, kind: 'update', qty_floor_new: -1 }),
      oldChange({ id: 303 }),
    ],
    lookups,
  );
  assert.deepEqual(
    mapped.body.history.map((change) => change.legacyId),
    [301, 303],
  );
  assert.equal(mapped.historyLeftOut, 1);
  for (const missing of [undefined, null, {}]) {
    const none = mapRecord(oldRow(), missing, lookups);
    assert.deepEqual(none.body.history, []);
    assert.equal(none.historyLeftOut, 0);
  }
});

test('finds a product by code as a SKU, by code as a barcode, then by each old barcode', async () => {
  const asked = [];
  const finders = (skus, barcodes) => ({
    bySku: async (code) => {
      asked.push(`sku ${code}`);
      return skus[code] ?? null;
    },
    byBarcode: async (code) => {
      asked.push(`barcode ${code}`);
      return barcodes[code] ?? null;
    },
  });
  const row = oldRow({ product_code: '100200.0', product_barcode: '111,222' });

  assert.equal(await findProductId(row, finders({ 100200: 5 }, { 100200: 6, 111: 7 })), 5);
  assert.deepEqual(asked, ['sku 100200']);

  asked.length = 0;
  assert.equal(await findProductId(row, finders({}, { 100200: 6, 111: 7 })), 6);
  assert.deepEqual(asked, ['sku 100200', 'barcode 100200']);

  asked.length = 0;
  assert.equal(await findProductId(row, finders({}, { 222: 8 })), 8);
  assert.deepEqual(asked, ['sku 100200', 'barcode 100200', 'barcode 111', 'barcode 222']);

  asked.length = 0;
  assert.equal(await findProductId(row, finders({}, {})), null);
  assert.equal(asked.length, 4);

  asked.length = 0;
  const nothing = oldRow({ product_code: '', product_barcode: '' });
  assert.equal(await findProductId(nothing, finders({}, {})), null);
  assert.deepEqual(asked, []);
});

test('asks once per code, remembers «not found», and asks again after a failure', async () => {
  let calls = 0;
  const find = cachedPerCode(async (code) => {
    calls += 1;
    if (code === 'broken' && calls === 1) throw new Error('down');
    return code === 'known' ? 5 : null;
  });
  await assert.rejects(find('broken'));
  assert.equal(await find('broken'), null);
  assert.equal(await find('broken'), null);
  assert.equal(calls, 2);
  assert.equal(await find('known'), 5);
  assert.equal(await find('known'), 5);
  assert.equal(calls, 3);
});

test('a failure prints the status and stable codes, never the message', () => {
  const refused = Object.assign(new Error('POST /api/v1/barcodes/100200: HTTP 422 VALIDATION'), {
    status: 422,
    problem: {
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'qtyFloor', constraint: 'matches', message: 'a secret value' }],
    },
  });
  assert.equal(failureText(refused), 'HTTP 422 VALIDATION_FAILED');
  assert.deepEqual(failureFields(refused), ['qtyFloor/matches']);

  const bare = Object.assign(new Error('GET /x?q=100200'), { status: 403 });
  assert.equal(failureText(bare), 'HTTP 403');
  assert.deepEqual(failureFields(bare), []);

  assert.equal(failureText(new Error('sign-in failed: HTTP 401')), 'sign-in failed: HTTP 401');
  assert.equal(failureText(new SyntaxError('quotes "a name"')), 'no usable answer from the api');
});
