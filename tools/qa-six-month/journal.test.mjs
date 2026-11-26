import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, access, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJournal, allPages, exactlyOne, hash } from './journal.mjs';

const fakeResponse = (body, status = 200) => ({
  status,
  ok: status < 400,
  text: async () => JSON.stringify(body),
});
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'bto-qa-journal-'));
  const original = globalThis.fetch;
  const runtime = { directory, password: 'private-test-only', clock: { tick() {} } };
  globalThis.fetch = async () =>
    fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
  try {
    await run(runtime);
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
}

test('recovery traverses every cursor page and refuses ambiguous matches', async () => {
  const calls = [];
  const all = await allPages(async (path) => {
    calls.push(path);
    return calls.length === 1
      ? { data: [{ id: 1 }], nextCursor: 'after/50' }
      : { data: [{ id: 61 }], nextCursor: null };
  }, '/suppliers?q=88');
  assert.deepEqual(
    all.map((r) => r.id),
    [1, 61],
  );
  assert.equal(calls[1], '/suppliers?q=88&cursor=after%2F50');
  assert.throws(() => exactlyOne([{ id: 1 }, { id: 2 }], 'supplier'), /Ambiguous/);
});

test('all creation requests carry stable keys without assuming unmarked routes deduplicate', async () =>
  fixture(async (runtime) => {
    const journal = await createJournal(runtime);
    const keys = [];
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'GET') return fakeResponse({ data: [], nextCursor: null });
      keys.push(options.headers['Idempotency-Key']);
      return fakeResponse({ id: 61, code: '88010061' });
    };
    try {
      await journal.create(
        'supplier61',
        '/suppliers',
        { code: '88010061' },
        { match: (r) => r.code === '88010061' },
      );
      assert.equal(typeof keys[0], 'string');
      assert.match(keys[0], /^[0-9a-f-]{36}$/);
      assert.equal(journal.state.operations.supplier61.specification.idempotent, false);
      assert.equal(journal.state.operations.supplier61.status, 'DONE');
    } finally {
      await journal.close();
    }
  }));

test('initial persistence and authentication failures release the lock and handle', async () =>
  fixture(async (runtime) => {
    await mkdir(join(runtime.directory, 'run.json.tmp'));
    await assert.rejects(createJournal(runtime));
    await assert.rejects(access(join(runtime.directory, 'run.lock')), { code: 'ENOENT' });
    await rm(join(runtime.directory, 'run.json.tmp'), { recursive: true });
    globalThis.fetch = async () => fakeResponse({ error: 'unauthorized' }, 401);
    await assert.rejects(createJournal(runtime), /authentication failed/);
    await assert.rejects(access(join(runtime.directory, 'run.lock')), { code: 'ENOENT' });
  }));

test('a proven rejected attempt permits only its reviewed replacement and preserves both attempts', async () =>
  fixture(async (runtime) => {
    let journal = await createJournal(runtime);
    const key = 'catalogue/location/0/2',
      path = '/product-locations';
    const keys = [],
      original = { productId: 1, warehouseId: 2, defaultBinId: 3 },
      replacement = { ...original, defaultBinId: 4 };
    globalThis.fetch = async (_url, options) => {
      keys.push(options.headers['Idempotency-Key']);
      return fakeResponse({ errors: [{ path: 'defaultBinId', constraint: 'type' }] }, 422);
    };
    await assert.rejects(journal.write(key, 'PUT', path, original, { idempotent: true }), /422/);
    const old = journal.state.operations[key];
    await journal.close();
    const operation = {
      ...old,
      status: 'REJECTED',
      allowedReplacementHash: hash({ method: 'PUT', path, body: replacement, idempotent: true }),
      rejectionEvidence: { locationRows: 0, proofHash: 'reviewed-test-proof' },
    };
    await appendFile(
      join(runtime.directory, 'operations.ndjson'),
      JSON.stringify({
        dataset: JSON.parse(await readFile(join(runtime.directory, 'run.json'), 'utf8')).dataset,
        key,
        operation,
      }) + '\n',
    );
    globalThis.fetch = async () =>
      fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
    journal = await createJournal(runtime);
    try {
      await assert.rejects(
        journal.write(key, 'PUT', path, original, { idempotent: true }),
        /explicitly authorized/,
      );
      await assert.rejects(
        journal.write(key, 'PUT', path, { ...replacement, defaultBinId: 5 }, { idempotent: true }),
        /explicitly authorized/,
      );
      globalThis.fetch = async (_url, options) => {
        keys.push(options.headers['Idempotency-Key']);
        throw new Error('interrupted replacement write');
      };
      await assert.rejects(
        journal.write(key, 'PUT', path, replacement, { idempotent: true }),
        /interrupted replacement/,
      );
      await journal.close();
      globalThis.fetch = async () =>
        fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
      journal = await createJournal(runtime);
      globalThis.fetch = async (_url, options) => {
        keys.push(options.headers['Idempotency-Key']);
        return fakeResponse({ id: 1 });
      };
      await journal.write(key, 'PUT', path, replacement, { idempotent: true });
      assert.equal(journal.state.operations[key].rejectedAttempt.hash, old.hash);
      assert.equal(
        journal.state.operations[key].rejectedAttempt.rejectionEvidence.proofHash,
        'reviewed-test-proof',
      );
      assert.notEqual(keys[0], keys[1]);
      assert.equal(keys[1], keys[2]);
      assert.equal(keys.length, 3);
    } finally {
      await journal.close();
    }
  }));

