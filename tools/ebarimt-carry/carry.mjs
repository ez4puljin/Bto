// Carries the old system's e-Barimt work into Bto through Bto's own API, so audit and history are
// real (README.md). Reads only tmp/ebarimt-old (gitignored). Prints counts, never business data.
//
//   node tools/ebarimt-carry/carry.mjs                  what would change, nothing written
//   node tools/ebarimt-carry/carry.mjs --write          writes the differences
//   ... [--api http://127.0.0.1:3300/api/v1] [--login import]
//
// Safe to run again: only what differs from Bto is written, so a second run writes nothing.
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OLD = join(ROOT, 'tmp/ebarimt-old');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const write = process.argv.includes('--write');
const API = option('api', 'http://127.0.0.1:3300/api/v1');
const LOGIN = option('login', 'import');

if (!existsSync(OLD)) throw new Error('tmp/ebarimt-old is missing; run from the repository root');

/** The months the old system's reports were saved for, oldest first. */
const PERIODS = readdirSync(OLD)
  .map((name) => /^report-(\d{6})\.json$/.exec(name)?.[1])
  .filter(Boolean)
  .map((text) => Number.parseInt(text, 10))
  .sort((a, b) => a - b);
if (PERIODS.length === 0) throw new Error('no report-YYYYMM.json in tmp/ebarimt-old');
const LATEST = PERIODS[PERIODS.length - 1];

const secret =
  process.env.CARRY_PASSWORD ??
  readFileSync(join(ROOT, 'tmp/dev-logins.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find(([name]) => name === LOGIN)?.[1];
const signIn = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login: LOGIN, password: secret }),
});
if (!signIn.ok) throw new Error(`sign-in ${signIn.status}`);
const { accessToken } = await signIn.json();

