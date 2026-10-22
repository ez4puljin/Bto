#!/usr/bin/env node
// Loads the converted Erxes master into a running local Bto (ADR-0098), idempotently:
//   node tools/migration/erxes-load.mjs --dir tmp/erxes/<day> --user <admin> [--logins tmp/dev-logins.txt]
//     [--api http://localhost:3300] [--only setup|categories|SUPPLIERS|PRODUCTS|overflow|PRICES]
// Creates what is missing of the branch, warehouses, settings, the price profile and the categories,
// then runs the SUPPLIERS, PRODUCTS and PRICES imports through Bto's own pipeline (upload, validate,
// commit), and adds the barcodes one import cell cannot hold through the api. An import whose file a committed import already took is skipped. Prints counts only; a
// refused file's problems go to <dir>/<kind>-errors.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { businessDate } from '@tugeel/shared/time';
import { BtoApi, readLogin } from './bto-api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg, i, all) => (arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.dir || !args.user) {
  console.error('usage: erxes-load.mjs --dir <converted dir> --user <admin> [--logins <file>]');
  process.exit(1);
}
const dir = resolve(args.dir);
const map = JSON.parse(readFileSync(args.map ?? join(HERE, 'erxes-map.json'), 'utf8'));
const api = new BtoApi({
  base: args.api ?? 'http://localhost:3300',
  user: args.user,
  password: readLogin(resolve(args.logins ?? join(ROOT, 'tmp', 'dev-logins.txt')), args.user),
});
const wants = (step) => !args.only || args.only === step;

async function setup() {
  const branches = (await api.get('/api/v1/branches')).data;
  let branch = branches.find((b) => b.code === map.branch.code);
  if (!branch) {
    branch = await api.call('POST', '/api/v1/branches', map.branch);
    console.log(`branch ${map.branch.code} created`);
  } else if (branch.name !== map.branch.name) {
    console.log(`branch ${map.branch.code} exists with another name; left as it is`);
  }
  const warehouses = (await api.get('/api/v1/warehouses')).data;
  const wanted = [
    ...map.warehouses.map((w) => ({ code: w.code, name: w.name, kind: 'WHOLESALE' })),
    { ...map.store, kind: 'STORE' },
  ];
  let created = 0;
  for (const w of wanted) {
    if (warehouses.some((have) => have.code === w.code)) continue;
    await api.call('POST', '/api/v1/warehouses', { ...w, branchId: branch.id });
    created += 1;
  }
  console.log(`warehouses: ${created} created, ${wanted.length - created} already there`);
  const settings = (await api.get('/api/v1/settings')).data;
  for (const [key, value] of Object.entries(map.settings)) {
    const current = settings.find((s) => s.key === key)?.current;
    if (current !== null && current !== undefined && String(current) === String(value)) continue;
    await api.call('POST', '/api/v1/settings', { key, value, effectiveFrom: businessDate() });
    console.log(`setting ${key} set`);
  }
  const profiles = await api.all('/api/v1/price-profiles');
  if (!profiles.some((p) => p.name === map.priceProfile.name)) {
    await api.call(
      'POST',
      '/api/v1/price-profiles',
      { ...map.priceProfile, validFrom: businessDate() },
      { idempotent: true },
    );
    console.log(`price profile «${map.priceProfile.name}» created`);
  }
}

async function categories() {
  const wanted = JSON.parse(readFileSync(join(dir, 'categories.json'), 'utf8'));
  const have = (await api.get('/api/v1/categories')).data;
  const idOf = (name, parentId) =>
    have.find((c) => c.name === name && (c.parentId ?? null) === parentId)?.id;
  let created = 0;
  for (const level of [false, true]) {
    for (const category of wanted.filter((c) => (c.parent !== null) === level)) {
      const parentId = category.parent === null ? null : idOf(category.parent, null);
      if (category.parent !== null && !parentId) throw new Error(`no parent ${category.parent}`);
      if (idOf(category.name, parentId)) continue;
      const row = await api.call('POST', '/api/v1/categories', {
        parentId,
        name: category.name,
        ...(category.skuFrom ? { skuFrom: category.skuFrom, skuTo: category.skuTo } : {}),
      });
      have.push(row);
      created += 1;
    }
  }
  console.log(`categories: ${created} created, ${wanted.length - created} already there`);
}