test('resuming a partial day cannot post behind a committed or pending stock-clock watermark', async () =>
  fixture(async (runtime) => {
    const base = Date.parse('2026-06-01T00:00:00.000Z');
    let now = base;
    runtime.clock = {
      get day() {
        return '2026-06-01';
      },
      get instant() {
        return new Date(now);
      },
      tick() {
        now += 1000;
      },
      advanceFloor(value) {
        now = Math.max(now, Date.parse(value));
      },
    };
    let journal = await createJournal(runtime);
    const postedAt = [];
    globalThis.fetch = async () => {
      postedAt.push(runtime.clock.instant.toISOString());
      return fakeResponse({ id: 1 });
    };
    await journal.write('stock/committed', 'POST', '/receipts/1/post', {}, { idempotent: true });
    globalThis.fetch = async () => {
      throw new Error('crash after pending record');
    };
    await assert.rejects(
      journal.write('stock/interrupted', 'POST', '/receipts/2/post', {}, { idempotent: true }),
      /crash/,
    );
    const watermark = journal.state.operations['stock/interrupted'].logicalInstant;
    assert.equal(watermark, '2026-06-01T00:00:02.000Z');
    await journal.close();
    now = base;
    globalThis.fetch = async () =>
      fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
    journal = await createJournal(runtime);
    try {
      await journal.write('stock/committed', 'POST', '/receipts/1/post', {}, { idempotent: true });
      assert.equal(runtime.clock.instant.toISOString(), watermark);
      now = base; // history's setDay call also resets to 08:00 before the next action.
      globalThis.fetch = async () => {
        postedAt.push(runtime.clock.instant.toISOString());
        return fakeResponse({ id: 3 });
      };
      await journal.write('stock/new', 'POST', '/receipts/3/post', {}, { idempotent: true });
      assert.equal(postedAt[1], '2026-06-01T00:00:03.000Z');
      assert.ok(postedAt[1] > watermark && postedAt[1] > postedAt[0]);
      assert.equal(journal.state.operations['stock/new'].logicalInstant, postedAt[1]);
    } finally {
      await journal.close();
    }
  }));

test('completed writes round-trip without reexecution; interrupted writes retain exact idempotency keys', async () =>
  fixture(async (runtime) => {
    let journal = await createJournal(runtime),
      posts = 0;
    globalThis.fetch = async (_url, options) => {
      posts++;
      assert.ok(options.headers['Idempotency-Key']);
      return fakeResponse({ id: 20 });
    };
    assert.equal(
      (await journal.write('posted', 'POST', '/receipts/1/post', {}, { idempotent: true })).id,
      20,
    );
    globalThis.fetch = async () => {
      throw new Error('injected connection loss');
    };
    await assert.rejects(
      journal.write('pending', 'POST', '/payments', { amount: '10' }, { idempotent: true }),
      /injected/,
    );
    await journal.close();
    globalThis.fetch = async () =>
      fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
    journal = await createJournal(runtime);
    globalThis.fetch = async (_url, options) => {
      posts++;
      assert.ok(options.headers['Idempotency-Key']);
      return fakeResponse({ id: 21 });
    };
    assert.equal(
      (await journal.write('posted', 'POST', '/receipts/1/post', {}, { idempotent: true })).id,
      20,
    );
    assert.equal(
      (await journal.write('pending', 'POST', '/payments', { amount: '10' }, { idempotent: true }))
        .id,
      21,
    );
    assert.equal(posts, 2);
    await assert.rejects(
      journal.write('posted', 'POST', '/receipts/1/post', { changed: true }, { idempotent: true }),
      /Changed payload/,
    );
    await journal.close();
  }));

test('pending non-idempotent creation recovers later-page matches and checkpoint redacts authentication fields', async () =>
  fixture(async (runtime) => {
    let journal = await createJournal(runtime);
    let page = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'POST') throw new Error('injected ambiguous write');
      return fakeResponse({ data: [], nextCursor: null });
    };
    await assert.rejects(
      journal.create(
        'supplier61',
        '/suppliers',
        { code: '88010061', pin: 'private-pin' },
        { match: (r) => r.code === '88010061' },
      ),
      /injected/,
    );
    await journal.close();
    globalThis.fetch = async () =>
      fakeResponse({ accessToken: 'never-checkpoint-this', me: { id: 1 } });
    journal = await createJournal(runtime);
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, 'GET');
      page++;
      return fakeResponse(
        page === 1
          ? { data: [{ id: 1, code: 'other' }], nextCursor: 'next' }
          : { data: [{ id: 61, code: '88010061' }], nextCursor: null },
      );
    };
    assert.equal(
      (
        await journal.create(
          'supplier61',
          '/suppliers',
          { code: '88010061', pin: 'private-pin' },
          { match: (r) => r.code === '88010061' },
        )
      ).id,
      61,
    );
    await journal.close();
    const saved = await readFile(join(runtime.directory, 'run.json'), 'utf8');
    assert.equal(JSON.parse(saved).refs.admin.id, 1);
    assert.equal(saved.includes('private-pin'), false);
    assert.equal(saved.includes('never-checkpoint-this'), false);
  }));
