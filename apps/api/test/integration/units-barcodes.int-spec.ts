import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Tx } from '../../src/common/db/db.types';
import {
  BarcodeService,
  UNIT_SUPERSEDED_HOOK,
  UnitConversionService,
} from '../../src/modules/catalog';
import { productUnits } from '../../src/modules/catalog/schema';
import { createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

describe('units, supersede, conversion and barcodes (ADR-0008, ADR-0029)', () => {
  const superseded: { oldUnitId: number; newUnitId: number }[] = [];
  const hook = {
    async onUnitSuperseded(tx: Tx, change: { oldUnitId: number; newUnitId: number }) {
      // Runs inside the superseding transaction: the new row is visible here.
      const rows = await tx
        .select()
        .from(productUnits)
        .where(eq(productUnits.id, change.newUnitId));
      if (rows.length !== 1) throw new Error('hook ran outside the superseding transaction');
      superseded.push(change);
    },
  };
  let app: NestExpressApplication;
  let admin: string;
  let pcs: number;
  let block: number;
  let box: number;
  let kg: number;
  let category: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp({ providers: [{ provide: UNIT_SUPERSEDED_HOOK, useValue: hook }] });
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const api = catalogApi(app, admin);
    pcs = await api.uomId('PCS');
    block = await api.uomId('BLOCK');
    box = await api.uomId('BOX');
    kg = await api.uomId('KG');
    category = await api.category('Нэгжийн тест');
  });
  afterAll(async () => {
    await app.close();
  });

  const cokeWithBox = (sku: string, boxBarcode: string) =>
    catalogApi(app, admin).product({
      sku,
      name: `Кока ${sku}`,
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24', isDefaultSales: true, barcodes: [boxBarcode] }],
    });

  it('adds units, keeps one current unit per unit of measure and moves default flags', async () => {
    const product = await cokeWithBox('30001', 'BOX-30001');
    const added = await http()
      .post(`/api/v1/products/${product.id}/units`)
      .set(bearer(admin))
      .send({ uomId: block, factorToBase: '6', isDefaultSales: true })
      .expect(201);
    const after = added.body as ProductJson;
    expect(unitOf(after, 'BLOCK')).toMatchObject({ isDefaultSales: true });
    expect(unitOf(after, 'BOX')).toMatchObject({ isDefaultSales: false });
    const twin = await http()
      .post(`/api/v1/products/${product.id}/units`)
      .set(bearer(admin))
      .send({ uomId: block, factorToBase: '12' })
      .expect(409);
    expect(twin.body.params).toMatchObject({ constraint: 'product_units_current_uom' });
    const flagged = await http()
      .patch(`/api/v1/product-units/${unitOf(after, 'BOX').id}`)
      .set(bearer(admin))
      .send({ isDefaultPurchase: true, measureUnit: 'хайрцаг' })
      .expect(200);
    expect(flagged.body).toMatchObject({
      isDefaultPurchase: true,
      measureUnit: 'хайрцаг',
      effectiveMeasureUnit: 'хайрцаг',
    });
  });

  it('supersedes a factor: barcodes, default flags and the hook move to the new unit in one transaction', async () => {
    const product = await cokeWithBox('30002', 'BOX-30002');
    const old = unitOf(product, 'BOX');
    await http()
      .post(`/api/v1/product-units/${old.id}/supersede`)
      .set(bearer(admin))
      .send({ factorToBase: '20' })
      .expect(400);
    const res = await http()
      .post(`/api/v1/product-units/${old.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '20' })
      .expect(201);
    expect(res.body).toMatchObject({
      factorToBase: '20',
      isDefaultSales: true,
      supersededAt: null,
    });
    expect(res.body.barcodes).toEqual([
      expect.objectContaining({ code: 'BOX-30002', isPrimary: true }),
    ]);
    expect(superseded).toContainEqual({ oldUnitId: old.id, newUnitId: res.body.id });

    const detail = await catalogApi(app, admin).get(product.id);
    const previous = detail.units.find((unit) => unit.id === old.id);
    expect(previous).toMatchObject({
      supersededBy: res.body.id,
      isDefaultSales: false,
      barcodes: [],
    });
    expect(previous?.supersededAt).not.toBeNull();
    const [hit] = await app.get(BarcodeService).lookup('box-30002');
    expect(hit?.unitId).toBe(res.body.id);

    const again = await http()
      .post(`/api/v1/product-units/${old.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '18' })
      .expect(409);
    expect(again.body.code).toBe('UNIT_SUPERSEDED');
    const base = unitOf(product, 'PCS');
    const locked = await http()
      .post(`/api/v1/product-units/${base.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '2' })
      .expect(422);
    expect(locked.body.code).toBe('UNIT_BASE_LOCKED');
    const same = await http()
      .post(`/api/v1/product-units/${res.body.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '20' })
      .expect(422);
    expect(same.body.errors).toEqual([expect.objectContaining({ path: 'factorToBase' })]);
  });

  it('retires a unit without a successor and lets the same unit of measure come back', async () => {
    const product = await cokeWithBox('30003', 'BOX-30003');
    const old = unitOf(product, 'BOX');
    const retired = await http()
      .post(`/api/v1/product-units/${old.id}/retire`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    expect(retired.body).toMatchObject({ supersededBy: null, isDefaultSales: false, barcodes: [] });
    expect(retired.body.supersededAt).not.toBeNull();
    expect(await app.get(BarcodeService).lookup('BOX-30003')).toEqual([]);
    await http()
      .post(`/api/v1/products/${product.id}/units`)
      .set(bearer(admin))
      .send({ uomId: box, factorToBase: '12', barcodes: ['BOX-30003'] })
      .expect(201);
    const base = unitOf(product, 'PCS');
    const locked = await http()
      .post(`/api/v1/product-units/${base.id}/retire`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(422);
    expect(locked.body.code).toBe('UNIT_BASE_LOCKED');
  });

  it('converts entered quantities to base units exactly, never through a superseded unit', async () => {
    const conversion = app.get(UnitConversionService);
    const product = await cokeWithBox('30004', 'BOX-30004');
    const boxUnit = unitOf(product, 'BOX');
    const converted = await conversion.toBase(boxUnit.id, new Decimal(2));
    expect(converted.qtyBase.toString()).toBe('48');
    expect(converted.factorSnapshot.toString()).toBe('24');
    expect(converted.productId).toBe(product.id);
    expect(await codeOf(conversion.toBase(unitOf(product, 'PCS').id, new Decimal('0.5')))).toBe(
      'UNIT_FACTOR_INEXACT',
    );
    await http()
      .post(`/api/v1/product-units/${boxUnit.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '12' })
      .expect(201);
    expect(await codeOf(conversion.toBase(boxUnit.id, new Decimal(1)))).toBe('UNIT_SUPERSEDED');

    const flour = await catalogApi(app, admin).product({
      name: 'Гурил',
      categoryId: category,
      baseUomId: kg,
    });
    const kilos = await conversion.toBase(unitOf(flour, 'KG').id, new Decimal('12.5'));
    expect(kilos.qtyBase.toString()).toBe('12.5');
  });

  it('keeps one primary barcode per unit and issues one internal EAN-13', async () => {
    const product = await catalogApi(app, admin).product({
      sku: '39005',
      name: 'Баркодгүй',
      categoryId: category,
      baseUomId: pcs,
    });
    const base = unitOf(product, 'PCS');
    const add = (code: string) =>
      http().post(`/api/v1/product-units/${base.id}/barcodes`).set(bearer(admin)).send({ code });
    const first = (await add('036000291452').expect(201)).body;
    const second = (await add('0036000291469').expect(201)).body;
    expect(first).toMatchObject({ isPrimary: true, gtin14: '00036000291452', barcodeType: 'GS1' });
    expect(second).toMatchObject({ isPrimary: false });
    const sameGtin = await add('0036000291452').expect(409);
    expect(sameGtin.body).toMatchObject({ code: 'BARCODE_TAKEN', params: { sku: '39005' } });

    await http()
      .post(`/api/v1/product-barcodes/${second.id}/primary`)
      .set(bearer(admin))
      .expect(200);
    await http().delete(`/api/v1/product-barcodes/${second.id}`).set(bearer(admin)).expect(204);
    const afterDelete = unitOf(await catalogApi(app, admin).get(product.id), 'PCS');
    expect(afterDelete.barcodes).toEqual([
      expect.objectContaining({ id: first.id, isPrimary: true }),
    ]);

    await http()
      .post(`/api/v1/product-units/${base.id}/internal-barcode`)
      .set(bearer(admin))
      .expect(400);
    const internal = await http()
      .post(`/api/v1/product-units/${base.id}/internal-barcode`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(201);
    expect(internal.body).toMatchObject({
      isInternal: true,
      barcodeType: 'UNDEFINED',
      isPrimary: false,
    });
    expect(internal.body.code).toMatch(/^20\d{11}$/);
    const twice = await http()
      .post(`/api/v1/product-units/${base.id}/internal-barcode`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(409);
    expect(twice.body.params).toMatchObject({ reason: 'INTERNAL_BARCODE_EXISTS' });
  });
});
