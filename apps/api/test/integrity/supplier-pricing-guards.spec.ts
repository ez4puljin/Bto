import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

describe('integrity: supplier base price evidence and rule revisions', () => {
  let app: NestExpressApplication;
  let db: Client;
  let migrator: Client;
  let supplierId: number;
  let productId: number;
  let secondEventId: number;
  let eventId: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    db = await connectAs('app');
    migrator = await connectAs('migrator');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const categoryId = await catalog.category('Price evidence');
    const baseUomId = await catalog.uomId('PCS');
    const first = await catalog.product({
      sku: '824101',
      name: 'Evidence one',
      categoryId,
      baseUomId,
    });
    const second = await catalog.product({
      sku: '824102',
      name: 'Evidence two',
      categoryId,
      baseUomId,
    });
    productId = first.id;
    for (const p of [first, second]) {
      const result = await http()
        .put(`/api/v1/pricing/base-prices/${p.id}`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          expectedPrice: null,
          expectedEventId: null,
          price: '1000',
          reason: 'Initial base for integrity check',
        })
        .expect(200);
      if (p.id === first.id) eventId = result.body.lastEventId as number;
      else secondEventId = result.body.lastEventId as number;
    }
    supplierId = (await partnersApi(app, admin).supplier({ name: 'Pricing integrity supplier' }))
      .id;
    await http()
      .put(`/api/v1/pricing/supplier-rules/${supplierId}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        expectedVersion: 0,
        enabled: true,
        markupPct: '10',
        markupAmount: '0',
        rounding: 'WHOLE',
      })
      .expect(200);
    const warehouse = await inventoryApi(app, admin).warehouse('PRICEGUARD');
    await http()
      .put(`/api/v1/pricing/location-rules/${warehouse.id}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        expectedVersion: 0,
        enabled: true,
        priceType: 'BASE',
        markupPct: '0',
        markupAmount: '0',
        rounding: 'WHOLE',
      })
      .expect(200);
  });
  afterAll(async () => {
    await db?.end();
    await migrator?.end();
    await app?.close();
  });

  it('keeps price events and dated location rule snapshots append-only, including for the migrator', async () => {
    expect(
      await sqlStateOf(
        db.query('UPDATE base_price_events SET reason=$1 WHERE id=$2', ['changed', eventId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        migrator.query('UPDATE base_price_events SET reason=$1 WHERE id=$2', ['changed', eventId]),
      ),
    ).toBe('23001');
    expect(await sqlStateOf(db.query('DELETE FROM base_price_events WHERE id=$1', [eventId]))).toBe(
      '42501',
    );
    expect(await sqlStateOf(db.query('TRUNCATE base_price_events'))).toBe('42501');
    expect(
      await sqlStateOf(db.query('UPDATE location_price_rule_versions SET markup_pct=99')),
    ).toBe('42501');
    expect(await sqlStateOf(migrator.query('DELETE FROM location_price_rule_versions'))).toBe(
      '23001',
    );
  });

  it('rejects nonfinite or nonpositive selling prices independently of DTO validation', async () => {
    for (const [value, expectedState] of [
      ['NaN', '23514'],
      // Constrained numeric rejects infinity/overflow before table CHECK constraints run.
      ['Infinity', '22003'],
      ['-Infinity', '22003'],
      ['1000000000000', '22003'],
      ['-1', '23514'],
      ['0', '23514'],
      ['1.5', '23514'],
    ] as const) {
      expect(
        await sqlStateOf(
          db.query(
            "INSERT INTO base_price_events(product_id,kind,new_base_price,reason) VALUES ($1,'MANUAL',$2,'invalid raw test')",
            [productId, value],
          ),
        ),
      ).toBe(expectedState);
    }
    const invalid = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM base_price_events WHERE product_id=$1 AND reason='invalid raw test'",
      [productId],
    );
    expect(invalid.rows[0]?.count).toBe(0);
    expect(
      await sqlStateOf(
        db.query("UPDATE base_price_states SET posting_price='NaN' WHERE product_id=$1", [
          productId,
        ]),
      ),
    ).toBe('23514');
  });

  it('keeps a product state tied to its own immutable event', async () => {
    expect(
      await sqlStateOf(
        db.query('UPDATE base_price_states SET last_event_id=$2 WHERE product_id=$1', [
          productId,
          secondEventId,
        ]),
      ),
    ).toBe('23514');
    const current = await db.query<{ last_event_id: string }>(
      'SELECT last_event_id::text FROM base_price_states WHERE product_id=$1',
      [productId],
    );
    expect(current.rows[0]?.last_event_id).toBe(String(eventId));
  });

  it('requires a next rule revision and finite rule values in SQL too', async () => {
    expect(
      await sqlStateOf(
        db.query('UPDATE supplier_price_rules SET markup_pct=20 WHERE supplier_id=$1', [
          supplierId,
        ]),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        db.query(
          "UPDATE supplier_price_rules SET version=version+1,markup_pct='NaN' WHERE supplier_id=$1",
          [supplierId],
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        db.query('DELETE FROM supplier_price_rules WHERE supplier_id=$1', [supplierId]),
      ),
    ).toBe('42501');
  });
});
