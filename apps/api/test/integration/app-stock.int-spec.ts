import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import { firstValueFrom, type Observable, filter, take, timeout, toArray } from 'rxjs';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { notifyStockChanged } from '../../src/modules/inventory';
import { LiveStockHub, type LiveStockMessage } from '../../src/modules/sales';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { type AppStore, appStore, storeOrderBody } from '../harness/customer-app';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi, type WarehouseJson } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { repApi, repOrderBody } from '../harness/sales-rep';

interface RepProductJson {
  id: number;
  available: string;
  stockBlocked: boolean;
}

interface ShopProductJson {
  id: number;
  stock: string;
  available?: string;
}

/** One server-sent event as read off the wire. */
interface WireEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Live app stock (ADR-0173): which warehouses each app counts (only the product's home
 * warehouse's stock, nothing when that one is not ticked), «Bto300»'s words or number, and the
 * stream that tells the phones at commit. Synthetic data.
 */
describe('live app stock (ADR-0173)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let rep: string;
  let store: AppStore;
  let shop: CustomerJson;
  let counted: WarehouseJson;
  let other: WarehouseJson;
  let ticked: ProductJson;
  let unticked: ProductJson;
  let shelfOf: Map<number, number>;
  let baseUrl: string;
  const http = () => request(app.getHttpServer());
  const hub = () => app.get(LiveStockHub);

  /** A surplus adjustment of `qty` pieces in the product's home warehouse, posted. */
  const stock = async (product: ProductJson, warehouseId: number, qty: string) => {
    const auth = bearer(admin);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(auth)
      .set(idempotency())
      .send({
        warehouseId,
        reason: 'SURPLUS',
        lines: [
          {
            productUnitId: unitOf(product, 'PCS').id,
            enteredQty: qty,
            binId: shelfOf.get(warehouseId),
            unitCost: '700',
          },
        ],
      })
      .expect(201);
    const id = (created.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${id}/submit`).set(auth).expect(200);
    await http()
      .post(`/api/v1/adjustments/${id}/post`)
      .set(auth)
      .set(idempotency())
      .send({})
      .expect(200);
  };

  const settings = async () =>
    (await http().get('/api/v1/app-settings').set(bearer(admin)).expect(200)).body as {
      stockWarehouses: { customer: number[]; staff: number[] };
      customerStockDisplay: string;
      [key: string]: unknown;
    };
  const save = (body: Record<string, unknown>) =>
    http()
      .put('/api/v1/app-settings')
      .set(bearer(admin))
      .send({
        assortmentSegmentId: null,
        homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
        minOrderAmount: null,
        appName: null,
        appColor: null,
        ...body,
      });
  const repProducts = async (query: Record<string, unknown> = {}) =>
    (
      (
        await http()
          .get('/api/v1/sales-rep/products')
          .query({ limit: 50, ...query })
          .set(bearer(rep))
          .expect(200)
      ).body as { data: RepProductJson[] }
    ).data;
  const shopProducts = async (query = '') =>
    (
      (await store.api.get(`/products?limit=50${query}`).expect(200)).body as {
        data: ShopProductJson[];
      }
    ).data;
  const byId = <T extends { id: number }>(rows: T[], product: ProductJson) =>
    rows.find((row) => row.id === product.id);

  /** Collects a hub stream's messages while `act` runs, until `until` matches or 5 s pass. */
  const heard = async (
    stream: Observable<LiveStockMessage>,
    act: () => Promise<void>,
    until: (message: LiveStockMessage) => boolean,
  ): Promise<LiveStockMessage[]> => {
    const ready = firstValueFrom(stream.pipe(filter((m) => m.type === 'ready')));
    const messages: LiveStockMessage[] = [];
    const subscription = stream.subscribe((message) => messages.push(message));
    try {
      await ready;
      await act();
      const deadline = Date.now() + 5_000;
      while (!messages.some(until) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // A late second message of the same burst would show here.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return messages.filter((message) => message.type !== 'ping');
    } finally {
      subscription.unsubscribe();
    }
  };
  const stockOf = (messages: LiveStockMessage[]) =>
    messages.filter((message) => message.type === 'stock');
  const itemsOf = (message: LiveStockMessage | undefined) =>
    ((message?.data ?? {}) as { items?: Record<string, unknown>[] }).items ?? [];

  /** Opens an SSE route over a real socket and reads its events until `count` arrived. */
  const openStream = (path: string, token: string | null) => {
    const events: WireEvent[] = [];
    let status = 0;
    let response: IncomingMessage | null = null;
    const opened = new Promise<void>((resolve, reject) => {
      const req = get(
        `${baseUrl}${path}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        (res) => {
          response = res;
          status = res.statusCode ?? 0;
          res.setEncoding('utf8');
          let buffer = '';
          res.on('data', (chunk: string) => {
            buffer += chunk;
            let end = buffer.indexOf('\n\n');
            while (end >= 0) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const event = /^event: (.*)$/m.exec(block)?.[1];
              const data = /^data: (.*)$/m.exec(block)?.[1];
              if (event) {
                events.push({
                  event,
                  data: data ? (JSON.parse(data) as Record<string, unknown>) : {},
                });
              }
              end = buffer.indexOf('\n\n');
            }
          });
          resolve();
        },
      );
      req.on('error', reject);
    });
    return {
      opened,
      events,
      status: () => status,
      contentType: () => response?.headers['content-type'],
      async until(check: (event: WireEvent) => boolean): Promise<WireEvent> {
        const deadline = Date.now() + 5_000;
        for (;;) {
          const found = events.find(check);
          if (found) return found;
          if (Date.now() > deadline) throw new Error(`no such event in ${JSON.stringify(events)}`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      },
      close: () => response?.destroy(),
    };
  };

  beforeAll(async () => {
    app = await createHttpApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const catalog = catalogApi(app, admin);
    const pricing = pricingApi(app, admin);
    counted = await inventory.warehouse('LSW1');
    other = await inventory.warehouse('LSW2');
    shelfOf = new Map([
      [counted.id, (await inventory.bin(counted.id, 'A-01-01')).id],
      [other.id, (await inventory.bin(other.id, 'A-01-01')).id],
    ]);
    const category = await catalog.category('Шууд үлдэгдэл');
    const pcs = await catalog.uomId('PCS');
    const profile = await pricing.profile('Шууд үнэ');
    const make = async (sku: string, name: string, home: WarehouseJson) => {
      const product = await catalog.product({ sku, name, categoryId: category, baseUomId: pcs });
      await inventory.setHome(product.id, home.id);
      await pricing.terms(product.id, '1000', profile, null);
      await http()
        .post('/api/v1/pricing/sale-ready')
        .set(bearer(admin))
        .set(idempotency())
        .send({ productIds: [product.id] })
        .expect(200);
      await stock(product, home.id, '40');
      return product;
    };
    ticked = await make('8301', 'Тоологдох', counted);
    unticked = await make('8302', 'Тоологдохгүй', other);
    shop = await partnersApi(app, admin).customer({ name: 'Шууд дэлгүүр', phone: '99113355' });
    store = await appStore(app, office);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps each app’s warehouses and the display, audits them, refuses an unknown one', async () => {
    expect(await settings()).toMatchObject({
      stockWarehouses: { customer: [], staff: [] },
      customerStockDisplay: 'WORDS',
    });
    const refused = (
      await save({ stockWarehouses: { customer: [999_999], staff: [] } }).expect(422)
    ).body as { code: string; errors: { path: string }[] };
    expect(refused.code).toBe('VALIDATION_FAILED');
    expect(refused.errors[0]?.path).toBe('stockWarehouses.customer');
    await save({ customerStockDisplay: 'LETTERS' }).expect(422);

    const saved = (
      await save({
        stockWarehouses: { customer: [counted.id], staff: [counted.id] },
      }).expect(200)
    ).body as { stockWarehouses: unknown; customerStockDisplay: string };
    expect(saved.stockWarehouses).toEqual({ customer: [counted.id], staff: [counted.id] });
    // A save from a screen that does not know the fields keeps them.
    await save({ appName: 'Bto' }).expect(200);
    expect((await settings()).stockWarehouses).toEqual({
      customer: [counted.id],
      staff: [counted.id],
    });

    const db = await connectAs('admin');
    try {
      const { rows } = await db.query<{ before: unknown; after: unknown }>(
        `SELECT before, after FROM audit_log WHERE entity = 'app_settings' ORDER BY id`,
      );
      expect(rows[0]?.before).toMatchObject({ stockWarehouses: { CUSTOMER: [], STAFF: [] } });
      expect(rows[0]?.after).toMatchObject({
        stockWarehouses: { CUSTOMER: [counted.id], STAFF: [counted.id] },
        customerStockDisplay: 'WORDS',
      });
      // The list is replaced, never truncated (migration 0091).
      const appRole = await connectAs('app');
      try {
        expect(
          await appRole.query('TRUNCATE app_stock_warehouses').then(
            () => 'done',
            (error: { code?: string }) => error.code,
          ),
        ).toBe('42501');
      } finally {
        await appRole.end();
      }
    } finally {
      await db.end();
    }
  });

  it('shows a product whose home is not ticked as out of stock and refuses its app orders', async () => {
    await save({ stockWarehouses: { customer: [counted.id], staff: [counted.id] } }).expect(200);

    const staff = await repProducts();
    expect(byId(staff, ticked)).toMatchObject({ available: '40', stockBlocked: false });
    expect(byId(staff, unticked)).toMatchObject({ available: '0', stockBlocked: true });
    const inStock = await repProducts({ inStock: true });
    expect(byId(inStock, ticked)).toBeDefined();
    expect(byId(inStock, unticked)).toBeUndefined();

    const words = await shopProducts();
    expect(byId(words, ticked)?.stock).toBe('IN');
    expect(byId(words, unticked)?.stock).toBe('OUT');
    const customerInStock = await shopProducts('&inStock=true');
    expect(byId(customerInStock, ticked)).toBeDefined();
    expect(byId(customerInStock, unticked)).toBeUndefined();
    const quoted = (
      await store.api
        .post('/quote', { lines: [{ productUnitId: unitOf(unticked, 'PCS').id, qty: '1' }] })
        .expect(200)
    ).body as { stock: { stock: string; mayBackorder: boolean }[] };
    expect(quoted.stock[0]).toMatchObject({ stock: 'OUT', mayBackorder: true });

    const line = (product: ProductJson) => ({ productUnitId: unitOf(product, 'PCS').id, qty: '1' });
    const repRefused = await repApi(app, rep)
      .create(repOrderBody(999_999, shop.id, [line(ticked), line(unticked)]))
      .expect(409);
    expect(repRefused.body).toMatchObject({
      code: 'PRODUCT_OUT_OF_APP_STOCK',
      params: { productIds: String(unticked.id) },
    });
    // The ticked product passes that check (the made-up stage is refused next).
    const repPassed = await repApi(app, rep).create(repOrderBody(999_999, shop.id, [line(ticked)]));
    expect(repPassed.status).not.toBe(409);
    const storeRefused = await store.api
      .send(storeOrderBody(businessDate(), [line(unticked)]))
      .expect(409);
    expect(storeRefused.body).toMatchObject({ code: 'PRODUCT_OUT_OF_APP_STOCK' });

    // Nothing ticked: every warehouse counts again (today's behaviour).
    await save({ stockWarehouses: { customer: [], staff: [] } }).expect(200);
    expect(byId(await repProducts(), unticked)).toMatchObject({
      available: '40',
      stockBlocked: false,
    });
    expect(byId(await shopProducts(), unticked)?.stock).toBe('IN');
  });

  it('sends «Bto300» the number only when the office shows numbers', async () => {
    await save({ stockWarehouses: { customer: [counted.id], staff: [] } }).expect(200);
    const words = await shopProducts();
    expect(byId(words, ticked)).not.toHaveProperty('available');
    expect(JSON.stringify(words)).not.toContain('"available"');

    await save({ customerStockDisplay: 'NUMBER' }).expect(200);
    const numbers = await shopProducts();
    expect(byId(numbers, ticked)).toMatchObject({ stock: 'IN', available: '40' });
    expect(byId(numbers, unticked)).toMatchObject({ stock: 'OUT', available: '0' });
    await save({
      customerStockDisplay: 'WORDS',
      stockWarehouses: { customer: [], staff: [] },
    }).expect(200);
  });

  it('tells the streams once per burst at commit, and nothing on a rollback', async () => {
    const db = app.get<Db>(DB);
    const staff = hub().stream('STAFF', 60_000);
    const burst = await heard(
      staff,
      async () => {
        await inTransaction(db, async (tx) => {
          await notifyStockChanged(tx, [ticked.id]);
          await notifyStockChanged(tx, [unticked.id, ticked.id]);
        });
      },
      (message) => message.type === 'stock',
    );
    expect(stockOf(burst)).toHaveLength(1);
    expect(itemsOf(stockOf(burst)[0])).toEqual(
      [
        { productId: ticked.id, available: '40', stockBlocked: false },
        { productId: unticked.id, available: '40', stockBlocked: false },
      ].sort((a, b) => a.productId - b.productId),
    );

    const rolledBack = await heard(
      staff,
      async () => {
        await inTransaction(db, async (tx) => {
          await notifyStockChanged(tx, [ticked.id]);
          throw new Error('rolled back');
        }).catch(() => undefined);
      },
      () => false,
    );
    expect(stockOf(rolledBack)).toEqual([]);

    // A real posting: the new number reaches the stream.
    const posted = await heard(
      staff,
      () => stock(ticked, counted.id, '5'),
      (message) => message.type === 'stock',
    );
    expect(itemsOf(stockOf(posted)[0])).toEqual([
      { productId: ticked.id, available: '45', stockBlocked: false },
    ]);
  });

  it('tells every stream to refetch when the settings change', async () => {
    const customer = hub().stream('CUSTOMER', 60_000);
    const changed = await heard(
      customer,
      async () => {
        await save({ stockWarehouses: { customer: [counted.id], staff: [] } }).expect(200);
      },
      (message) => message.type === 'resync',
    );
    expect(changed.map((message) => message.type)).toContain('resync');
    // A save that changes nothing of the stock sends nothing.
    const unchanged = await heard(
      customer,
      async () => {
        await save({
          stockWarehouses: { customer: [counted.id], staff: [] },
          appName: 'Bto2',
        }).expect(200);
      },
      () => false,
    );
    expect(unchanged.map((message) => message.type)).not.toContain('resync');
    await save({ stockWarehouses: { customer: [], staff: [] } }).expect(200);
  });

  it('serves the streams only to their own token, and «Bto300» words without a number', async () => {
    const anonymous = openStream('/api/v1/sales-rep/stock/live', null);
    await anonymous.opened;
    expect(anonymous.status()).toBe(401);
    anonymous.close();
    const customerOnStaff = openStream('/api/v1/sales-rep/stock/live', store.token);
    await customerOnStaff.opened;
    expect(customerOnStaff.status()).toBe(403);
    customerOnStaff.close();
    const staffOnCustomer = openStream('/api/v1/customer-app/stock/live', rep);
    await staffOnCustomer.opened;
    expect(staffOnCustomer.status()).toBe(403);
    staffOnCustomer.close();
    await http().get('/api/v1/customer-app/stock/live').expect(401);

    const live = openStream('/api/v1/customer-app/stock/live', store.token);
    try {
      await live.opened;
      expect(live.status()).toBe(200);
      expect(live.contentType()).toContain('text/event-stream');
      await live.until((event) => event.event === 'ready');
      await stock(ticked, counted.id, '1');
      const words = await live.until((event) => event.event === 'stock');
      expect(words.data).toEqual({ items: [{ productId: ticked.id, stock: 'IN' }] });

      await save({ customerStockDisplay: 'NUMBER' }).expect(200);
      await live.until((event) => event.event === 'resync');
      await stock(ticked, counted.id, '1');
      const numbers = await live.until(
        (event) => event.event === 'stock' && JSON.stringify(event.data).includes('available'),
      );
      expect(numbers.data).toEqual({
        items: [{ productId: ticked.id, stock: 'IN', available: '47' }],
      });
    } finally {
      live.close();
      await save({ customerStockDisplay: 'WORDS' }).expect(200);
    }
  });

  it('ends a stream at the token’s expiry and counts its listeners', async () => {
    const short = hub().stream('STAFF', 1_000);
    const ended = await firstValueFrom(
      short.pipe(
        filter((message) => message.type !== 'ping'),
        take(5),
        toArray(),
        timeout(5_000),
      ),
    );
    expect(ended.map((message) => message.type)).toEqual(['ready']);
    expect(hub().openStreams()).toEqual({ CUSTOMER: 0, STAFF: 0 });
  });
});
