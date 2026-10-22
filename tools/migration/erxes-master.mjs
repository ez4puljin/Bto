#!/usr/bin/env node
// Converts the Erxes product master export into Bto's import sheets (ADR-0098):
//   node tools/migration/erxes-master.mjs --in <master.xlsx> --out tmp/erxes/<day>
// Writes suppliers.xlsx, products.xlsx, prices.xlsx (the import templates' headers), categories.json,
// images.json, report.xlsx (everything left out and why) and summary.json. Prints counts only: the
// export is real business data and stays in the gitignored tmp/ (never in git, docs or logs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decimal } from '@tugeel/shared/money';
import { SKU_PATTERN, WEIGHT_PATTERN } from '@tugeel/shared/catalog';
import { IMPORT_LIMITS } from '@tugeel/shared/imports';
import ExcelJS from 'exceljs';
import {
  fitCell,
  homeOf,
  placeCategory,
  planBarcodes,
  planSuppliers,
  reassignCodes,
  splitBarcodes,
} from './erxes-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.in || !args.out) {
  console.error(
    'usage: erxes-master.mjs --in <master.xlsx> --out <dir under tmp/> [--map <map.json>]',
  );
  process.exit(1);
}
const map = JSON.parse(readFileSync(args.map ?? join(HERE, 'erxes-map.json'), 'utf8'));
const labels = JSON.parse(readFileSync(join(ROOT, 'packages', 'shared', 'i18n', 'mn.json'), 'utf8'))
  .imports.columns;
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && value.text !== undefined) return String(value.text).trim();
    if ('richText' in value)
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if ('hyperlink' in value) return String(value.hyperlink).trim();
    if (value instanceof Date) return value.toISOString();
  }
  return String(value).trim();
}

async function readMaster() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(args.in));
  const sheet = workbook.getWorksheet(map.sheet);
  if (!sheet) throw new Error(`no sheet «${map.sheet}»`);
  const header = sheet
    .getRow(1)
    .values.slice(1)
    .map((value) => String(value ?? '').trim());
  const at = (name) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`no column «${name}»`);
    return index + 1;
  };
  const columns = {
    sku: at('Код'),
    name: at('Нэр'),
    category: at('Ангилал нэр'),
    price: at('Нэгж үнэ'),
    weight: at('Жин'),
    box: at('Хайрцагны тоо'),
    brandCode: at('Брэнд код'),
    brandName: at('Брэнд нэр'),
    barcodes: at('Баркод'),
    image: at('imageUrl'),
    tag: at('Байршил tag'),
  };
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const entry = { row: number };
    for (const [key, col] of Object.entries(columns)) entry[key] = cellText(row.getCell(col));
    if (entry.sku || entry.name) rows.push(entry);
  });
  return rows;
}

function sheetOf(workbook, name, kind, keys, rows, textKeys) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(keys.map((key) => labels[kind][key]));
  keys.forEach((key, i) => {
    if (textKeys.includes(key)) sheet.getColumn(i + 1).numFmt = '@';
  });
  for (const row of rows) sheet.addRow(keys.map((key) => row[key] ?? ''));
  return sheet;
}

function reportSheet(workbook, name, header, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row);
}

const count = (list, key) =>
  list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {});

const master = await readMaster();
const skipped = [];
const placed = [];
const seenSku = new Set();
for (const row of master) {
  const place = placeCategory(row.category, map);
  if (place.skip) {
    skipped.push([row.sku, row.name, row.category, 'SKIPPED_CATEGORY']);
    continue;
  }
  if (place.error) throw new Error(`row ${row.row}: ${place.error} (fix erxes-map.json)`);
  if (seenSku.has(row.sku)) throw new Error(`row ${row.row}: the code repeats`);
  seenSku.add(row.sku);
  placed.push({ ...row, place });
}

