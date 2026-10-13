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

  it('shows the movement history newest first with documents, balances and costs for holders', async () => {
    interface MovementJson {
      movementType: string;
      docType: string;
      docNumber: string | null;
      binCode: string;
      qtyBase: string;
      enteredQty: string;
      unitName: string;
      warehouseBalance: string | null;
      binBalance: string | null;
      unitCost?: string;
      value?: string;
    }
    const lower = (await inventoryApi(app, admin).bin(wh1.id, 'A-01-02')).id;
    await http()
      .post('/api/v1/bin-moves')
      .set(bearer(worker))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        lines: [
          {
            productUnitId: unitOf(cola, 'PCS').id,
            enteredQty: '10',
            fromBinId: shelf,
            toBinId: lower,
          },
        ],
      })
      .expect(201);
    const damaged = await http()
      .post('/api/v1/adjustments')
      .set(bearer(worker))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        reason: 'DAMAGED',
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '4', binId: lower }],
      })
      .expect(201);
    const adjustmentId = (damaged.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${adjustmentId}/submit`).set(bearer(worker)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${adjustmentId}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);

    const read = async (token: string, query: Record<string, unknown>, status = 200) =>
      (await http().get('/api/v1/stock/movements').query(query).set(bearer(token)).expect(status))
        .body as { data: MovementJson[]; nextCursor: string | null };
    const history = await read(worker, { productId: cola.id });
    expect(
      history.data.map((row) => [
        row.movementType,
        row.docType,
        row.binCode,
        row.qtyBase,
        row.warehouseBalance,
        row.binBalance,
      ]),
    ).toEqual([
      ['ADJUSTMENT', 'ADJ', 'A-01-02', '-4', '44', '6'],
      ['BIN_MOVE_IN', 'BM', 'A-01-02', '10', '48', '10'],
      ['BIN_MOVE_OUT', 'BM', 'A-01-01', '-10', '38', '38'],
      ['RECEIPT', 'GR', 'A-01-01', '48', '48', '48'],
    ]);
    expect(history.data.map((row) => row.docNumber)).toEqual([
      expect.stringMatching(/^ADJ-\d{4}-\d{6}$/),
      expect.stringMatching(/^BM-\d{4}-\d{6}$/),
      expect.stringMatching(/^BM-\d{4}-\d{6}$/),
      expect.stringMatching(/^GR-\d{4}-\d{6}$/),
    ]);
    expect(history.data[3]).toMatchObject({ enteredQty: '2', unitName: 'хайрцаг' });
    expect(JSON.stringify(history)).not.toMatch(/unitCost|"value"/);

    const costed = await read(accountant, { productId: cola.id, limit: 1 });
    expect(costed.data[0]).toMatchObject({ unitCost: '1000', value: '-4000.00' });

    // Filters: a shelf, a warehouse, a document type, dates, and keyset pages.
    expect((await read(worker, { binId: lower })).data.map((row) => row.movementType)).toEqual([
      'ADJUSTMENT',
      'BIN_MOVE_IN',
    ]);
    const other = await read(worker, { warehouseId: wh2.id });
    expect(other.data.map((row) => [row.movementType, row.warehouseBalance])).toEqual([
      ['RECEIPT', null],
    ]);
    expect((await read(worker, { docType: 'BM', productId: cola.id })).data).toHaveLength(2);
    expect((await read(worker, { productId: cola.id, from: '2099-01-01' })).data).toEqual([]);
    expect((await read(worker, { productId: cola.id, to: '2099-12-31' })).data.length).toBe(4);
    await read(worker, { from: '2026-13-01' }, 422);
    await read(worker, { docType: 'XX' }, 422);
    const first = await read(worker, { productId: cola.id, limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await read(worker, {
      productId: cola.id,
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect(second.data.map((row) => row.movementType)).toEqual(['BIN_MOVE_OUT', 'RECEIPT']);
    expect(second.data.map((row) => row.warehouseBalance)).toEqual(['38', '48']);
  });

  it('lists what is out of stock or at its minimum, out of stock first (ADR-0039)', async () => {
    interface LowJson {
      product: { id: number; sku: string };
      baseUnitId: number;
      status: string;
      onHand: string;
      minQty: string | null;
      maxQty: string | null;
      suggestedQty: string | null;
      homeWarehouseId: number | null;
    }
    const low = async (warehouseId: number, query: Record<string, unknown> = {}) =>
      (
        await http()
          .get('/api/v1/stock/low')
          .query({ warehouseId, ...query })
          .set(bearer(worker))
          .expect(200)
      ).body as { data: LowJson[]; nextCursor: string | null };
    const levels = (warehouseId: number, productId: number, minQty: string, maxQty?: string) =>
      http()
        .put('/api/v1/product-locations')
        .set(bearer(worker))
        .send({ warehouseId, productId, minQty, ...(maxQty ? { maxQty } : {}) })
        .expect(200);
    const catalog = catalogApi(app, admin);
    const category = cola.categoryId as number;
    const pcs = await catalog.uomId('PCS');
    const coffee = (
      (await http().get('/api/v1/products').query({ q: '12' }).set(bearer(admin)).expect(200))
        .body as { data: { id: number; sku: string }[] }
    ).data.find((product) => product.sku === '12');
    if (!coffee) throw new Error('no coffee');
    const tea = await catalog.product({
      sku: '13',
      name: 'Цай',
      categoryId: category,
      baseUomId: pcs,
    });

    // Nothing is low before any level, and nothing is out yet.
    expect((await low(wh1.id)).data).toEqual([]);
    await http().put('/api/v1/product-locations/home').set(bearer(admin)).send({
      productId: cola.id,
      warehouseId: wh1.id,
    });
    await levels(wh1.id, cola.id, '50', '100');
    await levels(wh1.id, coffee.id, '5');
    await levels(wh1.id, tea.id, '1');
    // Tea is discontinued: it leaves the list.
    await http()
      .patch(`/api/v1/products/${tea.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    // The last 10 rice of WH2 are written off: out of stock there without any level.
    const riceShelf = (await inventoryApi(app, admin).bins(wh2.id)).find(
      (bin) => bin.code === 'B-01-01',
    );
    const writeOff = await http()
      .post('/api/v1/adjustments')
      .set(bearer(worker))
      .set(idempotency())
      .send({
        warehouseId: wh2.id,
        reason: 'DAMAGED',
        lines: [{ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '10', binId: riceShelf?.id }],
      })
      .expect(201);
    const writeOffId = (writeOff.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${writeOffId}/submit`).set(bearer(worker)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${writeOffId}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);

    const wh1Low = await low(wh1.id);
    expect(
      wh1Low.data.map((row) => [
        row.product.sku,
        row.status,
        row.onHand,
        row.minQty,
        row.maxQty,
        row.suggestedQty,
      ]),
    ).toEqual([
      ['12', 'OUT', '0', '5', null, '5'],
      ['10', 'LOW', '44', '50', '100', '56'],
    ]);
    expect(wh1Low.data[1]).toMatchObject({
      baseUnitId: unitOf(cola, 'PCS').id,
      homeWarehouseId: wh1.id,
    });
    expect((await low(wh2.id)).data).toEqual([
      expect.objectContaining({
        product: expect.objectContaining({ sku: '11' }),
        status: 'OUT',
        onHand: '0',
        minQty: null,
        suggestedQty: null,
      }),
    ]);

    // Keyset pages; a level above the stock again takes the product off.
    const first = await low(wh1.id, { limit: 1 });
    expect(first.data.map((row) => row.product.sku)).toEqual(['12']);
    const second = await low(wh1.id, { limit: 1, cursor: first.nextCursor ?? '' });
    expect(second.data.map((row) => row.product.sku)).toEqual(['10']);
    await levels(wh1.id, cola.id, '40', '100');
    expect((await low(wh1.id)).data.map((row) => row.product.sku)).toEqual(['12']);
    await http().get('/api/v1/stock/low').set(bearer(worker)).expect(422);
  });
});
