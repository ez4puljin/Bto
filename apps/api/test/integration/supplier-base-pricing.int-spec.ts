import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import type { BasePriceViewDto } from '../../src/modules/pricing/dto/supplier-pricing.dto';
import { SupplierPricingService } from '../../src/modules/pricing';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

describe('supplier base and location pricing configuration', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  let supplierId: number;
  let baseWarehouse: number;
  let addedWarehouse: number;
  let product: ProductJson;
  let profileId: number;
  let looseRoundedProfile: number;
  let retailRoundedProfile: number;
  const http = () => request(app.getHttpServer());
  const view = async () =>
    (await http().get(`/api/v1/pricing/base-prices/${product.id}`).set(bearer(admin)).expect(200))
      .body as BasePriceViewDto;
  const manual = (before: BasePriceViewDto, price: string) =>
    http()
      .put(`/api/v1/pricing/base-prices/${product.id}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        expectedPrice: before.basePrice,
        expectedEventId: before.lastEventId,
        price,
        reason: 'Supplier price update by phone',
      });
  const quote = (warehouseId: number, date?: string) =>
    http()
      .post('/api/v1/pricing/quote')
      .set(bearer(office))
      .send({
        list: 'RETAIL',
        warehouseId,
        ...(date ? { date } : {}),
        lines: [{ productUnitId: unitOf(product, 'PCS').id, qty: '1' }],
      });

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    supplierId = (await partnersApi(app, admin).supplier({ name: 'Supplier base pricing test' }))
      .id;
    const inventory = inventoryApi(app, admin);
    baseWarehouse = (await inventory.warehouse('BASE-A')).id;
    addedWarehouse = (await inventory.warehouse('ADDED-A')).id;
    const catalog = catalogApi(app, admin);
    const categoryId = await catalog.category('Supplier base prices');
    product = await catalog.product({
      sku: '824001',
      name: 'Invoice-price sample',
      categoryId,
      baseUomId: await catalog.uomId('PCS'),
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '10' }],
    });
    profileId = await pricingApi(app, admin).profile('Existing commercial profile');
    const zeroUplift = {
      looseMarkupPct: '0',
      retailMarkupPct: '0',
      retailBulkMinQty: null,
      retailBulkMarkupPct: null,
    };
    looseRoundedProfile = await pricingApi(app, admin).profile('BASE', {
      ...zeroUplift,
      rounding: 'UP_100',
    });
    retailRoundedProfile = await pricingApi(app, admin).profile('BASE 1', {
      ...zeroUplift,
      rounding: 'WHOLE',
      retailRounding: 'UP_100',
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('protects supplier settings, validates values, and rejects a stale configuration save', async () => {
    const body = {
      expectedVersion: 0,
      enabled: true,
      markupPct: '10',
      markupAmount: '0',
      rounding: 'WHOLE',
    };
    await http()
      .put(`/api/v1/pricing/supplier-rules/${supplierId}`)
      .set(bearer(office))
      .set(idempotency())
      .send(body)
      .expect(403);
    await http()
      .put(`/api/v1/pricing/supplier-rules/${supplierId}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...body, markupPct: 'NaN' })
      .expect(422);
    const results = await Promise.all(
      [1, 2].map(() =>
        http()
          .put(`/api/v1/pricing/supplier-rules/${supplierId}`)
          .set(bearer(admin))
          .set(idempotency())
          .send(body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await http().get('/api/v1/pricing/supplier-rules').set(bearer(office)).expect(403);
  });

  it('bootstraps a neutral price without reusing user profiles with nonneutral rounding', async () => {
    const catalog = catalogApi(app, admin);
    const fresh = await catalog.product({
      sku: '824002',
      name: 'Neutral bootstrap sample',
      categoryId: await catalog.category('Neutral bootstrap'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await http()
      .put(`/api/v1/pricing/base-prices/${fresh.id}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ expectedPrice: null, expectedEventId: null, price: '105', reason: 'Initial price' })
      .expect(200);
    for (const list of ['WHOLESALE', 'RETAIL']) {
      const quoted = await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(office))
        .send({ list, lines: [{ productUnitId: unitOf(fresh, 'PCS').id, qty: '1' }] })
        .expect(200);
      expect(quoted.body.total).toBe('105');
    }
    const labels = await http()
      .post('/api/v1/product-prices/labels')
      .set(bearer(office))
      .send({ productIds: [fresh.id] })
      .expect(200);
    expect(labels.body.labels[0].retail).toBe('105');
    for (const [id, rounding, retailRounding] of [
      [looseRoundedProfile, 'UP_100', null],
      [retailRoundedProfile, 'WHOLE', 'UP_100'],
    ] as const) {
      const original = await http()
        .get(`/api/v1/price-profiles/${id}`)
        .set(bearer(admin))
        .expect(200);
      expect(original.body.current).toMatchObject({ rounding, retailRounding });
    }
  });

  it('establishes an unpriced product manually without a receipt and records its source', async () => {
    const before = await view();
    expect(before.basePrice).toBeNull();
    const saved = (await manual(before, '1000').expect(200)).body as BasePriceViewDto;
    expect(saved).toMatchObject({ basePrice: '1000', source: 'MANUAL', receiptId: null });
    expect(saved.history[0]).toMatchObject({
      kind: 'MANUAL',
      newBasePrice: '1000',
      reason: 'Supplier price update by phone',
    });
    expect(saved.baseUomName).not.toBe('');
    await manual(saved, '0').expect(422);
  });

  it('observes legacy manual changes and rejects an ABA-stale manual form', async () => {
    const captured = await view();
    const box = unitOf(product, 'BOX').uomId;
    await pricingApi(app, admin).terms(product.id, '1100', profileId, box);
    await pricingApi(app, admin).terms(product.id, '1000', profileId, box);
    const changed = await view();
    expect(changed.basePrice).toBe(captured.basePrice);
    expect(changed.lastEventId).not.toBe(captured.lastEventId);
    await manual(captured, '900').expect(409);
    expect(changed.history.slice(0, 2).every((e) => e.kind === 'MANUAL')).toBe(true);
  });

  it('serializes competing current-price edits with one successful event', async () => {
    const captured = await view();
    const results = await Promise.all([manual(captured, '1200'), manual(captured, '1300')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await manual(await view(), '1000').expect(200);
  });

  it('prices a chosen location from base or its uplift, independently of legacy profile marks', async () => {
    const base = {
      expectedVersion: 0,
      enabled: true,
      priceType: 'BASE',
      markupPct: '0',
      markupAmount: '0',
      rounding: 'WHOLE',
    };
    await http()
      .put(`/api/v1/pricing/location-rules/${baseWarehouse}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...base, markupPct: '1' })
      .expect(422);
    await http()
      .put(`/api/v1/pricing/location-rules/${baseWarehouse}`)
      .set(bearer(admin))
      .set(idempotency())
      .send(base)
      .expect(200);
    await http()
      .put(`/api/v1/pricing/location-rules/${addedWarehouse}`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...base, priceType: 'ADDITIONAL', markupPct: '50' })
      .expect(200);
    expect((await quote(baseWarehouse).expect(200)).body.total).toBe('1000');
    expect((await quote(addedWarehouse).expect(200)).body.total).toBe('1500');
    const mixed = await http()
      .post('/api/v1/pricing/quote')
      .set(bearer(office))
      .send({
        list: 'RETAIL',
        lines: [
          { productUnitId: unitOf(product, 'PCS').id, qty: '1', warehouseId: baseWarehouse },
          { productUnitId: unitOf(product, 'PCS').id, qty: '1', warehouseId: addedWarehouse },
        ],
      })
      .expect(200);
    expect(mixed.body.total).toBe('2500');
  });

  it('prints labels using the same selected location rule as checkout', async () => {
    for (const [warehouseId, price] of [
      [baseWarehouse, '1000'],
      [addedWarehouse, '1500'],
    ] as const) {
      const response = await http()
        .post('/api/v1/product-prices/labels')
        .set(bearer(office))
        .send({ productIds: [product.id], warehouseId })
        .expect(200);
      expect(response.body.labels[0].retail).toBe(price);
    }
  });

  it('does not apply a new location rule to a preceding business date', async () => {
    const pricing = app.get(SupplierPricingService);
    expect(
      await pricing.locationSettings(baseWarehouse, app.get<Db>(DB), addDays(businessDate(), -1)),
    ).toBeNull();
    expect((await pricing.locationSettings(baseWarehouse))?.priceType).toBe('BASE');
  });

  it('keeps the current explicit base from silently reverting to an older future schedule', async () => {
    await pricingApi(app, admin).terms(
      product.id,
      '4000',
      profileId,
      unitOf(product, 'BOX').uomId,
      addDays(businessDate(), 1),
    );
    await manual(await view(), '2000').expect(200);
    expect((await quote(baseWarehouse, addDays(businessDate(), 1)).expect(200)).body.total).toBe(
      '2000',
    );
    // Reasserting the same current amount must also remove a later scheduled reversion.
    await pricingApi(app, admin).terms(
      product.id,
      '4000',
      profileId,
      unitOf(product, 'BOX').uomId,
      addDays(businessDate(), 1),
    );
    await manual(await view(), '2000').expect(200);
    expect((await quote(baseWarehouse, addDays(businessDate(), 1)).expect(200)).body.total).toBe(
      '2000',
    );
    const old = await http()
      .get('/api/v1/product-prices')
      .set(bearer(admin))
      .query({ productId: product.id })
      .expect(200);
    expect(old.body.scheduled).toEqual([]);
  });
});