/** Polls the job until `finished(job)` or FAILED. */
async function waitFor(id, finished) {
  for (;;) {
    const job = await api.get(`/api/v1/imports/${id}`);
    if (finished(job) || job.status === 'FAILED') return job;
    await sleep(2_000);
  }
}

async function runImport(kind, file) {
  const fileName = `${basename(dir)}-${file}`;
  const history = await api.all('/api/v1/imports');
  const taken = (job) =>
    job.kind === kind && job.fileName === fileName && job.status === 'COMMITTED';
  if (history.some(taken)) {
    console.log(`${kind}: ${fileName} already committed; skipped`);
    return;
  }
  const bytes = readFileSync(join(dir, file));
  const fileId = await api.upload('imports.source', XLSX, bytes);
  const created = await api.call(
    'POST',
    '/api/v1/imports',
    { kind, fileId, fileName },
    { idempotent: true },
  );
  const checked = await waitFor(created.id, (job) => ['VALIDATED', 'INVALID'].includes(job.status));
  if (checked.status !== 'VALIDATED') {
    const rows = await api.all(`/api/v1/imports/${created.id}/rows?filter=ERRORS`);
    const codes = {};
    for (const row of rows)
      for (const e of row.errors ?? [])
        codes[`${e.column}:${e.code}`] = (codes[`${e.column}:${e.code}`] ?? 0) + 1;
    writeFileSync(
      join(dir, `${kind}-errors.json`),
      JSON.stringify({ job: checked, rows }, null, 2),
    );
    throw new Error(
      `${kind} refused (${checked.status}): ${JSON.stringify(checked.summary?.fileIssues ?? codes)}`,
    );
  }
  await api.call('POST', `/api/v1/imports/${created.id}/commit`, undefined, { idempotent: true });
  // A failed or refreshed commit returns the job to VALIDATED / INVALID with `lastError` or `summary.refreshed`.
  const committed = await waitFor(
    created.id,
    (job) =>
      job.status === 'COMMITTED' ||
      (['VALIDATED', 'INVALID'].includes(job.status) && (job.lastError || job.summary?.refreshed)),
  );
  if (committed.status !== 'COMMITTED') {
    throw new Error(
      `${kind} commit ended ${committed.status}: ${JSON.stringify(committed.lastError)}`,
    );
  }
  console.log(
    `${kind}: committed ${committed.totalRows} rows ${JSON.stringify(committed.summary?.applied ?? committed.summary)}`,
  );
}

/** The base-unit barcodes that did not fit the product's import cell (overflow-barcodes.json). */
async function overflow() {
  const entries = JSON.parse(readFileSync(join(dir, 'overflow-barcodes.json'), 'utf8'));
  const counts = { added: 0, alreadyThere: 0 };
  for (const { sku, codes } of entries) {
    const hits = (await api.get(`/api/v1/products?q=${encodeURIComponent(sku)}&limit=20`)).data;
    const product = hits.find((p) => p.sku === sku);
    if (!product) throw new Error('a product of overflow-barcodes.json is missing');
    const detail = await api.get(`/api/v1/products/${product.id}`);
    const base = detail.units.find((unit) => unit.isBase);
    const have = new Set(detail.units.flatMap((unit) => (unit.barcodes ?? []).map((b) => b.code)));
    for (const code of codes) {
      if (have.has(code)) {
        counts.alreadyThere += 1;
        continue;
      }
      await api.call(
        'POST',
        `/api/v1/product-units/${base.id}/barcodes`,
        { code },
        { idempotent: true },
      );
      counts.added += 1;
    }
  }
  console.log(`overflow barcodes: ${JSON.stringify(counts)}`);
}

if (wants('setup')) await setup();
if (wants('categories')) await categories();
if (wants('SUPPLIERS')) await runImport('SUPPLIERS', 'suppliers.xlsx');
if (wants('PRODUCTS')) await runImport('PRODUCTS', 'products.xlsx');
if (wants('overflow')) await overflow();
if (wants('PRICES')) await runImport('PRICES', 'prices.xlsx');
