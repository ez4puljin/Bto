#!/usr/bin/env node
// Converts Erkhet's partner list into Bto's CUSTOMERS sheet (ADR-0107):
//   node tools/migration/erkhet-customers.mjs --in <Харилцагч.xlsx> --out tmp/erkhet-customers/<day>
//     [--map tools/migration/erkhet-customers-map.json] [--taken <codes.txt>]
// Writes customers.xlsx (the import template's headers), categories.json (in order), report.xlsx
// (rows left out, reassigned codes, notes) and summary.json. Prints counts only: the list is real
// business data and stays in the gitignored tmp/ (never in git, docs or logs). An Erkhet group the
// map does not name stops the run; ask the owner and add it to the map.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { convertRow, planCategories, reassignCodes } from './erkhet-customers-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.in || !args.out) {
  console.error('usage: erkhet-customers.mjs --in <partners.xlsx> --out <dir under tmp/>');
  process.exit(1);
}
const map = JSON.parse(readFileSync(args.map ?? join(HERE, 'erkhet-customers-map.json'), 'utf8'));
const labels = JSON.parse(readFileSync(join(ROOT, 'packages', 'shared', 'i18n', 'mn.json'), 'utf8'))
  .imports.columns.CUSTOMERS;
const taken = args.taken
  ? readFileSync(resolve(args.taken), 'utf8').split(/\s+/).filter(Boolean)
  : [];
const out = resolve(args.out);
mkdirSync(out, { recursive: true });

const COLUMNS = {
  code: 'Код',
  name: 'Нэр',
  groupCode: 'Бүлэг код',
  groupName: 'Бүлэг нэр',
  email: 'мэйл',
  address: 'Хаяг',
  phone: 'Утас',
  bank: 'Банк',
  bankAccount: 'Банк дахь данс',
};
const KEYS = [
  'code',
  'name',
  'kind',
  'category',
  'phone',
  'address',
  'contactPhone',
  'settlementGroup',
  'note',
];
const TEXT_KEYS = ['code', 'phone', 'contactPhone'];

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    if ('text' in value && value.text !== undefined) return String(value.text).trim();
    if ('result' in value) return String(value.result ?? '').trim();
  }
  return String(value).trim();
}

async function readList() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(args.in));
  const sheet = workbook.getWorksheet(map.sheet);
  if (!sheet) throw new Error(`no sheet «${map.sheet}»`);
  const header = sheet
    .getRow(1)
    .values.slice(1)
    .map((value) => String(value ?? '').trim());
  const at = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => {
      const index = header.indexOf(name);
      if (index < 0) throw new Error(`no column «${name}»`);
      return [key, index + 1];
    }),
  );
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const entry = { rowNo: number };
    for (const [key, col] of Object.entries(at)) entry[key] = cellText(row.getCell(col));
    if (entry.code || entry.name) rows.push(entry);
  });
  return rows;
}

const tally = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const source = await readList();
const namesOfGroups = new Map(source.map((row) => [row.groupCode, row.groupName]));
const unknown = [...namesOfGroups.keys()].filter(
  (code) => !map.groups.some((group) => group.code === code),
);
if (unknown.length > 0) {
  console.error(
    `unknown Erkhet groups (ask the owner, then add them to the map): ${unknown.length}`,
  );
  writeFileSync(join(out, 'unknown-groups.json'), JSON.stringify(unknown, null, 2));
  process.exit(2);
}
const { categories, groups } = planCategories(map, namesOfGroups);

const kept = [];
const skipped = [];
const refused = [];
const flags = {};
for (const row of source) {
  const result = convertRow(row, groups.get(row.groupCode));
  if (result.skip) skipped.push({ ...row, reason: result.skip });
  else if (result.error) refused.push({ ...row, reason: result.error });
  else {
    for (const flag of result.flags) tally(flags, flag);
    kept.push({ source: row, row: result.row, flags: result.flags });
  }
}
const reassigned = reassignCodes(
  kept.map(({ row }) => row),
  taken,
);
for (const [index, { code }] of reassigned) kept[index].row.code = code;
const codes = new Map();
for (const { row } of kept) codes.set(row.code, (codes.get(row.code) ?? 0) + 1);
const repeated = [...codes].filter(([, count]) => count > 1).length;
if (refused.length > 0 || repeated > 0) {
  console.error(`refused rows: ${refused.length}, repeated codes: ${repeated}`);
}

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Харилцагч');
sheet.addRow(KEYS.map((key) => labels[key]));
KEYS.forEach((key, i) => {
  if (TEXT_KEYS.includes(key)) sheet.getColumn(i + 1).numFmt = '@';
});
for (const { row } of kept) sheet.addRow(KEYS.map((key) => row[key] ?? ''));
await workbook.xlsx.writeFile(join(out, 'customers.xlsx'));
writeFileSync(join(out, 'categories.json'), `${JSON.stringify(categories, null, 2)}\n`);

const report = new ExcelJS.Workbook();
const addSheet = (name, header, rows) => {
  const page = report.addWorksheet(name);
  page.addRow(header);
  for (const values of rows) page.addRow(values);
};
addSheet(
  'Оруулаагүй',
  ['Мөр', 'Код', 'Нэр', 'Бүлэг код', 'Бүлэг нэр', 'Шалтгаан'],
  [...skipped, ...refused].map((row) => [
    row.rowNo,
    row.code,
    row.name,
    row.groupCode,
    row.groupName,
    row.reason,
  ]),
);
addSheet(
  'Код сольсон',
  ['Мөр', 'Эрхэт код', 'Шинэ код', 'Нэр'],
  [...reassigned].map(([index, { code, from }]) => [
    kept[index].source.rowNo,
    from,
    code,
    kept[index].row.name,
  ]),
);
addSheet(
  'Тэмдэглэлтэй',
  ['Мөр', 'Код', 'Нэр', 'Тэмдэглэл', 'Тэмдэг'],
  kept
    .filter(({ row }) => row.note)
    .map(({ source: from, row, flags: marks }) => [
      from.rowNo,
      row.code,
      row.name,
      row.note,
      marks.join(' '),
    ]),
);
await report.xlsx.writeFile(join(out, 'report.xlsx'));

const by = (list, pick) => {
  const counts = {};
  for (const item of list) tally(counts, pick(item));
  return counts;
};
const summary = {
  rows: source.length,
  kept: kept.length,
  skipped: by(skipped, (row) => row.reason),
  refused: by(refused, (row) => row.reason),
  repeatedCodes: repeated,
  categories: categories.length,
  perCategory: by(kept, ({ row }) => row.category),
  perSettlement: by(kept, ({ row }) => row.settlementGroup),
  perKind: by(kept, ({ row }) => row.kind),
  withPhone: kept.filter(({ row }) => row.phone).length,
  withContactPhone: kept.filter(({ row }) => row.contactPhone).length,
  withAddress: kept.filter(({ row }) => row.address).length,
  withNote: kept.filter(({ row }) => row.note).length,
  codesReassigned: reassigned.size,
  flags,
};
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `rows ${summary.rows}, kept ${summary.kept}, skipped ${JSON.stringify(summary.skipped)}, ` +
    `refused ${refused.length}, categories ${summary.categories}, settlement ${JSON.stringify(summary.perSettlement)}, ` +
    `kind ${JSON.stringify(summary.perKind)}, codes reassigned ${summary.codesReassigned}, flags ${JSON.stringify(flags)}`,
);
if (refused.length > 0 || repeated > 0) process.exit(2);
