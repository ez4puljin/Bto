import type { NestExpressApplication } from '@nestjs/platform-express';
import { EXPORTABLE_PRODUCT_COLUMNS } from '@tugeel/shared/catalog';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, type ProductJson } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

const ean13 = (body: string) => `${body}${gtinCheckDigit(body)}`;
const COLA_PCS = ean13('865000000001');
const COLA_BOX = ean13('865000000002');

/**
 * The product export (ADR-0049 #6): the ticked products or every product the list's filters keep,
 * in the list's order (by name), with the visible columns in the list's order. Codes and barcodes
 * are text, prices and weights numbers, and an empty value is an empty cell (Excel filters and
 * sorts it as a blank).
 */
describe('product export', () => {
  let app: NestExpressApplication;
  let admin: string;
  let worker: string;
  let wh1: WarehouseJson;
  let drinks: number;
  let cola: ProductJson;
  let still: ProductJson;
  let pcsName: string;
  let boxName: string;
  const http = () => request(app.getHttpServer());

  /** POST /exports/products; the body comes back as a Buffer. */
  const download = (body: Record<string, unknown>, token = admin) =>
    http()
      .post('/api/v1/exports/products')
      .set(bearer(token))
      .send(body)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  /** The sheet's rows as plain values, the header first; an empty cell reads as null. */
  async function rowsOf(body: Buffer): Promise<unknown[][]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const rows: unknown[][] = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      rows.push(Array.from((row.values as unknown[]).slice(1), (value) => value ?? null));
    });
    return rows;
  }

  beforeAll(async () => {
    app = await createHttpApp();
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('EX1');
    const shelf = await inventory.bin(wh1.id, 'A-01-01');
    const catalog = catalogApi(app, admin);
    drinks = await catalog.category('Ундаа');
    const water = await catalog.category('Ус', drinks);
    const food = await catalog.category('Хүнс');
    const uoms = (await http().get('/api/v1/uoms').set(bearer(admin)).expect(200)).body as {
      data: { id: number; code: string | null; name: string }[];
    };
    const uom = (code: string) => {
      const found = uoms.data.find((row) => row.code === code);
      if (!found) throw new Error(`no unit of measure ${code}`);
      return found;
    };
    pcsName = uom('PCS').name;
    boxName = uom('BOX').name;
    cola = await catalog.product({
      sku: '501',
      name: 'Кока кола',
      categoryId: drinks,
      baseUomId: uom('PCS').id,
      weightKg: '0.5',
      baseBarcodes: [COLA_PCS],
      units: [{ uomId: uom('BOX').id, factorToBase: '24', barcodes: [COLA_BOX] }],
    });
    still = await catalog.product({
      sku: '502',
      name: 'Ус 0.5л',
      categoryId: water,
      baseUomId: uom('PCS').id,
    });
    await catalog.product({
      sku: '503',
      name: 'Будаа',
      categoryId: food,
      baseUomId: uom('PCS').id,
    });
    const partners = partnersApi(app, admin);
    for (const name of ['МСМ ХХК', 'АПУ ХК']) {
      const supplier = await partners.supplier({ name });
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId: cola.id, supplierId: supplier.id })
        .expect(201);
    }
    await inventory.setHome(cola.id, wh1.id);
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, productId: cola.id, defaultBinId: shelf.id })
      .expect(200);
    const pricing = pricingApi(app, admin);
    await pricing.terms(cola.id, '1000', await pricing.profile('Ундаа'), uom('BOX').id);
  });
  afterAll(async () => {
    await app.close();
  });

  it('writes the visible columns of every product the filters keep, in the list order', async () => {
    const file = await download({ columns: [...EXPORTABLE_PRODUCT_COLUMNS].reverse() }).expect(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect(file.headers['content-disposition']).toContain(
      `filename="products-${businessDate()}.xlsx"`,
    );
    const [header, ...rows] = await rowsOf(file.body as Buffer);
    expect(header).toEqual(
      EXPORTABLE_PRODUCT_COLUMNS.map((key) => mn.catalog.products.columns[key]),
    );
    const pending = mn.catalog.products.status.PENDING;
    expect(rows).toEqual([
      [
        '503',
        'Будаа',
        'Хүнс',
        pcsName,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        pending,
      ],
      [
        '501',
        'Кока кола',
        'Ундаа',
        pcsName,
        `1 ${boxName} = 24 ${pcsName}`,
        1000,
        'Ундаа',
        COLA_PCS,
        `${COLA_BOX} (${boxName})`,
        0.5,
        wh1.name,
        `${wh1.name}: A-01-01`,
        'МСМ ХХК, АПУ ХК',
        pending,
      ],
      [
        '502',
        'Ус 0.5л',
        'Ундаа / Ус',
        pcsName,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        pending,
      ],
    ]);
  });

  it('writes the ticked products only, or what the conditions keep', async () => {
    const ticked = await download({
      productIds: [still.id, cola.id, 999_999],
      columns: ['name', 'sku'],
    }).expect(200);
    expect(await rowsOf(ticked.body as Buffer)).toEqual([
      [mn.catalog.products.columns.sku, mn.catalog.products.columns.name],
      ['501', 'Кока кола'],
      ['502', 'Ус 0.5л'],
    ]);
    const kept = await download({
      where: {
        match: 'ALL',
        groups: [{ match: 'ALL', conditions: [{ field: 'category', op: 'IN', ids: [drinks] }] }],
      },
      q: 'ус',
      columns: ['sku'],
    }).expect(200);
    expect(await rowsOf(kept.body as Buffer)).toEqual([[mn.catalog.products.columns.sku], ['502']]);
    // Nothing kept: the header alone.
    const none = await download({ q: 'байхгүй бараа', columns: ['sku'] }).expect(200);
    expect(await rowsOf(none.body as Buffer)).toEqual([[mn.catalog.products.columns.sku]]);
  });

  it('refuses ticked products with filters, the photo and callers without the right', async () => {
    const mixed = await download({ productIds: [cola.id], q: 'кола', columns: ['sku'] }).expect(
      422,
    );
    expect(JSON.parse((mixed.body as Buffer).toString('utf8'))).toMatchObject({
      errors: [{ path: 'productIds', constraint: 'alone' }],
    });
    await download({ columns: ['image'] }).expect(422);
    await download({ columns: [] }).expect(422);
    await download({ columns: ['sku'] }, worker).expect(403);
  });
});
