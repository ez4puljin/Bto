import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve, join } from 'node:path';
import { Socket } from 'node:net';
import {
  assertQaUrl,
  assertApiPath,
  assertClientTarget,
  assertRunDirectory,
  qaAdminLogin,
} from './safety.mjs';
import { QA_DATABASE } from './dataset.mjs';
import { installLoopbackFence, loadQaEnvironment, startRuntime } from './runtime.mjs';
import { repairRejectedLocation } from './repair-rejected-location.mjs';

test('database guard permits only exact isolated loopback target without URL overrides', () => {
  const valid = `postgresql://app:fake@127.0.0.1:15432/${QA_DATABASE}`;
  assert.equal(assertQaUrl(valid).hostname, '127.0.0.1');
  for (const value of [
    valid.replace(QA_DATABASE, 'ordinary_database'),
    ...['localhost', '[::1]', '127.0.0.2', '192.168.1.10'].map((host) =>
      valid.replace('127.0.0.1', host),
    ),
    valid + '?port=5432',
    valid + '?host=external.example',
    valid.replace('15432', '5432'),
  ])
    assert.throws(() => assertQaUrl(value));
});

test('API routes cannot escape origin or invoke provider/fiscal/notification actions', () => {
  assert.equal(assertApiPath('/pos/sync/events'), '/pos/sync/events');
  for (const path of [
    'https://example.com',
    '//example.com',
    '/%2e%2e/products',
    '/pos/sync/ebarimt/claim',
    '/notifications',
    '/unknown-root',
    '/finance/close-year',
    '/finance/close-year?year=2026',
    '/pos/sync/ebarimt?x=1',
  ])
    assert.throws(() => assertApiPath(path));
});

test('network fence refuses external sockets and fetch synchronously and restores originals', () => {
  const connect = Socket.prototype.connect,
    fetch = globalThis.fetch;
  const restore = installLoopbackFence();
  try {
    const socket = new Socket();
    assert.throws(() => socket.connect({ host: 'example.com', port: 443 }), /blocks/);
    assert.throws(() => socket.connect({ host: '127.0.0.1', port: 3300 }), /blocks/);
    assert.throws(() => globalThis.fetch('https://example.com'), /blocks/);
    socket.destroy();
  } finally {
    restore();
    restore();
  }
  assert.equal(Socket.prototype.connect, connect);
  assert.equal(globalThis.fetch, fetch);
});

test('client guard rejects every nonexact connection target', () => {
  const valid = { host: '127.0.0.1', port: 15432, database: QA_DATABASE };
  assert.doesNotThrow(() => assertClientTarget({ connectionParameters: valid }));
  for (const patch of [
    { host: 'localhost' },
    { host: '::1' },
    { host: '127.0.0.2' },
    { host: '192.168.1.10' },
    { port: 5432 },
    { database: 'ordinary_database' },
  ])
    assert.throws(() => assertClientTarget({ connectionParameters: { ...valid, ...patch } }));
  assert.throws(() => assertClientTarget({}));
});

test('repair refuses a non-QA target before creating its run lock', async () => {
  let locks = 0;
  await assert.rejects(
    repairRejectedLocation(
      { repo: resolve('fake-checkout'), explicitlyEnabled: true, database: QA_DATABASE },
      {
        read: async () => `DATABASE_URL=postgres://app:fake@127.0.0.1:5432/${QA_DATABASE}`,
        openLock: async () => {
          locks++;
          throw new Error('unexpected lock creation');
        },
      },
    ),
    /must target/,
  );
  assert.equal(locks, 0);
});

test('run directory is explicit and cannot escape the tool-owned subtree', () => {
  const repo = resolve('fake-checkout');
  const root = join(repo, '.data/local-dev/qa-six-month');
  assert.equal(assertRunDirectory(repo), root);
  assert.equal(assertRunDirectory(repo, join(root, 'child')), join(root, 'child'));
  for (const target of [
    repo,
    join(root, '..'),
    join(repo, 'outside'),
    join(root, '../qa-six-month-other'),
  ])
    assert.throws(() => assertRunDirectory(repo, target));
  assert.throws(() => assertRunDirectory(undefined));
});

test('runtime rejects missing explicit authorization before accessing dependencies or files', async () => {
  const valid = {
    repo: resolve('nonexistent-test-checkout'),
    explicitlyEnabled: true,
    database: QA_DATABASE,
    password: 'fake-only',
  };
  for (const patch of [
    { explicitlyEnabled: undefined },
    { explicitlyEnabled: false },
    { database: undefined },
    { database: 'ordinary_database' },
    { password: undefined },
    { repo: undefined },
  ])
    await assert.rejects(startRuntime({ ...valid, ...patch }));
});

test('environment target validation precedes I/O and never falls back to application secrets', async () => {
  const options = {
    repo: resolve('fake-checkout'),
    explicitlyEnabled: true,
    database: QA_DATABASE,
    password: 'fake-only',
  };
  const validUrl = `postgres://app:fake@127.0.0.1:15432/${QA_DATABASE}`;
  const missing = async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  let reads = 0;
  const neverRead = async () => {
    reads++;
    throw new Error('unexpected environment read');
  };
  await assert.rejects(
    loadQaEnvironment(options, { explicitUrl: validUrl.replace('15432', '5432'), read: neverRead }),
  );
  await assert.rejects(
    loadQaEnvironment(
      { ...options, directory: resolve('outside') },
      { explicitUrl: validUrl, read: neverRead },
    ),
  );
  assert.equal(reads, 0);
  await assert.rejects(
    loadQaEnvironment(options, { explicitUrl: undefined, read: missing }),
    /Pre-provision/,
  );
  const expectedFile = join(options.repo, '.data/local-dev/qa-six-month/qa.env');
  const read = async (file) => {
    assert.equal(file, expectedFile);
    reads++;
    return `DATABASE_URL=${validUrl}\nNODE_ENV=test\nROLE=api\nAPI_PORT=3301\n`;
  };
  const loaded = await loadQaEnvironment(options, { explicitUrl: undefined, read });
  assert.equal(reads, 1);
  assert.equal(loaded.provision, false);
  const fresh = await loadQaEnvironment(options, { explicitUrl: validUrl, read: missing });
  assert.equal(fresh.provision, true);
  assert.equal(fresh.env.DATABASE_URL, validUrl);
  await assert.rejects(
    loadQaEnvironment(options, {
      explicitUrl: undefined,
      read: async () => `DATABASE_URL=${validUrl}?host=elsewhere`,
    }),
  );
  assert.equal(qaAdminLogin({}), 'qa-admin');
  assert.equal(
    qaAdminLogin({ BTO_QA_ADMIN_LOGIN: 'private-existing-admin' }),
    'private-existing-admin',
  );
  assert.throws(() => qaAdminLogin({ BTO_QA_ADMIN_LOGIN: 'bad login' }));
});
