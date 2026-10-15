import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, salesApi } from '../harness/sales';

interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
  errors?: { path: string; constraint: string }[];
}
interface StageJson {
  id: number;
  name: string;
  position: number;
  action: string;
  cardSort: string;
  printPickList: boolean;
  printDeliveryNote: boolean;
  archivedAt: string | null;
  roles: { VIEW: number[]; EDIT: number[]; MOVE: number[] };
}
interface PipelineJson {
  id: number;
  boardId: number;
  name: string;
  visibility: string;
  ownOrdersOnly: boolean;
  archivedAt: string | null;
  roles: { VIEW: number[]; MANAGE: number[]; ALL_ORDERS: number[] };
  canManage: boolean;
  stages: StageJson[];
}
interface BoardJson {
  id: number;
  name: string;
  archivedAt: string | null;
  pipelines: {
    id: number;
    name: string;
    archivedAt: string | null;
    createdByName: string | null;
  }[];
}

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action = 'NONE', fields: Record<string, unknown> = {}) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
  ...fields,
});
const asInput = (stage: StageJson) => ({
  id: stage.id,
  name: stage.name,
  action: stage.action,
  printPickList: stage.printPickList,
  printDeliveryNote: stage.printDeliveryNote,
  roles: stage.roles,
});

/**
 * Boards and pipelines (ADR-0057): boards as groups, a pipeline saved whole with its stages,
 * visibility, MANAGE and ALL_ORDERS roles, copying, archiving and the refusals that keep orders
 * in live stages. Synthetic data only.
 */
