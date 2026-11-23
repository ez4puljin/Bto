import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { posActors, posStore, type TillJson } from '../harness/pos';
import { pricingApi } from '../harness/pricing';

/**
 * Price labels (ADR-0226): the till's own price on the label (a RETAIL plan naming the till
 * counts there and only there), only the till's products, only a staff member a till names, the
 * 100-label limit, and the print jobs of a Windows bridge (its key) and of a LAN printer (a local
 * TCP listener standing in for port 9100). Synthetic data only.
 */
describe('price labels and print jobs', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let cashier: string;
  let store: Awaited<ReturnType<typeof posStore>>;
  let other: TillJson;
  let cola: ProductJson;
  let water: ProductJson;
  let soap: ProductJson;
  const http = () => request(app.getHttpServer());

  const labelsOf = (token: string, tillId: number, q: string) =>
    http().get('/api/v1/price-labels/products').query({ tillId, q }).set(bearer(token));
  const quoteAt = async (product: ProductJson, qty: string, tillId: number) => {
    const res = await http()
      .post('/api/v1/pricing/quote')
      .set(bearer(admin))
      .send({
        list: 'RETAIL',
        tillId,
        lines: [{ productUnitId: unitOf(product, 'PCS').id, qty }],
      })
      .expect(200);
    const body = res.body as { lines: { total: string }[] };
    return body.lines[0]?.total ?? '';
  };
  const per = (total: string, qty: number) => String(Math.round(Number(total) / qty));

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const actors = await posActors(app);
    admin = actors.admin;
    office = actors.office;
    store = await posStore(app, admin, 'PL');
    cola = await store.product('9411', 'Кола шошго', '1000', '0');
    water = await store.product('9412', 'Ус шошго', '500', '0');
    // A product of another category, sold only at the second till.
    const catalog = catalogApi(app, admin);
    const household = await catalog.category('Ахуйн бараа PL');
    const profile = await pricingApi(app, admin).profile('Ахуй PL');
    soap = await catalog.product({
      sku: '9413',
      name: 'Саван шошго',
      categoryId: household,
      baseUomId: await catalog.uomId('PCS'),
    });
    await pricingApi(app, admin).terms(soap.id, '800', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [soap.id] })
      .expect(200);
    other = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: store.store.id,
          code: 'К2',
          name: 'Касс 2',
          printerHost: null,
        })
        .expect(201)
    ).body as TillJson;
    await http()
      .put(`/api/v1/pos/tills/${other.id}/access`)
      .set(bearer(admin))
      .send({ cashierUserIds: [], supervisorUserIds: [], categoryIds: [household] })
      .expect(200);
    // A plan of the first till only: 10 % off cola there.
    await http()
      .post('/api/v1/discount-programs')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        name: 'К1 кола',
        list: 'RETAIL',
        scope: 'PRODUCT',
        measure: 'QTY',
        effect: 'PERCENT',
        targetKind: 'PRODUCT',
        targetIds: [cola.id],
        tillIds: [store.till.id],
        validFrom: businessDate(),
        steps: [{ threshold: '0', value: '10' }],
      })
      .expect(201);
    // A seller who works both tills.
    const seller = await seedUser(app, { roles: ['POS_CASHIER'] });
    await store.pos.setPin(seller.id, '112233').expect(200);
    await store.pos.setCashierTills(seller.id, [store.till.id, other.id]).expect(200);
    cashier = (await login(app, seller)).accessToken;
  });

  afterAll(async () => {
    await sql?.end();
    await app?.close();
  });

  it('offers the cashier’s tills and refuses staff without one', async () => {
    const tills = (await http().get('/api/v1/price-labels/tills').set(bearer(cashier)).expect(200))
      .body as { id: number; name: string; storeName: string }[];
    expect(tills.map((till) => till.id).sort((a, b) => a - b)).toEqual(
      [store.till.id, other.id].sort((a, b) => a - b),
    );
    expect(tills[0]?.storeName).toEqual(expect.any(String));
    const refused = await http().get('/api/v1/price-labels/tills').set(bearer(office)).expect(403);
    expect(refused.body).toMatchObject({ code: 'PRINT_NO_TILL' });
    await labelsOf(office, store.till.id, 'кола').expect(403);
    await http().get('/api/v1/print-stations').set(bearer(office)).expect(403);
  });

  it('puts on the label what the till charges, its plan included, and the bulk price', async () => {
    const found = (await labelsOf(cashier, store.till.id, 'КОЛА').expect(200)).body as {
      productId: number;
      code: string;
      unit: string;
      price: number;
      bulkQty: number | null;
      bulkPrice: number | null;
    }[];
    const label = found.find((item) => item.productId === cola.id);
    expect(label).toMatchObject({ code: '9411', bulkQty: 24 });
    const tillPrice = await quoteAt(cola, '1', store.till.id);
    expect(String(label?.price)).toBe(per(tillPrice, 1));
    // 1,300 at the supermarket, 10 % off at this till.
    expect(label?.price).toBe(1170);
    expect(String(label?.bulkPrice)).toBe(per(await quoteAt(cola, '24', store.till.id), 24));
    expect(label?.bulkPrice).toBeLessThan(1170);
    // The plan does not reach the other till, which does not sell cola anyway.
    expect(await quoteAt(cola, '1', other.id)).toBe('1300');

    const byCode = (
      await http()
        .get('/api/v1/price-labels/barcode/9412')
        .query({ tillId: store.till.id })
        .set(bearer(cashier))
        .expect(200)
    ).body as { productId: number; price: number };
    expect(byCode).toMatchObject({ productId: water.id, price: 650 });
  });

  it('refuses a product the till does not sell', async () => {
    const missing = await http()
      .get('/api/v1/price-labels/barcode/9411')
      .query({ tillId: other.id })
      .set(bearer(cashier))
      .expect(404);
    expect(missing.body).toMatchObject({ code: 'PRINT_PRODUCT_NOT_FOUND' });
    expect(((await labelsOf(cashier, other.id, 'кола').expect(200)).body as unknown[]).length).toBe(
      0,
    );
    const soapThere = (await labelsOf(cashier, other.id, 'саван').expect(200)).body as {
      productId: number;
    }[];
    expect(soapThere.map((item) => item.productId)).toEqual([soap.id]);
    const escpos = await http()
      .post('/api/v1/price-labels/escpos')
      .set(bearer(cashier))
      .send({ tillId: other.id, items: [{ productId: cola.id, copies: 1 }] })
      .expect(404);
    expect(escpos.body).toMatchObject({ code: 'PRINT_PRODUCT_NOT_FOUND' });
  });

  it('makes ESC/POS for the phone and keeps to 100 labels a print', async () => {
    const made = (
      await http()
        .post('/api/v1/price-labels/escpos')
        .set(bearer(cashier))
        .send({
          tillId: store.till.id,
          items: [
            { productId: cola.id, copies: 2 },
            { productId: water.id, copies: 1 },
          ],
        })
        .expect(200)
    ).body as { data: string; labels: number };
    expect(made.labels).toBe(3);
    const bytes = Buffer.from(made.data, 'base64');
    expect([...bytes.subarray(0, 6)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00]);
    const cuts = bytes.toString('latin1').split('\x1dVB\x00').length - 1;
    expect(cuts).toBe(3);

    const tooMany = await http()
      .post('/api/v1/price-labels/escpos')
      .set(bearer(cashier))
      .send({
        tillId: store.till.id,
        items: [
          ...Array.from({ length: 5 }, () => ({ productId: cola.id, copies: 20 })),
          { productId: water.id, copies: 1 },
        ],
      })
      .expect(422);
    expect(tooMany.body).toMatchObject({ code: 'PRINT_TOO_MANY_LABELS', params: { count: 101 } });
    await http()
      .post('/api/v1/price-labels/escpos')
      .set(bearer(cashier))
      .send({ tillId: store.till.id, items: [{ productId: cola.id, copies: 21 }] })
      .expect(422);
  });

  it('runs a job through a Windows bridge with its key, and refuses a wrong key', async () => {
    const created = (
      await http()
        .post('/api/v1/printing/stations')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Заал XP-80C', kind: 'bridge' })
        .expect(201)
    ).body as { station: { id: number; online: boolean }; key: string };
    expect(created.key).toMatch(/^bps_\d+_/);
    expect(created.station.online).toBe(false);
    await http().get('/api/v1/printing/stations').set(bearer(cashier)).expect(403);

    const choices = (await http().get('/api/v1/print-stations').set(bearer(cashier)).expect(200))
      .body as { id: number; kind: string; online: boolean }[];
    expect(choices).toContainEqual({
      id: created.station.id,
      name: 'Заал XP-80C',
      kind: 'bridge',
      online: false,
    });

    const printed = (
      await http()
        .post('/api/v1/price-labels/print')
        .set(bearer(cashier))
        .set(idempotency())
        .send({
          tillId: store.till.id,
          stationId: created.station.id,
          items: [{ productId: cola.id, copies: 2 }],
        })
        .expect(201)
    ).body as { jobId: number; labels: number };
    expect(printed.labels).toBe(2);
    const job = () =>
      http().get(`/api/v1/print-jobs/${printed.jobId}`).set(bearer(cashier)).expect(200);
    expect((await job()).body).toMatchObject({ status: 'queued', error: null });

    const wrong = await http()
      .get('/api/v1/print-bridge/next')
      .set('Authorization', `Bearer bps_${created.station.id}_${'x'.repeat(32)}`)
      .expect(401);
    expect(wrong.body).toMatchObject({ code: 'PRINT_KEY_INVALID' });
    await http().get('/api/v1/print-bridge/next').expect(401);

    const bridge = (path: string) =>
      http()
        .get(path)
        .set('Authorization', `Bearer ${created.key}`)
        .set('X-Printer-Name', 'XP-80C');
    const next = (await bridge('/api/v1/print-bridge/next').expect(200)).body as {
      job: { id: number; labels: number; data: string } | null;
    };
    expect(next.job).toMatchObject({ id: printed.jobId, labels: 2 });
    expect([...Buffer.from(next.job?.data ?? '', 'base64').subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect((await job()).body).toMatchObject({ status: 'printing' });
    const station = (
      (await http().get('/api/v1/printing/stations').set(bearer(admin)).expect(200)).body as {
        id: number;
        online: boolean;
        printerName: string | null;
      }[]
    ).find((entry) => entry.id === created.station.id);
    expect(station).toMatchObject({ online: true, printerName: 'XP-80C' });

    await http()
      .post(`/api/v1/print-bridge/jobs/${printed.jobId}/done`)
      .set('Authorization', `Bearer bps_${created.station.id}_${'y'.repeat(32)}`)
      .send({ ok: true })
      .expect(401);
    await http()
      .post(`/api/v1/print-bridge/jobs/${printed.jobId}/done`)
      .set('Authorization', `Bearer ${created.key}`)
      .send({ ok: true })
      .expect(200);
    expect((await job()).body).toMatchObject({ status: 'done', error: null });
    // Reported once only.
    await http()
      .post(`/api/v1/print-bridge/jobs/${printed.jobId}/done`)
      .set('Authorization', `Bearer ${created.key}`)
      .send({ ok: false, message: 'late' })
      .expect(409);
    // The bytes are gone once the job ended.
    const kept = await sql.query<{ payload: Buffer | null }>(
      'SELECT payload FROM print_jobs WHERE id = $1',
      [printed.jobId],
    );
    expect(kept.rows[0]?.payload).toBeNull();

    // A job nobody takes in two minutes fails PRINTER_OFFLINE.
    const late = (
      await http()
        .post('/api/v1/price-labels/print')
        .set(bearer(cashier))
        .set(idempotency())
        .send({
          tillId: store.till.id,
          stationId: created.station.id,
          items: [{ productId: water.id, copies: 1 }],
        })
        .expect(201)
    ).body as { jobId: number };
    await sql.query(
      `UPDATE print_jobs SET created_at = now() - interval '3 minutes' WHERE id = $1`,
      [late.jobId],
    );
    expect(
      (await http().get(`/api/v1/print-jobs/${late.jobId}`).set(bearer(cashier)).expect(200)).body,
    ).toMatchObject({ status: 'failed', error: 'PRINTER_OFFLINE' });
    // Someone else's job is not theirs to read.
    await http().get(`/api/v1/print-jobs/${late.jobId}`).set(bearer(office)).expect(404);

    // Disabled: no key works and nobody prints to it.
    await http()
      .put(`/api/v1/printing/stations/${created.station.id}`)
      .set(bearer(admin))
      .send({ status: 'disabled' })
      .expect(200);
    await bridge('/api/v1/print-bridge/next').expect(401);
  });

  it('sends a LAN printer’s job from the api and reports it done', async () => {
    const received: Buffer[] = [];
    const server: Server = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const created = (
        await http()
          .post('/api/v1/printing/stations')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name: 'Сүлжээний принтер', kind: 'network', host: '127.0.0.1', port })
          .expect(201)
      ).body as { station: { id: number }; key: string | null };
      expect(created.key).toBeNull();
      const order = { tillId: store.till.id, items: [{ productId: water.id, copies: 1 }] };
      const expected = (
        await http()
          .post('/api/v1/price-labels/escpos')
          .set(bearer(cashier))
          .send(order)
          .expect(200)
      ).body as { data: string };
      const printed = (
        await http()
          .post('/api/v1/price-labels/print')
          .set(bearer(cashier))
          .set(idempotency())
          .send({ ...order, stationId: created.station.id })
          .expect(201)
      ).body as { jobId: number };
      let status = '';
      for (let attempt = 0; attempt < 50 && status !== 'done'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = (
          (await http().get(`/api/v1/print-jobs/${printed.jobId}`).set(bearer(cashier)).expect(200))
            .body as { status: string }
        ).status;
      }
      expect(status).toBe('done');
      expect(Buffer.concat(received).toString('base64')).toBe(expected.data);

      // The office's test label goes the same way.
      const test = (
        await http()
          .post(`/api/v1/printing/stations/${created.station.id}/test`)
          .set(bearer(admin))
          .set(idempotency())
          .expect(201)
      ).body as { id: number; labels: number };
      expect(test.labels).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('gives a cashier no till names no labels', async () => {
    const user = await seedUser(app, { roles: ['POS_CASHIER'] });
    const token = (await login(app, user)).accessToken;
    // A cashier no till names has no labels.
    await http().get('/api/v1/price-labels/tills').set(bearer(token)).expect(403);
  });

  it('offers every active till to the holder of pos.manage, cashier of none (owner 2026-11-20)', async () => {
    // A third till, closed: not offered even to pos.manage.
    const closed = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: store.store.id,
          code: 'К3',
          name: 'Касс 3',
          printerHost: null,
        })
        .expect(201)
    ).body as TillJson;
    await store.pos.updateTill(closed.id, { status: 'INACTIVE' }).expect(200);

    const active = (await store.pos.tills())
      .filter((till) => till.status === 'ACTIVE')
      .map((till) => till.id)
      .sort((a, b) => a - b);
    const offered = (
      (await http().get('/api/v1/price-labels/tills').set(bearer(admin)).expect(200)).body as {
        id: number;
      }[]
    )
      .map((till) => till.id)
      .sort((a, b) => a - b);
    expect(offered).toEqual(active);
    expect(offered).toEqual(expect.arrayContaining([store.till.id, other.id]));
    expect(offered).not.toContain(closed.id);

    // It prints on the second till, which names no cashier, at that till's products.
    const soapThere = (await labelsOf(admin, other.id, 'саван').expect(200)).body as {
      productId: number;
    }[];
    expect(soapThere.map((item) => item.productId)).toEqual([soap.id]);
    const made = (
      await http()
        .post('/api/v1/price-labels/escpos')
        .set(bearer(admin))
        .send({ tillId: other.id, items: [{ productId: soap.id, copies: 2 }] })
        .expect(200)
    ).body as { labels: number };
    expect(made.labels).toBe(2);
    await http().get('/api/v1/print-stations').set(bearer(admin)).expect(200);
    // The closed till stays shut to it.
    const shut = await labelsOf(admin, closed.id, 'саван').expect(403);
    expect(shut.body).toMatchObject({ code: 'PRINT_TILL_NOT_YOURS' });

    // Staff without pos.manage and named by no till still have none.
    const refused = await http().get('/api/v1/price-labels/tills').set(bearer(office)).expect(403);
    expect(refused.body).toMatchObject({ code: 'PRINT_NO_TILL' });
    await labelsOf(office, other.id, 'саван').expect(403);
  });
});
