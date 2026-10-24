// The Erkhet customer conversion rules (ADR-0107) on synthetic rows only: never the owner's data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  convertRow,
  placeEmailCell,
  planCategories,
  reassignCodes,
  splitPhones,
} from './erkhet-customers-rules.mjs';

test('splits a phone cell into mobile numbers and what is left', () => {
  assert.deepEqual(splitPhones('99112233'), { phones: ['+97699112233'], rest: null });
  assert.deepEqual(splitPhones('99112233, 88112233,'), {
    phones: ['+97699112233', '+97688112233'],
    rest: null,
  });
  assert.deepEqual(splitPhones('99112233   88112233.99112233'), {
    phones: ['+97699112233', '+97688112233'],
    rest: null,
  });
  assert.deepEqual(splitPhones('99112233,/3812345/,'), {
    phones: ['+97699112233'],
    rest: '3812345',
  });
  assert.deepEqual(splitPhones('/99112233 88112233 Болд/'), {
    phones: ['+97699112233', '+97688112233'],
    rest: 'Болд',
  });
  assert.deepEqual(splitPhones(''), { phones: [], rest: null });
  assert.deepEqual(splitPhones(null), { phones: [], rest: null });
});

test('places the «мэйл» cell by what it holds', () => {
  assert.deepEqual(placeEmailCell('shop@example.mn'), { kind: 'EMAIL', value: 'shop@example.mn' });
  assert.deepEqual(placeEmailCell('99112233'), { kind: 'PHONE', value: ['+97699112233'] });
  assert.deepEqual(placeEmailCell('3812345'), { kind: 'NUMBER', value: '3812345' });
  assert.deepEqual(placeEmailCell('5-р баг, 2-р гудамж'), {
    kind: 'TEXT',
    value: '5-р баг, 2-р гудамж',
  });
  assert.equal(placeEmailCell('  '), null);
});

test('gives a code with letters the next free code of its category', () => {
  const rows = [
    { code: '50101', category: 'А' },
    { code: '50105', category: 'А' },
    { code: '50106', category: 'Б' },
    { code: '50107', category: 'Б' },
    { code: '5010A', category: 'А' },
    { code: '7X', category: 'В' },
  ];
  const changed = reassignCodes(rows);
  assert.deepEqual(changed.get(4), { code: '50108', from: '5010A' });
  // A category without digit codes takes the next code of all rows.
  assert.deepEqual(changed.get(5), { code: '50109', from: '7X' });
  assert.equal(changed.size, 2);
  assert.deepEqual(reassignCodes([{ code: 'A', category: 'А' }], ['1']).get(0), {
    code: '2',
    from: 'A',
  });
});

const group = { settlement: 'DAY_20', category: '1-р хороо' };

test('converts a row: second phone to the contact, the rest to the note', () => {
  const result = convertRow(
    {
      code: '50101',
      name: '  Дэлгүүр  Од ',
      phone: '99112233, 88112233, 95112233',
      email: 'shop@example.mn',
      address: '1-р хороо',
      bank: 'Банк',
      bankAccount: '123456',
    },
    group,
  );
  assert.deepEqual(result.row, {
    code: '50101',
    name: 'Дэлгүүр Од',
    kind: 'Байгууллага',
    category: '1-р хороо',
    phone: '+97699112233',
    address: '1-р хороо',
    contactPhone: '+97688112233',
    settlementGroup: 'Мөрөн',
    note: 'Нэмэлт утас: +97695112233; И-мэйл: shop@example.mn; Данс: Банк 123456',
  });
  assert.deepEqual(result.flags, ['EXTRA_PHONES', 'EMAIL_EMAIL', 'BANK']);
});

test('fills the phone or the address from the «мэйл» cell when they are empty', () => {
  const individual = { settlement: 'MONTH_END', kind: 'INDIVIDUAL', category: 'Сум' };
  const byPhone = convertRow({ code: '20101', name: 'Бат', email: '99112233' }, individual);
  assert.equal(byPhone.row.phone, '+97699112233');
  assert.equal(byPhone.row.kind, 'Хувь хүн');
  assert.equal(byPhone.row.settlementGroup, 'Орон нутаг');
  const second = convertRow(
    { code: '20102', name: 'Дорж', phone: '88112233', email: '99112233' },
    individual,
  );
  assert.equal(second.row.contactPhone, '+97699112233');
  const byText = convertRow({ code: '20103', name: 'Цэцэг', email: '3-р баг' }, individual);
  assert.equal(byText.row.address, '3-р баг');
  const kept = convertRow(
    { code: '20104', name: 'Сүх', address: 'Төв', email: '3-р баг' },
    individual,
  );
  assert.equal(kept.row.address, 'Төв');
  assert.equal(kept.row.note, 'Эрхэт мэйл: 3-р баг');
});

test('notes a reassigned code; skips and refuses by the map', () => {
  const result = convertRow({ code: '5010A', name: 'Дэлгүүр' }, group);
  assert.equal(result.row.note, 'Эрхэт код: 5010A');
  assert.deepEqual(result.flags, ['CODE_REASSIGNED']);
  assert.deepEqual(convertRow({ code: '1', name: 'X' }, { skip: 'KHARKHORIN' }), {
    skip: 'KHARKHORIN',
  });
  assert.deepEqual(convertRow({ code: '1', name: 'X' }, undefined), { error: 'UNKNOWN_GROUP' });
  assert.deepEqual(convertRow({ code: '1', name: ' ' }, group), { error: 'NO_NAME' });
});

test('plans categories in the map order, sharing one name', () => {
  const map = {
    groups: [
      { code: '511', settlement: 'DAY_20' },
      { code: '511 {2}', settlement: 'DAY_20' },
      { code: '201', settlement: 'MONTH_END', category: 'Алаг' },
      { code: '84', skip: 'KHARKHORIN' },
    ],
  };
  const names = new Map([
    ['511', '11-р хороо'],
    ['511 {2}', '11-р  хороо'],
    ['201', 'Алаг-Эрдэнэ'],
  ]);
  const planned = planCategories(map, names);
  assert.deepEqual(
    planned.categories.map(({ name, sortOrder }) => [name, sortOrder]),
    [
      ['11-р хороо', 10],
      ['Алаг', 20],
    ],
  );
  assert.equal(planned.groups.get('511 {2}').category, '11-р хороо');
  assert.deepEqual(planned.groups.get('84'), { skip: 'KHARKHORIN' });
  assert.throws(() => planCategories({ groups: [{ code: '1', settlement: 'X' }] }, names));
});
