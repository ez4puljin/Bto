import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import type { PgBoss } from 'pg-boss';
import request from 'supertest';
import { PG_BOSS } from '../../src/common/jobs/pg-boss.provider';
import { ImportPipelineService } from '../../src/modules/imports';
import { StocktakesService } from '../../src/modules/inventory';
import { connectAs, createHttpApp, createWorker, waitFor } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi, type ImportJobJson, sheetOf } from '../harness/imports';
import {
  expectReconciled,
  inventoryApi,
  staffContext,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

const COLA_BARCODE = '4006381333931';
const COLA_BOX_BARCODE = '5449000000996';

/**
 * Excel imports end to end (SPEC §5.5, ADR-0036): templates, the preview with Mongolian problem
 * codes, all-or-nothing commits, re-imports, opening stock per warehouse and the LIFO revert.
 * Synthetic data only: the owner's real sheets never enter the repository.
 */
describe('imports', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let imports: ReturnType<typeof importsApi>;
  let wh1: WarehouseJson;
  const committed: number[] = [];
  const http = () => request(app.getHttpServer());

  const codes = (rows: { errors: { code: string; column: string | null }[] }[]) =>
    rows.flatMap((row) => row.errors.map((issue) => `${issue.column}:${issue.code}`));
  const productRow = async (sku: string) => {
    const { rows } = await sql.query<{
      id: string;
      name: string;
      status: string;
      sale_ready: boolean;
    }>(
      `SELECT id::text, name, status, sale_ready_at IS NOT NULL AS sale_ready FROM products WHERE sku = $1`,
      [sku],
    );
    return rows[0];
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    imports = importsApi(app, admin);
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    await inventory.warehouse('WH2');
    await inventory.warehouse('STORE1', 'STORE');
    await inventory.bin(wh1.id, 'A-01-01');
    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа');
    await catalog.category('Хийжүүлсэн', drinks);
    const food = await catalog.category('Хүнс');
    await catalog.category('Хийжүүлсэн', food);
    await catalog.category('Ус');
    await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('downloads templates for admins only', async () => {
    const response = await http()
      .get('/api/v1/imports/templates/OPENING_STOCK')
      .set(bearer(admin))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.headers['content-disposition']).toContain('tugeel-opening-stock.xlsx');
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await http().get('/api/v1/imports/templates/PRODUCTS').set(bearer(worker)).expect(403);
    await http().get('/api/v1/imports/templates/ORDERS').set(bearer(admin)).expect(422);
  });

  it('previews products with their problems and refuses a file with any error', async () => {
    const job = await imports.check('PRODUCTS', [
      {
        sku: '1001',
        name: 'Кока кола 0.5л',
        category: 'Ундаа / Хийжүүлсэн',
        barcodes: COLA_BARCODE,
      },
      { sku: '1002', name: 'Цэвэр ус', category: 'Цай' },
      { sku: '1001', name: 'Давхар', category: 'Ус' },
      { sku: '1003', name: 'Хоёрдмол', category: 'Хийжүүлсэн' },
      { sku: '1004', name: 'Баркод', category: 'Ус', barcodes: COLA_BARCODE },
      { sku: '12AB', name: 'Үсэг', category: 'Ус', boxQty: 'хайрцаг' },
    ]);
    expect(job).toMatchObject({ status: 'INVALID', totalRows: 6, errorRows: 5 });
    expect(codes(await imports.rows(job.id, 'ERRORS'))).toEqual([
      'category:NOT_FOUND',
      'sku:DUPLICATE_IN_FILE',
      'category:AMBIGUOUS',
      'barcodes:DUPLICATE_IN_FILE',
      'sku:FORMAT',
      'boxQty:FORMAT',
    ]);
    const [first] = await imports.rows(job.id);
    expect(first).toMatchObject({ rowNo: 2, action: 'CREATE', errors: [] });
    const refused = await http()
      .post(`/api/v1/imports/${job.id}/commit`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'IMPORT_HAS_ERRORS' });
    expect(await productRow('1001')).toBeUndefined();
  });

  it('refuses a sheet without the required columns as a whole', async () => {
    const job = await imports.check('CUSTOMERS', [{ name: 'Код алга' }]);
    expect(job).toMatchObject({
      status: 'INVALID',
      totalRows: 0,
      summary: { fileIssues: [{ code: 'MISSING_COLUMNS', params: { columns: 'Код' } }] },
    });
  });

  it('creates products with units, barcodes, home, shelf and supplier in one commit', async () => {
    const rows = [
      {
        sku: '1001',
        name: 'Кока кола 0.5л',
        category: 'Ундаа / Хийжүүлсэн',
        barcodes: COLA_BARCODE,
        boxQty: 24,
        boxBarcodes: COLA_BOX_BARCODE,
        vatType: 'НӨАТ-тай',
        weightKg: 0.55,
        homeWarehouse: 'WH1',
        fixedBin: 'a-01-01',
        supplier: 'мсм ххк',
      },
      { sku: '1002', name: 'Цэвэр ус', category: 'Ус' },
    ];
    const job = await imports.check('PRODUCTS', rows);
    expect(job).toMatchObject({ status: 'VALIDATED', summary: { actions: { CREATE: 2 } } });
    const done = await imports.commit(job.id);
    committed.push(job.id);
    expect(done).toMatchObject({ status: 'COMMITTED', canRevert: true });
    expect(done.summary?.applied).toMatchObject({ CREATE: 2 });
    // Bulk writes under table locks: the commit holds the import lock, not one per product.
    expect(done.summary?.advisoryLocks).toBeLessThanOrEqual(3);
    const { rows: units } = await sql.query(
      `SELECT u.factor_to_base::text AS factor, u.is_base, string_agg(b.code, ',' ORDER BY b.id) AS codes
         FROM products p JOIN product_units u ON u.product_id = p.id
         LEFT JOIN product_barcodes b ON b.product_unit_id = u.id
        WHERE p.sku = '1001' GROUP BY u.id ORDER BY u.id`,
    );
    expect(units).toEqual([
      { factor: '1.000000', is_base: true, codes: COLA_BARCODE },
      { factor: '24.000000', is_base: false, codes: COLA_BOX_BARCODE },
    ]);
    const { rows: where } = await sql.query(
      `SELECT pl.is_home, b.code AS bin, s.name AS supplier
         FROM products p JOIN product_locations pl ON pl.product_id = p.id
         LEFT JOIN bins b ON b.id = pl.default_bin_id
         JOIN product_suppliers ps ON ps.product_id = p.id JOIN suppliers s ON s.id = ps.supplier_id
        WHERE p.sku = '1001'`,
    );
    expect(where).toEqual([{ is_home: true, bin: 'A-01-01', supplier: 'МСМ ХХК' }]);
    // Imported products wait for their prices like registered ones (ADR-0044).
    expect(await productRow('1001')).toMatchObject({ status: 'ACTIVE', sale_ready: false });

    // The same file again changes nothing; a new name is an update, a new box size is refused.
    const again = await imports.check('PRODUCTS', rows);
    expect(again.summary?.actions).toMatchObject({ UNCHANGED: 2 });
    const changed = await imports.check('PRODUCTS', [
      { ...rows[0], name: 'Кока кола 0.5 л', boxQty: 12 },
    ]);
    expect(codes(await imports.rows(changed.id, 'ERRORS'))).toEqual(['boxQty:MISMATCH']);
    const renamed = await imports.check('PRODUCTS', [
      { sku: '1001', name: 'Кока кола 0.5 л', category: 'Ундаа > Хийжүүлсэн' },
    ]);
    expect(await imports.rows(renamed.id)).toEqual([
      expect.objectContaining({ action: 'UPDATE', changed: ['name'] }),
    ]);
    expect((await imports.commit(renamed.id)).status).toBe('COMMITTED');
    committed.push(renamed.id);
    expect((await productRow('1001'))?.name).toBe('Кока кола 0.5 л');
  });

  it('imports customers with the kind read from their numbers, credit terms, settlement group and GPS', async () => {
    const job = await imports.check('CUSTOMERS', [
      {
        code: '501',
        name: 'Номин дэлгүүр',
        regNo: '1234567',
        tin: '12345678901',
        phone: '9911 2233',
        address: 'БЗД, 3-р хороо',
        gps: 'https://www.google.com/maps/@47.918,106.917,17z',
        creditLimit: '5,000,000',
        settlementGroup: 'Орон нутаг',
      },
      {
        code: '502',
        name: 'Бат',
        regNo: 'УБ90010112',
        consumerNo: '12345678',
        settlementGroup: 'Мөрөн',
      },
      { code: '503', name: 'Шинэ харилцагч', settlementGroup: 'DAY_20' },
      { code: '504', name: 'Буруу', phone: '123', consumerNo: '1', settlementGroup: 'Мөрөн' },
      { code: '505', name: 'Бүлэггүй' },
      { code: '506', name: 'Буруу бүлэг', settlementGroup: 'Хот' },
    ]);
    expect(job).toMatchObject({ status: 'INVALID', errorRows: 3 });
    // A new customer needs its settlement group (ADR-0101).
    expect(codes(await imports.rows(job.id, 'ERRORS'))).toEqual([
      'consumerNo:NOT_ALLOWED',
      'phone:FORMAT',
      'settlementGroup:REQUIRED',
      'settlementGroup:FORMAT',
    ]);
    const fixed = await imports.check('CUSTOMERS', [
      {
        code: '501',
        name: 'Номин дэлгүүр',
        regNo: '1234567',
        tin: '12345678901',
        phone: '9911 2233',
        address: 'БЗД, 3-р хороо',
        gps: 'https://www.google.com/maps/@47.918,106.917,17z',
        creditLimit: '5,000,000',
        settlementGroup: 'Орон нутаг',
      },
      {
        code: '502',
        name: 'Бат',
        regNo: 'УБ90010112',
        consumerNo: '12345678',
        settlementGroup: 'Мөрөн',
      },
      { code: '503', name: 'Шинэ харилцагч', settlementGroup: 'DAY_20' },
    ]);
    expect(fixed).toMatchObject({ status: 'VALIDATED', warningRows: 1 });
    expect((await imports.rows(fixed.id, 'WARNINGS'))[0]?.warnings).toEqual([
      { column: null, code: 'KIND_GUESSED' },
    ]);
    expect((await imports.commit(fixed.id)).status).toBe('COMMITTED');
    committed.push(fixed.id);
    const { rows } = await sql.query(
      `SELECT c.code, c.kind, c.phone, c.credit_limit::text AS credit, c.settlement_group AS term,
              a.lat::text AS lat
         FROM customers c LEFT JOIN customer_addresses a ON a.customer_id = c.id
        ORDER BY c.code`,
    );
    expect(rows).toEqual([
      {
        code: '501',
        kind: 'COMPANY',
        phone: '+97699112233',
        credit: '5000000.00',
        term: 'MONTH_END',
        lat: '47.918000',
      },
      { code: '502', kind: 'INDIVIDUAL', phone: null, credit: null, term: 'DAY_20', lat: null },
      { code: '503', kind: 'COMPANY', phone: null, credit: null, term: 'DAY_20', lat: null },
    ]);
  });

  it('imports suppliers keyed on the name when they have no code, with their contact', async () => {
    const job = await imports.check('SUPPLIERS', [
      { name: 'Таван богд', contactName: 'Сараа', contactPhone: '88112233', paymentTermDays: 14 },
      { code: '77', name: 'мсм ххк' },
    ]);
    expect(codes(await imports.rows(job.id, 'ERRORS'))).toEqual(['name:TAKEN']);
    const ok = await imports.check('SUPPLIERS', [
      { name: 'Таван богд', contactName: 'Сараа', contactPhone: '88112233', paymentTermDays: 14 },
      { name: 'МСМ ХХК', bankAccount: 'mn 12-3456 7890' },
    ]);
    expect(await imports.rows(ok.id)).toEqual([
      expect.objectContaining({ action: 'CREATE' }),
      expect.objectContaining({ action: 'UPDATE', changed: ['bankAccount'] }),
    ]);
    expect((await imports.commit(ok.id)).status).toBe('COMMITTED');
    committed.push(ok.id);
    const { rows } = await sql.query(
      `SELECT s.name, s.bank_account, s.payment_term_days AS term, c.name AS contact, c.phone
         FROM suppliers s LEFT JOIN supplier_contacts c ON c.supplier_id = s.id ORDER BY s.id`,
    );
    expect(rows).toEqual([
      { name: 'МСМ ХХК', bank_account: 'MN1234567890', term: null, contact: null, phone: null },
      { name: 'Таван богд', bank_account: null, term: 14, contact: 'Сараа', phone: '+97688112233' },
    ]);
  });

  it('leaves nothing behind when the commit fails late', async () => {
    const inventory = inventoryApi(app, admin);
    const wh3 = await inventory.warehouse('WH3');
    const wh4 = await inventory.warehouse('WH4');
    await inventory.bin(wh3.id, 'C-01-01');
    const counted = await inventory.bin(wh4.id, 'D-01-01');
    const job = await imports.check('OPENING_STOCK', [
      { warehouse: 'WH3', bin: 'C-01-01', sku: '1002', qty: 5 },
      { warehouse: 'WH4', bin: 'D-01-01', sku: '1002', qty: 5 },
    ]);
    expect(job.status).toBe('VALIDATED');
    // The shelf of the second warehouse is counted after the check: its posting fails.
    const stocktakes = app.get(StocktakesService);
    const ctx = staffContext(1, 'ADMIN');
    const count = await stocktakes.create(ctx, { warehouseId: wh4.id, binIds: [counted.id] });
    await stocktakes.start(ctx, count.id);
    const failed = await imports.commit(job.id);
    expect(failed).toMatchObject({
      status: 'VALIDATED',
      lastError: { code: 'BIN_LOCKED_FOR_COUNT' },
    });
    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM adjustments WHERE warehouse_id = ANY($1::bigint[])`,
      [[wh3.id, wh4.id]],
    );
    expect(rows[0]).toEqual({ n: 0 });
    await stocktakes.cancel(ctx, count.id);
  });

  it('imports opening stock once per warehouse, onto fixed shelves, the sales floor or «Тавиургүй»', async () => {
    const job = await imports.check('OPENING_STOCK', [
      { warehouse: 'WH1', sku: '1001', unit: 'хайрцаг', qty: 2, unitCost: 24000 },
      { warehouse: 'Агуулах WH1', sku: '1002', qty: 5 },
      { warehouse: 'STORE1', sku: '1002', qty: 3, unitCost: 500 },
      { warehouse: 'STORE1', sku: '1001', qty: 1 },
      { warehouse: 'WH2', sku: '1001', qty: 1 },
    ]);
    expect(codes(await imports.rows(job.id, 'ERRORS'))).toEqual(['warehouse:NOT_ALLOWED']);
    const ok = await imports.check('OPENING_STOCK', [
      { warehouse: 'WH1', sku: '1001', unit: 'хайрцаг', qty: 2, unitCost: 24000 },
      { warehouse: 'Агуулах WH1', sku: '1002', qty: 5 },
      { warehouse: 'STORE1', sku: '1002', qty: 3, unitCost: 500 },
      { warehouse: 'STORE1', sku: '1001', qty: 1 },
    ]);
    expect(ok.status).toBe('VALIDATED');
    expect(
      (await imports.rows(ok.id)).map((row) => row.warnings.map((issue) => issue.code)),
    ).toEqual([[], ['NO_SHELF', 'NO_COST'], [], ['NO_COST']]);
    expect((await imports.commit(ok.id)).status).toBe('COMMITTED');
    committed.push(ok.id);
    const { rows } = await sql.query(
      `SELECT w.code AS wh, b.code AS bin, p.sku, bs.on_hand::text AS qty, ws.avg_cost::text AS cost
         FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id JOIN warehouses w ON w.id = bs.warehouse_id
         JOIN products p ON p.id = bs.product_id
         JOIN warehouse_stock ws ON ws.warehouse_id = bs.warehouse_id AND ws.product_id = bs.product_id
        WHERE bs.on_hand <> 0 ORDER BY w.code, p.sku`,
    );
    expect(rows).toEqual([
      { wh: 'STORE1', bin: 'SALESFLOOR', sku: '1001', qty: '1.000', cost: '0.0000' },
      { wh: 'STORE1', bin: 'SALESFLOOR', sku: '1002', qty: '3.000', cost: '500.0000' },
      { wh: 'WH1', bin: 'A-01-01', sku: '1001', qty: '48.000', cost: '1000.0000' },
      { wh: 'WH1', bin: 'NOSHELF', sku: '1002', qty: '5.000', cost: '0.0000' },
    ]);
    const again = await imports.check('OPENING_STOCK', [{ warehouse: 'WH1', sku: '1002', qty: 1 }]);
    expect(codes(await imports.rows(again.id, 'ERRORS'))).toEqual(['warehouse:ALREADY_IMPORTED']);
  });

  it('sets low-stock levels per warehouse in a unit and keeps what a cell leaves empty (ADR-0039)', async () => {
    const levels = async () =>
      (
        await sql.query(
          `SELECT w.code AS wh, p.sku, pl.min_qty::text AS min, pl.max_qty::text AS max
             FROM product_locations pl JOIN warehouses w ON w.id = pl.warehouse_id
             JOIN products p ON p.id = pl.product_id
            WHERE pl.min_qty IS NOT NULL OR pl.max_qty IS NOT NULL ORDER BY w.code, p.sku`,
        )
      ).rows;
    const bad = await imports.check('LEVELS', [
      { warehouse: 'WH2', sku: '1001', minQty: 1 },
      { warehouse: 'WH1', sku: '9999', minQty: 1 },
      { warehouse: 'WH1', sku: '1001', minQty: 10, maxQty: 5 },
      { warehouse: 'STORE1', sku: '1002', unit: null, minQty: null },
      { warehouse: 'STORE1', sku: '1001', unit: 'хайрцаг', minQty: '0.3' },
      { warehouse: 'STORE1', sku: '1001', minQty: 2 },
    ]);
    expect(bad.status).toBe('INVALID');
    expect(codes(await imports.rows(bad.id, 'ERRORS'))).toEqual([
      'warehouse:NOT_ALLOWED',
      'sku:NOT_FOUND',
      'maxQty:MIN_ABOVE_MAX',
      'minQty:REQUIRED',
      'minQty:INEXACT',
      'sku:DUPLICATE_IN_FILE',
    ]);

    // Boxes of 24 become pieces; a level of 0 is allowed.
    const ok = await imports.check('LEVELS', [
      { warehouse: 'WH1', sku: '1001', unit: 'хайрцаг', minQty: 1, maxQty: 4 },
      { warehouse: 'STORE1', sku: '1002', minQty: 0 },
    ]);
    expect(ok.status).toBe('VALIDATED');
    expect((await imports.rows(ok.id)).map((row) => [row.action, row.changed])).toEqual([
      ['CREATE', ['minQty', 'maxQty']],
      ['CREATE', ['minQty']],
    ]);
    expect((await imports.commit(ok.id)).status).toBe('COMMITTED');
    committed.push(ok.id);
    expect(await levels()).toEqual([
      { wh: 'STORE1', sku: '1002', min: '0.000', max: null },
      { wh: 'WH1', sku: '1001', min: '24.000', max: '96.000' },
    ]);

    // An empty cell keeps the stored level; the same level again changes nothing.
    const update = await imports.check('LEVELS', [
      { warehouse: 'WH1', sku: '1001', maxQty: 120 },
      { warehouse: 'Супермаркет STORE1', sku: '1002', minQty: 0 },
    ]);
    expect(codes(await imports.rows(update.id, 'ERRORS'))).toEqual(['warehouse:NOT_FOUND']);
    const fixed = await imports.check('LEVELS', [
      { warehouse: 'WH1', sku: '1001', maxQty: 120 },
      { warehouse: 'STORE1', sku: '1002', minQty: 0 },
    ]);
    expect((await imports.rows(fixed.id)).map((row) => [row.action, row.changed])).toEqual([
      ['UPDATE', ['maxQty']],
      ['UNCHANGED', []],
    ]);
    expect((await imports.commit(fixed.id)).status).toBe('COMMITTED');
    committed.push(fixed.id);
    expect(await levels()).toEqual([
      { wh: 'STORE1', sku: '1002', min: '0.000', max: null },
      { wh: 'WH1', sku: '1001', min: '24.000', max: '120.000' },
    ]);
  });

  it('shows the new preview instead when the data changed after the check', async () => {
    const job = await imports.check('PRODUCTS', [
      { sku: '2001', name: 'Шүүс', category: 'Ус', barcodes: '4870001000011' },
    ]);
    expect(job.status).toBe('VALIDATED');
    const { rows: water } = await sql.query<{ id: string }>(
      `SELECT id::text FROM categories WHERE name = 'Ус'`,
    );
    const catalog = catalogApi(app, admin);
    await catalog.product({
      sku: '2002',
      name: 'Өөр шүүс',
      categoryId: Number.parseInt(water[0]?.id ?? '0', 10),
      baseUomId: await catalog.uomId('PCS'),
      baseBarcodes: ['4870001000011'],
    });
    const result = await imports.commit(job.id);
    expect(result).toMatchObject({ status: 'INVALID', summary: { refreshed: true } });
    expect(codes(await imports.rows(result.id, 'ERRORS'))).toEqual(['barcodes:TAKEN']);
    expect(await productRow('2001')).toBeUndefined();
  });

  it('commits or reverts one import at a time', async () => {
    const first = await imports.check('SUPPLIERS', [{ name: 'Нэгдүгээр' }]);
    const second = await imports.check('SUPPLIERS', [{ name: 'Хоёрдугаар' }]);
    await http()
      .post(`/api/v1/imports/${first.id}/commit`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    const busy = await http()
      .post(`/api/v1/imports/${second.id}/commit`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(409);
    expect(busy.body).toMatchObject({ code: 'IMPORT_BUSY' });
    await app.get(ImportPipelineService).commit(first.id);
    committed.push(first.id);
    expect((await imports.commit(second.id)).status).toBe('COMMITTED');
    committed.push(second.id);
  });

  it('reverts the most recent import first, each completely', async () => {
    const older = committed[0] ?? 0;
    const blocked = await http()
      .post(`/api/v1/imports/${older}/revert`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(409);
    expect(blocked.body).toMatchObject({ code: 'IMPORT_REVERT_BLOCKED' });
    const reverted: ImportJobJson[] = [];
    for (const id of [...committed].reverse()) reverted.push(await imports.revert(id));
    expect(reverted.map((job) => job.status)).toEqual(committed.map(() => 'REVERTED'));
    const { rows: stock } = await sql.query(
      `SELECT count(*)::int AS n FROM bin_stock WHERE on_hand <> 0`,
    );
    expect(stock[0]).toEqual({ n: 0 });
    const { rows: reversals } = await sql.query(
      `SELECT count(*)::int AS n FROM adjustments WHERE reason = 'OPENING_REVERSAL' AND status = 'POSTED'`,
    );
    expect(reversals[0]).toEqual({ n: 2 });
    expect(await productRow('1001')).toMatchObject({
      status: 'INACTIVE',
      name: 'Кока кола 0.5л',
      sale_ready: false,
    });
    const { rows: barcodes } = await sql.query(`SELECT count(*)::int AS n FROM product_barcodes`);
    expect(barcodes[0]).toEqual({ n: 1 });
    const { rows: partners } = await sql.query(
      `SELECT (SELECT count(*) FROM customers WHERE status = 'ACTIVE')::int AS customers,
              (SELECT string_agg(name || ':' || coalesce(bank_account, '-'), ',' ORDER BY id) FROM suppliers WHERE status = 'ACTIVE') AS suppliers`,
    );
    expect(partners[0]).toEqual({ customers: 0, suppliers: 'МСМ ХХК:-' });
    // The levels went back in two steps; the supermarket row the import made is gone.
    const { rows: levels } = await sql.query(
      `SELECT count(*)::int AS n FROM product_locations
        WHERE min_qty IS NOT NULL OR max_qty IS NOT NULL OR warehouse_id IN
              (SELECT id FROM warehouses WHERE code = 'STORE1')`,
    );
    expect(levels[0]).toEqual({ n: 0 });
  });

  it('runs the check in the worker through pg-boss', async () => {
    // The other tests ran their jobs in-process: what their requests queued would keep the worker
    // busy for a polling interval each before it reached this one.
    const boss = app.get<PgBoss>(PG_BOSS);
    for (const queue of ['imports.validate', 'imports.commit', 'imports.revert']) {
      await boss.deleteQueuedJobs(queue);
    }
    const context: INestApplicationContext = await createWorker();
    try {
      const fileId = await imports.upload(
        await sheetOf('SUPPLIERS', [{ name: 'Ажлын нийлүүлэгч' }]),
      );
      const created = (
        await http()
          .post('/api/v1/imports')
          .set(bearer(admin))
          .set(idempotency())
          .send({ kind: 'SUPPLIERS', fileId, fileName: 'workers.xlsx' })
          .expect(201)
      ).body as ImportJobJson;
      const checked = await waitFor(async () => {
        const job = await imports.get(created.id);
        return job.status === 'VALIDATED' ? job : undefined;
      });
      expect(checked).toMatchObject({ totalRows: 1, summary: { actions: { CREATE: 1 } } });
    } finally {
      await context.close();
    }
  });
});
