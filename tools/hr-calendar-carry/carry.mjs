// Carries the old system's calendar into Bto's /hr/calendar through Bto's own API, so audit is real
// (ADR-0171). Reads only tmp/hr-calendar-old (gitignored). Prints counts, never business data.
//
//   node tools/hr-calendar-carry/carry.mjs              what would be created, nothing written
//   node tools/hr-calendar-carry/carry.mjs --write      creates it
//   ... [--api http://127.0.0.1:3300/api/v1] [--login import] [--ledger <file>]
//
// tmp/hr-calendar-old holds labels.json ([{ key, name, color }], the old labels become Bto's types)
// and events-YYYY.jsonl (one [id, date, labelKey, notes, isDone] a line). An old note is the event's
// title; an empty one takes the label's name.
//
// The ledger (default tmp/hr-calendar-old/carried.json) remembers which old label became which type
// and which old rows were carried, so a second run brings only rows new in the old system: what HR
// has since renamed, moved or archived in Bto stays as HR left it. A ledger belongs to one database;
// for another one, name another file. A row with no ledger entry that already stands in Bto on the
// same day, with the same type and title, is recorded rather than created. An old row marked done
// is marked done in Bto once, by the signed-in user, at the time of the run: the old system kept
// neither who nor when.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OLD = join(ROOT, 'tmp/hr-calendar-old');
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const write = process.argv.includes('--write');
const API = option('api', 'http://127.0.0.1:3300/api/v1');
const LOGIN = option('login', 'import');
const LEDGER = option('ledger', join(OLD, 'carried.json'));

if (!existsSync(OLD))
  throw new Error('tmp/hr-calendar-old is missing; run from the repository root');
const labels = JSON.parse(readFileSync(join(OLD, 'labels.json'), 'utf8'));
const rows = readdirSync(OLD)
  .filter((name) => /^events-\d{4}\.jsonl$/.test(name))
  .flatMap((name) =>
    readFileSync(join(OLD, name), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        // The parser's own message quotes the line, and the line is business data.
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`line ${index + 1} of ${name} is not JSON`);
        }
      }),
  );

const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, 'utf8'))
  : { types: {}, events: {} };
ledger.done ??= {};
const saveLedger = () => {
  if (write) writeFileSync(LEDGER, JSON.stringify(ledger));
};

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

const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} ${res.status}`);
  return res.status === 204 ? null : res.json();
};

const created = new Map();
const leftOut = new Map();
const add = (counts, what) => counts.set(what, (counts.get(what) ?? 0) + 1);

// The types: the ledger's first, whatever HR has renamed them to, then by name. An archived one is
// not brought back: its rows are reported, and come over if HR restores it.
const held = await call('GET', '/hr/event-types?includeArchived=true');
const nameKey = (name) => name.trim().toLowerCase();
const typeById = new Map(held.map((type) => [type.id, type]));
const typeByName = new Map(held.map((type) => [nameKey(type.name), type]));
const typeOfLabel = new Map();
for (const label of labels) {
  let type = typeById.get(ledger.types[label.key]) ?? typeByName.get(nameKey(label.name));
  if (!type) {
    add(created, 'types');
    type = write
      ? await call('POST', '/hr/event-types', { name: label.name, color: label.color })
      : null;
  }
  if (type && ledger.types[label.key] !== type.id) {
    ledger.types[label.key] = type.id;
    saveLedger();
  }
  typeOfLabel.set(label.key, { label, type });
}

// What each month already holds, for the rows the ledger does not know.
const months = [...new Set(rows.map((row) => row[1].slice(0, 7)))].sort();
const standing = new Map();
const keyOf = (date, typeId, title) => `${date}|${typeId}|${title}`;
for (const month of months) {
  for (const item of await call('GET', `/hr/calendar?month=${month}`)) {
    if (item.eventId !== null) {
      standing.set(keyOf(item.date, item.typeId, item.title), item);
    }
  }
}

const carryDone = async (oldId, key) => {
  const event = standing.get(key);
  if (!event) {
    add(leftOut, 'done marks of events no longer as carried');
    return;
  }
  if (!event.doneAt) {
    add(created, 'done marks');
    if (!write) return;
    await call('PUT', `/hr/events/${event.eventId}/done`, { done: true });
  }
  ledger.done[oldId] = true;
  saveLedger();
};

for (const [oldId, date, labelKey, notes, isDone] of rows) {
  const found = typeOfLabel.get(labelKey);
  const doneKey = found?.type ? keyOf(date, found.type.id, notes.trim() || found.label.name) : null;
  if (ledger.events[oldId]) {
    if (isDone && !ledger.done[oldId] && doneKey) await carryDone(oldId, doneKey);
    continue;
  }
  if (!found) {
    add(leftOut, 'events of an unknown label');
    continue;
  }
  if (found.type?.archivedAt) {
    add(leftOut, 'events of an archived type');
    continue;
  }
  const title = notes.trim() || found.label.name;
  if (found.type && standing.has(keyOf(date, found.type.id, title))) {
    add(created, 'events already in Bto, recorded in the ledger');
  } else {
    add(created, 'events');
    if (!write) {
      if (isDone) add(created, 'done marks');
      continue;
    }
    const item = await call('POST', '/hr/events', {
      typeId: found.type.id,
      title,
      fromDate: date,
      toDate: date,
    });
    standing.set(keyOf(date, found.type.id, title), item);
  }
  ledger.events[oldId] = true;
  saveLedger();
  if (isDone && !ledger.done[oldId]) await carryDone(oldId, keyOf(date, found.type.id, title));
}

console.log(write ? 'Done:' : 'Nothing written. It would do:');
for (const [what, by] of created) console.log(`  ${what}: ${by}`);
if (created.size === 0) console.log('  nothing to do');
if (leftOut.size > 0) console.log('Left out, not in Bto:');
for (const [what, by] of leftOut) console.log(`  ${what}: ${by}`);
