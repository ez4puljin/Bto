import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { BarcodeService } from '../../src/modules/catalog';
import { systemActor } from '../../src/modules/identity';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, unitOf } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';

/** ADR-0029 #2: one lookup key across all products, even when two admins register it at once. */
describe('integrity: concurrent barcode registration', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('lets exactly one of two products take the same GTIN', async () => {
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const api = catalogApi(app, admin);
    const pcs = await api.uomId('PCS');
    const category = await api.category('Race');
    const first = await api.product({
      sku: '80001',
      name: 'Race A',
      categoryId: category,
      baseUomId: pcs,
    });
    const second = await api.product({
      sku: '80002',
      name: 'Race B',
      categoryId: category,
      baseUomId: pcs,
    });
    const barcodes = app.get(BarcodeService);
    const actor = systemActor('integrity-test');
    const results = await Promise.all([
      codeOf(barcodes.add(actor, unitOf(first, 'PCS').id, '4006381333931')),
      // The same GTIN in its 14-digit form.
      codeOf(barcodes.add(actor, unitOf(second, 'PCS').id, '04006381333931')),
    ]);
    expect(results.filter((code) => code === undefined)).toHaveLength(1);
    expect(results.find((code) => code !== undefined)).toMatch(/^(BARCODE_TAKEN|DUPLICATE_VALUE)$/);
    const { rows } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM product_barcodes WHERE lookup_key = '04006381333931'`,
    );
    expect(rows[0]?.count).toBe('1');
  });
});
