import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import type { Client } from 'pg';
import request from 'supertest';
import { Decimal } from '@tugeel/shared/money';
import type { PriceChangeSummary } from '@tugeel/shared/notifications';
import { businessDate } from '@tugeel/shared/time';
import { CheckoutService } from '../../src/edge/services/checkout.service';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { PRICE_CHANGE_NOTIFIER, type PriceChangeNotifier } from '../../src/modules/pricing';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase } from '../harness/edge';
import { bearer, login, seedUser, uniquePhone } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { posStore } from '../harness/pos';
import { salesFlow } from '../harness/finance';
import { CustomerShopService } from '../../src/modules/customer/services/customer-shop.service';
import { PhoneCallsService } from '../../src/modules/phone-agent/services/phone-calls.service';
import { PhoneLinesService } from '../../src/modules/phone-agent/services/phone-lines.service';
import { PhoneToolsService } from '../../src/modules/phone-agent/services/phone-tools.service';
import { SalesRepShopService } from '../../src/modules/sales';

interface ReceiptJson {
  id: number;
  status: string;
  costingVersion: number;
  lines: {
    id: number;
    printedUnitPrice?: string | null;
    freeGoods?: boolean;
    docAmount?: string | null;
  }[];
}
interface BaseJson {
  basePrice: string | null;
  lastEventId: number | null;
}
interface NotificationJson {
  id: number;
  kind: string;
  priceChange?: PriceChangeSummary | null;
  read: boolean;
}

