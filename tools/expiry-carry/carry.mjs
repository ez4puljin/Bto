// Carries the old system's expiry records into Bto's register through its own API, so the audit is
// real (ADR-0172 #12, docs/modules/expiry.md §5). Reads only a gitignored dump. Prints counts, never
// names, product names, quantities or notes, because the repository is public and output gets pasted.
//
//   node tools/expiry-carry/carry.mjs              does every lookup, posts nothing
//   node tools/expiry-carry/carry.mjs --write      posts each old record
//   ... [--old tmp/expiry-old] [--api http://127.0.0.1:3300/api/v1] [--login import]
//       [--logins tmp/dev-logins.txt]
//
// CARRY_PASSWORD overrides the logins file. See README.md for the dump and for running it again.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXPIRY_CARRY_OUTCOMES } from '@tugeel/shared/expiry';
import { BtoApi, readLogin } from '../migration/bto-api.mjs';
import {
  cachedPerCode,
  failureFields,
  failureText,
  findProductId,
  indexLookups,
  mapRecord,
} from './rules.mjs';

const ROOT = process.cwd();
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
};
const write = process.argv.includes('--write');
const OLD = resolve(ROOT, option('old', 'tmp/expiry-old'));
const API = option('api', 'http://127.0.0.1:3300/api/v1');
const LOGIN = option('login', 'import');
const LOGINS = resolve(ROOT, option('logins', 'tmp/dev-logins.txt'));

const PROGRESS_EVERY = 100;
const FAILURE_LINES = 20;
/** Answers that mean «this code names no one product»; anything else is a failed row. */
const NOT_A_MATCH = new Set([400, 404, 409, 422]);

const readDump = (name) => {
  const file = join(OLD, name);
  if (!existsSync(file)) throw new Error(`${file} is missing; see tools/expiry-carry/README.md`);
  // The parser's own message quotes the file, and the file is business data.
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`${name} is not JSON`);
  }
};
const items = readDump('items.json');
const history = readDump('history.json');
const roles = readDump('roles.json');
const users = readDump('users.json');
if (!Array.isArray(items)) throw new Error('items.json is not a list');
if (history === null || typeof history !== 'object' || Array.isArray(history)) {
  throw new Error('history.json is not an object of old ids');
}
if (!Array.isArray(roles)) throw new Error('roles.json is not a list');
if (!Array.isArray(users)) throw new Error('users.json is not a list');
const lookups = indexLookups(roles, users);

const api = new BtoApi({
  base: API.replace(/\/+$/, '').replace(/\/api\/v1$/, ''),
  user: LOGIN,
  password: process.env.CARRY_PASSWORD ?? readLogin(LOGINS, LOGIN),
});
await api.signIn();

const orNull = async (call) => {
  try {
    return await call();
  } catch (error) {
    if (NOT_A_MATCH.has(error.status)) return null;
    throw error;
  }
};
const finders = {
  // The list's rank puts an exact code first, so a prefix match cannot push it out of the 30.
  bySku: cachedPerCode((code) =>
    orNull(async () => {
      const found = await api.get(`/api/v1/products/lookup?q=${encodeURIComponent(code)}&limit=30`);
      return found.find((product) => product.sku === code)?.id ?? null;
    }),
  ),
  byBarcode: cachedPerCode((code) =>
    orNull(async () => (await api.get(`/api/v1/barcodes/${encodeURIComponent(code)}`)).product.id),
  ),
};

const count = (counts, what) => counts.set(what, (counts.get(what) ?? 0) + 1);
const outcomes = new Map(EXPIRY_CARRY_OUTCOMES.map((outcome) => [outcome, 0]));
const wouldSend = new Map();
const leftOut = new Map();
const failed = new Map();
const productsNotFound = new Set();
const tally = {
  productRows: 0,
  historySent: 0,
  historyLeftOut: 0,
  noHistory: 0,
  liability: 0,
  notes: 0,
  liabilityNotes: 0,
};
let reached = 0;
let failures = 0;

for (const row of items) {
  reached += 1;
  if (reached % PROGRESS_EVERY === 0) console.log(`  ${reached} of ${items.length} rows`);
  const mapped = mapRecord(row, history[row?.id], lookups);
  if (mapped.leftOut) {
    count(leftOut, mapped.leftOut);
    continue;
  }
  try {
    const productId = await findProductId(row, finders);
    if (productId === null) {
      tally.productRows += 1;
      productsNotFound.add(row.product_id);
      continue;
    }
    tally.historySent += mapped.body.history.length;
    tally.historyLeftOut += mapped.historyLeftOut;
    if (mapped.body.history.length === 0) tally.noHistory += 1;
    if (mapped.body.liabilityType !== 'NONE') tally.liability += 1;
    if (mapped.noteTruncated) tally.notes += 1;
    if (mapped.liabilityNoteTruncated) tally.liabilityNotes += 1;
    if (!write) {
      count(wouldSend, mapped.body.status);
      continue;
    }
    // The route is idempotent on the old id, so each post has a key of its own and a re-run is
    // weighed afresh rather than answered from the first run.
    const result = await api.call(
      'POST',
      '/api/v1/expiry/items/carry',
      { ...mapped.body, productId },
      { idempotent: true },
    );
    count(outcomes, result.outcome);
  } catch (error) {
    failures += 1;
    count(failed, failureText(error));
    if (failures <= FAILURE_LINES) {
      const fields = failureFields(error).join(', ');
      console.error(`  old record ${row.id}: ${failureText(error)}${fields ? ` ${fields}` : ''}`);
    }
    if (failures === FAILURE_LINES + 1) console.error('  further failures are only counted');
  }
}

const sum = (counts) => [...counts.values()].reduce((total, by) => total + by, 0);
const line = (what, by) => console.log(`  ${what}: ${by}`);

console.log(write ? 'Done:' : 'Nothing written. It would do:');
line('rows read', items.length);
if (write) {
  for (const [outcome, by] of outcomes) line(outcome, by);
} else {
  line('rows it would send', sum(wouldSend));
  for (const [status, by] of wouldSend) line(`  ${status}`, by);
}
line('products not found', `${productsNotFound.size} (${tally.productRows} rows)`);
line('rows left out', sum(leftOut));
for (const [why, by] of leftOut) line(`  ${why}`, by);
line('history rows sent', tally.historySent);
line('history rows left out', tally.historyLeftOut);
line('rows with no history', tally.noHistory);
line('liability rows', tally.liability);
line('notes truncated', tally.notes);
line('liability notes truncated', tally.liabilityNotes);
line('rows failed', failures);
for (const [why, by] of failed) line(`  ${why}`, by);

if (failures > 0) process.exitCode = 1;
