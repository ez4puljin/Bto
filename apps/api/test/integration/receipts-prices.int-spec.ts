import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi, sheetOf } from '../harness/imports';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface LineJson {
  id: number;
  enteredQty: string;
  docUnitPrice?: string | null;
  docAmount?: string | null;
  freeGoods?: boolean;
  vatAmount?: string | null;
  costAmount?: string | null;
}
interface ReceiptJson {
  id: number;
  status: string;
  costingStatus: string | null;
  costingVersion: number;
  paymentMethod: string;
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  supplierVatPayer: boolean;
  vatRatePct: string;
  supplierDocNo: string | null;
  supplierDocDate: string | null;
  lines: LineJson[];
  totals?: { docTotal: string; vatTotal: string; costTotal: string; pricedLines: number };
}

/**
 * The receipt window as one delivery note (ADR-0078): prices typed on the draft by a cost holder,
 * VAT taken out for a VAT-paying supplier, a fully priced receipt costed at posting, the payment
 * method and account, and delivery notes imported from a sheet as drafts. Synthetic data only.
 */
describe('receipt prices and payment', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let wh: WarehouseJson;
  let vatSupplier: number;
  let plainSupplier: number;
  let water: ProductJson;
  let juice: ProductJson;
  let cashBox: number;
  let bank: number;
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/receipts').set(bearer(token)).set(idempotency()).send(body);
  const get = async (token: string, id: number) =>
    (await http().get(`/api/v1/receipts/${id}`).set(bearer(token)).expect(200)).body as ReceiptJson;
  const patchLine = (token: string, id: number, body: Record<string, unknown>) =>
    http().patch(`/api/v1/receipt-lines/${id}`).set(bearer(token)).send(body);
  const post = (token: string, id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(token)).set(idempotency());
  const avgOf = async (productId: number) =>
    (
      await sql.query<{ avg_cost: string; on_hand: string }>(
        'SELECT avg_cost, on_hand FROM warehouse_stock WHERE product_id = $1 AND warehouse_id = $2',
        [productId, wh.id],
      )
    ).rows[0];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('RP1');
    const partners = partnersApi(app, admin);
    vatSupplier = (await partners.supplier({ name: 'НӨАТ Нийлүүлэгч РП', vatPayer: true })).id;
    plainSupplier = (await partners.supplier({ name: 'Энгийн Нийлүүлэгч РП' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ус РП');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    water = await catalog.product({
      sku: '7701',
      name: 'Ус РП',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '12' }],
    });
    juice = await catalog.product({
      sku: '7702',
      name: 'Жүүс РП',
      categoryId: category,
      baseUomId: pcs,
    });
    const finance = financeApi(app, admin);
    const cashGl = await finance.account('100101');
    const bankGl = await finance.account('110101');
    cashBox = (
      (
        await finance
          .createMoneyAccount({
            code: 'RP-CASH',
            name: 'Касс РП',
            kind: 'CASH',
            glAccountId: cashGl.id,
          })
          .expect(201)
      ).body as { id: number }
    ).id;
    bank = (
      (
        await finance
          .createMoneyAccount({
            code: 'RP-BANK',
            name: 'Банк РП',
            kind: 'BANK',
            glAccountId: bankGl.id,
          })
          .expect(201)
      ).body as { id: number }
    ).id;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('takes the VAT out of a VAT payer’s prices and costs a fully priced receipt at posting', async () => {
    const draft = (
      await create(admin, {
        warehouseId: wh.id,
        supplierId: vatSupplier,
        supplierDocNo: 'P-1',
        supplierDocDate: today,
        lines: [
          { productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' },
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '5', freeGoods: true },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft).toMatchObject({
      supplierVatPayer: true,
      vatRatePct: '10',
      paymentMethod: 'CREDIT',
    });
    expect(draft.lines[0]).toMatchObject({
      docUnitPrice: '13200.00',
      docAmount: '26400.00',
      vatAmount: '2400.00',
      costAmount: '24000.00',
    });
    expect(draft.totals).toEqual({
      docTotal: '26400.00',
      vatTotal: '2400.00',
      costTotal: '24000.00',
      pricedLines: 2,
    });
    // A price per unit follows a new quantity.
    const [line] = draft.lines;
    if (!line) throw new Error('no line');
    const changed = (await patchLine(admin, line.id, { enteredQty: '3' }).expect(200))
      .body as ReceiptJson;
    expect(changed.lines[0]).toMatchObject({ docAmount: '39600.00', costAmount: '36000.00' });

    const posted = (await post(admin, draft.id).expect(200)).body as ReceiptJson;
    expect(posted).toMatchObject({ status: 'POSTED', costingStatus: 'COSTED', costingVersion: 1 });
    // 36 pieces at 36,000 ex-VAT: 1,000 each.
    expect(await avgOf(water.id)).toMatchObject({ on_hand: '36.000', avg_cost: '1000.0000' });
    const costing = (
      await http().get(`/api/v1/receipts/${draft.id}/costing`).set(bearer(admin)).expect(200)
    ).body as { total: string; docTotal: string; lines: { docAmount: string; amount: string }[] };
    expect(costing).toMatchObject({ total: '36000.00', docTotal: '39600.00' });
  });

  it('keeps a non-VAT supplier’s price as the cost and leaves a partly priced receipt pending', async () => {
    const draft = (
      await create(admin, {
        warehouseId: wh.id,
        supplierId: plainSupplier,
        lines: [
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '10', docAmount: '25000' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '4' },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft).toMatchObject({ supplierVatPayer: false, vatRatePct: '0' });
    expect(draft.totals).toMatchObject({ docTotal: '25000.00', vatTotal: '0.00', pricedLines: 1 });
    const posted = (await post(admin, draft.id).expect(200)).body as ReceiptJson;
    expect(posted).toMatchObject({ costingStatus: 'PENDING', costingVersion: 0 });
    // The accountant's costing starts from the typed price and takes delivery-note amounts.
    const costing = (
      await http().get(`/api/v1/receipts/${draft.id}/costing`).set(bearer(admin)).expect(200)
    ).body as { costingVersion: number; lines: { lineId: number; docAmount: string | null }[] };
    expect(costing.lines.map((row) => row.docAmount)).toEqual(['25000.00', null]);
    const [first, second] = costing.lines;
    if (!first || !second) throw new Error('two lines expected');
    await http()
      .put(`/api/v1/receipts/${draft.id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 0,
        lines: [
          { lineId: first.lineId, amount: '25000' },
          { lineId: second.lineId, unitPrice: '1100' },
        ],
      })
      .expect(200);
    const after = await get(admin, draft.id);
    expect(after).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    expect(after.lines.map((row) => row.costAmount)).toEqual(['25000.00', '4400.00']);
  });

  it('never shows or takes prices from a user without the cost right', async () => {
    const draft = (
      await create(worker, {
        warehouseId: wh.id,
        supplierId: vatSupplier,
        lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft.totals).toBeUndefined();
    expect(Object.keys(draft.lines[0] ?? {})).not.toContain('docAmount');
    const [line] = draft.lines;
    if (!line) throw new Error('no line');
    const refused = await patchLine(worker, line.id, { docUnitPrice: '500' }).expect(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
    await create(worker, {
      warehouseId: wh.id,
      supplierId: vatSupplier,
      lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1', docAmount: '500' }],
    }).expect(403);
    // An admin prices the same draft; the warehouse still sees no price after posting.
    await patchLine(admin, line.id, { docAmount: '550' }).expect(200);
    await post(worker, draft.id).expect(200);
    const seen = await get(worker, draft.id);
    expect(seen).toMatchObject({ costingStatus: 'COSTED' });
    expect(JSON.stringify(seen)).not.toMatch(/docAmount|costAmount|totals/);
  });

  it('names a cash box or bank account for a paid receipt, none on credit', async () => {
    const accounts = (
      await http().get('/api/v1/receipts/payment-accounts').set(bearer(worker)).expect(200)
    ).body as { id: number; kind: string }[];
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cashBox, kind: 'CASH' }),
        expect.objectContaining({ id: bank, kind: 'BANK' }),
      ]),
    );
    const base = {
      warehouseId: wh.id,
      supplierId: plainSupplier,
      lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '2' }],
    };
    await create(admin, { ...base, paymentMethod: 'CREDIT', moneyAccountId: cashBox }).expect(422);
    await create(admin, { ...base, paymentMethod: 'CASH', moneyAccountId: bank }).expect(422);
    const cash = (await create(admin, { ...base, paymentMethod: 'CASH' }).expect(201))
      .body as ReceiptJson;
    const missing = await post(admin, cash.id).expect(422);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const named = (
      await http()
        .patch(`/api/v1/receipts/${cash.id}`)
        .set(bearer(admin))
        .send({ moneyAccountId: cashBox })
        .expect(200)
    ).body as ReceiptJson;
    expect(named).toMatchObject({ paymentMethod: 'CASH', moneyAccountName: 'Касс РП' });
    await post(admin, cash.id).expect(200);
    // Back to credit on another draft drops the account.
    const other = (
      await create(admin, { ...base, paymentMethod: 'BANK', moneyAccountId: bank }).expect(201)
    ).body as ReceiptJson;
    const credit = (
      await http()
        .patch(`/api/v1/receipts/${other.id}`)
        .set(bearer(admin))
        .send({ paymentMethod: 'CREDIT' })
        .expect(200)
    ).body as ReceiptJson;
    expect(credit).toMatchObject({ paymentMethod: 'CREDIT', moneyAccountId: null });
  });

  it('imports delivery notes from a sheet as drafts and takes them back while untouched', async () => {
    const imports = importsApi(app, admin);
    const options = {
      receiptOptions: { warehouseId: wh.id, paymentMethod: 'CREDIT', moneyAccountId: null },
    };
    const job = await imports.check(
      'RECEIPTS',
      [
        {
          date: today,
          supplier: 'НӨАТ Нийлүүлэгч РП',
          docNo: 'X-1',
          sku: '7701',
          unit: 'хайрцаг',
          qty: '1',
          unitPrice: '13200',
        },
        {
          date: today,
          supplier: 'НӨАТ Нийлүүлэгч РП',
          docNo: 'X-1',
          sku: '7702',
          qty: '6',
          unitPrice: '1100',
        },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'Y-9', sku: '7702', qty: '3' },
      ],
      options,
    );
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    const committed = await imports.commit(job.id);
    expect(committed.status).toBe('COMMITTED');
    const { rows } = await sql.query<{ id: number; supplier_doc_no: string; lines: string }>(
      `SELECT r.id, r.supplier_doc_no, count(l.id)::text AS lines
         FROM goods_receipts r JOIN goods_receipt_lines l ON l.receipt_id = r.id
        WHERE r.supplier_doc_no IN ('X-1', 'Y-9') AND r.status = 'DRAFT'
        GROUP BY r.id ORDER BY r.supplier_doc_no`,
    );
    expect(rows.map((row) => [row.supplier_doc_no, row.lines])).toEqual([
      ['X-1', '2'],
      ['Y-9', '1'],
    ]);
    const x1 = await get(admin, rows[0]?.id ?? 0);
    expect(x1.totals).toMatchObject({ docTotal: '19800.00', vatTotal: '1800.00', pricedLines: 2 });
    const reverted = await imports.revert(job.id);
    expect(reverted.status).toBe('REVERTED');
    const { rows: left } = await sql.query<{ status: string }>(
      `SELECT status FROM goods_receipts WHERE supplier_doc_no IN ('X-1', 'Y-9')`,
    );
    expect(left.map((row) => row.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });

  it('refuses a sheet row it cannot place and keeps a posted import receipt', async () => {
    const imports = importsApi(app, admin);
    const options = {
      receiptOptions: { warehouseId: wh.id, paymentMethod: 'CREDIT', moneyAccountId: null },
    };
    const bad = await imports.check(
      'RECEIPTS',
      [
        { date: '2026-13-01', supplier: 'Байхгүй ХХК', sku: '0000', qty: '1' },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', qty: '0' },
      ],
      options,
    );
    expect(bad.status).toBe('INVALID');
    const issues = (await imports.rows(bad.id, 'ERRORS')).flatMap((row) =>
      row.errors.map((issue) => `${row.rowNo}:${issue.column}:${issue.code}`),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        '2:date:FORMAT',
        '2:supplier:NOT_FOUND',
        '2:sku:NOT_FOUND',
        '3:sku:REQUIRED',
        '3:qty:NOT_POSITIVE',
      ]),
    );
    const good = await imports.check(
      'RECEIPTS',
      [{ date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'Z-5', sku: '7702', qty: '2' }],
      options,
    );
    await imports.commit(good.id);
    const { rows } = await sql.query<{ id: number }>(
      `SELECT id FROM goods_receipts WHERE supplier_doc_no = 'Z-5'`,
    );
    await post(worker, rows[0]?.id ?? 0).expect(200);
    const kept = await imports.revert(good.id);
    expect(kept.status).toBe('COMMITTED');
    expect(kept.lastError).toMatchObject({ code: 'IMPORT_REVERT_BLOCKED' });
    // A receipts import needs its warehouse.
    const fileId = await imports.upload(
      await sheetOf('RECEIPTS', [
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', sku: '7702', qty: '1' },
      ]),
    );
    await http()
      .post('/api/v1/imports')
      .set(bearer(admin))
      .set(idempotency())
      .send({ kind: 'RECEIPTS', fileId, fileName: 'r.xlsx' })
      .expect(422);
  });
});
