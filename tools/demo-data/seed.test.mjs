import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  apiUrl,
  idempotencyKey,
  Journal,
  LocalApi,
  main,
  operationHash,
  parseArgs,
  parseEnv,
  routeOf,
  verifyLocal,
} from './seed.mjs';
import { products, suppliers, customers, summary } from './dataset.mjs';

const config = {
  NODE_ENV: 'development',
  API_PORT: '3300',
  DATABASE_URL: 'postgres://ignored:ignored@127.0.0.1:15432/bto_local_shiro',
};
const openapi = {
  paths: {
    '/api/v1/items': { get: {}, post: { parameters: [] } },
    '/api/v1/docs': { post: { parameters: [{ in: 'header', name: 'Idempotency-Key' }] } },
    '/api/v1/docs/{id}/post': { post: { parameters: [{ in: 'header', name: 'Idempotency-Key' }] } },
  },
};

test('guard accepts only the isolated development database and expected port', () => {
  assert.doesNotThrow(() => verifyLocal(config, {}));
  for (const DATABASE_URL of [
    'postgres://x@remote.example:15432/bto_local_shiro',
    'postgres://x@localhost:15432/bto_local_shiro',
    'postgres://x@127.0.0.1:5432/bto_local_shiro',
    'postgres://x@127.0.0.1:15432/bto_main',
    'postgres://x@127.0.0.1:15432/bto_local_shiro?host=remote.example',
    'not-a-url',
  ])
    assert.throws(() => verifyLocal({ ...config, DATABASE_URL }, {}));
  assert.throws(() => verifyLocal({ ...config, NODE_ENV: 'production' }, {}));
  assert.throws(() => verifyLocal(config, { NODE_ENV: 'production' }));
  assert.throws(() =>
    verifyLocal(config, { DATABASE_URL: 'postgres://x@remote.example:15432/bto_local_shiro' }),
  );
  assert.throws(() => verifyLocal({ ...config, API_PORT: '3000' }, {}));
  assert.throws(() => verifyLocal({ ...config, DATABASE_URL: undefined }, {}));
});

test('paths cannot escape loopback or call provider, secret and fiscal actions', () => {
  assert.equal(apiUrl('/docs').origin, 'http://127.0.0.1:3300');
  for (const path of [
    'https://external.example',
    '//external.example',
    '/../auth/login',
    '/%2e%2e/auth/login',
    '/docs#x',
    '/docs\\x',
    '/erkhet/sync',
    '/hr/staff/1/password',
    '/finance/periods/2026-10/close',
    '/notifications/send',
    '/ebarimt/issue',
  ])
    assert.throws(() => apiUrl(path));
  assert.throws(() => parseArgs(['--api', 'https://external.example']));
  assert.throws(() => parseArgs(['--phase', 'unknown']));
  assert.throws(() => parseArgs(['--aply']));
  assert.equal(parseArgs([]).apply, false);
});

test('OpenAPI matching handles document IDs and rejects unknown routes', () => {
  assert.ok(routeOf(openapi, 'POST', '/docs/123/post'));
  assert.throws(() => routeOf(openapi, 'DELETE', '/docs'));
  assert.throws(() => routeOf(openapi, 'POST', '/docs/123/send'));
});

