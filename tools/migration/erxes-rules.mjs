// The pure rules of the Erxes product master conversion (ADR-0098): categories, codes, barcodes,
// suppliers. No I/O here, so `erxes-rules.test.mjs` proves them on synthetic rows.
import { lowestFree, SKU_PATTERN } from '@tugeel/shared/catalog';
import { classifyBarcode } from '@tugeel/shared/gtin';
import { nameKey } from '@tugeel/shared/text';

export const CATEGORY_SEPARATORS = /[/>»\\]/;
const NUMBERED = /^(\d)(\d{2})\b/;

/** The import importer's list split (`splitList` in `@tugeel/shared/imports`). */
export function splitBarcodes(cell) {
  return String(cell ?? '')
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Where an Erxes category goes: `{ path: [top, sub?], range }`, `{ skip: true }` or `{ error }`.
 * Numbered «101 Дарс виски» goes under its hundred's group with the range 101000–101999 and keeps
 * its number; «+Тамхи» is a top group without the «+»; the map's unnumbered names go under their
 * group; a product filed under a group's own name goes into the group's «Ангилаагүй».
 */
export function placeCategory(name, map) {
  const raw = String(name ?? '').trim();
  if (!raw) return { error: 'EMPTY_CATEGORY' };
  if (map.skipCategories.includes(raw)) return { skip: true };
  if (CATEGORY_SEPARATORS.test(raw)) return { error: 'SEPARATOR_IN_NAME' };
  const numbered = NUMBERED.exec(raw);
  if (numbered) {
    const top = map.topGroups[numbered[1]];
    if (!top) return { error: 'NO_TOP_GROUP' };
    const number = BigInt(`${numbered[1]}${numbered[2]}`);
    return { path: [top, raw], range: { from: number * 1000n, to: number * 1000n + 999n } };
  }
  if (raw.startsWith('+')) {
    const top = raw.slice(1).trim();
    return top ? { path: [top], range: null } : { error: 'EMPTY_CATEGORY' };
  }
  const into = map.unnumberedInto[raw];
  if (into) return { path: [map.topGroups[into], raw], range: null };
  const group = Object.entries(map.topGroups).find(([, top]) => nameKey(top) === nameKey(raw));
  if (group) return { path: [group[1], map.directInTopGroup], range: null };
  return { error: 'UNKNOWN_CATEGORY' };
}

/** The range of a hundred's top group: 100000–199999 for «1». */
export function topRange(digit) {
  const d = BigInt(digit);
  return { from: d * 100000n, to: d * 100000n + 99999n };
}

/**
 * New codes for SKUs Bto cannot keep (digits only, `SKU_PATTERN`): the lowest free code of the
 * category's own range, else of its group's range outside every subcategory's, else past the
 * highest code. `taken` holds every numeric code of the file (by value, so «010» and «10» clash).
 * Returns Map(old → new) in row order.
 */
export function reassignCodes(rows, map) {
  const taken = new Set();
  for (const row of rows) if (SKU_PATTERN.test(row.sku)) taken.add(BigInt(row.sku));
  const subRanges = new Map();
  for (const row of rows) {
    if (!row.place?.range) continue;
    const digit = row.place.range.from.toString().charAt(0);
    const list = subRanges.get(digit) ?? new Map();
    list.set(row.place.range.from, row.place.range);
    subRanges.set(digit, list);
  }
  const renamed = new Map();
  for (const row of rows) {
    if (SKU_PATTERN.test(row.sku) || renamed.has(row.sku)) continue;
    let code = null;
    const top = Object.entries(map.topGroups).find(([, name]) => name === row.place?.path?.[0]);
    if (row.place?.range) code = lowestFree(row.place.range, [], taken);
    if (code === null && top) {
      const holes = [...(subRanges.get(top[0])?.values() ?? [])].sort((a, b) =>
        a.from < b.from ? -1 : 1,
      );
      code = lowestFree(topRange(top[0]), holes, taken);
    }
    if (code === null)
      code = [...taken].reduce((max, value) => (value > max ? value : max), 0n) + 1n;
    taken.add(code);
    renamed.set(row.sku, code.toString());
  }
  return renamed;
}

/**
 * Each product's barcodes as Bto stores them: classified by `@tugeel/shared/gtin`, one per lookup
 * key, and none that another product also has (the owner's answer: shared ones are listed, not
 * guessed). Returns `{ kept: Map(sku → codes[]), dropped: [{ sku, code, reason }], shared: [{ key,
 * code, skus }] }`.
 */
export function planBarcodes(products) {
  const dropped = [];
  const owners = new Map();
  const perProduct = new Map();
  for (const { sku, codes } of products) {
    const keys = new Map();
    for (const code of codes) {
      const classified = classifyBarcode(code);
      if (!classified.ok) {
        dropped.push({ sku, code, reason: classified.problem });
        continue;
      }
      const { lookupKey } = classified.value;
      if (keys.has(lookupKey)) continue;
      keys.set(lookupKey, classified.value.code);
      const list = owners.get(lookupKey) ?? [];
      list.push(sku);
      owners.set(lookupKey, list);
    }
    perProduct.set(sku, keys);
  }
  const shared = [];
  for (const [key, skus] of owners) {
    if (skus.length < 2) continue;
    shared.push({ key, code: perProduct.get(skus[0]).get(key), skus });
    for (const sku of skus) perProduct.get(sku).delete(key);
  }
  const kept = new Map();
  for (const [sku, keys] of perProduct) kept.set(sku, [...keys.values()]);
  return { kept, dropped, shared };
}

/**
 * Suppliers from «Брэнд код» / «Брэнд нэр»: one per code; a name another code already uses gets
 * its code appended, since Bto's supplier names are unique. Returns `{ suppliers: [{ code, name }],
 * problems: [{ code, name, reason }] }`.
 */
export function planSuppliers(pairs) {
  const byCode = new Map();
  const problems = [];
  for (const { code, name } of pairs) {
    if (!code) continue;
    if (!/^[0-9]{1,20}$/.test(code)) {
      problems.push({ code, name, reason: 'CODE_FORMAT' });
      continue;
    }
    const clean = String(name ?? '').trim() || code;
    if (!byCode.has(code)) byCode.set(code, clean);
    else if (byCode.get(code) !== clean) problems.push({ code, name, reason: 'SEVERAL_NAMES' });
  }
  const usedKeys = new Set();
  const suppliers = [];
  for (const [code, name] of [...byCode].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let finalName = name;
    if (usedKeys.has(nameKey(name))) {
      finalName = `${name} (${code})`;
      problems.push({ code, name, reason: 'NAME_TAKEN' });
    }
    usedKeys.add(nameKey(finalName));
    suppliers.push({ code, name: finalName });
  }
  return { suppliers, problems };
}

/**
 * The barcodes that fit one import cell (`IMPORT_LIMITS.maxCellLength`, joined by ", ") and the rest,
 * which the loader adds through the api after the import.
 */
export function fitCell(codes, maxLength) {
  const fits = [];
  let length = 0;
  let index = 0;
  for (; index < codes.length; index += 1) {
    const next = length + (fits.length > 0 ? 2 : 0) + codes[index].length;
    if (next > maxLength) break;
    fits.push(codes[index]);
    length = next;
  }
  return { cell: fits.join(', '), rest: codes.slice(index) };
}

/** The home warehouse code of a «Байршил tag» cell: the first tag of a combination; null if empty. */
export function homeOf(tagCell, map) {
  const first = splitTags(tagCell)[0];
  if (!first) return { code: null };
  const warehouse = map.warehouses.find((w) => w.tag === first);
  return warehouse ? { code: warehouse.code } : { error: 'UNKNOWN_TAG', tag: first };
}

function splitTags(cell) {
  return String(cell ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
