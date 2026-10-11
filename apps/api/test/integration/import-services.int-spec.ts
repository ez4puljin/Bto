import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db, Tx } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { CatalogImportService } from '../../src/modules/catalog';
import { StorageService, systemActor } from '../../src/modules/identity';
import {
  AdjustmentsService,
  BinsService,
  NO_SHELF_CODE,
  ProductLocationsService,
  StockQueryService,
} from '../../src/modules/inventory';
import { ProductSuppliersService, SupplierContactsService } from '../../src/modules/partners';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

const actor = systemActor('import-test');

/**
 * The bulk service methods the Excel import builds on (ADR-0036): multi-row writes under table
 * locks instead of per-product advisory locks, system adjustments for opening stock and their
 * reversal, and reading an uploaded private sheet.
 */
describe('services for imports', () => {
  let app: NestExpressApplication;
  let db: Db;
  let sql: Client;
  let admin: string;
  let catalogImport: CatalogImportService;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let store: WarehouseJson;
  let shelf: number;
  let categoryId: number;
  let brandId: number;
  let pcs: number;
  let box: number;
  const http = () => request(app.getHttpServer());
  const tx = <T>(work: (t: Tx) => Promise<T>) => inTransaction(db, work);

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    sql = await connectAs('app');
    catalogImport = app.get(CatalogImportService);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    store = await inventory.warehouse('STORE1', 'STORE');
    shelf = (await inventory.bin(wh1.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    categoryId = await catalog.category('Ундаа');
    pcs = await catalog.uomId('PCS');
    box = await catalog.uomId('BOX');
    brandId = (
      (
        await http()
          .post('/api/v1/brands')
          .set(bearer(admin))
          .send({ name: 'Coca-Cola' })
          .expect(201)
      ).body as { id: number }
    ).id;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  const input = (sku: string, barcodes: string[], boxBarcodes: string[] | null) => ({
    sku,
    name: `Бараа ${sku}`,
    categoryId,
    brandId,
    vatType: 'VAT_ABLE' as const,
    weightKg: new Decimal('0.5'),
    baseUomId: pcs,
    baseBarcodes: barcodes,
    box: boxBarcodes ? { uomId: box, factorToBase: new Decimal(24), barcodes: boxBarcodes } : null,
  });

  it('creates products in bulk with units and barcodes, reads them back and deactivates them', async () => {
    const created = await tx((t) =>
      catalogImport.createManyInTx(t, actor, [
        input('101', ['4006381333931'], ['5449000000996']),
        input('102', [], null),
      ]),
    );
    expect([...created.keys()]).toEqual(['101', '102']);
    expect(created.get('102')?.boxUnitId).toBeNull();
    const [cola, plain] = await catalogImport.productsBySku(['101', '102', '999']);
    expect(cola).toMatchObject({
      sku: '101',
      name: 'Бараа 101',
      categoryId,
      brandId,
      status: 'ACTIVE',
    });
    expect(cola?.units.map((unit) => [unit.isBase, unit.factorToBase.toFixed()])).toEqual([
      [true, '1'],
      [false, '24'],
    ]);
    expect(cola?.units.flatMap((unit) => unit.barcodes.map((code) => code.code))).toEqual([
      '4006381333931',
      '5449000000996',
    ]);
    expect(plain?.units).toHaveLength(1);
    const owners = await catalogImport.barcodeOwners(['04006381333931', '05449000000996', '0']);
    expect([...owners.values()].map((owner) => owner.sku)).toEqual(['101', '101']);
    const { rows: audit } = await sql.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity = 'products' AND action = 'CREATE'`,
    );
    expect(audit[0]).toEqual({ n: 2 });
    // A barcode already taken fails the whole call.
    expect(
      await codeOf(
        tx((t) => catalogImport.createManyInTx(t, actor, [input('103', ['4006381333931'], null)])),
      ),
    ).toBe('DUPLICATE_VALUE');
    expect(await catalogImport.productsBySku(['103'])).toEqual([]);

    const before = await tx((t) =>
      catalogImport.updateProductInTx(t, actor, created.get('102')?.productId ?? 0, {
        name: 'Шинэ нэр',
      }),
    );
    expect(before.name).toBe('Бараа 102');
    const colaId = created.get('101')?.productId ?? 0;
    const plainId = created.get('102')?.productId ?? 0;
    await tx((t) => catalogImport.deactivateManyInTx(t, actor, [colaId, plainId]));
    const [inactive] = await catalogImport.productsBySku(['101']);
    expect(inactive?.status).toBe('INACTIVE');
    expect(inactive?.units.flatMap((unit) => unit.barcodes)).toEqual([]);
    expect((await catalogImport.barcodeOwners(['04006381333931'])).size).toBe(0);
    // Each product's audit row names its own released barcodes.
    const { rows: released } = await sql.query<{ entity_id: string; before: unknown }>(
      `SELECT entity_id, before FROM audit_log
        WHERE entity = 'products' AND action = 'UPDATE' AND after->>'status' = 'INACTIVE'
        ORDER BY entity_id::int`,
    );
    expect(released).toEqual([
      {
        entity_id: String(colaId),
        before: { status: 'ACTIVE', barcodes: ['4006381333931', '5449000000996'] },
      },
      { entity_id: String(plainId), before: { status: 'ACTIVE', barcodes: [] } },
    ]);
  });

  it('links suppliers and sets locations in bulk under table locks', async () => {
    const partners = partnersApi(app, admin);
    const msm = (await partners.supplier({ name: 'МСМ ХХК' })).id;
    const apu = (await partners.supplier({ name: 'АПУ ХК' })).id;
    const created = await tx((t) =>
      catalogImport.createManyInTx(t, actor, [input('201', [], null), input('202', [], null)]),
    );
    const first = created.get('201')?.productId ?? 0;
    const second = created.get('202')?.productId ?? 0;
    const links = app.get(ProductSuppliersService);
    const added = await tx((t) =>
      links.linkManyInTx(t, actor, [
        { productId: first, supplierId: msm },
        { productId: first, supplierId: apu },
        { productId: second, supplierId: apu },
      ]),
    );
    expect(added.size).toBe(3);
    // Linking again adds nothing.
    expect(
      (await tx((t) => links.linkManyInTx(t, actor, [{ productId: first, supplierId: msm }]))).size,
    ).toBe(0);
    expect((await links.ofProduct(first)).map((link) => [link.supplier.id, link.isMain])).toEqual([
      [msm, true],
      [apu, false],
    ]);
    await tx((t) => links.unlinkManyInTx(t, actor, [added.get(`${first}:${msm}`) ?? 0]));
    expect((await links.ofProduct(first)).map((link) => [link.supplier.id, link.isMain])).toEqual([
      [apu, true],
    ]);

    const contacts = app.get(SupplierContactsService);
    const contact = await tx((t) =>
      contacts.addInTx(t, actor, msm, { name: 'Бат', phone: '99112233' }),
    );
    expect(contact).toMatchObject({ supplierId: msm, name: 'Бат', phone: '+97699112233' });

    const locations = app.get(ProductLocationsService);
    const firstState = await tx((t) =>
      locations.setManyInTx(t, actor, [
        {
          productId: first,
          homeWarehouseId: wh1.id,
          fixedBin: { warehouseId: wh1.id, binId: shelf },
        },
        { productId: second, homeWarehouseId: wh2.id },
      ]),
    );
    expect(firstState.get(first)).toEqual({
      productId: first,
      homeWarehouseId: null,
      fixedBins: [],
    });
    // Moving the home keeps one home per product and reports where it was.
    const moved = await tx((t) =>
      locations.setManyInTx(t, actor, [{ productId: first, homeWarehouseId: wh2.id }]),
    );
    expect(moved.get(first)).toEqual({
      productId: first,
      homeWarehouseId: wh1.id,
      fixedBins: [{ warehouseId: wh1.id, binId: shelf }],
    });
    const homes = (await locations.ofProducts([first])).filter((row) => row.isHome);
    expect(homes.map((row) => row.warehouseId)).toEqual([wh2.id]);
    expect(
      await codeOf(
        tx((t) =>
          locations.setManyInTx(t, actor, [{ productId: first, homeWarehouseId: store.id }]),
        ),
      ),
    ).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
    expect(
      await codeOf(
        tx((t) =>
          locations.setManyInTx(t, actor, [
            { productId: first, fixedBin: { warehouseId: wh2.id, binId: shelf } },
          ]),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('posts opening stock as a system adjustment and reverses it once', async () => {
    const created = await tx((t) =>
      catalogImport.createManyInTx(t, actor, [
        input('301', [], ['4870001000011']),
        input('302', [], null),
      ]),
    );
    const cola = created.get('301');
    const water = created.get('302');
    if (!cola?.boxUnitId || !water) throw new Error('products missing');
    const bins = app.get(BinsService);
    const noShelf = await tx((t) => bins.ensureNoShelfInTx(t, actor, wh1.id));
    expect(noShelf).toMatchObject({ code: NO_SHELF_CODE, type: 'STORAGE', sellable: true });
    expect((await tx((t) => bins.ensureNoShelfInTx(t, actor, wh1.id))).id).toBe(noShelf.id);
    expect((await bins.ofWarehouses([wh1.id])).some((bin) => bin.code === NO_SHELF_CODE)).toBe(
      true,
    );

    const adjustments = app.get(AdjustmentsService);
    const opening = await tx((t) =>
      adjustments.postSystemInTx(t, actor, {
        warehouseId: wh1.id,
        reason: 'OPENING',
        note: 'Импорт',
        lines: [
          {
            productId: cola.productId,
            productUnitId: cola.boxUnitId ?? 0,
            enteredQty: new Decimal(2),
            factorSnapshot: new Decimal(24),
            binId: shelf,
            unitCost: new Decimal(1000),
          },
          {
            productId: water.productId,
            productUnitId: water.baseUnitId,
            enteredQty: new Decimal(5),
            factorSnapshot: new Decimal(1),
            binId: noShelf.id,
            unitCost: null,
          },
        ],
      }),
    );
    expect(opening.number).toMatch(/^ADJ-\d{4}-\d{6}$/);
    const { rows: stock } = await sql.query(
      `SELECT product_id::int, on_hand::text, avg_cost::text FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = ANY($2::bigint[]) ORDER BY product_id`,
      [wh1.id, [cola.productId, water.productId]],
    );
    expect(stock).toEqual([
      { product_id: cola.productId, on_hand: '48.000', avg_cost: '1000.0000' },
      { product_id: water.productId, on_hand: '5.000', avg_cost: '0.0000' },
    ]);
    const query = app.get(StockQueryService);
    expect(
      [...(await query.productsWithStock([cola.productId, water.productId, 1]))].sort(),
    ).toEqual([cola.productId, water.productId].sort());

    const reversal = await tx((t) => adjustments.reverseOpeningInTx(t, actor, opening.id));
    expect((await adjustments.get(reversal.id)).reason).toBe('OPENING_REVERSAL');
    expect((await query.productsWithStock([cola.productId, water.productId])).size).toBe(0);
    expect(await codeOf(tx((t) => adjustments.reverseOpeningInTx(t, actor, opening.id)))).toBe(
      'DOC_ALREADY_POSTED',
    );

    // Goods that moved since cannot be taken back.
    const again = await tx((t) =>
      adjustments.postSystemInTx(t, actor, {
        warehouseId: wh1.id,
        reason: 'OPENING',
        lines: [
          {
            productId: water.productId,
            productUnitId: water.baseUnitId,
            enteredQty: new Decimal(5),
            factorSnapshot: new Decimal(1),
            binId: noShelf.id,
            unitCost: null,
          },
        ],
      }),
    );
    await http()
      .post('/api/v1/bin-moves')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        lines: [
          {
            productUnitId: water.baseUnitId,
            enteredQty: '3',
            fromBinId: noShelf.id,
            toBinId: shelf,
          },
        ],
      })
      .expect(201);
    expect(await codeOf(tx((t) => adjustments.reverseOpeningInTx(t, actor, again.id)))).toBe(
      'STOCK_INSUFFICIENT',
    );
    // Bins of another warehouse are refused.
    const foreign = (await bins.systemBin(wh2.id, 'RECEIVING')).id;
    expect(
      await codeOf(
        tx((t) =>
          adjustments.postSystemInTx(t, actor, {
            warehouseId: wh1.id,
            reason: 'OPENING',
            lines: [
              {
                productId: water.productId,
                productUnitId: water.baseUnitId,
                enteredQty: new Decimal(1),
                factorSnapshot: new Decimal(1),
                binId: foreign,
                unitCost: null,
              },
            ],
          }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('opens an uploaded import sheet on the server only', async () => {
    const body = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(admin))
        .send({ kind: 'imports.source', contentType: XLSX_CONTENT_TYPE, sizeBytes: body.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http()
      .put(issued.uploadUrl)
      .set('Content-Type', XLSX_CONTENT_TYPE)
      .send(body)
      .expect(204);
    const storage = app.get(StorageService);
    expect(await codeOf(storage.openPrivate(issued.fileId, 'imports.source'))).toBe('NOT_FOUND');
    await tx((t) => storage.confirm(t, issued.fileId, 'imports.source'));
    const opened = await storage.openPrivate(issued.fileId, 'imports.source');
    const chunks: Buffer[] = [];
    for await (const chunk of opened.body) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).equals(body)).toBe(true);
    expect(await codeOf(storage.openPrivate(issued.fileId, 'catalog.product_image'))).toBe(
      'NOT_FOUND',
    );
  });
});
