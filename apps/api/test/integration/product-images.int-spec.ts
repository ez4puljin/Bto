import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { MAX_PRODUCT_IMAGES } from '../../src/modules/catalog/services/product-images.service';
import { createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface ImageJson {
  id: number;
  url: string | null;
  thumbUrl: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

const jpeg = (size: number) => {
  const body = Buffer.alloc(size, 9);
  body.set([0xff, 0xd8, 0xff]);
  return body;
};

/** Product photos through identity's storage (ADR-0030). */
describe('product images', () => {
  let app: NestExpressApplication;
  let admin: string;
  let api: ReturnType<typeof catalogApi>;
  let category: number;
  let pcs: number;
  const http = () => request(app.getHttpServer());

  /** Presigns and uploads a file the way the web does; returns its id. */
  async function upload(kind: 'catalog.product_image' | 'catalog.product_thumb', put = true) {
    const body = jpeg(kind === 'catalog.product_image' ? 2048 : 512);
    const issued = await http()
      .post('/api/v1/files/presign')
      .set(bearer(admin))
      .send({ kind, contentType: 'image/jpeg', sizeBytes: body.length })
      .expect(201);
    if (put) {
      await http()
        .put(issued.body.uploadUrl)
        .set('Content-Type', 'image/jpeg')
        .send(body)
        .expect(204);
    }
    return issued.body.fileId as number;
  }
  const attach = (productId: number, imageFileId: number, thumbFileId: number) =>
    http()
      .post(`/api/v1/products/${productId}/images`)
      .set(bearer(admin))
      .send({ imageFileId, thumbFileId });

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    api = catalogApi(app, admin);
    category = await api.category('Зураг');
    pcs = await api.uomId('PCS');
  });
  afterAll(async () => {
    await app.close();
  });

  it('attaches uploaded photos, serves them publicly and shows the primary thumbnail in lists', async () => {
    const product = await api.product({
      sku: '90001',
      name: 'Зурагтай бараа',
      categoryId: category,
      baseUomId: pcs,
    });
    const first = (
      await attach(
        product.id,
        await upload('catalog.product_image'),
        await upload('catalog.product_thumb'),
      ).expect(201)
    ).body as ImageJson;
    expect(first).toMatchObject({ isPrimary: true, sortOrder: 0 });
    expect(first.url).toMatch(/^\/api\/v1\/files\/public\/[0-9a-f-]{36}\.jpg$/);
    await http()
      .get(first.url ?? '')
      .expect(200);

    const second = (
      await attach(
        product.id,
        await upload('catalog.product_image'),
        await upload('catalog.product_thumb'),
      ).expect(201)
    ).body as ImageJson;
    expect(second).toMatchObject({ isPrimary: false, sortOrder: 1 });

    const list = await http().get('/api/v1/products?q=90001').set(bearer(admin)).expect(200);
    expect(list.body.data[0]).toMatchObject({ thumbUrl: first.thumbUrl });

    await http().post(`/api/v1/product-images/${second.id}/primary`).set(bearer(admin)).expect(200);
    await http().delete(`/api/v1/product-images/${second.id}`).set(bearer(admin)).expect(204);
    await http()
      .get(second.url ?? '')
      .expect(404);
    const detail = await api.get(product.id);
    expect(detail.images).toEqual([expect.objectContaining({ id: first.id, isPrimary: true })]);
  });

  it('refuses files of the wrong kind, missing bytes and files already attached', async () => {
    const product = await api.product({
      sku: '90002',
      name: 'Зураггүй бараа',
      categoryId: category,
      baseUomId: pcs,
    });
    const image = await upload('catalog.product_image');
    const thumb = await upload('catalog.product_thumb');
    expect((await attach(product.id, thumb, image).expect(422)).body.code).toBe(
      'FILE_KIND_MISMATCH',
    );
    const pending = await upload('catalog.product_image', false);
    expect((await attach(product.id, pending, thumb).expect(409)).body.code).toBe(
      'FILE_NOT_UPLOADED',
    );
    await attach(product.id, image, thumb).expect(201);
    const other = await api.product({
      sku: '90003',
      name: 'Өөр бараа',
      categoryId: category,
      baseUomId: pcs,
    });
    expect((await attach(other.id, image, thumb).expect(409)).body.code).toBe('FILE_NOT_UPLOADED');
  });

  it(`keeps at most ${MAX_PRODUCT_IMAGES} photos per product`, async () => {
    const product = await api.product({
      sku: '90004',
      name: 'Олон зураг',
      categoryId: category,
      baseUomId: pcs,
    });
    for (let index = 0; index < MAX_PRODUCT_IMAGES; index += 1) {
      await attach(
        product.id,
        await upload('catalog.product_image'),
        await upload('catalog.product_thumb'),
      ).expect(201);
    }
    const tooMany = await attach(
      product.id,
      await upload('catalog.product_image'),
      await upload('catalog.product_thumb'),
    ).expect(422);
    expect(tooMany.body.errors).toEqual([
      expect.objectContaining({ path: 'images', constraint: 'max' }),
    ]);
  });
});