describe('sales pipelines', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let accountant: string;
  let water: ProductJson;
  let shop: CustomerJson;
  let roleIds: { office: number; accountant: number; warehouse: number };
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const tree = async (token: string, archived = false) =>
    (
      await http()
        .get('/api/v1/sales-boards')
        .query(archived ? { archived: 'true' } : {})
        .set(bearer(token))
        .expect(200)
    ).body as BoardJson[];
  const board = async (name: string) =>
    (
      (await http().post('/api/v1/sales-boards').set(bearer(admin)).send({ name }).expect(201))
        .body as { id: number }
    ).id;
  const pipelineBody = (boardId: number, fields: Record<string, unknown> = {}) => ({
    boardId,
    name: 'Бөөний борлуулалт',
    visibility: 'PUBLIC',
    ownOrdersOnly: false,
    roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
    stages: [
      stageBody('Ирсэн'),
      stageBody('Нөөцөлсөн', 'CONFIRM'),
      stageBody('Цуцалсан', 'CANCEL'),
    ],
    ...fields,
  });
  const create = async (body: Record<string, unknown>) =>
    (await http().post('/api/v1/sales-pipelines').set(bearer(admin)).send(body).expect(201))
      .body as PipelineJson;
  const save = (token: string, id: number, body: Record<string, unknown>) =>
    http().put(`/api/v1/sales-pipelines/${id}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    const roles = (
      (await http().get('/api/v1/roles').set(bearer(admin)).expect(200)).body as {
        data: { id: number; code: string | null }[];
      }
    ).data;
    const roleId = (code: string) => roles.find((role) => role.code === code)?.id ?? 0;
    roleIds = {
      office: roleId('OFFICE'),
      accountant: roleId('ACCOUNTANT'),
      warehouse: roleId('WAREHOUSE'),
    };
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SP1');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Дамжлагын бараа');
    water = await catalog.product({
      sku: '7911',
      name: 'Рашаан',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventory.setHome(water.id, wh.id);
    const pricing = pricingApi(app, admin);
    await pricing.terms(water.id, '500', await pricing.profile('Дамжлага'), null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [water.id] })
      .expect(200);
    shop = await partnersApi(app, admin).customer({ name: 'Дамжлагын дэлгүүр' });
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('keeps boards as groups: created, renamed and archived by managers only', async () => {
    await http()
      .post('/api/v1/sales-boards')
      .set(bearer(office))
      .send({ name: 'Хархорин' })
      .expect(403);
    const id = await board('  Хархорин  ');
    await http()
      .put(`/api/v1/sales-boards/${id}`)
      .set(bearer(admin))
      .send({ name: 'Хархорин салбар' })
      .expect(204);
    // An empty board shows to managers only.
    expect((await tree(admin)).map((entry) => entry.name)).toContain('Хархорин салбар');
    expect((await tree(office)).map((entry) => entry.name)).not.toContain('Хархорин салбар');
    const pipeline = await create(pipelineBody(id));
    const officeTree = await tree(office);
    expect(officeTree.find((entry) => entry.id === id)?.pipelines).toEqual([
      expect.objectContaining({
        id: pipeline.id,
        name: 'Бөөний борлуулалт',
        createdByName: expect.any(String),
      }),
    ]);
    // A board holding a live pipeline is not archived.
    expect(
      (
        (await http().delete(`/api/v1/sales-boards/${id}`).set(bearer(admin)).expect(409))
          .body as ProblemJson
      ).code,
    ).toBe('BOARD_NOT_EMPTY');
    await http()
      .post(`/api/v1/sales-pipelines/${pipeline.id}/archive`)
      .set(bearer(admin))
      .expect(204);
    await http().delete(`/api/v1/sales-boards/${id}`).set(bearer(admin)).expect(204);
    expect((await tree(admin)).map((entry) => entry.id)).not.toContain(id);
    expect((await tree(admin, true)).find((entry) => entry.id === id)?.archivedAt).not.toBeNull();
    // A pipeline of an archived board does not come back alone.
    await http()
      .post(`/api/v1/sales-pipelines/${pipeline.id}/unarchive`)
      .set(bearer(admin))
      .expect(422);
    await http().post(`/api/v1/sales-boards/${id}/unarchive`).set(bearer(admin)).expect(204);
    await http()
      .post(`/api/v1/sales-pipelines/${pipeline.id}/unarchive`)
      .set(bearer(admin))
      .expect(204);
  });

  it('saves a pipeline whole: settings, roles and its stages in their new order', async () => {
    const boardId = await board('Хөвсгөл');
    const created = await create(
      pipelineBody(boardId, {
        roles: { VIEW: [], MANAGE: [roleIds.office], ALL_ORDERS: [roleIds.warehouse] },
      }),
    );
    // ALL_ORDERS only while own orders only is on; VIEW only when private.
    expect(created.roles).toEqual({ VIEW: [], MANAGE: [roleIds.office], ALL_ORDERS: [] });
    expect(created.stages.map((stage) => `${stage.position}:${stage.name}`)).toEqual([
      '0:Ирсэн',
      '1:Нөөцөлсөн',
      '2:Цуцалсан',
    ]);
    const [arrived, reserved, cancelled] = created.stages;
    if (!arrived || !reserved || !cancelled) throw new Error('stages');
    // The office (a MANAGE role) saves it: «Цуцалсан» goes first, «Ирсэн» renamed, «Нөөцөлсөн»
    // left out (archived), a new stage added.
    const saved = (
      await save(office, created.id, {
        ...pipelineBody(boardId),
        name: 'Хөвсгөл бөөний',
        roles: { VIEW: [], MANAGE: [roleIds.office], ALL_ORDERS: [] },
        stages: [
          asInput(cancelled),
          { ...asInput(arrived), name: 'Шинэ ирсэн' },
          stageBody('Хүргэлт'),
        ],
      }).expect(200)
    ).body as PipelineJson;
    expect(saved.name).toBe('Хөвсгөл бөөний');
    expect(
      saved.stages.map((stage) => [stage.name, stage.position, stage.archivedAt === null]),
    ).toEqual([
      ['Цуцалсан', 0, true],
      ['Шинэ ирсэн', 1, true],
      ['Нөөцөлсөн', 1, false],
      ['Хүргэлт', 2, true],
    ]);
    // A stage of another pipeline, or twice the same, is refused; at least one stage.
    expect(
      (
        (
          await save(admin, created.id, {
            ...pipelineBody(boardId),
            stages: [{ ...asInput(reserved) }],
          }).expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'stages.0.id' })]);
    await save(admin, created.id, { ...pipelineBody(boardId), stages: [] }).expect(422);
    // The office may save but neither create nor copy.
    await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(office))
      .send(pipelineBody(boardId))
      .expect(403);
    await http()
      .post(`/api/v1/sales-pipelines/${created.id}/copy`)
      .set(bearer(office))
      .send({ name: 'Хуулбар', boardId })
      .expect(403);
    // The accountant (no MANAGE role) may not save.
    await save(accountant, created.id, pipelineBody(boardId)).expect(403);
    // A stage holding an unfinished order stays: refused with its name.
    const kept = saved.stages.filter((stage) => stage.archivedAt === null);
    const first = kept[1];
    if (!first) throw new Error('stage');
    const order = await salesApi(app, office).draft(
      orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], {
        pipelineId: created.id,
        stageId: first.id,
      }),
    );
    expect(order.stageId).toBe(first.id);
    const refused = (
      await save(admin, created.id, {
        ...pipelineBody(boardId),
        stages: kept.filter((stage) => stage.id !== first.id).map(asInput),
      }).expect(409)
    ).body as ProblemJson;
    expect(refused).toMatchObject({
      code: 'STAGE_IN_USE',
      params: { name: 'Шинэ ирсэн', count: 1 },
    });
    // Neither is the pipeline archived while the order is unfinished.
    expect(
      (
        (
          await http()
            .post(`/api/v1/sales-pipelines/${created.id}/archive`)
            .set(bearer(admin))
            .expect(409)
        ).body as ProblemJson
      ).code,
    ).toBe('PIPELINE_IN_USE');
    await salesApi(app, office).cancel(order.id, 'Тест').expect(200);
    const audit = await sql.query<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_log
        WHERE (entity = 'sales_pipelines' AND entity_id = $1)
           OR (entity = 'sales_stages' AND entity_id IN (SELECT id::text FROM sales_stages WHERE pipeline_id = $2))
        ORDER BY id`,
      [String(created.id), created.id],
    );
    expect(audit.rows.map((row) => `${row.entity}:${row.action}`)).toEqual([
      'sales_pipelines:CREATE',
      'sales_stages:CREATE',
      'sales_stages:CREATE',
      'sales_stages:CREATE',
      'sales_pipelines:UPDATE',
      'sales_stages:ARCHIVE',
      'sales_stages:UPDATE',
      'sales_stages:UPDATE',
      'sales_stages:CREATE',
    ]);
  });

  it('shows a private pipeline to its roles, copies a pipeline and archives one', async () => {
    const boardId = await board('Нууц самбар');
    const hidden = await create(
      pipelineBody(boardId, {
        name: 'Нууц',
        visibility: 'PRIVATE',
        ownOrdersOnly: true,
        roles: { VIEW: [roleIds.accountant], MANAGE: [], ALL_ORDERS: [roleIds.warehouse] },
      }),
    );
    expect(hidden.roles).toEqual({
      VIEW: [roleIds.accountant],
      MANAGE: [],
      ALL_ORDERS: [roleIds.warehouse],
    });
    await http().get(`/api/v1/sales-pipelines/${hidden.id}`).set(bearer(office)).expect(404);
    await http().get(`/api/v1/sales-pipelines/${hidden.id}/cards`).set(bearer(office)).expect(404);
    expect((await tree(office)).map((entry) => entry.id)).not.toContain(boardId);
    await http().get(`/api/v1/sales-pipelines/${hidden.id}`).set(bearer(accountant)).expect(200);
    // An order cannot be placed in a pipeline the caller does not see.
    await salesApi(app, office)
      .create(
        orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], { pipelineId: hidden.id }),
      )
      .expect(404);
    // The copy keeps the settings, roles, stages and their sorts, never orders.
    await http()
      .put(`/api/v1/sales-stages/${hidden.stages[0]?.id}/sort`)
      .set(bearer(admin))
      .send({ sort: 'TOTAL' })
      .expect(200);
    const copy = (
      await http()
        .post(`/api/v1/sales-pipelines/${hidden.id}/copy`)
        .set(bearer(admin))
        .send({ name: 'Нууц хуулбар', boardId })
        .expect(201)
    ).body as PipelineJson;
    expect(copy).toMatchObject({
      name: 'Нууц хуулбар',
      visibility: 'PRIVATE',
      ownOrdersOnly: true,
      roles: hidden.roles,
    });
    expect(copy.stages.map((stage) => [stage.name, stage.action, stage.cardSort])).toEqual([
      ['Ирсэн', 'NONE', 'TOTAL'],
      ['Нөөцөлсөн', 'CONFIRM', 'NEWEST'],
      ['Цуцалсан', 'CANCEL', 'NEWEST'],
    ]);
    // Archived, its channel default goes; restored, it is back.
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'SALES_REP', pipelineId: copy.id, stageId: copy.stages[0]?.id })
      .expect(200);
    await http().post(`/api/v1/sales-pipelines/${copy.id}/archive`).set(bearer(admin)).expect(204);
    const channels = (
      await http().get('/api/v1/sales-settings/channels').set(bearer(office)).expect(200)
    ).body as { channel: string }[];
    expect(channels.map((entry) => entry.channel)).not.toContain('SALES_REP');
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'SALES_REP', pipelineId: copy.id, stageId: copy.stages[0]?.id })
      .expect(422);
    await http()
      .post(`/api/v1/sales-pipelines/${copy.id}/unarchive`)
      .set(bearer(admin))
      .expect(204);
    const restored = (await tree(admin)).find((entry) => entry.id === boardId);
    expect(restored?.pipelines.map((pipeline) => pipeline.name)).toEqual(['Нууц', 'Нууц хуулбар']);
  });
});
