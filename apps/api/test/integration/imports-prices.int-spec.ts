import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi } from '../harness/imports';
import { pricingApi } from '../harness/pricing';

interface TermsJson {
  warehousePrice: string;
  profileName: string;
  wholeUomId: number | null;
  validFrom: string;
  validTo: string | null;
}
interface PriceViewJson {
  current: TermsJson | null;
  scheduled: TermsJson[];
}

/**
 * The price sheet import (ADR-0054): the template filled with every active product, the row
 * rules, writing under the table lock, completing waiting products and the forward revert.
 * Synthetic data only.
 */
describe('imports: prices', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let imports: ReturnType<typeof importsApi>;
  let boxUom: number;
  let liveProfile: number;
  const products = new Map<string, ProductJson>();
  const profile = 'Импорт: Ундаа';
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const codes = (rows: { errors: { code: string; column: string | null }[] }[]) =>
    rows.map((row) => row.errors.map((issue) => `${issue.column}:${issue.code}`));
  const id = (sku: string) => products.get(sku)?.id ?? 0;
  const pricesOf = async (sku: string) =>
    (
      await http()
        .get('/api/v1/product-prices')
        .query({ productId: id(sku) })
        .set(bearer(admin))
        .expect(200)
    ).body as PriceViewJson;
  const saleReady = async (...skus: string[]) =>
    (
      await sql.query<{ sku: string; ready: boolean }>(
        `SELECT sku, sale_ready_at IS NOT NULL AS ready FROM products WHERE sku = ANY($1) ORDER BY sku`,
        [skus],
      )
    ).rows.map((row) => `${row.sku}:${row.ready}`);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    imports = importsApi(app, admin);
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Импортын үнэ');
    const base = await catalog.uomId('PCS');
    boxUom = await catalog.uomId('BOX');
    for (const [sku, box] of [
      ['8101', '24'],
      ['8102', null],
      ['8103', '12'],
      ['8104', null],
      ['8105', '6'],
      ['8106', '20'],
    ] as const) {
      products.set(
        sku,
        await catalog.product({
          sku,
          name: `Бараа ${sku}`,
          categoryId: category,
          baseUomId: base,
          ...(box ? { units: [{ uomId: boxUom, factorToBase: box }] } : {}),
        }),
      );
    }
    const pricing = pricingApi(app, admin);
    liveProfile = await pricing.profile(profile);
    const old = await pricing.profile('Импорт: Хуучин');
    await http()
      .post(`/api/v1/price-profiles/${old}/archive`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    await pricing.profile('Импорт: Ирээдүй', { validFrom: addDays(today, 5) });
    await pricing.terms(id('8103'), '800', liveProfile, boxUom);
    await pricing.terms(id('8104'), '700', liveProfile, null);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('fills the template with every active product and its terms in force', async () => {
    const response = await http()
      .get('/api/v1/imports/templates/PRICES')
      .set(bearer(admin))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-disposition']).toContain('tugeel-prices.xlsx');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body as ArrayBuffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Үнэ', 'Тохиргоо', 'Заавар']);
    const [sheet, profiles] = book.worksheets;
    if (!sheet || !profiles) throw new Error('no sheets');
    const rows: unknown[][] = [];
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
    expect(rows[0]).toEqual([
      'Код *',
      'Нэр',
      'Суурь нэгж',
      'Савлагаа',
      'Агуулахын үнэ',
      'Үнийн тохиргоо',
      'Бүтэн савлагаа',
      'Хэдээс',
    ]);
    const { rows: active } = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM products WHERE status = 'ACTIVE'`,
    );
    expect(rows).toHaveLength((active[0]?.count ?? 0) + 1);
    const ours = rows.filter((row) => typeof row[0] === 'string' && row[0].startsWith('81'));
    expect(ours.slice(0, 4)).toEqual([
      ['8101', 'Бараа 8101', 'ш', 'хайрцаг 24'],
      ['8102', 'Бараа 8102', 'ш'],
      ['8103', 'Бараа 8103', 'ш', 'хайрцаг 12', 800, profile, 'хайрцаг'],
      ['8104', 'Бараа 8104', 'ш', undefined, 700, profile],
    ]);
    const names: unknown[] = [];
    profiles.eachRow((row) => names.push(row.getCell(1).value));
    expect(names).toContain(profile);
    expect(names).toContain('Импорт: Ирээдүй');
    expect(names).not.toContain('Импорт: Хуучин');
  });

  it('refuses a sheet with a broken row and names each problem', async () => {
    const job = await imports.check('PRICES', [
      { sku: '9999', warehousePrice: 100, profile },
      { sku: '8101', warehousePrice: '10.5', profile, wholePack: 'хайрцаг' },
      { sku: '8102', warehousePrice: 0, profile: 'Байхгүй тохиргоо' },
      { sku: '8103', warehousePrice: 100, profile: 'Импорт: Хуучин', wholePack: 'хайрцаг' },
      { sku: '8104', warehousePrice: 100, profile: 'Импорт: Ирээдүй' },
      { sku: '8105', warehousePrice: 100, profile, validFrom: addDays(today, -1) },
      { sku: '8106', warehousePrice: 100, profile, wholePack: 'шуудай', validFrom: 'маргааш' },
      { sku: '8102', warehousePrice: 100, profile, wholePack: 'хайрцаг' },
    ]);
    expect(job.status).toBe('INVALID');
    expect(codes(await imports.rows(job.id))).toEqual([
      ['sku:NOT_FOUND'],
      ['warehousePrice:NOT_WHOLE'],
      ['warehousePrice:NOT_POSITIVE', 'profile:NOT_FOUND'],
      ['profile:ARCHIVED'],
      ['profile:NO_PROFILE_VALUES'],
      ['validFrom:PAST_DATE', 'wholePack:REQUIRED'],
      ['validFrom:FORMAT', 'wholePack:NOT_FOUND'],
      ['wholePack:NO_PACKS', 'sku:DUPLICATE_IN_FILE'],
    ]);
  });

  it('writes the terms, completes the products priced from today and reverts forward', async () => {
    const job = await imports.check('PRICES', [
      { sku: '8101', warehousePrice: 1000, profile, wholePack: 'хайрцаг' },
      { sku: '8102', warehousePrice: 500, profile, validFrom: addDays(today, 3) },
      { sku: '8103', warehousePrice: 900, profile, wholePack: 'Хайрцаг' },
      { sku: '8104', warehousePrice: 700, profile, validFrom: today },
      { sku: '8105', name: 'Нэр өөрчилсөн ч орохгүй' },
    ]);
    expect(job.status).toBe('VALIDATED');
    expect((await imports.rows(job.id)).map((row) => [row.action, row.changed])).toEqual([
      ['CREATE', []],
      ['CREATE', []],
      ['UPDATE', ['warehousePrice']],
      ['UNCHANGED', []],
      ['UNCHANGED', []],
    ]);
    const committed = await imports.commit(job.id);
    expect(committed.status).toBe('COMMITTED');
    expect(committed.summary?.applied).toEqual({
      CREATE: 2,
      UPDATE: 1,
      UNCHANGED: 2,
      COMPLETED: 2,
    });
    // Only the import lock: no advisory lock per product.
    expect(committed.summary?.advisoryLocks).toBe(1);
    expect(await saleReady('8101', '8102', '8103', '8104')).toEqual([
      '8101:true',
      '8102:false',
      '8103:true',
      '8104:false',
    ]);
    expect((await pricesOf('8101')).current).toMatchObject({
      warehousePrice: '1000',
      profileName: profile,
      wholeUomId: boxUom,
      validFrom: today,
    });
    expect((await pricesOf('8102')).scheduled).toEqual([
      expect.objectContaining({ warehousePrice: '500', validFrom: addDays(today, 3) }),
    ]);
    const name = await sql.query<{ name: string }>(`SELECT name FROM products WHERE sku = '8105'`);
    expect(name.rows[0]?.name).toBe('Бараа 8105');

    // The clerk changes 8103 after the import: the revert leaves it as the clerk set it.
    await pricingApi(app, admin).terms(id('8103'), '950', liveProfile, boxUom);
    const reverted = await imports.revert(job.id);
    expect(reverted.status).toBe('REVERTED');
    expect((await pricesOf('8101')).current).toBeNull();
    expect((await pricesOf('8102')).scheduled).toEqual([]);
    expect((await pricesOf('8103')).current).toMatchObject({ warehousePrice: '950' });
    expect((await pricesOf('8104')).current).toMatchObject({ warehousePrice: '700' });
    expect(await saleReady('8101', '8103')).toEqual(['8101:false', '8103:true']);
    const audit = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log WHERE entity = 'products' AND action = 'UNCOMPLETE'
          AND entity_id = $1`,
      [String(id('8101'))],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('brings back the terms an import replaced, from the revert day', async () => {
    const job = await imports.check('PRICES', [
      { sku: '8104', warehousePrice: 750, profile },
      {
        sku: '8105',
        warehousePrice: 300,
        profile,
        wholePack: 'хайрцаг',
        validFrom: addDays(today, 2),
      },
    ]);
    expect((await imports.commit(job.id)).status).toBe('COMMITTED');
    expect((await pricesOf('8104')).current).toMatchObject({ warehousePrice: '750' });
    expect((await imports.revert(job.id)).status).toBe('REVERTED');
    expect((await pricesOf('8104')).current).toMatchObject({
      warehousePrice: '700',
      validFrom: today,
      validTo: null,
    });
    expect((await pricesOf('8105')).current).toBeNull();
    expect((await pricesOf('8105')).scheduled).toEqual([]);
  });
});
