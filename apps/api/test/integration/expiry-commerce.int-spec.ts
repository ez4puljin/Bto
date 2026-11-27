import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ExpiryCommerceView } from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import {
  EXPIRY_SALE_CONTEXTS,
  ExpiryCommerceService,
  type ExpirySaleInput,
  type ExpirySaleContexts,
} from '../../src/modules/expiry';
import { UserNamesService } from '../../src/modules/identity';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, codeOf, idempotency, type ProductJson } from '../harness/catalog';
import { approveExpiry } from '../harness/expiry-commerce';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, staffContext } from '../harness/inventory';

/** Real receipt/expiry/payroll writes with a deterministic public context adapter. Actual POS and
 * wholesale posting are exercised separately by their integration suites. */
describe('expiry commerce: proven sold units only', () => {
  let app: NestExpressApplication,
    db: Db,
    sql: Client,
    admin: string,
    staff: string,
    adminId: number;
  let warehouseId: number,
    category: number,
    pcs: number,
    serial = 882000;
  let people: number[];
  const http = () => request(app.getHttpServer());
  const contexts: ExpirySaleContexts = {
    list: () =>
      Promise.resolve([{ warehouseId, channel: 'RETAIL', contextId: 456, name: 'Synthetic till' }]),
    quote: (_tx, _product, _context, override) =>
      Promise.resolve({
        unitPrice: (override ?? new Decimal(150)).toFixed(2),
        netUnitPrice: (override ?? new Decimal(150)).toFixed(2),
      }),
  };
  const product = async (): Promise<ProductJson> =>
    catalogApi(app, admin).product({
      sku: String(++serial),
      name: 'Synthetic expiry product',
      categoryId: category,
      baseUomId: pcs,
    });
  const fixture = async (
    extra: {
      qty?: string;
      costAmount?: string;
      unitPrice?: string;
      freeGoods?: boolean;
      purchaseDiscount?: string;
    } = {},
  ) => {
    const p = await product();
    const unit = p.units.find((row) => row.isBase);
    if (!unit) throw new Error('base unit missing');
    const result = await approveExpiry(app, admin, {
      productId: p.id,
      productUnitId: unit.id,
      receiptWarehouseId: warehouseId,
      warehouseId,
      channel: 'RETAIL',
      contextId: 456,
      liableUserIds: extra.freeGoods ? [] : people,
      ...extra,
    });
    const markdown = result.commerce.markdowns[0];
    if (!markdown) throw new Error('approval missing');
    return { ...result, product: p, markdown };
  };
  const sale = (
    f: Awaited<ReturnType<typeof fixture>>,
    id: string,
    qty = '1',
  ): ExpirySaleInput => ({
    barcode: f.markdown.barcode,
    sourceKind: 'POS',
    saleId: id,
    lineId: '1',
    productId: f.product.id,
    productUnitId: f.markdown.productUnitId,
    warehouseId,
    channel: 'RETAIL',
    contextId: 456,
    qtyBase: new Decimal(qty),
    grossAmount: new Decimal(f.markdown.unitPrice).mul(qty),
    revenueAmount: new Decimal(f.markdown.unitPrice).mul(qty),
    soldAt: new Date(),
  });
  const record = (input: ExpirySaleInput) =>
    inTransaction(db, (tx) =>
      app.get(ExpiryCommerceService).recordSaleInTx(tx, staffContext(adminId, 'ADMIN'), input),
    );
  const detail = async (id: number) =>
    (await http().get(`/api/v1/expiry/items/${id}/commerce`).set(bearer(admin)).expect(200))
      .body as ExpiryCommerceView;
  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(EXPIRY_SALE_CONTEXTS).useValue(contexts),
    });
    db = app.get<Db>(DB);
    sql = await connectAs('app');
    const user = await seedUser(app, { roles: ['ADMIN'] });
    adminId = user.id;
    admin = (await login(app, user)).accessToken;
    staff = (await login(app, await seedUser(app))).accessToken;
    people = [(await seedUser(app)).id, (await seedUser(app)).id].sort((a, b) => a - b);
    warehouseId = (await inventoryApi(app, admin).warehouse('EXPC')).id;
    category = await catalogApi(app, admin).category('Synthetic expiry');
    pcs = await catalogApi(app, admin).uomId('PCS');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('keeps acquisition/payroll data off ordinary shelf and cashier reads', async () => {
    const f = await fixture();
    await http().get(`/api/v1/expiry/items/${f.itemId}/commerce`).set(bearer(staff)).expect(403);
    await http()
      .get(`/api/v1/expiry/items/${f.itemId}/receipt-sources`)
      .set(bearer(staff))
      .expect(403);
    const ordinary = (
      await http().get(`/api/v1/expiry/items/${f.itemId}`).set(bearer(staff)).expect(200)
    ).body as Record<string, unknown>;
    expect(ordinary).not.toHaveProperty('source');
    expect(ordinary).not.toHaveProperty('accountingUnitCost');
    const snapshot = await app.get(ExpiryCommerceService).snapshots(db, { warehouseId });
    expect(JSON.stringify(snapshot)).not.toMatch(/accounting|liableUser|payrollMonth|receiptLine/);
    expect(f.commerce.source?.first).toMatchObject({
      qtyBase: '10',
      grossAmount: '1000',
      freeGoods: false,
    });
    expect(f.commerce.source?.current?.unitCost).toBe('100.00000000');
    const costOnly = await customRoleUser(app, admin, ['inventory.costs.manage']);
    const redacted = (
      await http()
        .get(`/api/v1/expiry/items/${f.itemId}/commerce`)
        .set(bearer(costOnly))
        .expect(200)
    ).body as ExpiryCommerceView;
    expect(redacted.liabilityFingerprint).toBeNull();
    expect(redacted.liableUsers).toEqual([]);
    expect(redacted.markdowns[0]).toMatchObject({ payrollMonth: null, liableUserIds: [] });
  });
  it('does not charge on publication; finalized quantities and exact replay charge once', async () => {
    const f = await fixture();
    expect(
      (
        await sql.query('SELECT id FROM payroll_source_deductions WHERE source_reference=$1', [
          `expiry:${f.itemId}/markdown:${f.markdown.id}`,
        ])
      ).rows,
    ).toHaveLength(0);
    const input = sale(f, 'once', '2');
    const first = await record(input);
    expect(first.allocated).toBe(true);
    expect(await record(input)).toEqual(first);
    expect(await codeOf(record({ ...input, revenueAmount: new Decimal(90) }))).toBe('CONFLICT');
    const obligations = (
      await sql.query<{ amount: string }>(
        'SELECT amount::text FROM payroll_source_deductions WHERE source_reference=$1 ORDER BY user_id',
        [`expiry:${f.itemId}/markdown:${f.markdown.id}`],
      )
    ).rows;
    expect(obligations.map((row) => row.amount)).toEqual(['50.00', '50.00']);
    expect((await detail(f.itemId)).markdowns[0]?.qtySold).toBe('2');
    const audit = (
      await sql.query<{ after: unknown }>(
        'SELECT "after" FROM audit_log WHERE entity IN ($1,$2,$3)',
        ['expiry_markdowns', 'expiry_sale_allocations', 'payroll_source_deductions'],
      )
    ).rows;
    expect(JSON.stringify(audit)).not.toMatch(/accountingAmount|costAmount|lossAmount|"amount"/);
  });
  it('freezes acquisition version and employees when later corrections change them', async () => {
    const f = await fixture();
    await http()
      .put(`/api/v1/receipts/${f.receiptId}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 1,
        noteTotalAmount: '1200',
        lines: [{ lineId: f.receiptLineId, amount: '1200' }],
      })
      .expect(200);
    await http()
      .put(`/api/v1/expiry/items/${f.itemId}/liability`)
      .set(bearer(admin))
      .send({ type: 'NONE', roleIds: [], userIds: [] })
      .expect(200);
    const now = await detail(f.itemId);
    expect(now.source?.first?.grossAmount).toBe('1000');
    expect(now.source?.current?.accountingAmount).toBe('1200');
    expect(now.markdowns[0]?.accountingUnitCost).toBe('100.00000000');
    await record(sale(f, 'frozen'));
    expect(
      (
        await sql.query<{ loss_amount: string }>(
          'SELECT loss_amount::text FROM expiry_sale_allocations WHERE markdown_id=$1',
          [f.markdown.id],
        )
      ).rows[0]?.loss_amount,
    ).toBe('50.00');
    expect((await detail(f.itemId)).markdowns[0]?.liableUserIds).toEqual(people);
  });
  it('records over-budget offline sales durably without charge; replay and resolution stay explicit', async () => {
    const f = await fixture({ qty: '1', costAmount: '100' });
    await record(sale(f, 'last-proven'));
    const excess = sale(f, 'excess');
    const result = await record(excess);
    expect(result).toMatchObject({ allocated: false, reason: 'EXPIRY_BUDGET_EXCEEDED' });
    expect(await record(excess)).toEqual(result);
    const view = await detail(f.itemId);
    expect(view.exceptions).toHaveLength(1);
    expect(view.markdowns[0]?.qtySold).toBe('1');
    const exception = view.exceptions[0];
    if (!exception) throw new Error('exception missing');
    await http()
      .post(`/api/v1/expiry/sale-exceptions/${exception.id}/resolve`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ note: 'Physical source quantity was exhausted; no employee charge' })
      .expect(201);
    expect((await detail(f.itemId)).exceptions[0]?.resolvedAt).not.toBeNull();
    expect(await record(excess)).toEqual(result);
    expect(
      (await sql.query('SELECT id FROM expiry_sale_allocations WHERE sale_id=$1', ['excess'])).rows,
    ).toHaveLength(0);
  });
  it('uses exact cost ratio for sold quantity and reverses partial returns to the final original cent', async () => {
    const f = await fixture({ qty: '3', costAmount: '1', unitPrice: '0.01' });
    await record(sale(f, 'thirds', '3'));
    const original = (
      await sql.query<{ loss_amount: string; cost_amount: string }>(
        'SELECT loss_amount::text,cost_amount::text FROM expiry_sale_allocations WHERE sale_id=$1',
        ['thirds'],
      )
    ).rows[0];
    expect(original?.cost_amount).toBe('1.00');
    expect(original?.loss_amount).toBe('0.97');
    for (let i = 0; i < 3; i++) {
      const input = {
        sourceKind: 'POS' as const,
        saleId: 'thirds',
        lineId: '1',
        returnId: `third-return-${i}`,
        returnLineId: '1',
        qtyBase: new Decimal(1),
        returnedAt: new Date(),
      };
      await inTransaction(db, (tx) =>
        app.get(ExpiryCommerceService).recordReturnInTx(tx, staffContext(adminId, 'ADMIN'), input),
      );
      await inTransaction(db, (tx) =>
        app.get(ExpiryCommerceService).recordReturnInTx(tx, staffContext(adminId, 'ADMIN'), input),
      );
    }
    expect((await detail(f.itemId)).markdowns[0]?.qtySold).toBe('0');
    expect(
      (
        await sql.query<{ total: string }>(
          'SELECT sum(amount)::text AS total FROM payroll_source_deductions WHERE source_key LIKE $1',
          [`%third%`],
        )
      ).rows[0]?.total,
    ).toBe('0.00');
    expect(
      await codeOf(
        inTransaction(db, (tx) =>
          app.get(ExpiryCommerceService).recordReturnInTx(tx, staffContext(adminId, 'ADMIN'), {
            sourceKind: 'POS',
            saleId: 'thirds',
            lineId: '1',
            returnId: 'too-many',
            returnLineId: '1',
            qtyBase: new Decimal(1),
            returnedAt: new Date(),
          }),
        ),
      ),
    ).toBe('CONFLICT');
  });
  it('does not invent a paid loss for explicit supplier free goods', async () => {
    const f = await fixture({ freeGoods: true, unitPrice: '1' });
    expect(f.commerce.source?.promotionEvidence).toBe('FREE_GOODS');
    await record(sale(f, 'free-source'));
    expect(
      (
        await sql.query<{ loss_amount: string }>(
          'SELECT loss_amount::text FROM expiry_sale_allocations WHERE sale_id=$1',
          ['free-source'],
        )
      ).rows[0]?.loss_amount,
    ).toBe('0.00');
  });
  it('returns concurrently as app while immutable sale evidence keeps UPDATE revoked', async () => {
    const permissions = (
      await sql.query<{ can_update: boolean }>(
        "SELECT has_table_privilege(current_user,'expiry_sale_allocations','UPDATE') AS can_update",
      )
    ).rows[0];
    expect(permissions?.can_update).toBe(false);
    const f = await fixture({ qty: '2', costAmount: '200' });
    await record(sale(f, 'parallel-returns-sale', '2'));
    await Promise.all(
      ['a', 'b'].map((suffix) =>
        inTransaction(db, (tx) =>
          app.get(ExpiryCommerceService).recordReturnInTx(tx, staffContext(adminId, 'ADMIN'), {
            sourceKind: 'POS',
            saleId: 'parallel-returns-sale',
            lineId: '1',
            returnId: `parallel-returns-${suffix}`,
            returnLineId: '1',
            qtyBase: new Decimal(1),
            returnedAt: new Date(),
          }),
        ),
      ),
    );
    expect((await detail(f.itemId)).markdowns[0]?.qtySold).toBe('0');
    const sum = (
      await sql.query<{ amount: string }>(
        'SELECT sum(amount)::text AS amount FROM payroll_source_deductions WHERE source_key LIKE $1',
        ['%parallel-returns%'],
      )
    ).rows[0];
    expect(sum?.amount).toBe('0.00');
  });
  it('shows purchase-discount evidence separately from acquisition stock cost', async () => {
    const f = await fixture({ purchaseDiscount: '100' });
    expect(f.commerce.source?.promotionEvidence).toBe('DISCOUNT');
    expect(f.commerce.source?.first).toMatchObject({
      grossAmount: '1000',
      discountAmount: '100',
      freeGoods: false,
    });
    expect(f.commerce.source?.current).toMatchObject({
      accountingAmount: '1000',
      supplierNetAmount: '900',
      unitCost: '100.00000000',
    });
  });
  it('expands real role IDs and explicit active users with deduplication', async () => {
    const disabled = await seedUser(app, { status: 'DISABLED' });
    const role = (await sql.query<{ id: string }>("SELECT id::text FROM roles WHERE code='ADMIN'"))
      .rows[0];
    if (!role) throw new Error('admin role missing');
    const expanded = await inTransaction(db, (tx) =>
      app
        .get(UserNamesService)
        .activeLiableUsers([Number.parseInt(role.id, 10)], [adminId, disabled.id], false, tx),
    );
    expect(expanded.filter((user) => user.id === adminId)).toHaveLength(1);
    expect(expanded.some((user) => user.id === disabled.id)).toBe(false);
    expect(expanded.map((user) => user.id)).toEqual(
      expanded.map((user) => user.id).sort((a, b) => a - b),
    );
  });
  it('serializes opposing multibarcode port batches before financial rows', async () => {
    const a = await fixture(),
      b = await fixture();
    await Promise.all(
      [
        [a, b],
        [b, a],
      ].map((fixtures, batch) =>
        inTransaction(db, async (tx) => {
          for (const [index, f] of fixtures.entries())
            await app
              .get(ExpiryCommerceService)
              .recordSaleInTx(tx, staffContext(adminId, 'ADMIN'), {
                ...sale(f, `batch-${batch}`),
                lineId: String(index),
              });
        }),
      ),
    );
    expect((await detail(a.itemId)).markdowns[0]?.qtySold).toBe('2');
    expect((await detail(b.itemId)).markdowns[0]?.qtySold).toBe('2');
  });
  it('guards immutable finance history, source over-allocation, finite values and unsafe price overrides', async () => {
    const f = await fixture();
    expect(
      await sqlStateOf(
        sql.query('UPDATE expiry_markdowns SET unit_price=1 WHERE id=$1', [f.markdown.id]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(sql.query('DELETE FROM expiry_markdowns WHERE id=$1', [f.markdown.id])),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        sql.query('UPDATE expiry_markdown_balances SET qty_sold=999 WHERE markdown_id=$1', [
          f.markdown.id,
        ]),
      ),
    ).toBe('23514');
    expect(await codeOf(record({ ...sale(f, 'nan'), qtyBase: new Decimal('NaN') }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await record({
        ...sale(f, 'manual-override'),
        grossAmount: new Decimal(1),
        revenueAmount: new Decimal(1),
      }),
    ).toMatchObject({ allocated: false, reason: 'EXPIRY_PRICE_MISMATCH' });
    const duplicate = (
      await http()
        .post('/api/v1/expiry/items')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          productId: f.product.id,
          expiryDate: businessDate(),
          qtyFloor: '1',
          qtyWarehouse: '0',
          allowDuplicate: true,
        })
        .expect(201)
    ).body as { id: number };
    expect((await detail(duplicate.id)).source).toBeNull();
    await http()
      .put(`/api/v1/expiry/items/${duplicate.id}/source`)
      .set(bearer(admin))
      .send({ expectedVersion: 0, receiptLineId: f.receiptLineId, qtyBase: '1' })
      .expect(422);
  });
  it('refuses standalone sale/return evidence without the matching bounded balance update', async () => {
    const f = await fixture({ qty: '1', costAmount: '100' });
    const shares = people.map((userId) => ({ userId, amount: '25.00' }));
    expect(
      await sqlStateOf(
        sql.query(
          `INSERT INTO expiry_sale_allocations(markdown_id,source_kind,sale_id,line_id,source_key,qty_base,cost_amount,revenue_amount,loss_amount,shares,sold_at,input)
      VALUES($1,'POS','standalone','1','standalone',1,100,50,50,$2::jsonb,now(),'{}')`,
          [f.markdown.id, JSON.stringify(shares)],
        ),
      ),
    ).toBe('23514');
    expect(
      (await sql.query('SELECT id FROM expiry_sale_allocations WHERE sale_id=$1', ['standalone']))
        .rows,
    ).toHaveLength(0);
    const allocation = await record(sale(f, 'real-before-standalone-return'));
    expect(allocation.allocated).toBe(true);
    expect(
      await sqlStateOf(
        sql.query(
          `INSERT INTO expiry_return_allocations(sale_allocation_id,source_key,qty_base,loss_amount,shares,returned_at)
      VALUES($1,'standalone-return',1,50,$2::jsonb,now())`,
          [
            allocation.allocationId,
            JSON.stringify(people.map((userId) => ({ userId, amount: '-25.00' }))),
          ],
        ),
      ),
    ).toBe('23514');
    expect((await detail(f.itemId)).markdowns[0]?.qtySold).toBe('1');
  });
  it('archival withdraws labels permanently while preserving genuine earlier offline sales', async () => {
    const f = await fixture();
    const historical = sale(f, 'before-archive');
    await http()
      .put(`/api/v1/expiry/items/${f.itemId}/status`)
      .set(bearer(admin))
      .send({ status: 'ARCHIVED' })
      .expect(200);
    expect(
      (await app.get(ExpiryCommerceService).snapshots(db, { warehouseId })).some(
        (row) => row.id === f.markdown.id,
      ),
    ).toBe(false);
    expect(await record(historical)).toMatchObject({ allocated: true });
    expect(await record(sale(f, 'after-archive'))).toMatchObject({
      allocated: false,
      reason: 'EXPIRY_APPROVAL_INVALID',
    });
    await http()
      .put(`/api/v1/expiry/items/${f.itemId}/status`)
      .set(bearer(admin))
      .send({ status: 'REVIEW' })
      .expect(200);
    expect(
      (await app.get(ExpiryCommerceService).snapshots(db, { warehouseId })).some(
        (row) => row.id === f.markdown.id,
      ),
    ).toBe(false);
  });
  it('rejects unsupported zero/below-cost no-liability publication and permits an above-cost price-only revision', async () => {
    const f = await fixture();
    await http()
      .post(`/api/v1/expiry/markdowns/${f.markdown.id}/stop`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(201);
    await http()
      .put(`/api/v1/expiry/items/${f.itemId}/liability`)
      .set(bearer(admin))
      .send({ type: 'NONE', roleIds: [], userIds: [] })
      .expect(200);
    const basis = await detail(f.itemId);
    const body = {
      expectedVersion: 1,
      expectedSourceVersion: basis.sourceVersion,
      expectedCostingVersion: basis.source?.current?.version ?? 0,
      expectedLiabilityFingerprint: basis.liabilityFingerprint,
      receiptLineId: f.receiptLineId,
      qtyBase: '10',
      warehouseId,
      channel: 'RETAIL',
      contextId: 456,
      unitPrice: '50',
    };
    await http()
      .post(`/api/v1/expiry/items/${f.itemId}/markdowns`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...body, payrollMonth: businessDate().slice(0, 7) })
      .expect(422);
    await http()
      .post(`/api/v1/expiry/items/${f.itemId}/markdowns`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...body, unitPrice: '0' })
      .expect(422);
    const after = (
      await http()
        .post(`/api/v1/expiry/items/${f.itemId}/markdowns`)
        .set(bearer(admin))
        .set(idempotency())
        .send({ ...body, unitPrice: '150' })
        .expect(201)
    ).body as ExpiryCommerceView;
    expect(after.markdowns[0]).toMatchObject({
      unitPrice: '150',
      liableUserIds: [],
      payrollMonth: null,
    });
  });
  it('requires the exact source, costing and liability basis reviewed by the operator', async () => {
    const f = await fixture();
    await http()
      .post(`/api/v1/expiry/markdowns/${f.markdown.id}/stop`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(201);
    const old = f.commerce;
    const body = {
      expectedVersion: old.itemVersion,
      expectedSourceVersion: old.sourceVersion,
      expectedCostingVersion: old.source?.current?.version,
      expectedLiabilityFingerprint: old.liabilityFingerprint,
      receiptLineId: f.receiptLineId,
      qtyBase: '10',
      warehouseId,
      channel: 'RETAIL',
      contextId: 456,
      unitPrice: '50',
      payrollMonth: businessDate().slice(0, 7),
    };
    const post = (value: Record<string, unknown>) =>
      http()
        .post(`/api/v1/expiry/items/${f.itemId}/markdowns`)
        .set(bearer(admin))
        .set(idempotency())
        .send(value);
    await post({ ...body, expectedSourceVersion: old.sourceVersion + 1 }).expect(409);
    await http()
      .put(`/api/v1/receipts/${f.receiptId}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 1,
        noteTotalAmount: '1200',
        lines: [{ lineId: f.receiptLineId, amount: '1200' }],
      })
      .expect(200);
    await post(body).expect(409);
    const changedCost = await detail(f.itemId);
    await http()
      .put(`/api/v1/expiry/items/${f.itemId}/liability`)
      .set(bearer(admin))
      .send({ type: 'NONE', roleIds: [], userIds: [] })
      .expect(200);
    await post({ ...body, expectedCostingVersion: changedCost.source?.current?.version }).expect(
      409,
    );
    expect((await detail(f.itemId)).markdowns).toHaveLength(1);
    expect(
      (
        await sql.query('SELECT id FROM payroll_source_deductions WHERE source_reference=$1', [
          `expiry:${f.itemId}/markdown:${f.markdown.id}`,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
