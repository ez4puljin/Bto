import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface ProgramJson {
  id: number;
  name: string;
  status: string;
  state: string;
  priority: boolean;
  targetKind: string | null;
  targetIds: number[];
  excludeProductIds: number[];
  namedProducts: { id: number; name: string }[];
  createdByName: string | null;
  updatedAt: string;
}

interface QuoteJson {
  total: string;
  lines: {
    productId: number;
    total: string;
    discountAmount: string;
    parts: { unitPrice: string; applied: { programId: number; effect: string }[] }[];
  }[];
}

/**
 * The plan conditions in the discount programs (ADR-0159): a set of products by supplier, category,
 * chosen products or segment less its exclusions, N+M, rounding, priority, the places it serves,
 * and what a person does with a plan: edit it after it started, archive it, delete it, filter the
 * list. The arithmetic itself is cart.test.ts; here the targets are read from the real tables and
 * an order keeps its quantity. Synthetic data only.
 */
describe('discount plans', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let milk: ProductJson;
  let kefir: ProductJson;
  let soap: ProductJson;
  let supplierA: number;
  let supplierB: number;
  let dairy: number;
  let cultured: number;
  let shop: CustomerJson;
  let pipelineId: number;
  let otherPipelineId: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;

  const plan = (fields: Record<string, unknown>) => ({
    name: 'Төлөвлөгөө',
    list: 'WHOLESALE',
    scope: 'PRODUCT',
    measure: 'QTY',
    effect: 'PERCENT',
    validFrom: today,
    steps: [{ threshold: '0', value: '10' }],
    ...fields,
  });
  const create = async (fields: Record<string, unknown>) =>
    (
      await http()
        .post('/api/v1/discount-programs')
        .set(bearer(admin))
        .set(idempotency())
        .send(plan(fields))
        .expect(201)
    ).body as ProgramJson;
  const refused = async (fields: Record<string, unknown>) =>
    (
      await http()
        .post('/api/v1/discount-programs')
        .set(bearer(admin))
        .set(idempotency())
        .send(plan(fields))
        .expect(422)
    ).body as { errors: { path: string; constraint: string }[] };
  const remove = (id: number) =>
    http().delete(`/api/v1/discount-programs/${id}`).set(bearer(admin)).expect(204);
  const quote = async (
    lines: [ProductJson, string][],
    place: { pipelineId?: number; list?: string } = {},
  ) =>
    (
      await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(office))
        .send({
          ...place,
          lines: lines.map(([product, qty]) => ({ productUnitId: pcs(product), qty })),
        })
        .expect(200)
    ).body as QuoteJson;
  /** The unit price each product comes to, alone in its own cart. */
  const prices = async (...products: ProductJson[]) => {
    const quoted = [];
    for (const product of products) {
      const result = await quote([[product, '1']]);
      quoted.push(result.lines[0]?.parts[0]?.unitPrice);
    }
    return quoted;
  };
  const listed = async (query: Record<string, unknown>) =>
    (
      (await http().get('/api/v1/discount-programs').query(query).set(bearer(office)).expect(200))
        .body as { data: ProgramJson[] }
    ).data.map((program) => program.name);
  /** One plan in force for the length of a test. */
  const during = async (fields: Record<string, unknown>, run: () => Promise<void>) => {
    const created = await create(fields);
    try {
      await run();
    } finally {
      await remove(created.id);
    }
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    dairy = await catalog.category('Сүүн бүтээгдэхүүн');
    cultured = await catalog.category('Исгэлэн сүү', dairy);
    const home = await catalog.category('Ахуйн бараа');
    const base = await catalog.uomId('PCS');
    const product = (sku: string, name: string, categoryId: number) =>
      catalog.product({ sku, name, categoryId, baseUomId: base });
    milk = await product('8801', 'Сүү', dairy);
    kefir = await product('8802', 'Тараг', cultured);
    soap = await product('8803', 'Саван', home);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Төлөвлөгөөний үнэ');
    for (const own of [milk, kefir, soap]) await pricing.terms(own.id, '1000', profile, null);
    const partners = partnersApi(app, admin);
    supplierA = (await partners.supplier({ name: 'Нийлүүлэгч А', phone: '99110011' })).id;
    supplierB = (await partners.supplier({ name: 'Нийлүүлэгч Б', phone: '99110022' })).id;
    const link = async (productId: number, supplierId: number) =>
      http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    await link(milk.id, supplierA);
    await link(kefir.id, supplierA);
    await link(kefir.id, supplierB);
    await link(soap.id, supplierB);

    const board = (
      await http()
        .post('/api/v1/sales-boards')
        .set(bearer(admin))
        .send({ name: 'Самбар' })
        .expect(201)
    ).body as { id: number };
    const stage = (name: string, action: string) => ({
      name,
      action,
      printPickList: false,
      printDeliveryNote: false,
      roles: { VIEW: [], EDIT: [], MOVE: [] },
    });
    const pipeline = async (name: string) =>
      (
        (
          await http()
            .post('/api/v1/sales-pipelines')
            .set(bearer(admin))
            .send({
              boardId: board.id,
              name,
              visibility: 'PUBLIC',
              ownOrdersOnly: false,
              roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
              stages: [stage('Захиалга', 'NONE'), stage('Хяналт', 'CONFIRM')],
            })
            .expect(201)
        ).body as { id: number }
      ).id;
    pipelineId = await pipeline('Заал');
    otherPipelineId = await pipeline('Хөдөө');

    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('DP1');
    const bin = await inventory.bin(wh.id, 'A-01-01');
    for (const own of [milk, kefir, soap]) await inventory.setHome(own.id, wh.id);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [milk.id, kefir.id, soap.id] })
      .expect(200);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs(milk), enteredQty: '50', binId: bin.id, unitCost: '500' }],
      })
      .expect(201);
    const adjustment = (created.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${adjustment}/submit`).set(bearer(admin)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${adjustment}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);
    shop = await partners.customer({ name: 'Төлөвлөгөөний дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  describe('what it applies to', () => {
    it('takes a supplier’s linked products, less the excluded products and suppliers', async () => {
      await during({ targetKind: 'SUPPLIER', targetIds: [supplierA] }, async () => {
        expect(await prices(milk, kefir, soap)).toEqual(['900', '900', '1000']);
      });
      await during(
        { targetKind: 'SUPPLIER', targetIds: [supplierA], excludeProductIds: [milk.id] },
        async () => {
          expect(await prices(milk, kefir, soap)).toEqual(['1000', '900', '1000']);
        },
      );
      // Тараг comes from both suppliers: excluding Б takes it out.
      await during(
        { targetKind: 'SUPPLIER', targetIds: [supplierA], excludeTargetIds: [supplierB] },
        async () => {
          expect(await prices(milk, kefir, soap)).toEqual(['900', '1000', '1000']);
        },
      );
    });

    it('takes a category with its subtree, less an excluded category', async () => {
      await during({ targetKind: 'CATEGORY', targetIds: [dairy] }, async () => {
        expect(await prices(milk, kefir, soap)).toEqual(['900', '900', '1000']);
      });
      await during(
        { targetKind: 'CATEGORY', targetIds: [dairy], excludeTargetIds: [cultured] },
        async () => {
          expect(await prices(milk, kefir, soap)).toEqual(['900', '1000', '1000']);
        },
      );
    });

    it('takes several chosen products and names them', async () => {
      const created = await create({ targetKind: 'PRODUCT', targetIds: [milk.id, soap.id] });
      expect(created.namedProducts.map((product) => product.name).sort()).toEqual(['Саван', 'Сүү']);
      expect(await prices(milk, kefir, soap)).toEqual(['900', '1000', '900']);
      await remove(created.id);
    });

    it('takes a segment’s members, and nothing once the segment is gone', async () => {
      const segment = (
        await http()
          .post('/api/v1/segments/lists')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name: 'Төлөвлөгөөний сегмент', productIds: [soap.id] })
          .expect(201)
      ).body as { id: number };
      const created = await create({ targetKind: 'SEGMENT', targetIds: [segment.id] });
      expect(await prices(milk, soap)).toEqual(['1000', '900']);
      await http().delete(`/api/v1/segments/${segment.id}`).set(bearer(admin)).expect(204);
      // Saving any plan reads the segment afresh; the quote itself must not refuse.
      await during({ targetKind: 'PRODUCT', targetIds: [kefir.id] }, async () => {
        expect(await prices(milk, soap)).toEqual(['1000', '1000']);
      });
      await remove(created.id);
      await http()
        .post('/api/v1/discount-programs')
        .set(bearer(admin))
        .set(idempotency())
        .send(plan({ targetKind: 'SEGMENT', targetIds: [segment.id] }))
        .expect(404);
    });

    it('counts a set together by its amount', async () => {
      await during(
        {
          scope: 'CATEGORY',
          measure: 'AMOUNT',
          targetKind: 'SUPPLIER',
          targetIds: [supplierA],
          steps: [{ threshold: '2000', value: '10' }],
        },
        async () => {
          const below = await quote([[milk, '1']]);
          expect(below.total).toBe('1000');
          const reached = await quote([
            [milk, '1'],
            [kefir, '1'],
            [soap, '1'],
          ]);
          expect(reached.lines.map((line) => line.total)).toEqual(['900', '900', '1000']);
        },
      );
    });

    it('refuses what the shape does not allow', async () => {
      expect(await refused({ targetKind: 'SUPPLIER', targetIds: [] })).toMatchObject({
        errors: [{ path: 'targetIds' }],
      });
      expect(
        await refused({ productId: milk.id, targetKind: 'SUPPLIER', targetIds: [supplierA] }),
      ).toMatchObject({ errors: [{ path: 'scope', constraint: 'TARGET_NOT_ALLOWED' }] });
      expect(
        await refused({
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          excludeProductIds: [kefir.id],
        }),
      ).toMatchObject({ errors: [{ path: 'excludeProductIds' }] });
      expect(
        await refused({
          scope: 'ORDER',
          measure: 'AMOUNT',
          priority: true,
          steps: [{ threshold: '0', value: '5' }],
        }),
      ).toMatchObject({ errors: [{ path: 'priority' }] });
      expect(
        await refused({
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          effect: 'BONUS',
          adjustKind: 'ROUND',
          adjustFactor: 10,
          steps: [{ threshold: '1', value: '1' }],
        }),
      ).toMatchObject({ errors: [{ path: 'adjustKind' }] });
      expect(
        await refused({
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          adjustKind: 'ENDS_9',
          adjustFactor: 50,
        }),
      ).toMatchObject({ errors: [{ path: 'adjustFactor' }] });
      expect(
        await refused({ targetKind: 'PRODUCT', targetIds: [milk.id], tillIds: [1] }),
      ).toMatchObject({ errors: [{ path: 'tillIds' }] });
      expect(
        await refused({
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          list: 'RETAIL',
          pipelineIds: [pipelineId],
        }),
      ).toMatchObject({ errors: [{ path: 'pipelineIds' }] });
    });
  });

  describe('what it does', () => {
    it('rounds the price and lets a priority plan apply alone', async () => {
      await during(
        {
          name: 'Тоймтой',
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          steps: [{ threshold: '0', value: '7' }],
          adjustKind: 'ENDS_9',
          adjustFactor: 100,
        },
        async () => {
          expect(await prices(milk)).toEqual(['899']);
          await during(
            {
              name: 'Давуу',
              priority: true,
              targetKind: 'SUPPLIER',
              targetIds: [supplierA],
              steps: [{ threshold: '0', value: '50' }],
            },
            async () => {
              // Alone: not 50 % off 899.
              expect(await prices(milk)).toEqual(['500']);
            },
          );
          expect(await prices(milk)).toEqual(['899']);
        },
      );
    });

    it('takes 1+1 off an order’s line, the order and its stock keeping the quantity written', async () => {
      await during(
        {
          name: '1+1',
          effect: 'BONUS',
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          steps: [{ threshold: '1', value: '1' }],
        },
        async () => {
          const orders = salesApi(app, office);
          const draft = (
            await orders
              .create(orderBody(shop.id, [{ productUnitId: pcs(milk), qty: '3' }]))
              .expect(201)
          ).body as OrderJson;
          const confirmed = (await orders.submit(draft.id).expect(200)).body as OrderJson;
          const [line] = confirmed.lines;
          expect(line).toMatchObject({ qty: '3', qtyBase: '3', qtyApproved: '3', total: '2000' });
          const rows = await sql.query<{ reserved: string }>(
            `SELECT reserved::text AS reserved FROM warehouse_stock WHERE product_id = $1`,
            [milk.id],
          );
          expect(rows.rows[0]?.reserved).toMatch(/^3(\.0+)?$/);
          await orders.cancel(draft.id, 'туршилт').expect(200);
        },
      );
    });
  });

  describe('where it serves', () => {
    it('applies to the named pipelines, and to an order only on them', async () => {
      await during(
        { targetKind: 'PRODUCT', targetIds: [milk.id], pipelineIds: [pipelineId] },
        async () => {
          const on = async (place?: number) =>
            (await quote([[milk, '1']], place ? { pipelineId: place } : {})).lines[0]?.total;
          expect(await on(pipelineId)).toBe('900');
          expect(await on(otherPipelineId)).toBe('1000');
          expect(await on()).toBe('1000');
          const orders = salesApi(app, office);
          const here = (
            await orders
              .create(orderBody(shop.id, [{ productUnitId: pcs(milk), qty: '1' }], { pipelineId }))
              .expect(201)
          ).body as OrderJson;
          const confirmed = (await orders.submit(here.id).expect(200)).body as OrderJson;
          expect(confirmed.lines[0]?.total).toBe('900');
          await orders.cancel(here.id, 'туршилт').expect(200);
          const elsewhere = (
            await orders
              .create(orderBody(shop.id, [{ productUnitId: pcs(milk), qty: '1' }]))
              .expect(201)
          ).body as OrderJson;
          const other = (await orders.submit(elsewhere.id).expect(200)).body as OrderJson;
          expect(other.lines[0]?.total).toBe('1000');
          await orders.cancel(elsewhere.id, 'туршилт').expect(200);
        },
      );
    });

    it('serves both channels when asked', async () => {
      const retail = async () =>
        (await quote([[soap, '1']], { list: 'RETAIL' })).lines[0]?.parts[0]?.unitPrice;
      const before = await retail();
      await during({ targetKind: 'PRODUCT', targetIds: [soap.id], list: 'ALL' }, async () => {
        expect(await retail()).toBe('1170');
        expect(before).toBe('1300');
        expect(await prices(soap)).toEqual(['900']);
      });
    });
  });

  describe('what a person does with it', () => {
    it('edits a plan that has started, its first day staying, and the audit keeps it', async () => {
      const created = await create({
        name: 'Засагдах',
        targetKind: 'PRODUCT',
        targetIds: [milk.id],
        validFrom: today,
      });
      const body = plan({
        name: 'Засагдсан',
        targetKind: 'PRODUCT',
        targetIds: [kefir.id],
        validFrom: today,
        steps: [{ threshold: '0', value: '20' }],
      });
      const edited = (
        await http()
          .put(`/api/v1/discount-programs/${created.id}`)
          .set(bearer(admin))
          .send(body)
          .expect(200)
      ).body as ProgramJson;
      expect(edited).toMatchObject({ name: 'Засагдсан', targetIds: [kefir.id] });
      expect(await prices(milk, kefir)).toEqual(['1000', '800']);
      const audit = await sql.query<{
        before: { name: string; targetIds: number[] };
        after: { name: string; targetIds: number[] };
      }>(
        `SELECT before, after FROM audit_log
          WHERE entity = 'discount_programs' AND action = 'UPDATE' AND entity_id = $1`,
        [String(created.id)],
      );
      expect(audit.rows[0]?.before).toMatchObject({ name: 'Засагдах', targetIds: [milk.id] });
      expect(audit.rows[0]?.after).toMatchObject({ name: 'Засагдсан', targetIds: [kefir.id] });
      await remove(created.id);
    });

    it('keeps a draft and an archived plan out of quotes', async () => {
      const draft = await create({
        name: 'Ноорог',
        state: 'DRAFT',
        targetKind: 'PRODUCT',
        targetIds: [milk.id],
      });
      expect(draft).toMatchObject({ state: 'DRAFT', status: 'DRAFT' });
      expect(await prices(milk)).toEqual(['1000']);
      await remove(draft.id);

      const live = await create({ name: 'Архив', targetKind: 'PRODUCT', targetIds: [milk.id] });
      expect(await prices(milk)).toEqual(['900']);
      const archived = (
        await http()
          .post(`/api/v1/discount-programs/${live.id}/archive`)
          .set(bearer(admin))
          .expect(200)
      ).body as ProgramJson;
      expect(archived.status).toBe('ARCHIVED');
      expect(await prices(milk)).toEqual(['1000']);
      expect(await listed({})).not.toContain('Архив');
      expect(await listed({ status: 'ARCHIVED' })).toContain('Архив');
      await http()
        .post(`/api/v1/discount-programs/${live.id}/restore`)
        .set(bearer(admin))
        .expect(200);
      expect(await prices(milk)).toEqual(['900']);
      await remove(live.id);
      await http()
        .post(`/api/v1/discount-programs/${live.id}/archive`)
        .set(bearer(office))
        .expect(403);
    });

    it('deletes a running plan out of every list and quote, the row and audit staying', async () => {
      const live = await create({ name: 'Устгах', targetKind: 'PRODUCT', targetIds: [milk.id] });
      await remove(live.id);
      expect(await prices(milk)).toEqual(['1000']);
      expect(await listed({})).not.toContain('Устгах');
      await http().get(`/api/v1/discount-programs/${live.id}`).set(bearer(office)).expect(404);
      await http().delete(`/api/v1/discount-programs/${live.id}`).set(bearer(admin)).expect(404);
      const row = await sql.query<{ deleted: boolean }>(
        `SELECT deleted_at IS NOT NULL AS deleted FROM discount_programs WHERE id = $1`,
        [live.id],
      );
      expect(row.rows[0]?.deleted).toBe(true);
      const audit = await sql.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity = 'discount_programs' AND entity_id = $1
          ORDER BY id`,
        [String(live.id)],
      );
      expect(audit.rows.map((entry) => entry.action)).toEqual(['CREATE', 'DELETE']);
    });

    it('lets a deleted new price give way to another on the same unit', async () => {
      const price = {
        name: 'Шинэ үнэ',
        effect: 'PRICE',
        productId: milk.id,
        productUnitId: pcs(milk),
        thresholdUnitId: pcs(milk),
        steps: [{ threshold: '0', value: '700' }],
      };
      const first = await create(price);
      await http()
        .post('/api/v1/discount-programs')
        .set(bearer(admin))
        .set(idempotency())
        .send(plan({ ...price, validFrom: addDays(today, 1) }))
        .expect(409);
      await remove(first.id);
      const second = await create(price);
      await remove(second.id);
    });

    it('filters the list and says who made each', async () => {
      const made: ProgramJson[] = [
        await create({ name: 'Нийлүүлэгчийн', targetKind: 'SUPPLIER', targetIds: [supplierB] }),
        await create({
          name: 'Давуу эрхтэй',
          priority: true,
          targetKind: 'PRODUCT',
          targetIds: [milk.id],
          steps: [{ threshold: '10', value: '5' }],
        }),
        await create({
          name: 'Дэлгүүрийн',
          list: 'RETAIL',
          targetKind: 'CATEGORY',
          targetIds: [dairy],
          tillIds: [77],
        }),
        await create({
          name: 'Дамжлагын',
          targetKind: 'PRODUCT',
          targetIds: [soap.id],
          pipelineIds: [pipelineId],
        }),
      ];
      expect(made[0]?.createdByName).toEqual(expect.any(String));
      expect(await listed({ q: 'нийлүүлэгч' })).toEqual(['Нийлүүлэгчийн']);
      expect(await listed({ applyType: 'SUPPLIER' })).toEqual(['Нийлүүлэгчийн']);
      expect(await listed({ priority: 'ONLY' })).toEqual(['Давуу эрхтэй']);
      expect(await listed({ priority: 'EXCLUDE' })).not.toContain('Давуу эрхтэй');
      expect(await listed({ condition: 'QTY' })).toEqual(['Давуу эрхтэй']);
      // The product's plans by whatever way they hold it.
      expect((await listed({ productId: kefir.id })).sort()).toEqual(
        ['Дэлгүүрийн', 'Нийлүүлэгчийн'].sort(),
      );
      expect(await listed({ tillId: 77 })).toContain('Дэлгүүрийн');
      expect(await listed({ tillId: 78 })).not.toContain('Дэлгүүрийн');
      expect(await listed({ pipelineId })).toContain('Дамжлагын');
      expect(await listed({ pipelineId: otherPipelineId })).not.toContain('Дамжлагын');
      // Those naming no pipeline serve them all; the supermarket's serve none.
      expect(await listed({ pipelineId: otherPipelineId })).toContain('Нийлүүлэгчийн');
      expect(await listed({ pipelineId: otherPipelineId })).not.toContain('Дэлгүүрийн');
      expect(await listed({ date: addDays(today, -1) })).toEqual([]);
      for (const program of made) await remove(program.id);
    });
  });
});
