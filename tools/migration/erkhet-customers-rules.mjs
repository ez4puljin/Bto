// The pure rules of the Erkhet customer conversion (ADR-0107): phones, the «мэйл» cell, codes and
// one row into the CUSTOMERS sheet. No I/O here, so `erkhet-customers-rules.test.mjs` proves them on
// synthetic rows.
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { nameKey, normalizeName } from '@tugeel/shared/text';

const DIGITS = /^[0-9]{1,20}$/;
/** Eight digits not touching other digits: a mobile number written among others. */
const EIGHT = /(?<![0-9])[0-9]{8}(?![0-9])/g;
const SETTLEMENT_LABELS = { DAY_20: 'Мөрөн', MONTH_END: 'Орон нутаг' };
const KIND_LABELS = { COMPANY: 'Байгууллага', INDIVIDUAL: 'Хувь хүн' };
const NOTE_MAX = 1_000;
const ADDRESS_MAX = 300;

/** The cell's text, trimmed; a missing cell is ''. */
const clean = (value) => String(value ?? '').trim();

/**
 * The mobile numbers of a phone cell (E.164, in order, without repeats) and what is left of it
 * once they and their separators are taken out (a landline, a name): null when nothing is.
 */
export function splitPhones(cell) {
  const text = clean(cell);
  const phones = [];
  let rest = text;
  for (const match of text.matchAll(EIGHT)) {
    const phone = normalizeMnPhone(match[0]);
    if (phone === null) continue;
    if (!phones.includes(phone)) phones.push(phone);
    rest = rest.replace(match[0], ' ');
  }
  rest = rest.replace(/^[\s,.;/()-]+|[\s,.;/()-]+$/g, '').replace(/\s{2,}/g, ' ');
  // Only separators between the numbers: nothing worth keeping.
  if (/^[\s,.;/()-]*$/.test(rest)) rest = '';
  return { phones, rest: rest === '' ? null : rest };
}

/**
 * Where a «мэйл» cell belongs (owner 2026-10-24): an e-mail, a mobile number, a 7-digit number or
 * other text (an address).
 */
export function placeEmailCell(cell) {
  const text = clean(cell);
  if (text === '') return null;
  if (text.includes('@')) return { kind: 'EMAIL', value: text };
  const phones = splitPhones(text);
  if (phones.phones.length > 0 && phones.rest === null)
    return { kind: 'PHONE', value: phones.phones };
  if (/^[0-9\s-]+$/.test(text)) return { kind: 'NUMBER', value: text };
  return { kind: 'TEXT', value: text };
}

/**
 * The codes of the converted rows: digits stay as written; any other code gets the next free code
 * of its category (its largest digit code + 1, same width, stepping over taken codes), else of all
 * rows (owner 2026-10-24). Returns Map(index → { code, from }) for the reassigned ones.
 */
export function reassignCodes(rows, taken = []) {
  const used = new Set([
    ...taken,
    ...rows.map((row) => row.code).filter((code) => DIGITS.test(code)),
  ]);
  const largest = (codes) =>
    codes.reduce(
      (best, code) =>
        best === null || code.length > best.length || (code.length === best.length && code > best)
          ? code
          : best,
      null,
    );
  const after = (code) => {
    let value = BigInt(code) + 1n;
    const text = () => value.toString().padStart(code.length, '0');
    while (used.has(text())) value += 1n;
    return text();
  };
  const changed = new Map();
  rows.forEach((row, index) => {
    if (DIGITS.test(row.code)) return;
    const own = rows
      .filter((other) => other.category === row.category && DIGITS.test(other.code))
      .map((other) => other.code);
    const base = largest(own) ?? largest([...used]) ?? '0';
    const code = after(base);
    used.add(code);
    changed.set(index, { code, from: row.code });
  });
  return changed;
}

/**
 * One Erkhet row into a CUSTOMERS sheet row, or why it is left out. `group` is the map's entry of
 * the row's group code (undefined: an unknown group, which stops the run).
 * Returns { skip } | { error } | { row, notes: string[], flags: string[] }.
 */
