import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ExpiryCommerceView } from '@tugeel/shared/expiry';
import type {
  EdgeLoginResponse,
  EdgePairResponse,
  EdgeQuoteResponse,
  EdgeReceipt,
  PosSnapshot,
} from '@tugeel/shared/pos';
import { type Client, Pool } from 'pg';
import { DB_POOL } from '../../src/common/db/db.tokens';
import { eq, sql as sqlQuery } from 'drizzle-orm';
import { AppError, notFound } from '../../src/common/errors/app-error';
import { EDGE_DB, type EdgeDb } from '../../src/edge/db/edge-db';
import { edgeOutbox, edgeSales } from '../../src/edge/db/schema';
import { ExpiryCommerceService } from '../../src/modules/expiry';
import { PayrollSourceDeductionsService } from '../../src/modules/payroll';
import request from 'supertest';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { OutboxService } from '../../src/edge/services/outbox.service';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { approveExpiry } from '../harness/expiry-commerce';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { posActors, posStore, saleDoc, saleEvent } from '../harness/pos';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

/** Actual finalization boundaries, including the edge outbox, rather than SKU/date inference. */
describe('expiry source sales', () => {
  let app: NestExpressApplication;
  let edge: NestExpressApplication | undefined;
  let sql: Client;
  let admin: string;
  let store: Awaited<ReturnType<typeof posStore>>;
  let warehouse: WarehouseJson;
  let shiftClientId: string;
  let serial = 0;
  const http = () => request(app.getHttpServer());
  const base = (product: ProductJson) => unitOf(product, 'PCS').id;
  const product = async () =>
    store.product(String(998000 + ++serial), `Synthetic expiry sale ${serial}`, '1000', '30');
  const detail = async (id: number): Promise<ExpiryCommerceView> =>
    (await http().get(`/api/v1/expiry/items/${id}/commerce`).set(bearer(admin)).expect(200))
      .body as ExpiryCommerceView;
  const allocations = async (itemId: number) =>
    (
      await sql.query<{
        qty_base: string;
        cost_amount: string;
        revenue_amount: string;
        loss_amount: string;
      }>(
        'select a.qty_base::text,a.cost_amount::text,a.revenue_amount::text,a.loss_amount::text from expiry_sale_allocations a join expiry_markdowns m on m.id=a.markdown_id where m.item_id=$1 order by a.id',
        [itemId],
      )
    ).rows;
  const approve = (p: ProductJson, extra: Partial<Parameters<typeof approveExpiry>[2]> = {}) =>
    approveExpiry(app, admin, {
      productId: p.id,
      productUnitId: base(p),
      receiptWarehouseId: warehouse.id,
      warehouseId: store.store.id,
      channel: 'RETAIL',
      contextId: store.till.id,
      liableUserIds: [store.cashierId, store.supervisorId],
      qty: '10',
      costAmount: '1000',
      unitPrice: '55',
      ...extra,
    });
  const document = (
    p: ProductJson,
    qty: string,
    barcode: string,
    extra: Record<string, unknown> = {},
  ) => {
    const doc = saleDoc(
      [{ product: p, qty, unitPrice: '55' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const lines = doc.lines as Record<string, unknown>[];
    if (lines[0]) lines[0].expiryBarcode = barcode;
    return { ...doc, ...extra };
  };
  /** Real edge checkout and transport; fault injection happens only after local commit. */
  const faultTill = async () => {
    await edge?.close();
    edge = undefined;
    const p = await product();
    const till = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: store.store.id,
          code: `F${serial}`,
          name: `Synthetic failure till ${serial}`,
          printerHost: null,
        })
        .expect(201)
    ).body as { id: number; code: string };
    const approval = await approve(p, { contextId: till.id });
    const offer = approval.commerce.markdowns[0];
    if (!offer) throw new Error('missing failure-test approval');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
    });
    const kiosk = kioskApi(edge);
    const sync = edge.get(SyncRunner);
    const edgeDb = edge.get<EdgeDb>(EDGE_DB);
    const pair = (await store.pos.pairingCode(till.id).expect(200)).body as { code: string };
    expect(await sync.pullOnce()).toBe('changed');
    const paired = (
      await kiosk
        .post('/pair', {
          tillCode: till.code,
          pairingCode: pair.code,
        })
        .expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    const loggedIn = (
      await kiosk
        .post('/auth/pin', {
          userId: store.cashierId,
          pin: '123456',
        })
        .expect(200)
    ).body as EdgeLoginResponse;
    kiosk.setSession(loggedIn.token);
    await kiosk.post('/shifts/open', { openingFloat: '0' }).expect(200);
    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    const complete = async (marked = true) => {
      const body = {
        clientId: randomUUID(),
        lines: [
          {
            productUnitId: base(p),
            qty: marked ? '2' : '1',
            ...(marked ? { expiryBarcode: offer.barcode } : {}),
          },
        ],
        tenders: [
          { kind: 'CASH', amount: marked ? '110' : '1300', tendered: marked ? '110' : '1300' },
        ],
      };
      const receipt = (await kiosk.post('/sales', body).expect(200)).body.receipt as EdgeReceipt;
      const local = await edgeDb
        .select()
        .from(edgeSales)
        .where(eq(edgeSales.clientId, receipt.clientId));
      expect(local).toHaveLength(1);
      return { receipt, body };
    };
    const event = async (clientId: string) => {
      const rows = await edgeDb.select().from(edgeOutbox).where(eq(edgeOutbox.clientId, clientId));
      const row = rows.find((entry) => entry.kind === 'SALE' || entry.kind === 'RETURN');
      if (!row) throw new Error('completed edge document is missing its outbox event');
      return row;
    };
    return { kiosk, sync, edgeDb, approval, offer, complete, event };
  };
  const centralDocument = async (clientId: string) =>
    (
      await sql.query<{ sales: number; stock_qty: string }>(
        `SELECT (SELECT count(*)::int FROM pos_sales WHERE client_id=$1) AS sales,
       coalesce((SELECT sum(l.qty_base) FROM stock_ledger l JOIN pos_sales s
         ON l.doc_type='POS' AND l.doc_id=s.id WHERE s.client_id=$1),0)::numeric(14,3)::text AS stock_qty`,
        [clientId],
      )
    ).rows[0];
  const sourceCharges = async (itemId: number, markdownId: number) =>
    (
      await sql.query<{ rows: number; amount: string }>(
        `SELECT count(*)::int AS rows,coalesce(sum(amount),0)::numeric(14,2)::text AS amount
       FROM payroll_source_deductions WHERE source_reference=$1
       OR reverses_id IN (SELECT id FROM payroll_source_deductions WHERE source_reference=$1)`,
        [`expiry:${itemId}/markdown:${markdownId}`],
      )
    ).rows[0];
  afterEach(() => {
    jest.restoreAllMocks();
  });
  beforeAll(async () => {
    app = await createHttpApp();
    await app.listen(0, '127.0.0.1');
    sql = await connectAs('app');
    admin = (await posActors(app)).admin;
    store = await posStore(app, admin, 'EXC');
    warehouse = await inventoryApi(app, admin).warehouse('EXCWH');
    shiftClientId = (await store.openShift()).clientId;
  });
  afterAll(async () => {
    await edge?.close();
    await expectReconciled(app);
    await sql?.end();
    await app?.close();
  });

  it('publishes an actual sale-context approval with one pooled connection', async () => {
    const p = await product();
    const prior = await approve(p);
    const old = prior.commerce.markdowns[0];
    if (!old) throw new Error('missing approval');
    await http()
      .post(`/api/v1/expiry/markdowns/${old.id}/stop`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(201);
    const basis = await detail(prior.itemId);
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 1500,
    });
    const constrained = await createHttpApp({
      override: (builder) => builder.overrideProvider(DB_POOL).useValue(pool),
    });
    try {
      const published = (
        await request(constrained.getHttpServer())
          .post(`/api/v1/expiry/items/${prior.itemId}/markdowns`)
          .set(bearer(admin))
          .set(idempotency())
          .send({
            expectedVersion: basis.itemVersion,
            expectedSourceVersion: basis.sourceVersion,
            expectedCostingVersion: basis.source?.current?.version,
            expectedLiabilityFingerprint: basis.liabilityFingerprint,
            receiptLineId: prior.receiptLineId,
            qtyBase: '10',
            warehouseId: store.store.id,
            channel: 'RETAIL',
            contextId: store.till.id,
            unitPrice: '55',
            payrollMonth: old.payrollMonth,
          })
          .expect(201)
      ).body as ExpiryCommerceView;
      expect(published.markdowns).toHaveLength(2);
      expect(published.markdowns[0]).toMatchObject({
        revision: 2,
        payrollMonth: old.payrollMonth,
        contextId: store.till.id,
        qtyBudget: '10',
      });
      expect(published.markdowns[0]?.liableUserIds).toEqual(old.liableUserIds);
      expect(pool.totalCount).toBe(1);
      expect(await allocations(prior.itemId)).toEqual([]);
    } finally {
      await constrained.close();
    }
  });

  it('quotes a marked variant separately from fresh stock, then accepts its completed offline sale after stop and reverses a partial return once', async () => {
    const p = await product();
    const approval = await approve(p);
    const offer = approval.commerce.markdowns[0];
    if (!offer) throw new Error('missing approval');
    const quote = (
      await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(admin))
        .send({
          list: 'RETAIL',
          tillId: store.till.id,
          lines: [
            { productUnitId: base(p), qty: '2', expiryBarcode: offer.barcode },
            { productUnitId: base(p), qty: '1' },
          ],
        })
        .expect(200)
    ).body as { lines: { total: string }[] };
    expect(quote.lines.map((line) => line.total)).toEqual(['110.00', '1300']);
    expect(await allocations(approval.itemId)).toEqual([]);
    const doc = document(p, '2', offer.barcode);
    await http()
      .post(`/api/v1/expiry/markdowns/${offer.id}/stop`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(201);
    const [sale] = await store.replay([saleEvent(doc)]);
    expect(sale?.status).toBe('APPLIED');
    expect(await allocations(approval.itemId)).toEqual([
      { qty_base: '2.000', cost_amount: '200.00', revenue_amount: '100.00', loss_amount: '100.00' },
    ]);
    const [again] = await store.replay([saleEvent(doc)]);
    expect(again?.status).toBe('DUPLICATE');
    expect(await allocations(approval.itemId)).toHaveLength(1);
    const returned = saleDoc(
      [{ product: p, qty: '1', unitPrice: '55', refundsLineNo: 1 }],
      {
        kind: 'RETURN',
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        approvedByUserId: store.supervisorId,
        number: store.nextNumber(),
        refundsSaleClientId: doc.clientId as string,
      },
      store.retailPrice,
    );
    // No client source is needed on a return: the trusted original line supplies it.
    expect((await store.replay([saleEvent(returned)]))[0]?.status).toBe('APPLIED');
    expect((await store.replay([saleEvent(returned)]))[0]?.status).toBe('DUPLICATE');
    expect((await detail(approval.itemId)).markdowns[0]?.qtySold).toBe('1');
    const reversal = await sql.query<{ qty: string; loss: string }>(
      'select qty_base::text qty,loss_amount::text loss from expiry_return_allocations where sale_allocation_id in (select a.id from expiry_sale_allocations a join expiry_markdowns m on m.id=a.markdown_id where m.item_id=$1)',
      [approval.itemId],
    );
    expect(reversal.rows).toEqual([{ qty: '1.000', loss: '50.00' }]);
    // Another completed offline sale cannot turn insufficient provenance into a staff charge.
    const excess = document(p, '11', offer.barcode, { soldAt: doc.soldAt });
    const [accepted] = await store.replay([saleEvent(excess)]);
    expect(accepted?.status).toBe('APPLIED');
    expect(await allocations(approval.itemId)).toHaveLength(1);
    expect((await detail(approval.itemId)).exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'EXPIRY_BUDGET_EXCEEDED', qtyBase: '11' }),
      ]),
    );
    const stored = await sql.query<{ expiry_exception: string }>(
      'select expiry_exception from pos_sale_lines where sale_id=$1',
      [accepted?.id],
    );
    expect(stored.rows[0]?.expiry_exception).toBe('EXPIRY_BUDGET_EXCEEDED');
  });

  it('charges only the actual partial wholesale delivery, leaving quotes, drafts, picking and fresh lines uncharged', async () => {
    const p = await product();
    const inventory = inventoryApi(app, admin);
    const shelf = await inventory.bin(warehouse.id, 'EXP-SALE');
    await inventory.homeShelf(p.id, warehouse.id, shelf.id);
    const board = (
      await http()
        .post('/api/v1/sales-boards')
        .set(bearer(admin))
        .send({ name: 'Synthetic expiry board' })
        .expect(201)
    ).body as { id: number };
    const pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId: board.id,
          name: 'Synthetic expiry pipeline',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          kind: 'SALES',
          transferWarehouseId: null,
          roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
          stages: ['NONE', 'CONFIRM', 'PICK', 'SALE'].map((action) => ({
            name: action,
            action,
            printPickList: false,
            printDeliveryNote: false,
            roles: { VIEW: [], EDIT: [], MOVE: [] },
          })),
        })
        .expect(201)
    ).body as { id: number; stages: { id: number; action: string }[] };
    const approval = await approve(p, {
      warehouseId: warehouse.id,
      channel: 'WHOLESALE',
      contextId: pipeline.id,
    });
    const offer = approval.commerce.markdowns[0];
    if (!offer) throw new Error('missing wholesale approval');
    const customer = await partnersApi(app, admin).customer({ name: 'Synthetic expiry customer' });
    const orders = salesApi(app, admin);
    const draft = (
      await orders
        .create(
          orderBody(
            customer.id,
            [
              { productUnitId: base(p), qty: '4' },
              { productUnitId: base(p), qty: '1' },
            ],
            {
              pipelineId: pipeline.id,
              lines: [
                { productUnitId: base(p), qty: '4', expiryBarcode: offer.barcode },
                { productUnitId: base(p), qty: '1' },
              ],
            },
          ),
        )
        .expect(201)
    ).body as OrderJson;
    expect(await allocations(approval.itemId)).toEqual([]);
    await orders.submit(draft.id).expect(200);
    const pick = pipeline.stages.find((stage) => stage.action === 'PICK');
    const sell = pipeline.stages.find((stage) => stage.action === 'SALE');
    if (!pick || !sell) throw new Error('missing stages');
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/move`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ stageId: pick.id })
      .expect(200);
    const current = await orders.get(draft.id);
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/pick`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        lines: current.lines.map((line, index) => ({
          lineId: line.id,
          qty: index === 0 ? '3' : '1',
          binId: shelf.id,
        })),
      })
      .expect(200);
    expect(await allocations(approval.itemId)).toEqual([]);
    const key = idempotency();
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/move`)
      .set(bearer(admin))
      .set(key)
      .send({ stageId: sell.id })
      .expect(200);
    expect((await orders.get(draft.id)).status).toBe('INVOICED');
    expect(await allocations(approval.itemId)).toEqual([
      { qty_base: '3.000', cost_amount: '300.00', revenue_amount: '150.00', loss_amount: '150.00' },
    ]);
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/move`)
      .set(bearer(admin))
      .set(key)
      .send({ stageId: sell.id })
      .expect(200);
    expect(await allocations(approval.itemId)).toHaveLength(1);
    const original = (
      await sql.query<{ invoice_id: string; invoice_line_id: string }>(
        'select i.id::text invoice_id,l.id::text invoice_line_id from invoices i join invoice_lines l on l.invoice_id=i.id where i.order_id=$1 and l.order_line_id=$2',
        [draft.id, current.lines[0]?.id],
      )
    ).rows[0];
    if (!original) throw new Error('missing canonical invoice source');
    const correction = {
      invoiceId: Number(original.invoice_id),
      reason: 'Synthetic price correction only',
      lines: [{ invoiceLineId: Number(original.invoice_line_id), qty: '1' }],
    };
    await http()
      .post('/api/v1/credit-notes')
      .set(bearer(admin))
      .set(idempotency())
      .send(correction)
      .expect(201);
    expect((await detail(approval.itemId)).markdowns[0]?.qtySold).toBe('3');
    const returned = {
      ...correction,
      reason: 'Synthetic physical return',
      warehouseId: warehouse.id,
    };
    const returnKey = idempotency();
    await http()
      .post('/api/v1/credit-notes')
      .set(bearer(admin))
      .set(returnKey)
      .send(returned)
      .expect(201);
    await http()
      .post('/api/v1/credit-notes')
      .set(bearer(admin))
      .set(returnKey)
      .send(returned)
      .expect(201);
    expect((await detail(approval.itemId)).markdowns[0]?.qtySold).toBe('2');
    const reversals = await sql.query<{ qty: string; loss: string }>(
      'select r.qty_base::text qty,r.loss_amount::text loss from expiry_return_allocations r join expiry_sale_allocations a on a.id=r.sale_allocation_id join expiry_markdowns m on m.id=a.markdown_id where m.item_id=$1',
      [approval.itemId],
    );
    expect(reversals.rows).toEqual([{ qty: '1.000', loss: '50.00' }]);
  });

  it('uses only public approved edge snapshots, stops new checkouts locally, and replays an earlier completed sale after the stop', async () => {
    const p = await product();
    const till = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: store.store.id,
          code: 'E2',
          name: 'Synthetic expiry edge till',
          printerHost: null,
        })
        .expect(201)
    ).body as { id: number; code: string };
    const approval = await approve(p, { contextId: till.id });
    const offer = approval.commerce.markdowns[0];
    if (!offer) throw new Error('missing edge approval');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
    });
    const kiosk = kioskApi(edge);
    const sync = edge.get(SyncRunner);
    const pair = (await store.pos.pairingCode(till.id).expect(200)).body as { code: string };
    await sync.pullOnce();
    const paired = (
      await kiosk.post('/pair', { tillCode: till.code, pairingCode: pair.code }).expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    kiosk.setSession(login.token);
    await kiosk.post('/shifts/open', { openingFloat: '0' }).expect(200);
    const snapshot = (
      await store.pos
        .http()
        .get('/api/v1/pos/sync/snapshot')
        .set('Authorization', `Bearer ${store.edgeToken}`)
        .expect(200)
    ).body as { snapshot: PosSnapshot };
    const cached = snapshot.snapshot.expiryOffers?.find((row) => row.barcode === offer.barcode);
    expect(cached).toMatchObject({ productId: p.id, contextId: till.id, unitPrice: '55' });
    expect(JSON.stringify(cached)).not.toMatch(/accounting|liable|payroll|costAmount/);
    const unchanged = (
      await store.pos
        .http()
        .get('/api/v1/pos/sync/snapshot')
        .query({ since: snapshot.snapshot.version })
        .set('Authorization', `Bearer ${store.edgeToken}`)
        .expect(200)
    ).body as { changed: boolean; generatedAt?: string };
    expect(unchanged.changed).toBe(false);
    expect(Number.isFinite(Date.parse(unchanged.generatedAt ?? ''))).toBe(true);
    const quoted = (
      await kiosk
        .post('/quote', {
          lines: [
            { productUnitId: base(p), qty: '2', expiryBarcode: offer.barcode },
            { productUnitId: base(p), qty: '1' },
          ],
        })
        .expect(200)
    ).body as EdgeQuoteResponse;
    expect(quoted.lines.map((line) => line.total)).toEqual(['110.00', '1300.00']);
    const body = {
      clientId: randomUUID(),
      lines: [{ productUnitId: base(p), qty: '2', expiryBarcode: offer.barcode }],
      tenders: [{ kind: 'CASH', amount: '110', tendered: '110' }],
    };
    const completed = (await kiosk.post('/sales', body).expect(200)).body as {
      receipt: EdgeReceipt;
    };
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: [{ productUnitId: base(p), qty: '9', expiryBarcode: offer.barcode }],
        tenders: [{ kind: 'CASH', amount: '495', tendered: '495' }],
      })
      .expect(422);
    await http()
      .post(`/api/v1/expiry/markdowns/${offer.id}/stop`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(201);
    await sync.pullOnce();
    await kiosk.post('/quote', { lines: body.lines }).expect(422);
    expect(
      ((await kiosk.post('/sales', body).expect(200)).body as { receipt: EdgeReceipt }).receipt
        .clientId,
    ).toBe(completed.receipt.clientId);
    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    expect(await allocations(approval.itemId)).toEqual([
      { qty_base: '2.000', cost_amount: '200.00', revenue_amount: '100.00', loss_amount: '100.00' },
    ]);
    const tinyProduct = await product();
    const tiny = await approve(tinyProduct, { contextId: till.id, unitPrice: '0.01' });
    const tinyOffer = tiny.commerce.markdowns[0];
    if (!tinyOffer) throw new Error('missing tiny-price approval');
    await sync.pullOnce();
    const before = await edge.get(OutboxService).counts();
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: [
          { productUnitId: base(tinyProduct), qty: '0.001', expiryBarcode: tinyOffer.barcode },
        ],
        tenders: [{ kind: 'CASH', amount: '0', tendered: '0' }],
      })
      .expect(422);
    expect(await edge.get(OutboxService).counts()).toEqual(before);
    expect(await allocations(tiny.itemId)).toEqual([]);
  });

  it.each(['expiry bug', 'database timeout', 'lock timeout', 'payroll failure'] as const)(
    'keeps paid edge sales pending on %s, rolls back expiry and retries without duplicate stock or charges',
    async (failure) => {
      const ctx = await faultTill();
      // A separate ordinary sale precedes the faulty marked sale in the real outbox batch.
      const ordinary = await ctx.complete(false);
      const marked = await ctx.complete();
      const expiry = app.get(ExpiryCommerceService);
      const payroll = app.get(PayrollSourceDeductionsService);
      const recordPayroll = payroll.recordInTx.bind(payroll);
      const recordSale = expiry.recordSaleInTx.bind(expiry);
      const holder = failure === 'lock timeout' ? await connectAs('app') : undefined;
      if (holder) {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(72026240,1)');
      }
      let databaseCode: string | undefined;
      const fault =
        failure === 'payroll failure'
          ? jest.spyOn(payroll, 'recordInTx').mockImplementation(async (...args) => {
              await recordPayroll(...args);
              throw new Error('synthetic failure after liability insert');
            })
          : jest.spyOn(expiry, 'recordSaleInTx').mockImplementation(async (tx, actor, input) => {
              if (failure === 'lock timeout') {
                await tx.execute(sqlQuery`SET LOCAL lock_timeout = '25ms'`);
                try {
                  return await recordSale(tx, actor, input);
                } catch (error) {
                  const databaseError = error as { code?: string; cause?: { code?: string } };
                  databaseCode = databaseError.cause?.code ?? databaseError.code;
                  throw error;
                }
              }
              if (failure === 'database timeout') {
                await tx.execute(sqlQuery`SET LOCAL statement_timeout = '25ms'`);
                try {
                  await tx.execute(sqlQuery`SELECT pg_sleep(1)`);
                } catch (error) {
                  const databaseError = error as { code?: string; cause?: { code?: string } };
                  databaseCode = databaseError.cause?.code ?? databaseError.code;
                  throw error;
                }
                throw new Error('expected PostgreSQL statement timeout');
              }
              throw new Error('synthetic expiry programming failure');
            });
      try {
        expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'failed' });
        expect(fault).toHaveBeenCalled();
        if (failure === 'database timeout') expect(databaseCode).toBe('57014');
        if (failure === 'lock timeout') expect(databaseCode).toBe('55P03');
        expect(await ctx.event(marked.receipt.clientId)).toMatchObject({
          status: 'PENDING',
          attempts: 1,
        });
        expect(await ctx.event(ordinary.receipt.clientId)).toMatchObject({ status: 'PENDING' });
        expect(await centralDocument(ordinary.receipt.clientId)).toEqual({
          sales: 1,
          stock_qty: '-1.000',
        });
        expect(await centralDocument(marked.receipt.clientId)).toEqual({
          sales: 0,
          stock_qty: '0.000',
        });
        expect(await allocations(ctx.approval.itemId)).toEqual([]);
        expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
          rows: 0,
          amount: '0.00',
        });
        expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('0');
        expect(
          (await ctx.kiosk.post('/sales', marked.body).expect(200)).body.receipt.clientId,
        ).toBe(marked.receipt.clientId);
      } finally {
        fault.mockRestore();
        if (holder) {
          await holder.query('ROLLBACK');
          await holder.end();
        }
      }
      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
      expect(await ctx.event(marked.receipt.clientId)).toMatchObject({
        status: 'SENT',
        attempts: 2,
      });
      expect(await centralDocument(ordinary.receipt.clientId)).toEqual({
        sales: 1,
        stock_qty: '-1.000',
      });
      expect(await centralDocument(marked.receipt.clientId)).toEqual({
        sales: 1,
        stock_qty: '-2.000',
      });
      expect(await allocations(ctx.approval.itemId)).toHaveLength(1);
      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
        rows: 2,
        amount: '100.00',
      });
      expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('2');
      expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
      // Resend the already applied wire event, not just an empty outbox.
      expect(
        (await store.replay([(await ctx.event(marked.receipt.clientId)).payload]))[0]?.status,
      ).toBe('DUPLICATE');
      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
        rows: 2,
        amount: '100.00',
      });
    },
  );

  it.each([
    'missing markdown',
    'missing item',
    'missing balance',
    'replay mismatch',
    'budget bounds',
    'payroll AppError',
  ] as const)(
    'posts a paid sale despite %s, records one diagnostic and never creates an employee charge',
    async (failure) => {
      const ctx = await faultTill();
      const marked = await ctx.complete();
      const payroll = app.get(PayrollSourceDeductionsService);
      const recordPayroll = payroll.recordInTx.bind(payroll);
      const domain =
        failure === 'replay mismatch' || failure === 'budget bounds'
          ? new AppError('CONFLICT', 'synthetic expiry conflict', {
              reason:
                failure === 'replay mismatch'
                  ? 'EXPIRY_SALE_REPLAY_MISMATCH'
                  : 'EXPIRY_BUDGET_EXCEEDED',
            })
          : notFound(failure, ctx.offer.id);
      const fault =
        failure === 'payroll AppError'
          ? jest.spyOn(payroll, 'recordInTx').mockImplementation(async (...args) => {
              await recordPayroll(...args);
              throw domain;
            })
          : jest.spyOn(app.get(ExpiryCommerceService), 'recordSaleInTx').mockRejectedValue(domain);
      try {
        expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
        expect(await ctx.event(marked.receipt.clientId)).toMatchObject({ status: 'SENT' });
        expect(await centralDocument(marked.receipt.clientId)).toEqual({
          sales: 1,
          stock_qty: '-2.000',
        });
        expect(await allocations(ctx.approval.itemId)).toEqual([]);
        expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
          rows: 0,
          amount: '0.00',
        });
        expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('0');
      } finally {
        fault.mockRestore();
      }
      expect(
        (
          await sql.query('SELECT id FROM pos_sync_rejections WHERE client_id=$1', [
            marked.receipt.clientId,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
      expect(
        (await store.replay([(await ctx.event(marked.receipt.clientId)).payload]))[0]?.status,
      ).toBe('DUPLICATE');
      const diagnostics = (
        await sql.query('SELECT * FROM expiry_pos_exceptions WHERE barcode=$1', [ctx.offer.barcode])
      ).rows;
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        operation: 'SALE',
        code: domain.params?.reason ?? domain.code,
        acknowledged_at: null,
      });
      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
        rows: 0,
        amount: '0.00',
      });
      expect((await ctx.kiosk.post('/sales', marked.body).expect(200)).body.receipt.clientId).toBe(
        marked.receipt.clientId,
      );
    },
  );

  it.each(['domain rejection', 'payroll AppError', 'payroll failure'] as const)(
    'preserves a completed return through %s with explicit unresolved liability or technical retry',
    async (failure) => {
      const ctx = await faultTill();
      const marked = await ctx.complete();
      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
      const body = {
        clientId: randomUUID(),
        refundsSaleClientId: marked.receipt.clientId,
        lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
        approval: { supervisorUserId: store.supervisorId, pin: '654321' },
      };
      const returned = (await ctx.kiosk.post('/returns', body).expect(200)).body
        .receipt as EdgeReceipt;
      const payroll = app.get(PayrollSourceDeductionsService);
      const recordPayroll = payroll.recordInTx.bind(payroll);
      const fault =
        failure === 'domain rejection'
          ? jest
              .spyOn(app.get(ExpiryCommerceService), 'recordReturnInTx')
              .mockRejectedValue(notFound('expiry allocation', ctx.offer.id))
          : jest.spyOn(payroll, 'recordInTx').mockImplementation(async (...args) => {
              await recordPayroll(...args);
              if (failure === 'payroll AppError')
                throw new AppError('CONFLICT', 'synthetic payroll rejection after insert');
              throw new Error('synthetic failure after reversal insert');
            });
      try {
        expect(await ctx.sync.pushOnce()).toMatchObject(
          failure !== 'payroll failure' ? { state: 'sent', rejected: 0 } : { state: 'failed' },
        );
        expect(fault).toHaveBeenCalled();
        expect(await ctx.event(returned.clientId)).toMatchObject({
          status: failure !== 'payroll failure' ? 'SENT' : 'PENDING',
        });
        expect(await centralDocument(returned.clientId)).toEqual(
          failure === 'payroll failure'
            ? { sales: 0, stock_qty: '0.000' }
            : { sales: 1, stock_qty: '1.000' },
        );
        expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('2');
        expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
          rows: 2,
          amount: '100.00',
        });
        expect((await ctx.kiosk.post('/returns', body).expect(200)).body.receipt.clientId).toBe(
          returned.clientId,
        );
      } finally {
        fault.mockRestore();
      }
      if (failure !== 'payroll failure') {
        expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
        expect(
          (
            await sql.query('SELECT id FROM pos_sync_rejections WHERE client_id=$1', [
              returned.clientId,
            ])
          ).rows,
        ).toHaveLength(0);
        const diagnostics = (
          await sql.query('SELECT * FROM expiry_pos_exceptions WHERE barcode=$1', [
            ctx.offer.barcode,
          ])
        ).rows;
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ operation: 'RETURN', acknowledged_at: null });
        const page = (
          await http().get('/api/v1/expiry/commerce-exceptions').set(bearer(admin)).expect(200)
        ).body as { data: { id: number; origin: string; financialEffect: string }[] };
        expect(page.data).toContainEqual(
          expect.objectContaining({
            id: parseInt(diagnostics[0].id as string, 10),
            origin: 'POS_EXCEPTION',
            financialEffect: 'RETURN_REVERSAL_UNRESOLVED',
          }),
        );
        const ack = {
          origin: 'POS_EXCEPTION',
          note: 'Synthetic acknowledgement only; original charge requires separate review',
        };
        await http()
          .post(`/api/v1/expiry/commerce-exceptions/${diagnostics[0].id}/acknowledge`)
          .set(bearer(admin))
          .set(idempotency())
          .send(ack)
          .expect(201);
        await http()
          .post(`/api/v1/expiry/commerce-exceptions/${diagnostics[0].id}/acknowledge`)
          .set(bearer(admin))
          .set(idempotency())
          .send(ack)
          .expect(201);
      } else {
        expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
        expect(await ctx.event(returned.clientId)).toMatchObject({ status: 'SENT', attempts: 2 });
      }
      expect(await centralDocument(returned.clientId)).toEqual({ sales: 1, stock_qty: '1.000' });
      expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe(
        failure === 'payroll failure' ? '1' : '2',
      );
      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
        rows: failure === 'payroll failure' ? 4 : 2,
        amount: failure === 'payroll failure' ? '50.00' : '100.00',
      });
      expect((await store.replay([(await ctx.event(returned.clientId)).payload]))[0]?.status).toBe(
        'DUPLICATE',
      );
      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
        rows: failure === 'payroll failure' ? 4 : 2,
        amount: failure === 'payroll failure' ? '50.00' : '100.00',
      });
    },
  );
  it('diagnoses a marked return without an original allocation and leaves ordinary returns ordinary', async () => {
    const ctx = await faultTill();
    const marked = await ctx.complete();
    const fault = jest
      .spyOn(app.get(ExpiryCommerceService), 'recordSaleInTx')
      .mockRejectedValue(notFound('expiry markdown', ctx.offer.id));
    try {
      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    } finally {
      fault.mockRestore();
    }
    const returned = (
      await ctx.kiosk
        .post('/returns', {
          clientId: randomUUID(),
          refundsSaleClientId: marked.receipt.clientId,
          lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
          approval: { supervisorUserId: store.supervisorId, pin: '654321' },
        })
        .expect(200)
    ).body.receipt as EdgeReceipt;
    expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    expect(await centralDocument(returned.clientId)).toEqual({ sales: 1, stock_qty: '1.000' });
    expect(
      (
        await sql.query(
          'SELECT code FROM expiry_pos_exceptions WHERE barcode=$1 AND operation=$2',
          [ctx.offer.barcode, 'RETURN'],
        )
      ).rows,
    ).toEqual([{ code: 'EXPIRY_RETURN_SOURCE_MISSING' }]);
    expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
      rows: 0,
      amount: '0.00',
    });
    const ordinary = await ctx.complete(false);
    expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    await ctx.kiosk
      .post('/returns', {
        clientId: randomUUID(),
        refundsSaleClientId: ordinary.receipt.clientId,
        lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
        approval: { supervisorUserId: store.supervisorId, pin: '654321' },
      })
      .expect(200);
    expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    expect(
      (
        await sql.query('SELECT id FROM expiry_pos_exceptions WHERE barcode=$1', [
          ctx.offer.barcode,
        ])
      ).rows,
    ).toHaveLength(2);
  });

  it('pages both exception origins without losing itemless rows and guards acknowledgement rights and immutable facts', async () => {
    const sharedId = 900001;
    await sql.query(
      `INSERT INTO expiry_sale_exceptions (id,markdown_id,source_kind,sale_id,line_id,reason,input,qty_base,sold_at,created_at)
      OVERRIDING SYSTEM VALUE SELECT $1,markdown_id,'POS','pagination-legacy','1','EXPIRY_BUDGET_EXCEEDED',input,qty_base,sold_at,'2100-01-01 00:00:00.123456+00'
      FROM expiry_sale_exceptions LIMIT 1`,
      [sharedId],
    );
    await sql.query(
      `INSERT INTO expiry_pos_exceptions (id,operation,document_id,line_id,barcode,product_id,product_unit_id,warehouse_id,context_id,code,qty_base,occurred_at,created_at)
      OVERRIDING SYSTEM VALUE SELECT $1,'SALE','pagination-sidecar','1','BTOEXP-999999999',product_id,product_unit_id,warehouse_id,context_id,'NOT_FOUND',qty_base,occurred_at,'2100-01-01 00:00:00.123456+00'
      FROM expiry_pos_exceptions LIMIT 1`,
      [sharedId],
    );
    const read = async (cursor?: string) =>
      (
        await http()
          .get('/api/v1/expiry/commerce-exceptions')
          .query({ limit: 1, ...(cursor ? { cursor } : {}) })
          .set(bearer(admin))
          .expect(200)
      ).body as {
        data: { id: number; origin: string; barcode: string }[];
        nextCursor: string | null;
      };
    const first = await read();
    expect(first.data).toEqual([
      expect.objectContaining({ id: sharedId, origin: 'SALE_EXCEPTION' }),
    ]);
    const second = await read(first.nextCursor!);
    expect(second.data).toEqual([
      expect.objectContaining({
        id: sharedId,
        origin: 'POS_EXCEPTION',
        barcode: 'BTOEXP-999999999',
      }),
    ]);
    expect((await read(second.nextCursor!)).data[0]?.id).not.toBe(sharedId);
    const noRights = await customRoleUser(app, admin, []);
    await http().get('/api/v1/expiry/commerce-exceptions').set(bearer(noRights)).expect(403);
    const readOnly = await customRoleUser(app, admin, ['inventory.costs.manage']);
    await http().get('/api/v1/expiry/commerce-exceptions').set(bearer(readOnly)).expect(200);
    const route = `/api/v1/expiry/commerce-exceptions/${sharedId}/acknowledge`;
    const body = { origin: 'POS_EXCEPTION', note: 'Synthetic acknowledgement' };
    await http().post(route).set(bearer(readOnly)).set(idempotency()).send(body).expect(403);
    const scoped = (
      await login(app, await seedUser(app, { roles: ['ADMIN'], warehouseIds: [warehouse.id] }))
    ).accessToken;
    await http().get('/api/v1/expiry/commerce-exceptions').set(bearer(scoped)).expect(200);
    await http().post(route).set(bearer(scoped)).set(idempotency()).send(body).expect(403);
    expect(
      await sqlStateOf(
        sql.query('UPDATE expiry_pos_exceptions SET code=$1 WHERE id=$2', ['CONFLICT', sharedId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(sql.query('DELETE FROM expiry_pos_exceptions WHERE id=$1', [sharedId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        sql.query(
          `INSERT INTO expiry_pos_exceptions (operation,document_id,line_id,barcode,product_id,product_unit_id,warehouse_id,context_id,code,qty_base,occurred_at,acknowledged_at,acknowledged_by,acknowledgement_note)
      SELECT operation,'pre-acknowledged','1',barcode,product_id,product_unit_id,warehouse_id,context_id,code,qty_base,occurred_at,now(),(SELECT id FROM users LIMIT 1),'invalid' FROM expiry_pos_exceptions WHERE id=$1`,
          [sharedId],
        ),
      ),
    ).toBe('23514');
    await http().post(route).set(bearer(admin)).set(idempotency()).send(body).expect(201);
    expect(
      await sqlStateOf(
        sql.query('UPDATE expiry_pos_exceptions SET acknowledgement_note=$1 WHERE id=$2', [
          'changed',
          sharedId,
        ]),
      ),
    ).toBe('23514');
  });
});
