import { randomInt } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EXPORTABLE_PRODUCT_COLUMNS } from '@tugeel/shared/catalog';
import type { SegmentDefinition } from '@tugeel/shared/segments';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface SegmentJson {
  id: number;
  entity: string;
  kind: string;
  name: string;
  description: string | null;
  definition: SegmentDefinition | null;
}
interface MembersJson {
  changed: number;
  unchanged: number;
  count: number;
}

/**
 * Hand-picked product segments (ADR-0052): a LIST segment holds exactly the products put in,
 * whatever their data; admins create one from ticked products and add or remove members; every
 * consumer of a segment id (the product list, its ids, the export, the counts) reads the members.
 * Names carry the file's tag; product queries keep to the file's category.
 */
describe('hand-picked product segments', () => {
  const tag = `L${randomInt(10_000, 99_999)}`;
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let category: number;
  let cola: ProductJson;
  let fanta: ProductJson;
  let tea: ProductJson;
  let old: ProductJson;
  const http = () => request(app.getHttpServer());
  const idsOf = (...rows: { id: number }[]) => rows.map((row) => row.id);

  async function createList(body: Record<string, unknown>, status = 201, token = admin) {
    return http()
      .post('/api/v1/segments/lists')
      .set(bearer(token))
      .set(idempotency())
      .send(body)
      .expect(status);
  }
  async function members(
    id: number,
    productIds: number[],
    remove = false,
    status = 200,
  ): Promise<MembersJson> {
    const res = await http()
      .post(`/api/v1/segments/${id}/products${remove ? '/remove' : ''}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds })
      .expect(status);
    return res.body as MembersJson;
  }
  /** The file's products a segment keeps, in the list's order (by name). */
  async function listed(segmentId: number, extra: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/products/query')
      .set(bearer(worker))
      .send({ segmentId, categoryId: category, limit: 200, ...extra })
      .expect(200);
    return (res.body as { data: { id: number }[]; total: number }).data.map((row) => row.id);
  }

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    const catalog = catalogApi(app, admin);
    category = await catalog.category(`Жагсаалт ${tag}`);
    const pcs = await catalog.uomId('PCS');
    // Names sort as the list shows them: Кока, Фанта, Хуучин, Цай.
    cola = await catalog.product({ name: 'Кока кола', categoryId: category, baseUomId: pcs });
    fanta = await catalog.product({ name: 'Фанта', categoryId: category, baseUomId: pcs });
    tea = await catalog.product({ name: 'Цай', categoryId: category, baseUomId: pcs });
    old = await catalog.product({ name: 'Хуучин бараа', categoryId: category, baseUomId: pcs });
    await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('makes a segment of ticked products that every segment reader takes', async () => {
    // Repeats are dropped; the order sent does not matter.
    const created = await createList({
      name: `Түмний ${tag}`,
      description: 'Хоёр хайлтын бараа',
      productIds: [old.id, cola.id, old.id, fanta.id],
    });
    const segment = created.body as SegmentJson;
    expect(segment).toMatchObject({
      entity: 'PRODUCT',
      kind: 'LIST',
      name: `Түмний ${tag}`,
      description: 'Хоёр хайлтын бараа',
      definition: null,
    });
    expect(
      (await http().get(`/api/v1/segments/${segment.id}`).set(bearer(worker)).expect(200)).body,
    ).toMatchObject({ kind: 'LIST', definition: null });
    const counts = await http()
      .get('/api/v1/segments/counts')
      .query({ segmentIds: [segment.id] })
      .set(bearer(worker))
      .expect(200);
    expect(counts.body).toEqual([{ segmentId: segment.id, count: 3 }]);

    // The list, its ids and the export read the members, the inactive one too.
    expect(await listed(segment.id)).toEqual(idsOf(cola, fanta, old));
    expect(await listed(segment.id, { status: 'ACTIVE' })).toEqual(idsOf(cola, fanta));
    const where = {
      match: 'ALL',
      groups: [{ match: 'ALL', conditions: [{ field: 'search', op: 'CONTAINS', text: 'фанта' }] }],
    };
    expect(await listed(segment.id, { where })).toEqual(idsOf(fanta));
    const ids = await http()
      .post('/api/v1/products/query/ids')
      .set(bearer(worker))
      .send({ segmentId: segment.id })
      .expect(200);
    expect((ids.body as { ids: number[] }).ids).toEqual(idsOf(cola, fanta, old));
    await http()
      .post('/api/v1/exports/products')
      .set(bearer(admin))
      .send({ segmentId: segment.id, columns: EXPORTABLE_PRODUCT_COLUMNS })
      .expect(200);

    // One audit row names the products.
    const { rows } = await sql.query<{ action: string; after: { productIds: number[] } }>(
      `SELECT action, after FROM audit_log WHERE entity = 'segments' AND entity_id = $1 ORDER BY id`,
      [segment.id],
    );
    expect(rows.map((row) => [row.action, row.after.productIds])).toEqual([
      ['CREATE', [cola.id, fanta.id, old.id].sort((a, b) => a - b)],
    ]);
  });

  it('refuses unknown products, taken names, too many products and other users', async () => {
    const unknown = await createList({ name: `Буруу ${tag}`, productIds: [cola.id, 999_999] }, 422);
    expect(unknown.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'productIds', constraint: 'exists' }],
    });
    await createList({ name: `Хоосон ${tag}`, productIds: [] }, 422);
    await createList(
      { name: `Олон ${tag}`, productIds: Array.from({ length: 20_001 }, (_, at) => at + 1) },
      422,
    );
    await createList({ name: `Давхар ${tag}`, productIds: [cola.id] });
    const taken = await createList({ name: `давхар ${tag}`, productIds: [tea.id] }, 409);
    expect(taken.body).toMatchObject({ code: 'DUPLICATE_VALUE' });
    // A RULES segment of the same name is taken too: one name space per entity.
    await http()
      .post('/api/v1/segments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        entity: 'PRODUCT',
        name: `Давхар ${tag}`,
        definition: {
          match: 'ALL',
          groups: [
            { match: 'ALL', conditions: [{ field: 'stage', op: 'IN', values: ['ACTIVE'] }] },
          ],
        },
      })
      .expect(409);
    await createList({ name: `Ажилтан ${tag}`, productIds: [cola.id] }, 403, worker);
  });

  it('adds and removes members, says what changed, and replays a repeated request', async () => {
    const segment = (await createList({ name: `Нэмэх ${tag}`, productIds: [cola.id] }))
      .body as SegmentJson;
    expect(await members(segment.id, [fanta.id, cola.id, fanta.id])).toEqual({
      changed: 1,
      unchanged: 1,
      count: 2,
    });
    expect(await listed(segment.id)).toEqual(idsOf(cola, fanta));
    expect(await members(segment.id, [cola.id, tea.id], true)).toEqual({
      changed: 1,
      unchanged: 1,
      count: 1,
    });
    expect(await listed(segment.id)).toEqual(idsOf(fanta));
    // Nothing changes: no audit row.
    expect(await members(segment.id, [tea.id], true)).toEqual({
      changed: 0,
      unchanged: 1,
      count: 1,
    });
    const { rows } = await sql.query<{
      action: string;
      after: { productIds: number[]; count?: number };
    }>(
      `SELECT action, after FROM audit_log WHERE entity = 'segments' AND entity_id = $1 ORDER BY id`,
      [segment.id],
    );
    expect(rows.map((row) => [row.action, row.after.productIds, row.after.count])).toEqual([
      ['CREATE', [cola.id], undefined],
      ['ADD_PRODUCTS', [fanta.id], 2],
      ['REMOVE_PRODUCTS', [cola.id], 1],
    ]);

    // The same key replays the answer instead of adding twice.
    const key = idempotency();
    const add = () =>
      http()
        .post(`/api/v1/segments/${segment.id}/products`)
        .set(bearer(admin))
        .set(key)
        .send({ productIds: [tea.id] })
        .expect(200);
    expect((await add()).body).toEqual({ changed: 1, unchanged: 0, count: 2 });
    expect((await add()).body).toEqual({ changed: 1, unchanged: 0, count: 2 });
    expect(await listed(segment.id)).toEqual(idsOf(fanta, tea));

    // Unknown products are refused before anything changes.
    await members(segment.id, [999_999], false, 422);
  });

  it('keeps conditions and lists apart, and an archived list unusable', async () => {
    const rules = await http()
      .post('/api/v1/segments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        entity: 'PRODUCT',
        name: `Нөхцөл ${tag}`,
        definition: {
          match: 'ALL',
          groups: [
            { match: 'ALL', conditions: [{ field: 'stage', op: 'IN', values: ['ACTIVE'] }] },
          ],
        },
      })
      .expect(201);
    const rulesId = (rules.body as SegmentJson).id;
    expect(rules.body).toMatchObject({ kind: 'RULES' });
    const notList = await http()
      .post(`/api/v1/segments/${rulesId}/products`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id] })
      .expect(422);
    expect(notList.body).toMatchObject({ errors: [{ path: 'id', constraint: 'kind' }] });
    // A RULES segment still needs its conditions; a list takes only a name and a description.
    await http()
      .put(`/api/v1/segments/${rulesId}`)
      .set(bearer(admin))
      .send({ name: `Нөхцөл ${tag}` })
      .expect(422);
    const list = (await createList({ name: `Солих ${tag}`, productIds: [cola.id] }))
      .body as SegmentJson;
    const withConditions = await http()
      .put(`/api/v1/segments/${list.id}`)
      .set(bearer(admin))
      .send({ name: `Солих ${tag}`, definition: (rules.body as SegmentJson).definition })
      .expect(422);
    expect(withConditions.body).toMatchObject({
      errors: [{ path: 'definition', constraint: 'notAllowed' }],
    });
    const renamed = await http()
      .put(`/api/v1/segments/${list.id}`)
      .set(bearer(admin))
      .send({ name: `Шинэ нэр ${tag}`, description: 'Тайлбар' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      kind: 'LIST',
      name: `Шинэ нэр ${tag}`,
      description: 'Тайлбар',
      definition: null,
    });
    expect(await listed(list.id)).toEqual(idsOf(cola));

    await http().delete(`/api/v1/segments/${list.id}`).set(bearer(admin)).expect(204);
    await members(list.id, [fanta.id], false, 404);
    await http()
      .post('/api/v1/products/query')
      .set(bearer(worker))
      .send({ segmentId: list.id })
      .expect(404);
  });
});