test('manifest operation hashes and UUIDs are deterministic and key-sensitive', () => {
  assert.match(
    idempotencyKey('core/example'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(idempotencyKey('core/example'), idempotencyKey('core/example'));
  assert.notEqual(idempotencyKey('core/example'), idempotencyKey('core/other'));
  assert.equal(
    operationHash('POST', '/docs', { a: '1', b: '2' }),
    operationHash('POST', '/docs', { b: '2', a: '1' }),
  );
  assert.notEqual(
    operationHash('POST', '/docs', { a: '1' }),
    operationHash('POST', '/docs', { a: '2' }),
  );
});

test('successful mutations checkpoint pending before send and never send twice on resume', async () => {
  const state = { operations: {} },
    events = [];
  const api = {
    openapi,
    async request() {
      events.push('send');
      return { id: 3 };
    },
  };
  const journal = new Journal(
    state,
    async (value) => events.push(value.operations['core/document'].status),
    api,
    () => {},
  );
  assert.deepEqual(await journal.mutate('core/document', 'POST', '/docs', { amount: '123.45' }), {
    id: 3,
  });
  assert.deepEqual(await journal.mutate('core/document', 'POST', '/docs', { amount: '123.45' }), {
    id: 3,
  });
  assert.deepEqual(events, ['pending', 'send', 'done']);
  await assert.rejects(
    journal.mutate('core/document', 'POST', '/docs', { amount: '123.46' }),
    /changed/,
  );
});

test('transport failures remain pending; replay only where OpenAPI promises idempotency', async () => {
  const state = { operations: {} },
    sent = [];
  const api = {
    openapi,
    async request(method, path) {
      sent.push(path);
      throw new Error('connection lost');
    },
  };
  const journal = new Journal(
    state,
    async () => {},
    api,
    () => {},
  );
  await assert.rejects(
    journal.mutate('core/master', 'POST', '/items', { name: 'DEMO master' }),
    /connection lost/,
  );
  assert.equal(state.operations['core/master'].status, 'pending');
  await assert.rejects(
    journal.mutate('core/master', 'POST', '/items', { name: 'DEMO changed master' }),
    /changed/,
  );
  await assert.rejects(
    journal.mutate('core/master', 'POST', '/items', { name: 'DEMO master' }),
    /Ambiguous/,
  );
  assert.equal(sent.length, 1);
  await assert.rejects(journal.mutate('core/doc', 'POST', '/docs', {}), /connection lost/);
  api.request = async () => ({ id: 5 });
  assert.deepEqual(await journal.mutate('core/doc', 'POST', '/docs', {}), { id: 5 });
});

test('known 400/422 rejections accept corrected payloads once through mutate and create', async () => {
  for (const status of [400, 422]) {
    for (const kind of ['mutate', 'create']) {
      const state = { operations: {} },
        sent = [];
      const api = {
        openapi,
        async all() {
          return [];
        },
        async request(method, path, body) {
          sent.push(body);
          if (body.start === 'bad') {
            const error = new Error('validation rejected');
            error.status = status;
            throw error;
          }
          return { id: 11, ...body };
        },
      };
      const journal = new Journal(
        state,
        async () => {},
        api,
        () => {},
      );
      const key = `extras/rejection/${status}/${kind}`;
      const run = (body) =>
        kind === 'create'
          ? journal.create(key, '/items', body, { match: (row) => row.name === body.name })
          : journal.mutate(key, 'POST', '/items', body);
      await assert.rejects(run({ name: 'DEMO schedule', start: 'bad' }), /validation rejected/);
      assert.equal(state.operations[key].status, 'rejected');
      const corrected = { name: 'DEMO schedule', start: '09:00' };
      assert.equal((await run(corrected)).start, '09:00');
      assert.equal(state.operations[key].status, 'done');
      assert.equal(state.operations[key].requestHash, operationHash('POST', '/items', corrected));
      await run(corrected);
      assert.equal(sent.length, 2);
      await assert.rejects(run({ ...corrected, start: '10:00' }), /changed/);
      assert.equal(sent.length, 2);
    }
  }
});

test('a pending non-idempotent create recovers by its unique DEMO identity', async () => {
  const body = { name: 'DEMO master' };
  const state = {
    operations: {
      'core/master': { status: 'pending', requestHash: operationHash('POST', '/items', body) },
    },
  };
  let writes = 0;
  const api = {
    openapi,
    async all() {
      return [{ id: 7, name: 'DEMO master' }];
    },
    async request() {
      writes += 1;
    },
  };
  const journal = new Journal(
    state,
    async () => {},
    api,
    () => {},
  );
  assert.equal(
    (
      await journal.create('core/master', '/items', body, {
        match: (row) => row.name === body.name,
      })
    ).id,
    7,
  );
  assert.equal(writes, 0);
  assert.equal(state.operations['core/master'].recovered, true);
});

test('list helper follows cursor pages and accepts arrays and data-only lists', async () => {
  const api = new LocalApi(openapi);
  const requested = [];
  api.get = async (path) => {
    requested.push(path);
    return path.includes('cursor=')
      ? { data: [{ id: 2 }], nextCursor: null }
      : { data: [{ id: 1 }], nextCursor: 'a+b' };
  };
  assert.deepEqual(await api.all('/items?q=DEMO'), [{ id: 1 }, { id: 2 }]);
  assert.equal(requested[1], '/items?q=DEMO&cursor=a%2Bb');
  api.get = async () => [{ id: 3 }];
  assert.deepEqual(await api.all('/items'), [{ id: 3 }]);
  api.get = async () => ({ data: [{ id: 4 }] });
  assert.deepEqual(await api.all('/items'), [{ id: 4 }]);
});

test('HTTP calls disable redirects and attach stable idempotency headers', async () => {
  let captured;
  const api = new LocalApi(openapi, async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 201, text: async () => '{"id":1}' };
  });
  api.token = 'test-token';
  await api.request('POST', '/docs', { amount: '1.00' }, 'core/a');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.url.origin, 'http://127.0.0.1:3300');
  assert.equal(captured.options.headers['Idempotency-Key'], idempotencyKey('core/a'));
});

test('preview uses no credentials, HTTP or filesystem setup', async () => {
  const originalFetch = globalThis.fetch,
    originalLog = console.log;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('preview called HTTP');
  };
  console.log = () => {};
  try {
    await main(['--repo', 'path-that-does-not-exist']);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
  assert.equal(requests, 0);
});

test('dataset identity, stock scenarios and count declarations stay consistent', async () => {
  assert.equal(products.length, 72);
  assert.equal(new Set(products.map((row) => row.sku)).size, 72);
  assert.equal(suppliers.length, 24);
  assert.equal(customers.length, 18);
  assert.equal(products.filter((row) => row.stock === 'ZERO').length, summary.emptyProducts);
  assert.equal(products.filter((row) => row.stock === 'LOW').length, summary.lowStockProducts);
  for (const row of [...products, ...suppliers, ...customers])
    assert.ok(row.name.startsWith('DEMO '));
  const source = await readFile(new URL('./dataset.mjs', import.meta.url), 'utf8');
  assert.ok(/[\u0400-\u04ff]/.test(source));
  assert.ok(!source.includes('@gmail.com'));
});

test('dotenv parsing handles Windows newlines and quoted values without expansion', () => {
  assert.deepEqual(
    parseEnv('NODE_ENV=development\r\nA="x#y"\r\nB=12 # note\r\n# skip\r\nC=\'literal$VAR\'\r\n'),
    { NODE_ENV: 'development', A: 'x#y', B: '12', C: 'literal$VAR' },
  );
});
