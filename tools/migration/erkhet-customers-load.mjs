#!/usr/bin/env node
// Loads the converted Erkhet customers into a running local Bto (ADR-0107), idempotently:
//   node tools/migration/erkhet-customers-load.mjs --dir tmp/erkhet-customers/<day> --user <admin>
//     [--logins tmp/dev-logins.txt] [--api http://localhost:3300] [--only categories|CUSTOMERS]
// Creates the categories of categories.json that are missing (by name, in order), then runs
// customers.xlsx through Bto's CUSTOMERS import (upload, validate, commit). A file a committed
// import already took is skipped. Prints counts only; a refused file's problems go to
// <dir>/CUSTOMERS-errors.json.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { BtoApi, readLogin, runSheetImport } from './bto-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.dir || !args.user) {
  console.error('usage: erkhet-customers-load.mjs --dir <converted dir> --user <admin>');
  process.exit(1);
}
const dir = resolve(args.dir);
const api = new BtoApi({
  base: args.api ?? 'http://localhost:3300',
  user: args.user,
  password: readLogin(resolve(args.logins ?? join(ROOT, 'tmp', 'dev-logins.txt')), args.user),
});
const wants = (step) => !args.only || args.only === step;

async function categories() {
  const wanted = JSON.parse(readFileSync(join(dir, 'categories.json'), 'utf8'));
  const existing = new Map(
    (await api.get('/api/v1/customer-categories')).map((category) => [
      nameKey(normalizeName(category.name)),
      category,
    ]),
  );
  let created = 0;
  let retired = 0;
  for (const { name, sortOrder } of wanted) {
    const found = existing.get(nameKey(normalizeName(name)));
    if (found) {
      if (!found.active) retired += 1;
      continue;
    }
    await api.call(
      'POST',
      '/api/v1/customer-categories',
      { name, sortOrder },
      { idempotent: true },
    );
    created += 1;
  }
  console.log(
    `categories: ${created} created, ${wanted.length - created} already there` +
      (retired ? `, ${retired} of them retired (the import refuses those rows)` : ''),
  );
}

if (wants('categories')) await categories();
if (wants('CUSTOMERS')) await runSheetImport(api, dir, 'CUSTOMERS', 'customers.xlsx');
