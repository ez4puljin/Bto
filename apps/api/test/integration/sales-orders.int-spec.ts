import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate, businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
  errors?: { path: string; constraint: string }[];
}

/**
 * Office orders (SPEC §5.7, ADR-0055): drafts, the submit that confirms, freezes the price parts
 * and reserves per line in the product's home warehouse (the rest backordered), cancelling with a
 * reason that releases the stock, rights and the refusals. Synthetic data only.
 */
describe('sales orders', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let warehouseUser: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let cola: ProductJson;
  let juice: ProductJson;
  let homeless: ProductJson;
  let waiting: ProductJson;
  let shop: CustomerJson;
  let addressId: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const box = (product: ProductJson) => unitOf(product, 'BOX').id;
  const orders = () => salesApi(app, office);
  const reserved = async (warehouseId: number, productId: number) =>
    (
      await sql.query<{ reserved: string }>(
        `SELECT coalesce(sum(reserved), 0)::text AS reserved FROM warehouse_stock
          WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
      )
    ).rows[0]?.reserved;

  const stockIn = async (warehouseId: number, binId: number, product: ProductJson, qty: string) => {
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs(product), enteredQty: qty, binId, unitCost: '1000' }],
      })
      .expect(201);
    const id = (created.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${id}/submit`).set(bearer(admin)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${id}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    warehouseUser = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('SO1');
    wh2 = await inventory.warehouse('SO2');
    const bin1 = await inventory.bin(wh1.id, 'A-01-01');
    const bin2 = await inventory.bin(wh2.id, 'A-01-01');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Захиалгын бараа');
    const base = await catalog.uomId('PCS');
    const boxUom = await catalog.uomId('BOX');
    const product = (sku: string, name: string, factor: string | null) =>
      catalog.product({
        sku,
        name,
        categoryId: category,
        baseUomId: base,
        ...(factor ? { units: [{ uomId: boxUom, factorToBase: factor }] } : {}),
      });
    cola = await product('7701', 'Кола', '24');
    juice = await product('7702', 'Шүүс', '12');
    homeless = await product('7703', 'Харьяагүй', null);
    waiting = await product('7704', 'Хүлээгдэж буй', null);
    await inventory.setHome(cola.id, wh1.id);
    await inventory.setHome(juice.id, wh2.id);
    await inventory.setHome(waiting.id, wh1.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Захиалга: Ундаа');
    await pricing.terms(cola.id, '1000', profile, boxUom);
    await pricing.terms(juice.id, '2000', profile, boxUom);
    await pricing.terms(homeless.id, '500', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, juice.id, homeless.id] })
      .expect(200);
    await stockIn(wh1.id, bin1.id, cola, '30');
    await stockIn(wh2.id, bin2.id, juice, '12');
    const partners = partnersApi(app, admin);
    shop = await partners.customer({ name: 'Захиалгын дэлгүүр' });
    const address = await http()
      .post(`/api/v1/customers/${shop.id}/addresses`)
      .set(bearer(admin))
      .send({ address: 'Мөрөн, 3-р баг', lat: '49.6345', lng: '100.1625', isDefault: true })
      .expect(201);
    addressId = (address.body as { id: number }).id;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('refuses products that cannot be ordered and a delivery without an address', async () => {
    const refuse = async (body: Record<string, unknown>) =>
      (await orders().create(body)).body as ProblemJson;
    expect(
      await refuse(orderBody(shop.id, [{ productUnitId: pcs(homeless), qty: '1' }])),
    ).toMatchObject({
      code: 'PRODUCT_NO_HOME',
      errors: [{ path: 'lines.0', constraint: 'home' }],
    });
    expect(
      await refuse(
        orderBody(shop.id, [
          { productUnitId: pcs(cola), qty: '1' },
          { productUnitId: pcs(waiting), qty: '1' },
        ]),
      ),
    ).toMatchObject({ code: 'PRODUCT_NOT_SELLABLE', errors: [{ path: 'lines.1' }] });
    expect(await refuse(orderBody(shop.id, [], { fulfilment: 'DELIVERY' }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'addressId', constraint: 'required' }],
    });
    expect(
      await refuse(orderBody(shop.id, [], { deliveryDate: addDays(today, -1) })),
    ).toMatchObject({ errors: [{ path: 'deliveryDate', constraint: 'notPast' }] });
    expect(await refuse(orderBody(shop.id, [], { contactPhone: '123' }))).toMatchObject({
      errors: [{ path: 'contactPhone', constraint: 'phone' }],
    });
    await salesApi(app, warehouseUser)
      .create(orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(403);
  });

  it('shows what a product offers to an order', async () => {
    const info = (
      await http()
        .get('/api/v1/sales-orders/product-info')
        .query({ productIds: `${cola.id},${homeless.id},${waiting.id}` })
        .set(bearer(office))
        .expect(200)
    ).body as {
      productId: number;
      homeWarehouseId: number | null;
      sellable: boolean;
      available: string;
    }[];
    expect(info.sort((a, b) => a.productId - b.productId)).toEqual([
      { productId: cola.id, homeWarehouseId: wh1.id, sellable: true, available: '30' },
      { productId: homeless.id, homeWarehouseId: null, sellable: true, available: '0' },
      { productId: waiting.id, homeWarehouseId: wh1.id, sellable: false, available: '0' },
    ]);
  });

  it('confirms on submit: number, frozen parts, reservations per home warehouse, backorders', async () => {
    const draft = await orders().draft(
      orderBody(
        shop.id,
        [
          { productUnitId: box(cola), qty: '1' },
          { productUnitId: pcs(cola), qty: '5' },
          { productUnitId: box(juice), qty: '2' },
        ],
        {
          fulfilment: 'DELIVERY',
          addressId,
          contactName: '  Бат  ',
          contactPhone: '9911 2233',
          paymentMethod: 'CREDIT',
          note: 'Өглөө',
        },
      ),
    );
    expect(draft).toMatchObject({
      number: null,
      status: 'DRAFT',
      addressText: 'Мөрөн, 3-р баг',
      contactName: 'Бат',
      contactPhone: '+97699112233',
      total: null,
    });
    expect(draft.lines.map((line) => [line.qtyBase, line.warehouseId])).toEqual([
      ['24', wh1.id],
      ['5', wh1.id],
      ['24', wh2.id],
    ]);

    const key = idempotency();
    const confirmed = (await orders().submit(draft.id, key).expect(200)).body as OrderJson;
    const replay = (await orders().submit(draft.id, key).expect(200)).body as OrderJson;
    expect(replay.number).toBe(confirmed.number);
    expect(confirmed.number).toMatch(new RegExp(`^SO-${businessYear()}-\\d{6}$`));
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', priceDate: today });
    expect(
      confirmed.lines.map((line) => [line.qtyApproved, line.qtyBackordered, line.total]),
    ).toEqual([
      ['24', '0', '24000'],
      ['5', '0', '5750'],
      ['12', '12', '48000'],
    ]);
    expect(confirmed.lines[1]?.parts).toEqual([
      expect.objectContaining({ basis: 'LOOSE', qty: '5', unitPrice: '1150', total: '5750' }),
    ]);
    expect(confirmed.total).toBe('77750');
    expect(confirmed.events.map((event) => event.toStatus)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CONFIRMED',
    ]);
    expect(await reserved(wh1.id, cola.id)).toBe('29.000');
    expect(await reserved(wh2.id, juice.id)).toBe('12.000');

    // A confirmed order is not submitted again (editing it: sales-boards.int-spec, ADR-0056).
    expect(((await orders().submit(draft.id).expect(409)).body as ProblemJson).code).toBe(
      'ORDER_STATE_INVALID',
    );
    await salesApi(app, warehouseUser)
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(403);

    // The next order finds only one piece of cola left.
    const next = await orders().draft(orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '3' }]));
    const second = (await orders().submit(next.id).expect(200)).body as OrderJson;
    expect(second.lines[0]).toMatchObject({ qtyApproved: '1', qtyBackordered: '2' });

    // Cancelling releases what was reserved.
    await orders().cancel(draft.id, '  ').expect(422);
    const cancelled = (await orders().cancel(draft.id, 'Харилцагч цуцалсан').expect(200))
      .body as OrderJson;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Харилцагч цуцалсан' });
    expect(await reserved(wh1.id, cola.id)).toBe('1.000');
    expect(await reserved(wh2.id, juice.id)).toBe('0.000');
    await orders().cancel(draft.id, 'дахин').expect(409);
    await salesApi(app, warehouseUser).get(second.id);
  });

  it('edits a draft and lists orders by status and number', async () => {
    const draft = await orders().draft(
      orderBody(shop.id, [{ productUnitId: pcs(juice), qty: '1' }]),
    );
    const edited = (
      await orders()
        .update(
          draft.id,
          orderBody(shop.id, [{ productUnitId: box(juice), qty: '1' }], { note: 'Шинэ' }),
        )
        .expect(200)
    ).body as OrderJson;
    expect(edited.lines.map((line) => [line.unitName, line.qty])).toEqual([['хайрцаг', '1']]);
    expect(edited.contactName).toBeNull();
    const drafts = (
      await http()
        .get('/api/v1/sales-orders')
        .query({ status: 'DRAFT', customerId: shop.id })
        .set(bearer(office))
        .expect(200)
    ).body as { data: { id: number; lineCount: number; customerName: string }[] };
    expect(drafts.data[0]).toMatchObject({
      id: draft.id,
      lineCount: 1,
      customerName: 'Захиалгын дэлгүүр',
    });
    const cancelled = (await orders().cancel(draft.id, 'Ноорог хэрэггүй').expect(200))
      .body as OrderJson;
    expect(cancelled.number).toBeNull();
    const byNumber = (
      await http()
        .get('/api/v1/sales-orders')
        .query({ q: `SO-${businessYear()}` })
        .set(bearer(office))
        .expect(200)
    ).body as { data: { number: string }[] };
    expect(byNumber.data.length).toBeGreaterThanOrEqual(2);
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'sales_orders' AND entity_id = $1 ORDER BY id`,
      [String(draft.id)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE', 'CANCEL']);
  });
});
