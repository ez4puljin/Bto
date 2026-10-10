import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { TaxService } from '../../src/modules/catalog';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

/** TaxService.rates (ADR-0010) and the e-Barimt readiness report with bulk assignment (ADR-0015 #3). */
describe('tax rates and e-Barimt readiness', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let api: ReturnType<typeof catalogApi>;
  let pcs: number;
  let food: number;
  let flour: number;
  let drinks: number;
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    api = catalogApi(app, admin);
    pcs = await api.uomId('PCS');
    food = await api.category('Хүнс');
    flour = await api.category('Гурил', food);
    drinks = await api.category('Ундаа');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  const setting = (key: string, value: string, effectiveFrom: string) =>
    http()
      .post('/api/v1/settings')
      .set(bearer(admin))
      .send({ key, value, effectiveFrom })
      .expect(201);

  it('gives VAT and city-tax rates in force on a date, and refuses undecided city tax', async () => {
    const tax = app.get(TaxService);
    const cola = await api.product({
      sku: '95001',
      name: 'Кола',
      categoryId: drinks,
      baseUomId: pcs,
      cityTax: true,
    });
    const meal = await api.product({
      sku: '95002',
      name: 'Гурил',
      categoryId: flour,
      baseUomId: pcs,
      vatType: 'VAT_FREE',
      cityTax: false,
    });
    const unsure = await api.product({
      sku: '95003',
      name: 'Тодорхойгүй',
      categoryId: drinks,
      baseUomId: pcs,
    });

    expect(await codeOf(tax.rates(cola.id, today))).toBe('SETTING_MISSING');
    await setting('tax.vat_rate_pct', '10', today);
    await setting('tax.city_tax_rate_pct', '2', today);
    await setting('tax.vat_rate_pct', '12', addDays(today, 1));

    const now = await tax.rates(cola.id, today);
    expect({ vat: now.vatRatePct.toString(), city: now.cityTaxRatePct.toString() }).toEqual({
      vat: '10',
      city: '2',
    });
    expect((await tax.rates(cola.id, addDays(today, 1))).vatRatePct.toString()).toBe('12');
    const exempt = await tax.rates(meal.id, today);
    expect({ vat: exempt.vatRatePct.toString(), city: exempt.cityTaxRatePct.toString() }).toEqual({
      vat: '0',
      city: '0',
    });
    expect(await codeOf(tax.rates(unsure.id, today))).toBe('TAX_ATTRIBUTES_MISSING');
  });

  it('reports missing attributes and fills only empty ones by category subtree', async () => {
    await api.product({
      sku: '96001',
      name: 'Гурил 1',
      categoryId: flour,
      baseUomId: pcs,
      vatType: 'VAT_FREE',
    });
    await api.product({
      sku: '96002',
      name: 'Гурил 2',
      categoryId: flour,
      baseUomId: pcs,
      classificationCode: '1111111',
      cityTax: true,
    });
    await api.product({ sku: '96003', name: 'Хүнсний бусад', categoryId: food, baseUomId: pcs });

    await http().get('/api/v1/catalog/ebarimt-readiness').set(bearer(worker)).expect(403);
    const before = await http()
      .get('/api/v1/catalog/ebarimt-readiness')
      .set(bearer(admin))
      .expect(200);
    expect(before.body.missing.measureUnit).toBe(before.body.activeProducts);

    const listed = await http()
      .get(`/api/v1/catalog/ebarimt-readiness/products?gap=classificationCode&categoryId=${food}`)
      .set(bearer(admin))
      .expect(200);
    expect(
      listed.body.data.map((row: { product: { sku: string } }) => row.product.sku).sort(),
    ).toEqual(['95002', '96001', '96003']);
    expect(listed.body.data[0].missing).toContain('classificationCode');

    const assignment = {
      categoryId: food,
      classificationCode: '2222222',
      taxProductCode: '305',
      cityTax: false,
    };
    const dry = await http()
      .post('/api/v1/catalog/ebarimt-readiness/assign')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...assignment, dryRun: true })
      .expect(200);
    expect(dry.body).toEqual({ classificationCode: 3, taxProductCode: 2, cityTax: 2 });
    const untouched = await sql.query(
      `SELECT 1 FROM products WHERE classification_code = '2222222'`,
    );
    expect(untouched.rowCount).toBe(0);

    await http()
      .post('/api/v1/catalog/ebarimt-readiness/assign')
      .set(bearer(admin))
      .set(idempotency())
      .send(assignment)
      .expect(200);
    const { rows } = await sql.query<{
      sku: string;
      code: string;
      tax: string | null;
      city: boolean;
    }>(
      `SELECT sku, classification_code AS code, tax_product_code AS tax, city_tax AS city
         FROM products WHERE category_id IN ($1, $2) ORDER BY sku`,
      [food, flour],
    );
    expect(rows).toEqual([
      { sku: '95002', code: '2222222', tax: '305', city: false },
      { sku: '96001', code: '2222222', tax: '305', city: false },
      { sku: '96002', code: '1111111', tax: null, city: true },
      { sku: '96003', code: '2222222', tax: null, city: false },
    ]);
    const audit = await sql.query<{ after: { productIds: number[] } }>(
      `SELECT after FROM audit_log WHERE entity = 'categories' AND action = 'ASSIGN'`,
    );
    expect(audit.rows[0]?.after.productIds).toHaveLength(3);

    await http()
      .patch(`/api/v1/uoms/${pcs}`)
      .set(bearer(admin))
      .send({ measureUnit: 'ш' })
      .expect(200);
    const after = await http()
      .get('/api/v1/catalog/ebarimt-readiness')
      .set(bearer(admin))
      .expect(200);
    expect(after.body.missing.measureUnit).toBe(0);
  });
});
