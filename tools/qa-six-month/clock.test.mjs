import assert from 'node:assert/strict';
import test from 'node:test';
import { installLogicalClock } from './clock.mjs';
import { QA_DATABASE } from './dataset.mjs';

const URL = `postgresql://qa:fake@127.0.0.1:15432/${QA_DATABASE}`;
function fixture() {
  const real = new Date('2026-11-24T05:00:00Z');
  const date = (at = real) => new Date(at).toISOString().slice(0, 10);
  const time = {
    businessDate: date,
    businessYear: (at = real) => date(at).slice(0, 4),
    businessMonthStart: (at = real) => date(at).slice(0, 7) + '-01',
    businessDateIn: (_zone, at = real) => date(at),
  };
  class Client {
    constructor(database = QA_DATABASE) {
      this.connectionParameters = { host: '127.0.0.1', port: 15432, database };
      this.calls = [];
    }
    connect(callback) {
      if (callback) callback(null);
      else return Promise.resolve();
    }
    query(...args) {
      this.calls.push(args);
      const config = args[0];
      const result = {
        rows: config?.rowMode === 'array' ? [[real]] : [{ now: real }],
        rowCount: 1,
      };
      const callback = args.findLast((arg) => typeof arg === 'function');
      if (callback) {
        callback(null, result);
        return undefined;
      }
      return Promise.resolve(result);
    }
  }
  return { Client, time, real };
}
const install = (f) =>
  installLogicalClock({ ...f, databaseUrl: URL, nodeEnv: 'test', explicitlyEnabled: true });

test('only default business-date arguments use synthetic time, explicit instants retain their meaning', () => {
  const f = fixture(),
    previous = { ...f.time },
    c = install(f);
  try {
    c.setDay('2026-08-05');
    assert.equal(f.time.businessDate(), '2026-08-05');
    assert.equal(f.time.businessDate(f.real), '2026-11-24');
    assert.equal(f.time.businessDateIn('UTC', f.real), '2026-11-24');
    assert.equal(f.time.businessYear(f.real), '2026');
    assert.equal(f.time.businessMonthStart(), '2026-08-01');
    assert.equal(Date.now() > new Date('2026-01-01').getTime(), true);
  } finally {
    c.restore();
  }
  for (const key of Object.keys(previous)) assert.equal(f.time[key], previous[key]);
});

test('the exact SELECT executes normally and supports promise, callback and Drizzle array rows', async () => {
  const f = fixture(),
    c = install(f),
    client = new f.Client();
  try {
    c.setDay('2026-07-10');
    const object = await client.query('SELECT now() AS now');
    assert.equal(object.rows[0].now.toISOString(), '2026-07-10T00:00:00.000Z');
    const array = await client.query({ text: 'SELECT now() AS now', values: [], rowMode: 'array' });
    assert.equal(array.rows[0][0].toISOString(), '2026-07-10T00:00:00.000Z');
    const callback = await new Promise((resolve, reject) =>
      client.query('SELECT now() AS now', (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    );
    assert.equal(callback.rows[0].now.toISOString(), '2026-07-10T00:00:00.000Z');
    assert.equal(client.calls.length, 3);
    assert.equal((await client.query('SELECT now() AS other')).rows[0].now, f.real);
  } finally {
    c.restore();
  }
});

test('a durable logical floor only advances within the currently selected QA business day', () => {
  const c = install(fixture());
  try {
    c.setDay('2026-06-01');
    c.advanceFloor('2026-06-01T04:00:00.000Z');
    assert.equal(c.day, '2026-06-01');
    assert.equal(c.instant.toISOString(), '2026-06-01T04:00:00.000Z');
    c.advanceFloor('2026-06-01T01:00:00.000Z');
    assert.equal(c.instant.toISOString(), '2026-06-01T04:00:00.000Z');
    assert.throws(() => c.advanceFloor('2026-06-02T04:00:00.000Z'), /current declared/);
    assert.throws(() => c.advanceFloor('2027-06-01T04:00:00.000Z'), /current declared/);
    assert.throws(() => c.advanceFloor('bad'), /current declared/);
    c.tick();
    assert.equal(c.instant.toISOString(), '2026-06-01T04:00:01.000Z');
  } finally {
    c.restore();
  }
});

test('every client connection/query fails closed outside exact QA database, before executing', () => {
  const f = fixture(),
    c = install(f),
    wrong = new f.Client('bto_local_shiro');
  try {
    assert.throws(() => wrong.connect(), /outside/);
    assert.throws(() => wrong.query('INSERT any business data'), /outside/);
    assert.deepEqual(wrong.calls, []);
  } finally {
    c.restore();
  }
});

test('partial installation failure restores prior patches; production and wrong target refuse', () => {
  const f = fixture(),
    before = f.time.businessDate;
  Object.defineProperty(f.time, 'businessDateIn', {
    value: f.time.businessDateIn,
    writable: false,
  });
  assert.throws(() => install(f), /safely patch/);
  assert.equal(f.time.businessDate, before);
  assert.throws(
    () =>
      installLogicalClock({
        ...fixture(),
        databaseUrl: URL,
        nodeEnv: 'production',
        explicitlyEnabled: true,
      }),
    /explicit/,
  );
  assert.throws(
    () =>
      installLogicalClock({
        ...fixture(),
        databaseUrl: URL.replace(QA_DATABASE, 'bto_local_shiro'),
        nodeEnv: 'test',
        explicitlyEnabled: true,
      }),
    /must target/,
  );
});

test('logical dates cannot escape the declared window or survive restore', () => {
  const f = fixture(),
    c = install(f);
  assert.throws(() => c.setDay('2026-05-31'), /window/);
  assert.throws(() => c.setDay('2026-07-99'), /window/);
  c.restore();
  c.restore();
  assert.throws(() => c.setDay('2026-08-01'), /restored/);
});