export function convertRow(source, group) {
  if (!group) return { error: 'UNKNOWN_GROUP' };
  if (group.skip) return { skip: group.skip };
  const notes = [];
  const flags = [];
  const name = normalizeName(clean(source.name));
  if (name === '') return { error: 'NO_NAME' };
  const code = clean(source.code);
  if (!DIGITS.test(code)) {
    notes.push(`Эрхэт код: ${code}`);
    flags.push('CODE_REASSIGNED');
  }
  let address = clean(source.address);
  const phoneCell = splitPhones(source.phone);
  let [phone = null, contactPhone = null, ...more] = phoneCell.phones;
  if (more.length > 0) {
    notes.push(`Нэмэлт утас: ${more.join(', ')}`);
    flags.push('EXTRA_PHONES');
  }
  if (phoneCell.rest !== null) {
    notes.push(`Эрхэт утас: ${phoneCell.rest}`);
    flags.push('PHONE_TEXT');
  }
  const email = placeEmailCell(source.email);
  if (email) {
    flags.push(`EMAIL_${email.kind}`);
    if (email.kind === 'PHONE') {
      for (const value of email.value) {
        if (value === phone || value === contactPhone) continue;
        if (phone === null) phone = value;
        else if (contactPhone === null) contactPhone = value;
        else notes.push(`Нэмэлт утас: ${value}`);
      }
    } else if (email.kind === 'TEXT' && address === '') {
      address = email.value;
    } else if (email.kind === 'EMAIL') {
      notes.push(`И-мэйл: ${email.value}`);
    } else {
      notes.push(`Эрхэт мэйл: ${email.value}`);
    }
  }
  const bank = [clean(source.bank), clean(source.bankAccount)].filter(Boolean).join(' ');
  if (bank) {
    notes.push(`Данс: ${bank}`);
    flags.push('BANK');
  }
  if (address.length > ADDRESS_MAX) {
    notes.push(`Хаяг: ${address}`);
    address = address.slice(0, ADDRESS_MAX).trim();
    flags.push('ADDRESS_CUT');
  }
  let note = notes.join('; ');
  if (note.length > NOTE_MAX) {
    note = note.slice(0, NOTE_MAX).trim();
    flags.push('NOTE_CUT');
  }
  return {
    row: {
      code,
      name,
      kind: KIND_LABELS[group.kind ?? 'COMPANY'],
      category: group.category,
      phone: phone ?? '',
      address,
      contactPhone: contactPhone ?? '',
      settlementGroup: SETTLEMENT_LABELS[group.settlement],
      note,
    },
    flags,
  };
}

/**
 * The categories of the kept groups in the map's order: a group takes its Erkhet name (or the
 * map's `category`), and groups whose names fold to one key share the first one's category.
 * Returns { categories: [{ name, sortOrder }], groups: Map(code → entry with `category`) }.
 */
export function planCategories(map, namesOfGroups) {
  const categories = [];
  const byKey = new Map();
  const groups = new Map();
  // An array, not an object: JSON objects put integer-like keys ("501") first, losing the order.
  for (const { code, ...entry } of map.groups) {
    if (entry.skip) {
      groups.set(code, entry);
      continue;
    }
    if (!SETTLEMENT_LABELS[entry.settlement]) throw new Error(`group ${code}: settlement`);
    if (entry.kind && !KIND_LABELS[entry.kind]) throw new Error(`group ${code}: kind`);
    const name = normalizeName(entry.category ?? namesOfGroups.get(code) ?? '');
    if (name === '' || name.length > 80) throw new Error(`group ${code}: category name`);
    const key = nameKey(name);
    if (!byKey.has(key)) {
      byKey.set(key, name);
      categories.push({ name, sortOrder: (categories.length + 1) * 10 });
    }
    groups.set(code, { ...entry, category: byKey.get(key) });
  }
  return { categories, groups };
}