// Codes: digits only; numeric codes may not clash by value either («010» and «10»).
const byValue = new Map();
for (const row of placed) {
  if (!SKU_PATTERN.test(row.sku)) continue;
  const value = BigInt(row.sku).toString();
  if (byValue.has(value))
    throw new Error(`row ${row.row}: the code clashes with ${byValue.get(value)} by value`);
  byValue.set(value, row.sku);
}
const renamed = reassignCodes(placed, map);

// Categories: the tree with ranges (the group's own range only when one of its children is numbered).
const categories = new Map();
for (const row of placed) {
  const [top, sub] = row.place.path;
  if (!categories.has(top))
    categories.set(top, { name: top, parent: null, skuFrom: null, skuTo: null });
  const digit = Object.entries(map.topGroups).find(([, name]) => name === top)?.[0];
  if (row.place.range && digit) {
    const own = categories.get(top);
    own.skuFrom = `${digit}00000`;
    own.skuTo = `${digit}99999`;
  }
  if (sub) {
    const key = `${top}\u0000${sub}`;
    if (!categories.has(key)) {
      categories.set(key, {
        name: sub,
        parent: top,
        skuFrom: row.place.range ? row.place.range.from.toString() : null,
        skuTo: row.place.range ? row.place.range.to.toString() : null,
      });
    }
  }
}

// Barcodes: the cell's codes plus the old code of a renamed product (the owner's answer).
const barcodePlan = planBarcodes(
  placed.map((row) => ({
    sku: row.sku,
    codes: [...splitBarcodes(row.barcodes), ...(renamed.has(row.sku) ? [row.sku] : [])],
  })),
);

const suppliersPlan = planSuppliers(
  placed.map((row) => ({ code: row.brandCode, name: row.brandName })),
);

