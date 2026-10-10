import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import { systemActor } from '../../src/modules/identity';
import { BarcodeService, UnitsService } from '../../src/modules/catalog';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, unitOf } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';

/** ADR-0008 #7: superseding a factor never orphans barcodes or default flags, even under concurrency. */
describe('integrity: unit supersede', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let api: ReturnType<typeof catalogApi>;
  let category: number;
  let pcs: number;
  let box: number;
  const actor = systemActor('integrity-test');

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    api = catalogApi(app, admin);
    pcs = await api.uomId('PCS');
    box = await api.uomId('BOX');
    category = await api.category('Integrity');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('supersede keeps barcode and default flag', async () => {
    const product = await api.product({
      sku: '40001',
      name: 'Integrity box',
      categoryId: category,
      baseUomId: pcs,
      units: [
        {
          uomId: box,
          factorToBase: '24',
          isDefaultSales: true,
          isDefaultPurchase: true,
          barcodes: ['IB-40001'],
        },
      ],
    });
    const old = unitOf(product, 'BOX');
    const next = await app.get(UnitsService).supersede(actor, old.id, new Decimal(20));
    const [hit] = await app.get(BarcodeService).lookup('IB-40001');
    expect(hit?.unitId).toBe(next.id);
    expect(next).toMatchObject({ isDefaultSales: true, isDefaultPurchase: true });
    const { rows } = await sql.query<{
      id: string;
      current: boolean;
      sales: boolean;
      purchase: boolean;
    }>(
      `SELECT id::text, superseded_at IS NULL AS current, is_default_sales AS sales, is_default_purchase AS purchase
         FROM product_units WHERE product_id = $1 AND uom_id = $2 ORDER BY id`,
      [product.id, box],
    );
    expect(rows).toEqual([
      { id: String(old.id), current: false, sales: false, purchase: false },
      { id: String(next.id), current: true, sales: true, purchase: true },
    ]);
  });

  it('lets exactly one of two concurrent supersedes of a unit win', async () => {
    const product = await api.product({
      sku: '40002',
      name: 'Integrity race',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24', barcodes: ['IB-40002'] }],
    });
    const old = unitOf(product, 'BOX');
    const units = app.get(UnitsService);
    const results = await Promise.all([
      codeOf(units.supersede(actor, old.id, new Decimal(20))),
      codeOf(units.supersede(actor, old.id, new Decimal(18))),
    ]);
    expect(results.sort()).toEqual(['UNIT_SUPERSEDED', undefined].sort());
    const { rows } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM product_units WHERE product_id = $1 AND uom_id = $2 AND superseded_at IS NULL`,
      [product.id, box],
    );
    expect(rows[0]?.count).toBe('1');
    expect(await app.get(BarcodeService).lookup('IB-40002')).toHaveLength(1);
  });
});