const call = async (method, path, body, extra = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} ${res.status}`);
  return res.status === 204 ? null : res.json();
};

const counts = new Map();
const count = (what, by = 1) => counts.set(what, (counts.get(what) ?? 0) + by);

// Who held whom: the old names, mapped in a gitignored file, since the names are real people's.
const employeesPath = join(OLD, 'employees.json');
const employees = existsSync(employeesPath)
  ? JSON.parse(readFileSync(employeesPath, 'utf8'))
  : null;
if (!employees) count('employee map missing, employees skipped');

/**
 * Each code's row of an old report: a code can stand on several rows and the first one speaks, but
 * its employee is the first of those rows whose name is in the map.
 */
const oldRows = (period) => {
  const report = JSON.parse(readFileSync(join(OLD, `report-${period}.json`), 'utf8'));
  const byCode = new Map();
  const userOf = new Map();
  for (const row of report.rows ?? []) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
    const userId = employees?.[row.employee];
    if (userId && !userOf.has(row.code)) userOf.set(row.code, userId);
  }
  return { byCode, userOf, links: report.receipt_links ?? [] };
};
const reportOf = (period) => call('GET', `/ebarimt-check/report?periods=${period}`);

// Each month's file: skipped while the month already holds the file of that name.
for (const period of PERIODS) {
  const bytesPath = join(OLD, `ebarimt-${period}.xlsx`);
  if (!existsSync(bytesPath)) {
    count('months without a saved file');
    continue;
  }
  const year = Math.floor(period / 100);
  const overview = await call(
    'GET',
    `/ebarimt-check/files?year=${period % 100 === 12 ? year + 1 : year}`,
  );
  const held = overview.months.find((month) => month.period === period)?.file;
  const slotsPath = join(OLD, `slots-${period}.json`);
  const slots = existsSync(slotsPath) ? JSON.parse(readFileSync(slotsPath, 'utf8')) : {};
  const fileName = slots.ebarimt?.filename ?? `ebarimt-${period}.xlsx`;
  if (held?.fileName === fileName) continue;
  count('files to import');
  if (!write) continue;
  const bytes = readFileSync(bytesPath);
  const issued = await call('POST', '/files/presign', {
    kind: 'ebarimt.source',
    contentType: XLSX,
    sizeBytes: bytes.length,
  });
  const url = issued.uploadUrl.startsWith('/')
    ? `${new URL(API).origin}${issued.uploadUrl}`
    : issued.uploadUrl;
  const put = await fetch(url, {
    method: 'PUT',
    headers: issued.headers ?? { 'content-type': XLSX },
    body: bytes,
  });
  if (!put.ok) throw new Error(`upload ${period} ${put.status}`);
  const done = await call(
    'POST',
    '/ebarimt-check/files',
    { fileId: issued.fileId, fileName },
    { 'idempotency-key': randomUUID() },
  );
  if (done.period !== period) throw new Error(`file of ${period} landed in ${done.period}`);
}

// The latest month's registers, phones and remarks, for the suppliers Bto has.
const latest = await reportOf(LATEST);
const latestRows = new Map(latest.rows.map((row) => [row.code, row]));
const same = (a, b) => (a ?? '').trim() === (b ?? '').trim();
for (const [code, row] of oldRows(LATEST).byCode) {
  const supplier = latestRows.get(code);
  if (!supplier) {
    count('old suppliers not in Bto');
    continue;
  }
  const body = {};
  const registers = row.registry?.slice(0, 200);
  const phone = row.phone?.slice(0, 60);
  const remark = row.tailbar?.slice(0, 300);
  if (registers && !same(registers, supplier.registers)) {
    Object.assign(body, { registers, previousRegisters: supplier.registers });
  }
  if (phone && !same(phone, supplier.phone)) {
    Object.assign(body, { phone, previousPhone: supplier.phone });
  }
  if (remark && !same(remark, supplier.remark)) {
    Object.assign(body, { remark, previousRemark: supplier.remark });
  }
  if (Object.keys(body).length === 0) continue;
  count('supplier values to write');
  if (write) await call('PUT', `/ebarimt-check/suppliers/${supplier.supplierId}/profile`, body);
}

for (const period of PERIODS) {
  const { byCode, userOf, links } = oldRows(period);
  const now = await reportOf(period);
  const nowRows = new Map(now.rows.map((row) => [row.code, row]));
  const held = new Map();
  for (const [code, row] of byCode) {
    const supplier = nowRows.get(code);
    if (!supplier) continue;
    const month = supplier.byPeriod[0];
    const body = {};
    const exempt = row.exempt_orgil > 0 ? row.exempt_orgil.toFixed(2) : null;
    if (exempt && Number(exempt) !== Number(month.exemptAmount)) {
      Object.assign(body, { exemptAmount: exempt, previousExemptAmount: month.exemptAmount });
    }
    const note = (row.note ?? '').trim().slice(0, 500) || null;
    if (note && note !== (month.note ?? null)) {
      Object.assign(body, { note, previousNote: month.note ?? null });
    }
    if (Object.keys(body).length > 0) {
      count('month values to write');
      if (write) {
        await call('PUT', '/ebarimt-check/month-values', {
          period,
          supplierId: supplier.supplierId,
          ...body,
        });
      }
    }
    const userId = userOf.get(code);
    if (userId && supplier.employeeUserId !== userId) {
      held.set(userId, [...(held.get(userId) ?? []), supplier.supplierId]);
    }
  }
  for (const [userId, supplierIds] of held) {
    count('employee changes to write', supplierIds.length);
    if (write) await call('PUT', '/ebarimt-check/assignments', { period, supplierIds, userId });
  }
  const standing = new Set(now.links.map((link) => link.receiptKey));
  for (const link of links) {
    if (link.which !== 'orgil' || link.stale || standing.has(link.rkey)) continue;
    const supplier = nowRows.get(link.code);
    if (!supplier) {
      count('links of suppliers not in Bto');
      continue;
    }
    count('links to write');
    if (write) {
      await call('PUT', '/ebarimt-check/receipt-links', {
        period,
        receiptKeys: [link.rkey],
        supplierId: supplier.supplierId,
      });
    }
  }
}

const lines = [...counts];
const changes = lines.filter(([what]) => what.includes(' to '));
console.log(write ? 'Written:' : 'Nothing written. It would change:');
for (const [what, by] of changes) console.log(`  ${what}: ${by}`);
if (changes.length === 0) console.log('  nothing: Bto already holds it all');
const notes = lines.filter(([what]) => !what.includes(' to '));
if (notes.length > 0) console.log('Left out:');
for (const [what, by] of notes) console.log(`  ${what}: ${by}`);
