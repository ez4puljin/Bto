import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, postReceipt } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * Goods issues under concurrency (ADR-0081, ADR-0117): two sent issues of the last piece on a shelf
 * confirmed at once — the posting locks the bin's balance, so exactly one leaves and the other is
 * refused, the shelf never below zero; and two keepers confirming the two warehouses of one issue
 * at once — both parts post under the one number and the document reaches POSTED exactly once.
 */
describe('integrity: goods issue races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let shelfId: number;
  const outcomes: number[][] = [];
  const twoKeepers: { statuses: number[]; status: string; parts: number; number: string | null }[] =
    [];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] })))
      .accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('WH1');
    const other = await inventory.warehouse('WH2');
    const keeper1 = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [warehouse.id] }))
    ).accessToken;
    const keeper2 = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [other.id] }))
    ).accessToken;
    const shelf = await inventory.bin(warehouse.id, 'A-01-01');
    shelfId = shelf.id;
    const catalog = catalogApi(app, admin);
    const categoryId = await catalog.category('Хүнс');
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId,
      baseUomId: await catalog.uomId('PCS'),
    });
    const rice = await catalog.product({
      sku: '2',
      name: 'Будаа',
      categoryId,
      baseUomId: await catalog.uomId('PCS'),
    });
    // Receipts put the flour on its fixed shelf in its home (ADR-0099 #1); the rice lives in WH2.
    await inventory.homeShelf(product.id, warehouse.id, shelf.id);
    await inventory.setHome(rice.id, other.id);
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'Нийлүүлэгч' })).id;
    const http = () => request(app.getHttpServer());
    const types = (
      await http().get('/api/v1/issues/expense-types').set(bearer(accountant)).expect(200)
    ).body as { id: number; code: string | null }[];
    const expenseTypeId = types.find((type) => type.code === 'INTERNAL_USE')?.id ?? 0;
    const pieces = unitOf(product, 'PCS').id;
    const ricePieces = unitOf(rice, 'PCS').id;
    const receive = async (lines: { productUnitId: number; enteredQty: string }[]) => {
      const receipt = await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({ supplierId, lines })
        .expect(201);
      await postReceipt(app, admin, (receipt.body as { id: number }).id);
    };
    const sent = async (lines: Record<string, unknown>[]) => {
      const draft = (
        await http()
          .post('/api/v1/issues')
          .set(bearer(accountant))
          .set(idempotency())
          .send({
            warehouseId: warehouse.id,
            expenseTypeId,
            recipient: { kind: 'OTHER', name: 'Оффис' },
            lines,
          })
          .expect(201)
      ).body as { id: number };
      await http()
        .post(`/api/v1/issues/${draft.id}/send`)
        .set(bearer(accountant))
        .set(idempotency())
        .expect(200);
      return draft.id;
    };
    const tick = async (token: string, issueId: number) => {
      const issue = (await http().get(`/api/v1/issues/${issueId}`).set(bearer(token)).expect(200))
        .body as { lines: { id: number; warehouseId: number }[] };
      for (const line of issue.lines) {
        const own = await http()
          .patch(`/api/v1/issue-lines/${line.id}/check`)
          .set(bearer(token))
          .send({ checked: true });
        if (own.status !== 200 && own.status !== 403) throw new Error(`check ${own.status}`);
      }
    };
    const confirm = (token: string, issueId: number) =>
      http().post(`/api/v1/issues/${issueId}/confirm`).set(bearer(token)).set(idempotency());

    for (let round = 0; round < 5; round += 1) {
      // One piece on the shelf, two sent issues of it, the keeper confirms both at once.
      await receive([{ productUnitId: pieces, enteredQty: '1' }]);
      const issues = await Promise.all(
        [0, 1].map(() => sent([{ productUnitId: pieces, enteredQty: '1' }])),
      );
      for (const id of issues) await tick(keeper1, id);
      const results = await Promise.all(issues.map((id) => confirm(keeper1, id)));
      outcomes.push(results.map((result) => result.status).sort());
    }

    for (let round = 0; round < 3; round += 1) {
      // Flour in WH1 and rice in WH2 on one issue; both keepers confirm at the same moment.
      await receive([{ productUnitId: pieces, enteredQty: '1' }]);
      await receive([{ productUnitId: ricePieces, enteredQty: '1' }]);
      const id = await sent([
        { productUnitId: pieces, enteredQty: '1' },
        { productUnitId: ricePieces, enteredQty: '1' },
      ]);
      await tick(keeper1, id);
      await tick(keeper2, id);
      const results = await Promise.all([confirm(keeper1, id), confirm(keeper2, id)]);
      const after = (await http().get(`/api/v1/issues/${id}`).set(bearer(admin)).expect(200))
        .body as { status: string; number: string | null; confirmations: unknown[] };
      twoKeepers.push({
        statuses: results.map((result) => result.status).sort(),
        status: after.status,
        parts: after.confirmations.length,
        number: after.number,
      });
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lets exactly one issue take the last piece', () => {
    for (const outcome of outcomes) expect(outcome).toEqual([200, 409]);
  });

  it('never leaves the shelf below zero', async () => {
    const { rows } = await sql.query<{ on_hand: string }>(
      'SELECT on_hand FROM bin_stock WHERE bin_id = $1',
      [shelfId],
    );
    expect(rows.map((row) => row.on_hand)).toEqual(['0.000']);
  });

  it('posts both parts under one number when two keepers confirm at once', async () => {
    for (const round of twoKeepers) {
      expect(round.statuses).toEqual([200, 200]);
      expect(round).toMatchObject({ status: 'POSTED', parts: 2 });
      expect(round.number).toMatch(/^GI-\d{4}-\d{6}$/);
    }
    const { rows } = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE entity = 'goods_issues' AND action = 'POST'
          AND entity_id IN (SELECT id::text FROM goods_issues WHERE status = 'POSTED')`,
    );
    expect(Number.parseInt(rows[0]?.n ?? '0', 10)).toBe(
      (
        await sql.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM goods_issues WHERE status = 'POSTED'`,
        )
      ).rows.map((row) => Number.parseInt(row.n, 10))[0],
    );
  });
});
