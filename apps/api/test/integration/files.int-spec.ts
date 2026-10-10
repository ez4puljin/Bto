import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { StorageService } from '../../src/modules/identity';
import { StorageUrlSigner } from '../../src/modules/identity/storage/url-signer';
import { createHttpApp } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

interface Issued {
  fileId: number;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresAt: string;
}

const jpeg = (size: number) => {
  const body = Buffer.alloc(size, 7);
  body.set([0xff, 0xd8, 0xff]);
  return body;
};

describe('file storage, local driver (ADR-0030)', () => {
  let app: NestExpressApplication;
  let storage: StorageService;
  let db: Db;
  let adminToken: string;
  let workerToken: string;
  const root = process.env.STORAGE_LOCAL_DIR ?? '';
  const http = () => request(app.getHttpServer());
  const presign = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/files/presign').set(bearer(token)).send(body);
  const issue = async (sizeBytes: number, kind = 'catalog.product_image') =>
    (await presign(adminToken, { kind, contentType: 'image/jpeg', sizeBytes }).expect(201))
      .body as Issued;

  beforeAll(async () => {
    app = await createHttpApp();
    storage = app.get(StorageService);
    db = app.get<Db>(DB);
    adminToken = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    workerToken = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('issues upload URLs only to holders of the kind permission, within type and size', async () => {
    const image = { kind: 'catalog.product_image', contentType: 'image/jpeg', sizeBytes: 100 };
    await http().post('/api/v1/files/presign').send(image).expect(401);
    const denied = await presign(workerToken, image).expect(403);
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN', params: { reason: 'PERMISSION' } });
    const gif = await presign(adminToken, { ...image, contentType: 'image/gif' }).expect(415);
    expect(gif.body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    const thumb = { ...image, kind: 'catalog.product_thumb', sizeBytes: 600 * 1024 };
    expect((await presign(adminToken, thumb).expect(413)).body.code).toBe('PAYLOAD_TOO_LARGE');
    await presign(adminToken, { ...image, kind: 'catalog.unknown' }).expect(422);

    const issued = await issue(100);
    expect(issued).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });
    expect(issued.uploadUrl).toMatch(/^\/api\/v1\/files\/local\/[0-9a-f-]{36}\.jpg\?exp=\d+&sig=/);
  });

  it('stores an upload once and serves it publicly only after the owner confirms it', async () => {
    const body = jpeg(300);
    const issued = await issue(body.length);
    await http().put(issued.uploadUrl).set('Content-Type', 'image/jpeg').send(body).expect(204);
    const again = await http()
      .put(issued.uploadUrl)
      .set('Content-Type', 'image/jpeg')
      .send(body)
      .expect(409);
    expect(again.body.code).toBe('CONFLICT');

    const file = await storage.get(issued.fileId);
    expect(file).toMatchObject({
      status: 'PENDING',
      sha256: createHash('sha256').update(body).digest('hex'),
    });
    if (!file) throw new Error('file row missing');
    const url = storage.publicUrl(file);
    expect(url).toBe(`/api/v1/files/public/${file.key}`);
    await http().get(url).expect(404);

    await expect(
      storage.verifyUploaded(issued.fileId, 'catalog.product_thumb'),
    ).rejects.toMatchObject({ code: 'FILE_KIND_MISMATCH' });
    await storage.verifyUploaded(issued.fileId, 'catalog.product_image');
    await inTransaction(db, (tx) => storage.confirm(tx, issued.fileId, 'catalog.product_image'));

    const served = await http().get(url).expect(200);
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.isBuffer(served.body)).toBe(true);
    expect(Buffer.compare(served.body as Buffer, body)).toBe(0);

    await inTransaction(db, (tx) => storage.markDeleted(tx, issued.fileId));
    await http().get(url).expect(404);
  });

  it('refuses bad signatures, other types and wrong sizes, and keeps no bytes', async () => {
    const issued = await issue(100);
    const put = (url: string, type: string, body: Buffer) =>
      http().put(url).set('Content-Type', type).send(body);

    const tampered = issued.uploadUrl.replace(/sig=[^&]+/, 'sig=AAAA');
    const forged = await put(tampered, 'image/jpeg', jpeg(100)).expect(403);
    expect(forged.body).toMatchObject({ code: 'FORBIDDEN', params: { reason: 'SIGNATURE' } });

    const file = await storage.get(issued.fileId);
    if (!file) throw new Error('file row missing');
    const claim = { name: file.key, contentType: file.contentType, sizeBytes: file.sizeBytes };
    const expired = app.get(StorageUrlSigner).uploadUrl(claim, Date.now() - 20 * 60 * 1000).url;
    await put(expired, 'image/jpeg', jpeg(100)).expect(403);

    expect((await put(issued.uploadUrl, 'image/png', jpeg(100)).expect(415)).body.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect((await put(issued.uploadUrl, 'image/jpeg', jpeg(101)).expect(413)).body.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    await put(issued.uploadUrl, 'image/jpeg', jpeg(99)).expect(400);
    await put(issued.uploadUrl, 'image/jpeg', Buffer.alloc(100)).expect(415);

    expect(await storage.get(issued.fileId)).toMatchObject({ uploadedAt: null, sha256: null });
    await expect(
      storage.verifyUploaded(issued.fileId, 'catalog.product_image'),
    ).rejects.toMatchObject({ code: 'FILE_NOT_UPLOADED' });
    await expect(
      inTransaction(db, (tx) => storage.confirm(tx, issued.fileId, 'catalog.product_image')),
    ).rejects.toMatchObject({ code: 'FILE_NOT_UPLOADED' });
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
    expect((await readdir(join(root, 'public')).catch((): string[] => [])).includes(file.key)).toBe(
      false,
    );
  });

  it('never touches names the server did not generate', async () => {
    await http().get('/api/v1/files/public/..%2F..%2Fpackage.json').expect(404);
    await http().get('/api/v1/files/public/CON.jpg').expect(404);
    await http()
      .put('/api/v1/files/local/..%2Fevil.jpg?exp=1&sig=x')
      .set('Content-Type', 'image/jpeg')
      .send(jpeg(10))
      .expect(404);
  });
});
