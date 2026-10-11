import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { StockPostingService } from '../../src/modules/inventory';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface BalanceJson {
  warehouseId: number;
  onHand: string;
  available: string;
  avgCost?: string;
  value?: string;
}
interface StockJson {
  product: { id: number; name: string; baseUnitName: string };
  onHand: string;
  value?: string;
  warehouses: BalanceJson[];
  bins?: { binCode: string; onHand: string; sellable: boolean }[];
}

/** Stock balances by product, warehouse and bin, with costs only for cost holders (SPEC §5.4). */
describe('stock queries', () => {
  let app: NestExpressApplication;
  let admin: string;
  let worker: string;
  let accountant: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let cola: ProductJson;
  let rice: ProductJson;
  let shelf: number;
  const http = () => request(app.getHttpServer());

  /** Posts a receipt of one line and costs it at `amount`. */
  async function receive(
    warehouseId: number,
    supplierId: number,
    line: Record<string, unknown>,
    amount: string,
  ): Promise<void> {
    const created = await http()
      .post('/api/v1/receipts')
      .set(bearer(worker))
      .set(idempotency())
      .send({ warehouseId, supplierId, lines: [line] })
      .expect(201);
    const body = created.body as { id: number; lines: { id: number }[] };
    await http()
      .post(`/api/v1/receipts/${body.id}/post`)
      .set(bearer(worker))
      .set(idempotency())
      .expect(200);
    await http()
      .put(`/api/v1/receipts/${body.id}/costs`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ costingVersion: 0, lines: [{ lineId: body.lines[0]?.id, amount }] })
      .expect(200);
  }

  beforeAll(async () => {
    app = await createHttpApp();
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    accountant = await token('ACCOUNTANT');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    shelf = (await inventory.bin(wh1.id, 'A-01-01')).id;
    const other = (await inventory.bin(wh2.id, 'B-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24' }],
    });
    rice = await catalog.product({
      sku: '11',
      name: 'Будаа',
      categoryId: category,
      baseUomId: pcs,
    });
    await catalog.product({ sku: '12', name: 'Кофе', categoryId: category, baseUomId: pcs });
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    await receive(
      wh1.id,
      supplierId,
      { productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2', binId: shelf },
      '48000',
    );
    await receive(
      wh2.id,
      supplierId,
      { productUnitId: unitOf(rice, 'PCS').id, enteredQty: '10', binId: other },
      '5000',
    );
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('finds products as the catalog does and shows their stock without costs', async () => {
    const found = await http()
      .get('/api/v1/stock')
      .query({ q: 'кока' })
      .set(bearer(worker))
      .expect(200);
    const rows = (found.body as { data: StockJson[] }).data;
    expect(rows).toEqual([
      {
        product: expect.objectContaining({ id: cola.id, name: 'Кока кола', baseUnitName: 'ш' }),
        onHand: '48',
        available: '48',
        warehouses: [
          {
            warehouseId: wh1.id,
            onHand: '48',
            sellableOnHand: '48',
            reserved: '0',
            available: '48',
          },
        ],
      },
    ]);

    const costed = await http()
      .get('/api/v1/stock')
      .query({ q: 'кока' })
      .set(bearer(accountant))
      .expect(200);
    expect((costed.body as { data: StockJson[] }).data[0]).toMatchObject({
      value: '48000.00',
      warehouses: [{ avgCost: '1000', value: '48000.00' }],
    });
  });

  it('lists only products holding stock, in one warehouse or all', async () => {
    const all = await http()
      .get('/api/v1/stock')
      .query({ inStock: true })
      .set(bearer(worker))
      .expect(200);
    expect((all.body as { data: StockJson[] }).data.map((row) => row.product.id)).toEqual([
      cola.id,
      rice.id,
    ]);
    const second = await http()
      .get('/api/v1/stock')
      .query({ inStock: true, warehouseId: wh2.id })
      .set(bearer(worker))
      .expect(200);
    expect((second.body as { data: StockJson[] }).data).toEqual([
      expect.objectContaining({ product: expect.objectContaining({ id: rice.id }), onHand: '10' }),
    ]);
    const paged = await http()
      .get('/api/v1/stock')
      .query({ inStock: true, limit: 1 })
      .set(bearer(worker))
      .expect(200);
    const next = await http()
      .get('/api/v1/stock')
      .query({ inStock: true, limit: 1, cursor: (paged.body as { nextCursor: string }).nextCursor })
      .set(bearer(worker))
      .expect(200);
    expect((next.body as { data: StockJson[] }).data.map((row) => row.product.id)).toEqual([
      rice.id,
    ]);
    // Without the filter every product shows, stock or not.
    const browse = await http().get('/api/v1/stock').set(bearer(worker)).expect(200);
    expect((browse.body as { data: StockJson[] }).data).toHaveLength(3);
  });

  it('shows a product by bin and a bin by product', async () => {
    const product = await http()
      .get(`/api/v1/stock/products/${cola.id}`)
      .set(bearer(worker))
      .expect(200);
    expect((product.body as StockJson).bins).toEqual([
      expect.objectContaining({ binCode: 'A-01-01', onHand: '48', sellable: true }),
    ]);
    expect(JSON.stringify(product.body)).not.toMatch(/avgCost|"value"/);
    await http().get('/api/v1/stock/products/999999').set(bearer(worker)).expect(404);

    const bin = await http().get(`/api/v1/stock/bins/${shelf}`).set(bearer(worker)).expect(200);
    expect(bin.body).toMatchObject({
      bin: { code: 'A-01-01' },
      lines: [{ product: { id: cola.id }, onHand: '48' }],
    });
  });

  it('reports the last reconciliation to admins', async () => {
    await http().get('/api/v1/stock/reconciliation/latest').set(bearer(worker)).expect(403);
    await app.get(StockPostingService).reconcile('TEST');
    const latest = await http()
      .get('/api/v1/stock/reconciliation/latest')
      .set(bearer(admin))
      .expect(200);
    expect(latest.body).toMatchObject({
      lastRun: { status: 'OK', diffCount: 0, diffs: [], triggeredBy: 'TEST' },
    });
  });
});
