import type { NestExpressApplication } from '@nestjs/platform-express';
import { matchesQuery, queryTerms, SEARCH_KEYS_VERSION, searchKeys } from '@tugeel/shared/text';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { reindexSearch } from '../../src/modules/catalog/cli/reindex-search';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

const PRODUCTS: [sku: string, name: string, barcode?: string][] = [
  ['50001', 'Кока кола 0.5л'],
  ['50002', 'Coca-Cola 1.5L', '4006381333931'],
  ['50003', 'Ус Лайм 1л'],
  ['50004', 'Үс угаагч шампунь'],
  ['50005', 'Өндөг 10ш'],
  ['50006', 'Ёгурт тараг'],
  ['50007', 'Мусор уут 30л'],
  ['50008', 'Bonaqua 0.5L'],
  ['51001', 'Ижил нэр'],
  ['51002', 'Ижил нэр'],
];

/** ADR-0028: mixed-script search over strict and phonetic keys, ranked, with keyset pages. */
describe('product search', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let worker: string;
  const http = () => request(app.getHttpServer());
  const search = async (q: string, limit = 200) => {
    const res = await http()
      .get(`/api/v1/products?q=${encodeURIComponent(q)}&limit=${limit}`)
      .set(bearer(worker))
      .expect(200);
    return res.body as { data: { sku: string; name: string }[]; nextCursor: string | null };
  };
  const names = async (q: string) => (await search(q)).data.map((row) => row.name);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const api = catalogApi(app, admin);
    const pcs = await api.uomId('PCS');
    const category = await api.category('Хайлт');
    for (const [sku, name, barcode] of PRODUCTS) {
      await api.product({
        sku,
        name,
        categoryId: category,
        baseUomId: pcs,
        ...(barcode ? { baseBarcodes: [barcode] } : {}),
      });
    }
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('finds Кока, Coca, кока and COCA in both scripts, strict matches first (SPEC §5.2)', async () => {
    expect(await names('Coca')).toEqual(['Coca-Cola 1.5L', 'Кока кола 0.5л']);
    expect(await names('кока')).toEqual(['Кока кола 0.5л', 'Coca-Cola 1.5L']);
    expect(await names('COCA')).toEqual(await names('coca'));
    expect(await names('бонаква')).toEqual(['Bonaqua 0.5L']);
  });

  it('tolerates ө/ү and ё typed as о/у/е, and matches short words only at their start', async () => {
    expect(await names('ондог')).toEqual(['Өндөг 10ш']);
    expect(await names('егурт')).toEqual(['Ёгурт тараг']);
    expect(await names('ус')).toEqual(['Ус Лайм 1л', 'Үс угаагч шампунь']);
    // "1л" is two short words: " 1" and " л" (Cyrillic) or " l" (phonetic, so "1.5L" qualifies too).
    expect(await names('1л')).toEqual(['Ус Лайм 1л', 'Coca-Cola 1.5L']);
  });

  it('agrees with the shared reference matcher for every name query', async () => {
    for (const q of ['кола', 'cola 0.5', 'уут', 'лайм ус', 'ш', 'шампунь', 'bonaqua', 'нэр']) {
      const expected = PRODUCTS.filter(([sku, name]) =>
        matchesQuery(searchKeys(name, [sku]), queryTerms(q)),
      )
        .map(([, name]) => name)
        .sort();
      expect({ q, found: [...(await names(q))].sort() }).toEqual({ q, found: expected });
    }
  });

  it('answers digits with SKU prefixes and an exact barcode first', async () => {
    expect((await search('5100')).data.map((row) => row.sku).sort()).toEqual(['51001', '51002']);
    const byBarcode = await search('4006381333931');
    expect(byBarcode.data[0]).toMatchObject({ sku: '50002' });
    expect((await search('50005')).data[0]).toMatchObject({ sku: '50005' });
  });

  it('pages through equal names exactly once', async () => {
    const seen: string[] = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const res = await http()
        .get(
          `/api/v1/products?q=${encodeURIComponent('ижил')}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        )
        .set(bearer(worker))
        .expect(200);
      const body = res.body as { data: { sku: string }[]; nextCursor: string | null };
      seen.push(...body.data.map((row) => row.sku));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    expect(seen.sort()).toEqual(['51001', '51002']);
  });

  it('recomputes stale search keys', async () => {
    await sql.query(
      `UPDATE products SET search_text = '', search_phonetic = '', search_version = 0 WHERE sku = '50005'`,
    );
    expect(await names('ондог')).toEqual([]);
    expect(await reindexSearch(app.get<Db>(DB))).toBe(1);
    expect(await names('ондог')).toEqual(['Өндөг 10ш']);
    const { rows } = await sql.query<{ version: number }>(
      `SELECT search_version AS version FROM products WHERE sku = '50005'`,
    );
    expect(rows[0]?.version).toBe(SEARCH_KEYS_VERSION);
  });
});