const products = [];
const prices = [];
const images = [];
const problems = [];
const homeless = [];
const overflow = [];
for (const row of placed) {
  const sku = renamed.get(row.sku) ?? row.sku;
  const home = homeOf(row.tag, map);
  if (home.error)
    throw new Error(`row ${row.row}: ${home.error} «${home.tag}» (fix erxes-map.json)`);
  if (!home.code) homeless.push([sku, row.name]);
  let weightKg = '';
  if (row.weight) {
    const weight = new Decimal(row.weight).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (weight.gt(0) && WEIGHT_PATTERN.test(weight.toFixed())) weightKg = weight.toFixed();
    else problems.push([sku, row.name, 'weight', row.weight, 'WEIGHT_LEFT_OUT']);
  }
  let boxQty = '';
  if (row.box) {
    if (/^\d+$/.test(row.box) && BigInt(row.box) > 1n && BigInt(row.box) <= 100000n)
      boxQty = row.box;
    else if (!['0', '1'].includes(row.box))
      problems.push([sku, row.name, 'box', row.box, 'BOX_LEFT_OUT']);
  }
  const name = row.name.length > 200 ? row.name.slice(0, 200) : row.name;
  if (name !== row.name) problems.push([sku, row.name, 'name', '', 'NAME_CUT_TO_200']);
  const barcodes = fitCell(barcodePlan.kept.get(row.sku), IMPORT_LIMITS.maxCellLength);
  if (barcodes.rest.length > 0) overflow.push({ sku, codes: barcodes.rest });
  products.push({
    sku,
    name,
    category: row.place.path.join(' / '),
    barcodes: barcodes.cell,
    boxQty,
    weightKg,
    homeWarehouse: home.code ?? '',
    supplier: row.brandCode && /^[0-9]{1,20}$/.test(row.brandCode) ? row.brandCode : '',
  });
  if (/^\d+$/.test(row.price) && BigInt(row.price) > 0n) {
    prices.push({
      sku,
      warehousePrice: row.price,
      profile: map.priceProfile.name,
      wholePack: boxQty ? map.boxUnitName : '',
    });
  }
  if (/^https?:\/\//.test(row.image)) images.push({ sku, url: row.image });
}

const templates = new ExcelJS.Workbook();
sheetOf(templates, 'Нийлүүлэгч', 'SUPPLIERS', ['code', 'name'], suppliersPlan.suppliers, ['code']);
await templates.xlsx.writeFile(join(out, 'suppliers.xlsx'));
const productBook = new ExcelJS.Workbook();
sheetOf(
  productBook,
  'Бараа',
  'PRODUCTS',
  ['sku', 'name', 'category', 'barcodes', 'boxQty', 'weightKg', 'homeWarehouse', 'supplier'],
  products,
  ['sku', 'barcodes', 'supplier'],
);
await productBook.xlsx.writeFile(join(out, 'products.xlsx'));
const priceBook = new ExcelJS.Workbook();
sheetOf(priceBook, 'Үнэ', 'PRICES', ['sku', 'warehousePrice', 'profile', 'wholePack'], prices, [
  'sku',
]);
await priceBook.xlsx.writeFile(join(out, 'prices.xlsx'));
writeFileSync(join(out, 'categories.json'), JSON.stringify([...categories.values()], null, 2));
writeFileSync(join(out, 'images.json'), JSON.stringify(images));
writeFileSync(join(out, 'overflow-barcodes.json'), JSON.stringify(overflow));

const report = new ExcelJS.Workbook();
reportSheet(
  report,
  'Давхцсан баркод',
  ['Баркод', 'Бараанууд (Bto код)', 'Нэрс'],
  barcodePlan.shared.map(({ code, skus }) => {
    const rows = skus.map((old) => placed.find((row) => row.sku === old));
    return [
      code,
      rows.map((row) => renamed.get(row.sku) ?? row.sku).join(', '),
      rows.map((row) => row.name).join(' | '),
    ];
  }),
);
reportSheet(
  report,
  'Хасагдсан баркод',
  ['Bto код', 'Баркод', 'Шалтгаан'],
  barcodePlan.dropped.map(({ sku, code, reason }) => [renamed.get(sku) ?? sku, code, reason]),
);
reportSheet(
  report,
  'Шинэ код',
  ['Erxes код', 'Bto код', 'Нэр', 'Ангилал'],
  [...renamed].map(([old, sku]) => {
    const row = placed.find((entry) => entry.sku === old);
    return [old, sku, row.name, row.place.path.join(' / ')];
  }),
);
reportSheet(report, 'Харьяагүй', ['Bto код', 'Нэр'], homeless);
reportSheet(report, 'Алгассан мөр', ['Erxes код', 'Нэр', 'Ангилал', 'Шалтгаан'], skipped);
reportSheet(report, 'Бусад', ['Bto код', 'Нэр', 'Талбар', 'Утга', 'Шалтгаан'], problems);
reportSheet(
  report,
  'Нийлүүлэгч',
  ['Код', 'Нэр', 'Шалтгаан'],
  suppliersPlan.problems.map(({ code, name, reason }) => [code, name, reason]),
);
await report.xlsx.writeFile(join(out, 'report.xlsx'));

const summary = {
  masterRows: master.length,
  skippedRows: skipped.length,
  products: products.length,
  categories: categories.size,
  topGroups: [...categories.values()].filter((c) => c.parent === null).length,
  suppliers: suppliersPlan.suppliers.length,
  supplierProblems: count(suppliersPlan.problems, 'reason'),
  productsWithSupplier: products.filter((p) => p.supplier).length,
  renamedCodes: renamed.size,
  barcodesAfterImport: overflow.reduce((n, entry) => n + entry.codes.length, 0),
  barcodesKept: [...barcodePlan.kept.values()].reduce((n, list) => n + list.length, 0),
  barcodesShared: barcodePlan.shared.length,
  productsLosingShared: new Set(barcodePlan.shared.flatMap((s) => s.skus)).size,
  barcodesDropped: count(barcodePlan.dropped, 'reason'),
  withBox: products.filter((p) => p.boxQty).length,
  homeless: homeless.length,
  byHome: count(products, 'homeWarehouse'),
  priced: prices.length,
  waitingForPrice: products.length - prices.length,
  images: images.length,
  otherProblems: problems.length,
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
