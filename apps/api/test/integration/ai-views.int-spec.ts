import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { addDays, businessDate } from '@tugeel/shared/time';
import { AI_DATASETS, type AiColumnType } from '../../src/modules/ai/semantic/datasets';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import {
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

const PG_TYPES: Record<AiColumnType, string> = {
  bigint: 'bigint',
  integer: 'integer',
  numeric: 'numeric',
  text: 'text',
  boolean: 'boolean',
  date: 'date',
  timestamptz: 'timestamp with time zone',
};

/** Tables the assistant must never read, in any view (ADR-0045 #2). */
const FORBIDDEN_TABLES = [
  'auth_sessions',
  'password_resets',
  'customer_users',
  'customer_password_codes',
  'idempotency_keys',
  'files',
  'audit_log',
  'import_rows',
];

interface PriceViewJson {
  current: { warehousePrice: string } | null;
  table: { productUnitId: number; wholesale: string; retail: string; retailBulk: string | null }[];
}
interface BalanceJson {
  warehouseId: number;
  onHand: string;
  sellableOnHand: string;
  reserved: string;
  available: string;
  avgCost: string;
  value: string;
}
interface LowJson {
  product: { id: number };
  status: string;
  onHand: string;
  minQty: string | null;
  maxQty: string | null;
  suggestedQty: string | null;
  homeWarehouseId: number | null;
}

/**
 * The views of schema ai (migrations 0017_ai, 0019_price_profiles): exactly the AI_DATASETS catalog, readable only by
 * ai_reader, free of credentials, and in agreement with the services whose rules they repeat.
 */
describe('AI views (ADR-0045)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let migrator: Client;
  let reader: Client;
  let wholesale: WarehouseJson;
  let second: WarehouseJson;
  let cola: ProductJson;
  let juice: ProductJson;
  let programs: { active: number; scheduled: number; ended: number };
  /** Products priced under each rounding with half-tugrik markups (ADR-0048 #3). */
  const priced: ProductJson[] = [];
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  /** Rows of a view as ai_reader sees them, text values as node-postgres returns them. */
  async function rowsOf(view: string, where = 'true', params: unknown[] = []) {
    return (
      await reader.query<Record<string, unknown>>(`SELECT * FROM ${view} WHERE ${where}`, params)
    ).rows;
  }

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    reader = await connectAs('ai_reader');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    const worker = await token('WAREHOUSE');
    const accountant = await token('ACCOUNTANT');

    const inventory = inventoryApi(app, admin);
    wholesale = await inventory.warehouse('WH1');
    second = await inventory.warehouse('WH2');
    const shelf = (await inventory.bin(wholesale.id, 'A-01-01')).id;
    const other = (await inventory.bin(second.id, 'B-01-01')).id;
    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа');
    const juices = await catalog.category('Шүүс', drinks);
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: drinks,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24' }],
    });
    juice = await catalog.product({ sku: '11', name: 'Шүүс', categoryId: juices, baseUomId: pcs });
    await catalog.product({ sku: '12', name: 'Ус', categoryId: drinks, baseUomId: pcs });

    const partners = partnersApi(app, admin);
    const supplier = await partners.supplier({ name: 'МСМ ХХК', phone: '99112233' });
    await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId: cola.id, supplierId: supplier.id })
      .expect(201);
    await partners.customer({
      name: 'Номин дэлгүүр',
      phone: '88001122',
      address: { address: 'Мөрөн, 3-р баг', lat: '49.6342', lng: '100.1625' },
    });

    // Each line goes to its product's home and fixed shelf there (ADR-0099 #1).
    const receive = async (line: Record<string, unknown>, amount: string) => {
      const created = await http()
        .post('/api/v1/receipts')
        .set(bearer(worker))
        .set(idempotency())
        .send({ supplierId: supplier.id, lines: [line] });
      if (created.status !== 201) {
        throw new Error(`receipt ${created.status}: ${JSON.stringify(created.body)}`);
      }
      const body = created.body as { id: number; lines: { id: number }[] };
      await postReceipt(app, worker, body.id, { amount });
      await http()
        .put(`/api/v1/receipts/${body.id}/costs`)
        .set(bearer(accountant))
        .set(idempotency())
        .send({ costingVersion: 0, lines: [{ lineId: body.lines[0]?.id, amount }] })
        .expect(200);
    };
    await inventory.homeShelf(cola.id, wholesale.id, shelf);
    await inventory.homeShelf(juice.id, second.id, other);
    await receive({ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' }, '48000');
    await receive({ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '10' }, '5000');
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(worker))
      .send({ warehouseId: wholesale.id, productId: cola.id, minQty: '50', maxQty: '100' })
      .expect(200);

    const pricing = pricingApi(app, admin);
    await pricing.terms(cola.id, '1000', await pricing.profile('Ундаа'), box);
    // 5 %, 12.5 % and 7.5 % of 1,010 and 1,234 end in half tugriks: every rounding is exercised.
    let sku = 20;
    for (const rounding of ['WHOLE', 'UP_10', 'UP_50', 'UP_100']) {
      const profile = await pricing.profile(`Тоймлолт ${rounding}`, {
        looseMarkupPct: '5',
        retailMarkupPct: '12.5',
        retailBulkMarkupPct: '7.5',
        rounding,
      });
      for (const price of ['1010', '1234']) {
        sku += 1;
        const item = await catalog.product({
          sku: String(sku),
          name: `Тоймлолт ${sku}`,
          categoryId: drinks,
          baseUomId: pcs,
          units: [{ uomId: box, factorToBase: '24' }],
        });
        await pricing.terms(item.id, price, profile, box);
        priced.push(item);
      }
    }

    const program = async (name: string, validFrom: string) =>
      (
        (
          await http()
            .post('/api/v1/discount-programs')
            .set(bearer(admin))
            .set(idempotency())
            .send({
              name,
              list: 'WHOLESALE',
              scope: 'PRODUCT',
              measure: 'QTY',
              effect: 'PERCENT',
              productId: cola.id,
              validFrom,
              steps: [
                { threshold: '24', value: '2' },
                { threshold: '240', value: '5' },
              ],
            })
            .expect(201)
        ).body as { id: number }
      ).id;
    programs = {
      active: await program('Кока 2%', today),
      scheduled: await program('Кока маргааш', addDays(today, 1)),
      ended: await program('Кока зогссон', today),
    };
    await http()
      .post(`/api/v1/discount-programs/${programs.ended}/stop`)
      .set(bearer(admin))
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await reader.end();
    await migrator.end();
    await app.close();
  });

  it('schema ai holds exactly the AI_DATASETS views, column by column', async () => {
    const { rows } = await migrator.query<{ view: string; column: string; type: string }>(
      `SELECT c.table_name AS view, c.column_name AS column, c.data_type AS type
         FROM information_schema.columns c
        WHERE c.table_schema = 'ai'
        ORDER BY c.table_name, c.ordinal_position`,
    );
    const actual = new Map<string, string[]>();
    for (const row of rows) {
      actual.set(row.view, [...(actual.get(row.view) ?? []), `${row.column} ${row.type}`]);
    }
    const expected = new Map(
      AI_DATASETS.map((set) => [
        set.name,
        set.columns.map((column) => `${column.name} ${PG_TYPES[column.type]}`),
      ]),
    );
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
    const kinds = await migrator.query<{ kind: string }>(
      `SELECT DISTINCT c.relkind AS kind FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ai'`,
    );
    expect(kinds.rows).toEqual([{ kind: 'v' }]);
  });

  it('lets only ai_reader read them, read-only and in Ulaanbaatar time', async () => {
    for (const set of AI_DATASETS) {
      await reader.query(`SELECT * FROM ${set.name} LIMIT 1`);
    }
    const app = await connectAs('app');
    try {
      expect(await sqlStateOf(app.query('SELECT * FROM ai.products'))).toBe('42501');
    } finally {
      await app.end();
    }
    const settings = await reader.query<{ readOnly: string; zone: string; path: string }>(
      `SELECT current_setting('default_transaction_read_only') AS "readOnly",
              current_setting('TimeZone') AS zone, current_setting('search_path') AS path`,
    );
    expect(settings.rows[0]).toEqual({ readOnly: 'on', zone: 'Asia/Ulaanbaatar', path: 'ai' });
    expect(await sqlStateOf(reader.query('SELECT * FROM public.products'))).toBe('42501');
  });

  it('never reads credentials, sessions, files, audit data or import rows', async () => {
    const tables = await migrator.query<{ table: string }>(
      `SELECT DISTINCT table_name AS table FROM information_schema.view_table_usage
        WHERE view_schema = 'ai' AND table_schema = 'public' ORDER BY 1`,
    );
    const used = tables.rows.map((row) => row.table);
    expect(used.filter((table) => FORBIDDEN_TABLES.includes(table))).toEqual([]);
    expect(used).toEqual(expect.arrayContaining(['products', 'stock_ledger', 'product_prices']));
    const userColumns = await migrator.query<{ column: string }>(
      `SELECT DISTINCT column_name AS column FROM information_schema.view_column_usage
        WHERE view_schema = 'ai' AND table_schema = 'public' AND table_name = 'users' ORDER BY 1`,
    );
    expect(userColumns.rows.map((row) => row.column)).toEqual(['full_name', 'id']);
    const secretLike = AI_DATASETS.flatMap((set) => set.columns).filter((column) =>
      /password|hash|token|secret/i.test(column.name),
    );
    expect(secretLike).toEqual([]);
  });

  it('gives categories their path and top category', async () => {
    const rows = await rowsOf('categories', 'level = 2');
    expect(rows).toEqual([
      expect.objectContaining({ name: 'Шүүс', path: 'Ундаа / Шүүс', top_category_name: 'Ундаа' }),
    ]);
    expect(await rowsOf('products', 'id = $1', [juice.id])).toEqual([
      expect.objectContaining({ sku: '11', category_path: 'Ундаа / Шүүс', base_unit: 'ш' }),
    ]);
  });

  it("shows today's prices as the price service computes them, under every rounding", async () => {
    // NUMERIC columns arrive as strings: «1150.00» reads as the api's «1150».
    const amount = (value: unknown) =>
      typeof value === 'string' ? value.replace(/\.00$/, '') : value;
    for (const item of [cola, ...priced]) {
      const view = (
        await http().get('/api/v1/product-prices').query({ productId: item.id }).set(bearer(admin))
      ).body as PriceViewJson;
      const piece = view.table.find((row) => row.productUnitId === unitOf(item, 'PCS').id);
      const whole = view.table.find((row) => row.productUnitId === unitOf(item, 'BOX').id);
      const [row] = await rowsOf('product_prices_today', 'product_id = $1', [item.id]);
      expect({
        warehouse: amount(row?.warehouse_price),
        whole: amount(row?.whole_unit_price),
        loose: amount(row?.loose_price),
        retail: amount(row?.retail_price),
        bulk: amount(row?.retail_bulk_price),
      }).toEqual({
        warehouse: view.current?.warehousePrice,
        whole: whole?.wholesale,
        loose: piece?.wholesale,
        retail: piece?.retail,
        bulk: piece?.retailBulk,
      });
    }
    // 1,010 + 5 % = 1,060.5: half up to 1,061, or up to 1,070 / 1,100 / 1,100.
    const loose = await reader.query<{ rounding: string; loose: string }>(
      `SELECT rounding, loose_price::text AS loose FROM product_prices_today
        WHERE warehouse_price = 1010 ORDER BY loose_price, rounding`,
    );
    expect(loose.rows.map((row) => `${row.rounding} ${row.loose}`)).toEqual([
      'WHOLE 1061.00',
      'UP_10 1070.00',
      'UP_100 1100.00',
      'UP_50 1100.00',
    ]);
    const profiles = await rowsOf('price_profiles', "name = 'Ундаа'");
    expect(profiles).toEqual([
      expect.objectContaining({ status: 'ACTIVE', archived: false, products_today: 1 }),
    ]);
    expect(await rowsOf('product_price_history', 'product_id = $1', [cola.id])).toEqual([
      expect.objectContaining({ profile_name: 'Ундаа', whole_unit_name: 'хайрцаг' }),
    ]);
  });

  it('values stock as the stock service does', async () => {
    const detail = (
      await http().get(`/api/v1/stock/products/${cola.id}`).set(bearer(admin)).expect(200)
    ).body as { warehouses: BalanceJson[] };
    const rows = await rowsOf('stock', 'product_id = $1', [cola.id]);
    expect(
      rows.map((row) => ({
        warehouseId: Number(row.warehouse_id),
        onHand: String(row.on_hand).replace(/\.?0+$/, ''),
        available: String(row.available).replace(/\.?0+$/, ''),
        avgCost: row.avg_cost,
        value: row.stock_value,
      })),
    ).toEqual(
      detail.warehouses.map((balance) => ({
        warehouseId: balance.warehouseId,
        onHand: balance.onHand,
        available: balance.available,
        avgCost: expect.stringMatching(new RegExp(`^${balance.avgCost}(\\.0+)?$`)),
        value: expect.stringMatching(new RegExp(`^${balance.value}(\\.0+)?$`)),
      })),
    );
    expect(rows[0]).toMatchObject({
      warehouse_kind: 'WHOLESALE',
      avg_cost: '1000.0000',
      stock_value: '48000.00',
      min_qty: '50.000',
      is_home_warehouse: true,
      fixed_bin_code: 'A-01-01',
    });
  });

  it('lists low stock as the low-stock list does', async () => {
    const list = (
      await http()
        .get('/api/v1/stock/low')
        .query({ warehouseId: wholesale.id })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: LowJson[] };
    /** NUMERIC(14,3) text without its trailing zeros, as the service prints quantities. */
    const strip = (value: unknown) =>
      typeof value === 'string' ? value.replace(/\.?0+$/, '') : null;
    const rows = await rowsOf('low_stock', 'warehouse_id = $1', [wholesale.id]);
    expect(
      rows.map((row) => ({
        productId: Number(row.product_id),
        status: row.status,
        onHand: strip(row.on_hand),
        minQty: strip(row.min_qty),
        maxQty: strip(row.max_qty),
        suggestedQty: strip(row.suggested_qty),
        homeWarehouseId: row.home_warehouse_id === null ? null : Number(row.home_warehouse_id),
      })),
    ).toEqual(
      list.data.map((row) => ({
        productId: row.product.id,
        status: row.status,
        onHand: row.onHand,
        minQty: row.minQty,
        maxQty: row.maxQty,
        suggestedQty: row.suggestedQty,
        homeWarehouseId: row.homeWarehouseId,
      })),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        product_id: String(cola.id),
        status: 'LOW',
        suggested_qty: '52.000',
      }),
    ]);
  });

  it('carries documents, suppliers and costs on movements and receipt lines', async () => {
    expect(await rowsOf('stock_movements', 'product_id = $1', [cola.id])).toEqual([
      expect.objectContaining({
        movement_type: 'RECEIPT',
        doc_type: 'GR',
        doc_number: expect.stringMatching(/^GR-\d{4}-\d{6}$/),
        supplier_name: 'МСМ ХХК',
        qty_base: '48.000',
        entered_qty: '2.000',
        entered_unit: 'хайрцаг',
        warehouse_name: wholesale.name,
        bin_code: 'A-01-01',
      }),
    ]);
    // movement_date is the Ulaanbaatar business date, as current_date is for ai_reader.
    expect(await rowsOf('stock_movements', 'movement_date = current_date')).toHaveLength(2);
    expect(await rowsOf('receipt_lines', 'product_id = $1', [juice.id])).toEqual([
      expect.objectContaining({
        receipt_status: 'POSTED',
        costing_status: 'COSTED',
        warehouse_name: second.name,
        qty_base: '10.000',
        amount: '5000.00',
        unit_cost: '500.0000',
        free_goods: false,
        warehouse_id: String(second.id),
        doc_amount: '5000.00',
        discount_amount: '0.00',
      }),
    ]);
    const documents = await rowsOf('stock_documents', "doc_type = 'GR'");
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({ status: 'POSTED', costing_status: 'COSTED' });
    // A receipt's row names its warehouse while all its lines lie in one (ADR-0099 #1).
    expect(
      documents
        .map((row) => [row.warehouse_id, row.warehouse_name])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([
      [String(wholesale.id), wholesale.name],
      [String(second.id), second.name],
    ]);
  });

  it('names every warehouse of a receipt whose lines lie in several', async () => {
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'Хоёр агуулах ХХК' })).id;
    const created = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId,
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' },
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1' },
        ],
      })
      .expect(201);
    const id = (created.body as { id: number }).id;
    expect(await rowsOf('stock_documents', "doc_type = 'GR' AND id = $1", [id])).toEqual([
      expect.objectContaining({
        status: 'DRAFT',
        warehouse_id: null,
        warehouse_name: [wholesale.name, second.name].sort().join(', '),
      }),
    ]);
    expect(
      (await rowsOf('receipt_lines', 'receipt_id = $1', [id]))
        .map((row) => row.warehouse_id)
        .sort(),
    ).toEqual([String(wholesale.id), String(second.id)].sort());
    await http().post(`/api/v1/receipts/${id}/cancel`).set(bearer(admin)).expect(200);
  });

  it('gives discount programs the status the pricing service gives them', async () => {
    for (const [expected, id] of [
      ['ACTIVE', programs.active],
      ['SCHEDULED', programs.scheduled],
      ['ENDED', programs.ended],
    ] as const) {
      const program = (
        await http().get(`/api/v1/discount-programs/${id}`).set(bearer(admin)).expect(200)
      ).body as { status: string };
      expect(program.status).toBe(expected);
      expect(await rowsOf('discount_programs', 'id = $1', [id])).toEqual([
        expect.objectContaining({
          status: expected,
          scope: 'PRODUCT',
          product_name: 'Кока кола',
          steps: '24.000 => 2.00; 240.000 => 5.00',
        }),
      ]);
    }
  });

  it('shows partners with their contacts, addresses and supplied products', async () => {
    expect(await rowsOf('customers')).toEqual([
      expect.objectContaining({
        name: 'Номин дэлгүүр',
        phone: '+97688001122',
        default_address: 'Мөрөн, 3-р баг',
      }),
    ]);
    expect(await rowsOf('customer_addresses')).toEqual([
      expect.objectContaining({ lat: '49.634200', is_default: true, archived: false }),
    ]);
    // The juice received from the supplier is linked to it by the posting (ADR-0103).
    expect(await rowsOf('product_suppliers')).toEqual([
      expect.objectContaining({ sku: '10', supplier_name: 'МСМ ХХК', is_main: true }),
      expect.objectContaining({ sku: '11', supplier_name: 'МСМ ХХК', is_main: true }),
    ]);
  });
});