/** Real receiving, price facts and the bell share a transaction; tills price their own warehouses. */
describe('supplier pricing receipt, inbox and till adapters', () => {
  let app: NestExpressApplication;
  let edge: NestExpressApplication | undefined;
  let sql: Client;
  let admin: string;
  let keeper: string;
  let supplierId: number;
  let warehouseId: number;
  let categoryId: number;
  let pcs: number;
  let box: number;
  let sequence = 0;
  const http = () => request(app.getHttpServer());
  const auth = () => bearer(admin);
  const product = async () => {
    const result = await catalogApi(app, admin).product({
      sku: String(9988700 + ++sequence),
      name: 'Synthetic supplier adapter ' + sequence,
      categoryId,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '12' }],
    });
    await inventoryApi(app, admin).setHome(result.id, warehouseId);
    return result;
  };
  const draft = async (
    item: ProductJson,
    fields: Record<string, unknown>,
    token = admin,
  ): Promise<ReceiptJson> =>
    (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(token))
        .set(idempotency())
        .send({
          supplierId,
          lines: [{ productUnitId: unitOf(item, 'BOX').id, enteredQty: '1', ...fields }],
        })
        .expect(201)
    ).body as ReceiptJson;
  const base = async (id: number): Promise<BaseJson> =>
    (
      await http()
        .get('/api/v1/pricing/base-prices/' + id)
        .set(auth())
        .expect(200)
    ).body as BaseJson;
  const inbox = async (token = admin): Promise<NotificationJson[]> =>
    (
      (
        await http()
          .get('/api/v1/me/notifications')
          .query({ limit: 200 })
          .set(bearer(token))
          .expect(200)
      ).body as { data: NotificationJson[] }
    ).data;
  const receiptNotes = async (id: number) =>
    (await inbox()).filter(
      (row) => row.kind === 'PRICE_CHANGED' && row.priceChange?.receiptId === id,
    );

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    keeper = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const wh = await inventoryApi(app, admin).warehouse('SPF');
    warehouseId = wh.id;
    supplierId = (await partnersApi(app, admin).supplier({ name: 'Synthetic supplier flow' })).id;
    const catalog = catalogApi(app, admin);
    categoryId = await catalog.category('Synthetic price flows');
    pcs = await catalog.uomId('PCS');
    box = await catalog.uomId('BOX');
    await http()
      .put('/api/v1/pricing/supplier-rules/' + supplierId)
      .set(auth())
      .set(idempotency())
      .send({
        expectedVersion: 0,
        enabled: true,
        markupPct: '10',
        markupAmount: '0',
        rounding: 'WHOLE',
      })
      .expect(200);
  });
  afterAll(async () => {
    await edge?.close();
    await expectReconciled(app);
    await sql?.end();
    await app?.close();
  });

  it('merges interleaved legacy and price inbox IDs without changing cursors or read ownership', async () => {
    const owner = await seedUser(app, { roles: [] });
    const stranger = await seedUser(app, { roles: [] });
    const token = (await login(app, owner)).accessToken;
    const otherToken = (await login(app, stranger)).accessToken;
    const flow = await salesFlow(app, admin, 'SPI');
    const item = await flow.product('9988991', 'Synthetic inbox item', '1000', '1');
    const customer = await partnersApi(app, admin).customer({ name: 'Synthetic inbox customer' });
    const order = await flow.draft(customer.id, [{ productUnitId: flow.pcs(item), qty: '1' }]);
    const payload = JSON.stringify({
      receiptId: 1,
      receiptNumber: 'Synthetic inbox',
      changes: [],
      warnings: [],
    });
    const ids: number[] = [];
    await sql.query('BEGIN');
    try {
      for (const kind of ['PHONE_ORDER', 'ORDER_SOLD']) {
        const old = await sql.query<{ id: number }>(
          'INSERT INTO user_notifications (user_id,kind,order_id,payload) VALUES ($1,$2,$3,$4) RETURNING id::int',
          [owner.id, kind, order.id, '{}'],
        );
        ids.push(old.rows[0]!.id);
        const price = await sql.query<{ id: number }>(
          'INSERT INTO user_price_notifications (user_id,price_change_key,payload) VALUES ($1,$2,$3) RETURNING id::int',
          [owner.id, 'mixed-inbox-' + kind, payload],
        );
        ids.push(price.rows[0]!.id);
      }
      await sql.query('COMMIT');
    } catch (error) {
      await sql.query('ROLLBACK');
      throw error;
    }
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id > 0)).toBe(true);
    const timestamps = await sql.query<{ n: number }>(
      'SELECT count(DISTINCT created_at)::int AS n FROM (SELECT created_at FROM user_notifications WHERE user_id=$1 UNION ALL SELECT created_at FROM user_price_notifications WHERE user_id=$1) mixed',
      [owner.id],
    );
    expect(timestamps.rows[0]!.n).toBe(1);
    const page = async (cursor?: string) =>
      (
        await http()
          .get('/api/v1/me/notifications')
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(bearer(token))
          .expect(200)
      ).body as {
        data: NotificationJson[];
        nextCursor: string | null;
      };
    const first = await page();
    expect(first.data.map((row) => row.id)).toEqual([...ids].reverse().slice(0, 2));
    expect(first.data.map((row) => row.kind)).toEqual(['PRICE_CHANGED', 'ORDER_SOLD']);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(first.nextCursor!);
    expect(second.data.map((row) => row.id)).toEqual([...ids].reverse().slice(2));
    expect(second.data.map((row) => row.kind)).toEqual(['PRICE_CHANGED', 'PHONE_ORDER']);
    expect(second.nextCursor).toBeNull();
    const summary = async () =>
      (await http().get('/api/v1/me/notifications/summary').set(bearer(token)).expect(200))
        .body as { unread: number };
    const read = async (who: string, notificationIds: number[]) =>
      (
        await http()
          .post('/api/v1/me/notifications/read')
          .set(bearer(who))
          .send({ notificationIds })
          .expect(200)
      ).body as { unread: number };
    expect((await summary()).unread).toBe(4);
    await read(otherToken, ids);
    expect((await summary()).unread).toBe(4);
    expect((await read(token, ids.slice(0, 2))).unread).toBe(2);
    expect((await read(token, ids.slice(0, 2))).unread).toBe(2);
    expect((await read(token, ids)).unread).toBe(0);
    const replay = await sql.query(
      'INSERT INTO user_price_notifications (user_id,price_change_key,payload) VALUES ($1,$2,$3) ON CONFLICT (price_change_key,user_id) DO NOTHING RETURNING id',
      [owner.id, 'mixed-inbox-PHONE_ORDER', payload],
    );
    expect(replay.rowCount).toBe(0);
    expect((await inbox(token)).map((row) => row.id)).toEqual([...ids].reverse());
    expect((await summary()).unread).toBe(0);
    await expect(
      sql.query(
        'INSERT INTO user_price_notifications (id,user_id,price_change_key,payload) VALUES ($1,$2,$3,$4)',
        [ids[0], owner.id, 'explicit-id', payload],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      sql.query('UPDATE user_price_notifications SET payload=$1 WHERE user_id=$2', [
        payload,
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      sql.query(
        'INSERT INTO user_notifications (user_id,kind,order_id,payload) VALUES ($1,$2,$3,$4)',
        [owner.id, 'PRICE_CHANGED', order.id, payload],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'user_notifications_kind' });
  });

  it('keeps a free-goods printed reference private and derives a base price without adding book cost', async () => {
    const item = await product();
    await http()
      .post('/api/v1/receipts')
      .set(bearer(keeper))
      .set(idempotency())
      .send({
        supplierId,
        lines: [
          {
            productUnitId: unitOf(item, 'BOX').id,
            enteredQty: '1',
            freeGoods: true,
            printedUnitPrice: '12000',
          },
        ],
      })
      .expect(403);
    const receipt = await draft(item, { freeGoods: true, printedUnitPrice: '12000' });
    expect(receipt.lines[0]).toMatchObject({
      printedUnitPrice: '12000.00',
      freeGoods: true,
      docAmount: null,
    });
    const publicView = (
      await http()
        .get('/api/v1/receipts/' + receipt.id)
        .set(bearer(keeper))
        .expect(200)
    ).body as ReceiptJson;
    expect(publicView.lines[0]).not.toHaveProperty('printedUnitPrice');
    await postReceipt(app, admin, receipt.id);
    expect((await base(item.id)).basePrice).toBe('1100');
    await costReceiptAsTyped(app, admin, receipt.id);
    const costs = (
      await http()
        .get('/api/v1/receipts/' + receipt.id + '/costing')
        .set(auth())
        .expect(200)
    ).body as {
      total: string;
      lines: { amount: string; freeGoods: boolean; printedUnitPrice: string | null }[];
    };
    expect(new Decimal(costs.total).isZero()).toBe(true);
    expect(costs.lines[0]).toMatchObject({ freeGoods: true, printedUnitPrice: '12000.00' });
    expect(new Decimal(costs.lines[0]?.amount ?? '-1').isZero()).toBe(true);
    const notes = await receiptNotes(receipt.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.priceChange).toMatchObject({
      changeCount: 1,
      warningCount: 0,
      changes: [{ productId: item.id, newBasePrice: '1100', overrodeManual: false }],
    });
    expect(JSON.stringify(notes)).not.toContain('printedUnitPrice');
    expect((await inbox(keeper)).filter((row) => row.kind === 'PRICE_CHANGED')).toHaveLength(0);
  });

  it('retains a missing-reference warning and then notifies the first checked printed price once', async () => {
    const item = await product();
    const receipt = await draft(item, { freeGoods: true });
    await postReceipt(app, admin, receipt.id);
    expect((await base(item.id)).basePrice).toBeNull();
    const first = await receiptNotes(receipt.id);
    expect(first).toHaveLength(1);
    expect(first[0]?.priceChange?.warnings[0]?.reason).toBe('PRINTED_PRICE_MISSING');
    const key = idempotency();
    const body = {
      costingVersion: 0,
      noteTotalAmount: '0',
      lines: [{ lineId: receipt.lines[0]?.id, freeGoods: true, printedUnitPrice: '12000' }],
    };
    for (let repeat = 0; repeat < 2; repeat++)
      await http()
        .put('/api/v1/receipts/' + receipt.id + '/costs')
        .set(auth())
        .set(key)
        .send(body)
        .expect(200);
    expect((await base(item.id)).basePrice).toBe('1100');
    const notes = await receiptNotes(receipt.id);
    expect(notes).toHaveLength(2);
    expect(notes.some((row) => row.priceChange?.changeCount === 1)).toBe(true);
    expect(notes.some((row) => row.priceChange?.warningCount === 1)).toBe(true);
    const read = await http()
      .post('/api/v1/me/notifications/read')
      .set(auth())
      .send({ notificationIds: notes.map((row) => row.id) })
      .expect(200);
    expect(read.body).toHaveProperty('unread');
    expect((await receiptNotes(receipt.id)).every((row) => row.read)).toBe(true);
    await http()
      .put('/api/v1/receipts/' + receipt.id + '/costs')
      .set(auth())
      .set(idempotency())
      .send({
        ...body,
        costingVersion: 1,
        lines: [{ lineId: receipt.lines[0]?.id, freeGoods: true, printedUnitPrice: '24000' }],
      })
      .expect(422);
    expect((await base(item.id)).basePrice).toBe('1100');
  });

  it('reports replacement of a manual base price by the next posted delivery note', async () => {
    const item = await product();
    const receipt = await draft(item, { docUnitPrice: '12000' });
    await postReceipt(app, admin, receipt.id);
    const before = await base(item.id);
    await http()
      .put('/api/v1/pricing/base-prices/' + item.id)
      .set(auth())
      .set(idempotency())
      .send({
        expectedPrice: before.basePrice,
        expectedEventId: before.lastEventId,
        price: '2000',
        reason: 'Synthetic manual adjustment',
      })
      .expect(200);
    const next = await draft(item, { docUnitPrice: '24000' });
    await postReceipt(app, admin, next.id);
    expect((await base(item.id)).basePrice).toBe('2200');
    expect((await receiptNotes(next.id))[0]?.priceChange?.changes[0]).toMatchObject({
      oldBasePrice: '2000',
      newBasePrice: '2200',
      overrodeManual: true,
    });
  });

  it('rolls stock, prices and the receipt back when the mandatory notification write fails', async () => {
    const item = await product();
    const receipt = await draft(item, { docUnitPrice: '12000' });
    const notifier = app.get<PriceChangeNotifier>(PRICE_CHANGE_NOTIFIER);
    const spy = jest
      .spyOn(notifier, 'notifyInTx')
      .mockRejectedValueOnce(new Error('Synthetic notification failure'));
    try {
      await postReceipt(app, admin, receipt.id, { status: 500 });
    } finally {
      spy.mockRestore();
    }
    const saved = (
      await http()
        .get('/api/v1/receipts/' + receipt.id)
        .set(auth())
        .expect(200)
    ).body as ReceiptJson;
    expect(saved.status).toBe('DRAFT');
    expect((await base(item.id)).basePrice).toBeNull();
    expect(
      (
        await sql.query<{ n: number }>(
          "SELECT count(*)::int n FROM stock_ledger WHERE doc_type='GR' AND doc_id=$1",
          [receipt.id],
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(await receiptNotes(receipt.id)).toHaveLength(0);
  });

  it.each(['UNIT', 'TOTAL', 'FREE'] as const)(
    'keeps the exact invoice ratio across a partial arrival and later unchanged edits: %s',
    async (source) => {
      const freeGoods = source === 'FREE';
      const fractionalSupplier = (
        await partnersApi(app, admin).supplier({
          name: 'Synthetic fractional supplier ' + source,
        })
      ).id;
      await http()
        .put('/api/v1/pricing/supplier-rules/' + fractionalSupplier)
        .set(auth())
        .set(idempotency())
        .send({
          expectedVersion: 0,
          enabled: true,
          markupPct: '0.5',
          markupAmount: '0',
          rounding: 'WHOLE',
        })
        .expect(200);
      const item = await catalogApi(app, admin).product({
        sku: String(9988700 + ++sequence),
        name: 'Synthetic fractional reference ' + sequence,
        categoryId,
        baseUomId: pcs,
        units: [{ uomId: box, factorToBase: '3' }],
      });
      await inventoryApi(app, admin).setHome(item.id, warehouseId);
      const receipt = (
        await http()
          .post('/api/v1/receipts')
          .set(auth())
          .set(idempotency())
          .send({
            supplierId: fractionalSupplier,
            lines: [
              {
                productUnitId: unitOf(item, 'BOX').id,
                enteredQty: '1',
                ...(freeGoods
                  ? { freeGoods: true, printedUnitPrice: '100' }
                  : source === 'TOTAL'
                    ? { docAmount: '100' }
                    : { docUnitPrice: '100' }),
              },
            ],
          })
          .expect(201)
      ).body as ReceiptJson;
      const counted = (
        await http()
          .patch('/api/v1/receipt-lines/' + receipt.lines[0]?.id)
          .set(auth())
          .send({ arrivedQtyBase: '1' })
          .expect(200)
      ).body as ReceiptJson;
      expect(counted.lines[0]).toMatchObject({
        printedUnitPrice: '100.00',
        printedPriceFactor: '3',
        factorSnapshot: '1',
        freeGoods,
      });
      for (const edit of [1, 2]) {
        const echoed = (
          await http()
            .patch('/api/v1/receipt-lines/' + receipt.lines[0]?.id)
            .set(auth())
            .send({
              arrivedQtyBase: '1',
              note: 'Synthetic unchanged edit ' + edit,
              printedUnitPrice: '100',
              docUnitPrice: source === 'UNIT' ? '33.33' : null,
              docAmount: source === 'UNIT' ? '33.33' : source === 'TOTAL' ? '100' : null,
              freeGoods,
            })
            .expect(200)
        ).body as ReceiptJson;
        expect(echoed.lines[0]).toMatchObject({
          printedUnitPrice: '100.00',
          printedPriceFactor: '3',
          factorSnapshot: '1',
          freeGoods,
        });
      }
      await postReceipt(app, admin, receipt.id);
      // 100 / 3 * 1.005 = 33.5; the single final HALF_UP must yield 34, never 33.
      expect((await base(item.id)).basePrice).toBe('34');
      const checked =
        source === 'UNIT'
          ? await http()
              .put('/api/v1/receipts/' + receipt.id + '/costs')
              .set(auth())
              .set(idempotency())
              .send({
                costingVersion: 0,
                lines: [{ lineId: receipt.lines[0]?.id, unitPrice: '33.33' }],
              })
              .expect(200)
          : await costReceiptAsTyped(app, admin, receipt.id);
      expect((checked.body as ReceiptJson).lines[0]).toMatchObject({
        printedUnitPrice: '100.00',
        printedPriceFactor: '3',
      });
      expect((await base(item.id)).basePrice).toBe('34');
    },
  );

  it.each(['UNIT', 'TOTAL'] as const)(
    'applies a genuinely corrected paid invoice on the first price check only: %s',
    async (source) => {
      const item = await product();
      const receipt = await draft(
        item,
        source === 'UNIT' ? { docUnitPrice: '12000' } : { docAmount: '12000' },
      );
      await postReceipt(app, admin, receipt.id);
      expect((await base(item.id)).basePrice).toBe('1100');
      const checked = await http()
        .put('/api/v1/receipts/' + receipt.id + '/costs')
        .set(auth())
        .set(idempotency())
        .send({
          costingVersion: 0,
          noteTotalAmount: '24000',
          lines: [
            {
              lineId: receipt.lines[0]?.id,
              ...(source === 'UNIT' ? { unitPrice: '24000' } : { amount: '24000' }),
            },
          ],
        })
        .expect(200);
      expect((checked.body as ReceiptJson).lines[0]).toMatchObject({
        printedUnitPrice: '24000.00',
        printedPriceFactor: '12',
      });
      expect((await base(item.id)).basePrice).toBe('2200');
      // A later book-only revaluation is not a newly received invoice or a sale-price change.
      const recost = await http()
        .put('/api/v1/receipts/' + receipt.id + '/costs')
        .set(auth())
        .set(idempotency())
        .send({
          costingVersion: 1,
          noteTotalAmount: '36000',
          lines: [{ lineId: receipt.lines[0]?.id, amount: '36000' }],
        })
        .expect(200);
      expect((recost.body as ReceiptJson).lines[0]).toMatchObject({
        printedUnitPrice: '24000.00',
        printedPriceFactor: '12',
      });
      expect((await base(item.id)).basePrice).toBe('2200');
    },
  );

  it('shows customer, phone and rep prices that match a submitted mixed-warehouse order', async () => {
    const first = await salesFlow(app, admin, 'SPFA');
    const second = await salesFlow(app, admin, 'SPFB');
    const one = await first.product('9988781', 'Synthetic cross channel A', '1000', '10');
    const two = await second.product('9988782', 'Synthetic cross channel B', '1100', '10');
    for (const [warehouseId, priceType, markupPct] of [
      [first.wh.id, 'ADDITIONAL', '20'],
      [second.wh.id, 'BASE', '0'],
    ] as const) {
      await http()
        .put('/api/v1/pricing/location-rules/' + warehouseId)
        .set(auth())
        .set(idempotency())
        .send({
          expectedVersion: 0,
          enabled: true,
          priceType,
          markupPct,
          markupAmount: '0',
          rounding: 'WHOLE',
        })
        .expect(200);
    }
    const shop = app.get(SalesRepShopService);
    const scope = await shop.customerScope();
    const listed = await shop.productsOf(scope, [one.id, two.id]);
    expect(listed.find((row) => row.id === one.id)?.basePrice?.eq('1200')).toBe(true);
    expect(
      listed
        .find((row) => row.id === one.id)
        ?.units.find((unit) => unit.isBase)
        ?.wholesale?.eq('1200'),
    ).toBe(true);
    const sorted = await shop.productPage(scope, {
      q: 'Synthetic cross channel',
      sort: 'PRICE_ASC',
      limit: 200,
    });
    expect(
      sorted.data.filter((row) => row.id === one.id || row.id === two.id).map((row) => row.id),
    ).toEqual([two.id, one.id]);
    const lines = [
      { productUnitId: unitOf(one, 'PCS').id, qty: new Decimal(2) },
      { productUnitId: unitOf(two, 'PCS').id, qty: new Decimal(1) },
    ];
    expect(
      (await shop.withSourceWarehouses([{ ...lines[0]!, warehouseId: second.wh.id }]))[0]
        ?.warehouseId,
    ).toBe(second.wh.id);
    const customerQuote = await app.get(CustomerShopService).quote(lines);
    expect(customerQuote.quote.total.eq('3500')).toBe(true);
    const caller = uniquePhone();
    const customer = await partnersApi(app, admin).customer({
      name: 'Synthetic price comparison shop',
      phone: caller,
    });
    const openedLine = (
      await http()
        .post('/api/v1/phone-lines')
        .set(auth())
        .set(idempotency())
        .send({ name: 'Synthetic price phone' })
        .expect(201)
    ).body as { line: { id: number } };
    const lineId = openedLine.line.id;
    await http()
      .put('/api/v1/phone-lines/' + lineId)
      .set(auth())
      .send({ active: true })
      .expect(200);
    const openStage = first.pipeline.stages.find(
      (stage) => stage.action === 'NONE' && stage.archivedAt === null,
    );
    if (!openStage) throw Error('no open stage');
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(auth())
      .send({ channel: 'PHONE_AI', pipelineId: first.pipeline.id, stageId: openStage.id })
      .expect(200);
    const line = await app.get(PhoneLinesService).get(lineId);
    const call = await app
      .get(PhoneCallsService)
      .open(line, { callRef: randomUUID(), callerPhone: caller }, true);
    expect(call.call.answered).toBe(true);
    const spoken = await app.get(PhoneToolsService).run(line, call.call.id, 'quote', {
      afterSeq: 0,
      seq: 1,
      args: {
        lines: lines.map((own) => ({ unitId: own.productUnitId, qty: own.qty.toString() })),
      },
    });
    expect(spoken.total).toBe('3500');
    const order = await first.draft(
      customer.id,
      lines.map((own) => ({ productUnitId: own.productUnitId, qty: own.qty.toString() })),
    );
    await first.confirm(order.id).expect(200);
    const submitted = await first.orders.get(order.id);
    expect(new Decimal(submitted.total ?? 0).eq(customerQuote.quote.total)).toBe(true);
    expect(submitted.lines.map((own) => own.warehouseId)).toEqual([first.wh.id, second.wh.id]);
  }, 60_000);

  it('prices and advertises two tills on one offline edge from their own location rules', async () => {
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const store = await posStore(app, admin, 'SPX');
    const item = await store.product('9988799', 'Synthetic two till price', '1000', '10');
    const second = await inventoryApi(app, admin).warehouse('SPX2', 'STORE');
    const till2 = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: second.id,
          code: 'K2',
          name: 'Synthetic second till',
          printerHost: null,
        })
        .expect(201)
    ).body as { id: number; code: string };
    for (const [warehouseId, priceType, markupPct] of [
      [store.store.id, 'BASE', '0'],
      [second.id, 'ADDITIONAL', '20'],
    ] as const) {
      await http()
        .put('/api/v1/pricing/location-rules/' + warehouseId)
        .set(auth())
        .set(idempotency())
        .send({
          expectedVersion: 0,
          enabled: true,
          priceType,
          markupPct,
          markupAmount: '0',
          rounding: 'WHOLE',
        })
        .expect(200);
    }
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: 'http://127.0.0.1:' + port,
      nodeToken: store.edgeToken,
    });
    expect(await edge.get(SyncRunner).pullOnce()).toBe('changed');
    const checkout = edge.get(CheckoutService);
    const lines = [{ productUnitId: unitOf(item, 'PCS').id, qty: '1' }];
    for (const [code, tillId, price] of [
      [store.till.code, store.till.id, '1000.00'],
      [till2.code, till2.id, '1200.00'],
    ] as const) {
      expect(checkout.quote(lines, code).lines[0]?.total).toBe(price);
      expect(checkout.search(item.sku, code)[0]?.units[0]?.price).toBe(price);
      const quoted = await http()
        .post('/api/v1/pricing/quote')
        .set(auth())
        .send({ list: 'RETAIL', date: businessDate(), tillId, lines })
        .expect(200);
      expect(new Decimal((quoted.body as { total: string }).total).eq(price)).toBe(true);
    }
    // The second till's transformed terms must never mutate the first till's/global snapshot map.
    expect(checkout.quote(lines, store.till.code).lines[0]?.total).toBe('1000.00');
    const snapshot = await store.pos
      .http()
      .get('/api/v1/pos/sync/snapshot')
      .set('Authorization', 'Bearer ' + store.edgeToken)
      .expect(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('printedUnitPrice');
  }, 60_000);
});
