import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { isObjectName, LocalFileStore, ObjectTooLargeError } from './local-file-store';

describe('LocalFileStore (ADR-0030)', () => {
  let root: string;
  let store: LocalFileStore;
  const name = () => `${randomUUID()}.jpg`;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'tugeel-store-'));
    store = new LocalFileStore(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('receives a body with its size, hash and first bytes, then commits it', async () => {
    const key = name();
    const body = Buffer.from('hello, storage');
    const written = await store.receive(
      key,
      Readable.from([body.subarray(0, 5), body.subarray(5)]),
      64,
    );
    expect(written.size).toBe(body.length);
    expect(written.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(written.head.toString()).toBe('hello, storage');
    expect(await store.size('public', key)).toBeNull();
    await store.commit(written, 'public', key);
    expect(await store.size('public', key)).toBe(body.length);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('refuses more bytes than allowed and leaves nothing behind', async () => {
    const key = name();
    await expect(
      store.receive(key, Readable.from([Buffer.alloc(40), Buffer.alloc(40)]), 64),
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
    expect(await store.size('public', key)).toBeNull();
  });

  it('accepts only server-generated object names', () => {
    expect(isObjectName(name())).toBe(true);
    for (const bad of ['../x.jpg', 'CON.jpg', 'NUL', 'x.jpg', `${name()}/`, name().toUpperCase()]) {
      expect(isObjectName(bad)).toBe(false);
    }
    expect(() => store.path('public', '..\\..\\secret.jpg')).toThrow(RangeError);
  });
});
