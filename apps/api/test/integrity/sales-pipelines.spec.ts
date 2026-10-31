import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import type { AuthContext } from '../../src/modules/identity';
import {
  type OrderInput,
  SalesBoardsService,
  SalesOrdersService,
  SalesPipelinesService,
  type StageInput,
} from '../../src/modules/sales';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageInput = (name: string, id?: number): StageInput => ({
  ...(id ? { id } : {}),
  name,
  action: 'NONE',
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
});

/**
 * Pipelines under concurrency (ADR-0057 #3, #4): a stage being archived while a card moves into
 * it never ends up holding an unfinished order, and orders created at once in two pipelines take
 * one gap-free run of numbers from the shared counter.
 */
describe('integrity: sales pipelines', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let orders: SalesOrdersService;
  let pipelines: SalesPipelinesService;
  let actor: AuthContext;
  let boardId: number;
  let customerId: number;
  let water: ProductJson;
  const http = () => request(app.getHttpServer());

  const input = (pipelineId: number, stageId: number | null = null): OrderInput => ({
    customerId,
    pipelineId,
    stageId,
    fulfilment: 'PICKUP',
    deliveryDate: addDays(businessDate(), 1),
    addressId: null,
    contactName: null,
    contactPhone: null,
    paymentMethod: 'CASH',
    note: null,
    lines: [{ productUnitId: unitOf(water, 'PCS').id, qty: new Decimal('1') }],
  });
  const pipeline = (name: string, stages: StageInput[]) =>
    pipelines.create(actor, {
      boardId,
      name,
      visibility: 'PUBLIC',
      kind: 'SALES',
      transferWarehouseId: null,
      ownOrdersOnly: false,
      roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
      stages,
    });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    orders = app.get(SalesOrdersService);
    pipelines = app.get(SalesPipelinesService);
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    actor = staffContext(adminUser.id, 'ADMIN');
    const admin = (await login(app, adminUser)).accessToken;
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('RACE-SP');
    const catalog = catalogApi(app, admin);
    water = await catalog.product({
      sku: '7821',
      name: 'Цэвэр ус',
      categoryId: await catalog.category('Дамжлагын уралдаан'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventory.setHome(water.id, wh.id);
    const pricing = pricingApi(app, admin);
    await pricing.terms(water.id, '500', await pricing.profile('Уралдаан Д'), null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [water.id] })
      .expect(200);
    customerId = (await partnersApi(app, admin).customer({ name: 'Уралдааны дэлгүүр' })).id;
    boardId = await app.get(SalesBoardsService).create(actor, { name: 'Уралдаан', branchId: null });
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('never leaves an unfinished order in a stage archived while a card moves into it', async () => {
    for (let round = 0; round < 6; round += 1) {
      const id = await pipeline(`Зөөлт ${round}`, [stageInput('Эхэн'), stageInput('Төгсгөл')]);
      const detail = await pipelines.get(actor, id);
      const [from, to] = detail.pipeline.stages;
      if (!from || !to) throw new Error('stages');
      const order = await orders.create(actor, input(id));
      const results = await Promise.allSettled([
        orders.move(actor, order.id, { stageId: to.id }),
        pipelines.update(actor, id, {
          boardId,
          name: `Зөөлт ${round}`,
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          kind: 'SALES',
          transferWarehouseId: null,
          roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
          stages: [stageInput('Эхэн', from.id)],
        }),
      ]);
      // Exactly one wins: the move (the stage then holds the order) or the archive.
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const held = await sql.query<{ held: string }>(
        `SELECT count(*)::text AS held FROM sales_orders o JOIN sales_stages s ON s.id = o.stage_id
          WHERE s.archived_at IS NOT NULL AND o.status NOT IN ('DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED')`,
      );
      expect(held.rows[0]?.held).toBe('0');
      await orders.cancel(actor, order.id, 'Тест');
    }
  });

  it('numbers orders created at once in two pipelines without a gap or a repeat', async () => {
    const left = await pipeline('Зүүн', [stageInput('Ирсэн')]);
    const right = await pipeline('Баруун', [stageInput('Ирсэн')]);
    const created = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        orders.create(actor, input(index % 2 ? left : right)),
      ),
    );
    const numbers = created.map((order) => order.number ?? '');
    expect(new Set(numbers).size).toBe(10);
    const prefix = `${businessDate().replaceAll('-', '')}_`;
    expect(numbers.every((number) => number.startsWith(prefix))).toBe(true);
    const counters = numbers
      .map((number) => Number.parseInt(number.slice(prefix.length), 10))
      .sort((a, b) => a - b);
    const first = counters[0] ?? 0;
    expect(counters).toEqual(Array.from({ length: 10 }, (_, index) => first + index));
    for (const order of created) await orders.cancel(actor, order.id, 'Тест');
  });
});
