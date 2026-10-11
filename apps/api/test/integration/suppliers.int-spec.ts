import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { ProductSuppliersService, SuppliersService } from '../../src/modules/partners';
import { createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

interface LinkJson {
  id: number;
  productId: number;
  isMain: boolean;
  supplier: { id: number; code: string; name: string };
}

/** Suppliers and the product ↔ supplier link (SPEC §5.3, ADR-0032). */
describe('suppliers and product links', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  let worker: string;
  let api: ReturnType<typeof partnersApi>;
  let catalog: ReturnType<typeof catalogApi>;
  let category: number;
  let pcs: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    office = await token('OFFICE');
    worker = await token('WAREHOUSE');
    api = partnersApi(app, admin);
    catalog = catalogApi(app, admin);
    category = await catalog.category('Хүнс');
    pcs = await catalog.uomId('PCS');
  });
  afterAll(async () => {
    await app.close();
  });

  it('registers suppliers with normalised numbers, unique names and allocated codes', async () => {
    const msm = await api.supplier({
      code: '010',
      name: 'МСМ ХХК',
      tin: '123 456 789 01',
      phone: '7011-2233',
      email: ' Sales@MSM.mn ',
      bankName: 'Хаан банк',
      bankAccount: 'mn12 0005 00 5012345678',
      paymentTermDays: 30,
    });
    expect(msm).toMatchObject({
      code: '010',
      tin: '12345678901',
      phone: '+97670112233',
      email: 'sales@msm.mn',
      bankAccount: 'MN120005005012345678',
      paymentTermDays: 30,
    });
    const next = await api.supplier({ name: 'Номин Трейд' });
    expect(next.code).toBe('011');
    const twin = await http()
      .post('/api/v1/suppliers')
      .set(bearer(admin))
      .set(idempotency())
      .send({ name: 'мсм ххк' })
      .expect(409);
    expect(twin.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'suppliers_name_key_key' },
    });
    const badTin = await http()
      .post('/api/v1/suppliers')
      .set(bearer(admin))
      .set(idempotency())
      .send({ name: 'Буруу ТТД', tin: '12345' })
      .expect(422);
    expect(badTin.body.errors).toEqual([expect.objectContaining({ path: 'tin' })]);

    const contact = await http()
      .post(`/api/v1/suppliers/${msm.id}/contacts`)
      .set(bearer(admin))
      .send({ name: 'Сараа', position: 'Борлуулалт', phone: '99887766' })
      .expect(201);
    expect(contact.body).toMatchObject({ phone: '+97699887766' });
  });

  it('lets every user read suppliers and only admins change them', async () => {
    const list = await http()
      .get('/api/v1/suppliers')
      .query({ q: 'msm' })
      .set(bearer(worker))
      .expect(200);
    expect(list.body.data.map((row: { name: string }) => row.name)).toEqual(['МСМ ХХК']);
    await http()
      .post('/api/v1/suppliers')
      .set(bearer(office))
      .set(idempotency())
      .send({ name: 'Оффисоос' })
      .expect(403);
    const found = await app.get(SuppliersService).findByNames(['  мсм   ххк ']);
    expect(found.map((row) => row.code)).toEqual(['010']);
  });

  it('gives a product one main supplier, moves it and promotes the next on unlink', async () => {
    const flour = await catalog.product({
      sku: '7001',
      name: 'Гурил',
      categoryId: category,
      baseUomId: pcs,
    });
    const first = await api.supplier({ name: 'Гурилын үйлдвэр' });
    const second = await api.supplier({ name: 'Бөөний төв' });
    const link = async (supplierId: number) =>
      (
        await http()
          .post('/api/v1/product-suppliers')
          .set(bearer(admin))
          .send({ productId: flour.id, supplierId })
          .expect(201)
      ).body as LinkJson;
    const a = await link(first.id);
    const b = await link(second.id);
    expect([a.isMain, b.isMain]).toEqual([true, false]);
    const again = await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId: flour.id, supplierId: first.id })
      .expect(409);
    expect(again.body.params).toEqual({ constraint: 'product_suppliers_pair_key' });
    await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId: 999999, supplierId: first.id })
      .expect(404);

    await http().post(`/api/v1/product-suppliers/${b.id}/main`).set(bearer(admin)).expect(200);
    const ofProduct = async () =>
      (
        await http()
          .get('/api/v1/product-suppliers')
          .query({ productId: flour.id })
          .set(bearer(worker))
          .expect(200)
      ).body.data as LinkJson[];
    expect((await ofProduct()).map((row) => [row.supplier.name, row.isMain])).toEqual([
      ['Бөөний төв', true],
      ['Гурилын үйлдвэр', false],
    ]);
    const main = await app.get(ProductSuppliersService).mainSupplierOf([flour.id]);
    expect(main.get(flour.id)).toBe(second.id);

    await http().delete(`/api/v1/product-suppliers/${b.id}`).set(bearer(admin)).expect(204);
    expect((await ofProduct()).map((row) => [row.supplier.name, row.isMain])).toEqual([
      ['Гурилын үйлдвэр', true],
    ]);
    await http().post(`/api/v1/product-suppliers/${a.id}/main`).set(bearer(office)).expect(403);

    const products = await http()
      .get(`/api/v1/suppliers/${first.id}/products`)
      .set(bearer(worker))
      .expect(200);
    expect(products.body.data).toEqual([
      expect.objectContaining({
        isMain: true,
        product: expect.objectContaining({ sku: '7001', name: 'Гурил', baseUnitName: 'ш' }),
      }),
    ]);
  });

  it('refuses goods from a deactivated supplier', async () => {
    const old = await api.supplier({ name: 'Хуучин нийлүүлэгч' });
    await http()
      .patch(`/api/v1/suppliers/${old.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    const suppliers = app.get(SuppliersService);
    expect(await codeOf(suppliers.assertActive(app.get<Db>(DB), old.id))).toBe('SUPPLIER_INACTIVE');
  });
});
