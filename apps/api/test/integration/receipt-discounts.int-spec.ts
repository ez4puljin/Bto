import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface LineJson {
  id: number;
  productId: number;
  discountAmount?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  costAmount?: string | null;
}
interface DiscountJson {
  id: number;
  kind: 'LINES' | 'NOTE';
  pct: string | null;
  amount: string | null;
  lineIds: number[];
  total: string | null;
}
interface ReceiptJson {
  id: number;
  status: string;
  costingStatus: string | null;
  costingVersion: number;
  lines: LineJson[];
  discounts?: DiscountJson[];
  totals?: {
    docTotal: string;
    discountTotal: string;
    discountTooLarge: boolean;
    netTotal: string;
    vatTotal: string;
    costTotal: string;
    pricedLines: number;
  };
}
interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}

/**
 * A receipt's discounts on chosen lines and on the whole note (ADR-0103): line discounts first,
 * each on the sum of its lines, then the note's on what remains; the books at the net; a re-costing
 * that replaces them books the difference; a discount larger than its lines is flagged on the draft
 * and refused by the accountant's price check, which alone costs a receipt (ADR-0115). The posting
 * links each product to the supplier, and the line picker lists a supplier's products. Synthetic
 * data only.
 */
describe('receipt discounts and supplier products', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let wh: WarehouseJson;
  let vatSupplier: number;
  let plainSupplier: number;
  let water: ProductJson;
  let juice: ProductJson;
  let tea: ProductJson;
  let category: number;
  let pcs: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const create = (body: Record<string, unknown>) =>
    http().post('/api/v1/receipts').set(bearer(admin)).set(idempotency()).send(body);
  const draft = async (supplierId: number, lines: Record<string, unknown>[]) =>
    (await create({ supplierId, supplierDocDate: today, lines }).expect(201)).body as ReceiptJson;
  const get = async (id: number, token = admin) =>
    (await http().get(`/api/v1/receipts/${id}`).set(bearer(token)).expect(200)).body as ReceiptJson;
  const setDiscounts = (id: number, discounts: Record<string, unknown>[], token = admin) =>
    http().put(`/api/v1/receipts/${id}/discounts`).set(bearer(token)).send({ discounts });
  /** Types the note's totals from the lines and confirms (ADR-0115); asserts `status` (200). */
  const post = (id: number, status = 200, amount?: string) =>
    postReceipt(app, admin, id, { status, ...(amount === undefined ? {} : { amount }) });
  const cancel = (id: number) =>
    http().post(`/api/v1/receipts/${id}/cancel`).set(bearer(admin)).expect(200);
  const line = (product: ProductJson, qty: string, price: Record<string, unknown> = {}) => ({
    productUnitId: unitOf(product, 'PCS').id,
    enteredQty: qty,
    ...price,
  });
  const valuations = async (id: number) =>
    (
      await sql.query<{
        version: number;
        doc_amount: string;
        discount_amount: string | null;
        amount: string;
      }>(
        `SELECT version, doc_amount::text, discount_amount::text, amount::text
           FROM stock_valuation_adjustments WHERE doc_type = 'GR' AND doc_id = $1
          ORDER BY version, doc_line_id`,
        [id],
      )
    ).rows;
  /** The journal lines of a Bto purchase document: account code → signed amount (Dr +, Cr −). */
  const linesOf = async (docType: string, docId: string) =>
    Object.fromEntries(
      (
        await sql.query<{ code: string; amount: string }>(
          `SELECT a.code, (sum(l.debit) - sum(l.credit))::text AS amount
             FROM fin.documents d
             JOIN fin.source_systems s ON s.id = d.source_system_id AND s.code = 'BTO'
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE d.source_doc_type = $1 AND d.source_doc_id = $2
            GROUP BY a.code ORDER BY a.code`,
          [docType, docId],
        )
      ).rows.map((row) => [row.code, row.amount]),
    );
  /** Dr − Cr on goods received (310201) over every Bto document of one receipt. */
  const goodsReceivedOf = async (receiptId: number) =>
    (
      await sql.query<{ amount: string }>(
        `SELECT coalesce(sum(l.debit) - sum(l.credit), 0)::text AS amount
           FROM fin.documents d
           JOIN fin.source_systems s ON s.id = d.source_system_id AND s.code = 'BTO'
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE a.code = '310201'
            AND ((d.source_doc_type = 'STOCK' AND d.source_doc_id LIKE $1)
              OR (d.source_doc_type IN ('STOCK_REVALUE', 'RECEIPT_RECOST') AND d.source_doc_id LIKE $2)
              OR (d.source_doc_type = 'GOODS_RECEIPT' AND d.source_doc_id = $3))`,
        [`GR:${receiptId}:%`, `${receiptId}:%`, String(receiptId)],
      )
    ).rows[0]?.amount;
  const balance = async (supplierId: number) =>
    (
      (await http().get(`/api/v1/supplier-balances/${supplierId}`).set(bearer(admin)).expect(200))
        .body as { balance: string }
    ).balance;
  /** A product's supplier links, oldest first. */
  const linksOf = async (productId: number) =>
    (
      await sql.query<{ id: string; supplier_id: string; is_main: boolean }>(
        `SELECT id::text, supplier_id::text, is_main FROM product_suppliers
          WHERE product_id = $1 ORDER BY product_suppliers.id`,
        [productId],
      )
    ).rows;
  const product = async (sku: string, name: string) => {
    const made = await catalogApi(app, admin).product({
      sku,
      name,
      categoryId: category,
      baseUomId: pcs,
    });
    await inventoryApi(app, admin).setHome(made.id, wh.id);
    return made;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    wh = await inventoryApi(app, admin).warehouse('RD1');
    const partners = partnersApi(app, admin);
    vatSupplier = (await partners.supplier({ name: 'НӨАТ Нийлүүлэгч РД', vatPayer: true })).id;
    plainSupplier = (await partners.supplier({ name: 'Энгийн Нийлүүлэгч РД' })).id;
    const catalog = catalogApi(app, admin);
    category = await catalog.category('Ус РД');
    pcs = await catalog.uomId('PCS');
    water = await catalog.product({
      sku: '7801',
      name: 'Ус РД',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '12' }],
    });
    await inventoryApi(app, admin).setHome(water.id, wh.id);
    juice = await product('7802', 'Жүүс РД');
    tea = await product('7803', 'Цай РД');
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('takes the line discounts first, then the note’s on what remains, and books the net', async () => {
    const receipt = await draft(vatSupplier, [
      { productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' },
      line(juice, '10', { docAmount: '5500' }),
      line(tea, '5', { docAmount: '2200' }),
      line(juice, '2', { freeGoods: true }),
    ]);
    const [l1, l2, l3, free] = receipt.lines.map((row) => row.id);
    // The note's discount first in the list: it still comes after the line discounts.
    const typed = (
      await setDiscounts(receipt.id, [
        { kind: 'NOTE', pct: '5' },
        { kind: 'LINES', pct: '10', lineIds: [l2, l1] },
        { kind: 'LINES', amount: '770', lineIds: [l2, l3] },
      ]).expect(200)
    ).body as ReceiptJson;
    // 10 % of 31,900 on water and juice: 2,640 + 550; 770 on juice and tea by amount: 550 + 220;
    // 5 % of what is left (23,760 + 4,400 + 1,980 = 30,140): 1,188 + 220 + 99.
    expect(typed.discounts).toEqual([
      expect.objectContaining({
        kind: 'NOTE',
        pct: '5',
        amount: null,
        lineIds: [],
        total: '1507.00',
      }),
      expect.objectContaining({ kind: 'LINES', pct: '10', lineIds: [l1, l2], total: '3190.00' }),
      expect.objectContaining({
        kind: 'LINES',
        pct: null,
        amount: '770.00',
        lineIds: [l2, l3],
        total: '770.00',
      }),
    ]);
    expect(
      typed.lines.map((row) => [row.discountAmount, row.netAmount, row.vatAmount, row.costAmount]),
    ).toEqual([
      ['3828.00', '22572.00', '2052.00', '20520.00'],
      ['1320.00', '4180.00', '380.00', '3800.00'],
      ['319.00', '1881.00', '171.00', '1710.00'],
      [null, null, null, null],
    ]);
    const totals = {
      docTotal: '34100.00',
      discountTotal: '5467.00',
      discountTooLarge: false,
      netTotal: '28633.00',
      vatTotal: '2603.00',
      costTotal: '26030.00',
      pricedLines: 4,
    };
    expect(typed.totals).toEqual(totals);

    // Priced in full, the posting still waits for the price check, which books it (ADR-0115).
    const done = (await post(receipt.id)).body as ReceiptJson;
    expect(done).toMatchObject({ status: 'POSTED', costingStatus: 'PENDING', costingVersion: 0 });
    expect(done.totals).toEqual(totals);
    expect(done.discounts?.map((row) => row.total)).toEqual(['1507.00', '3190.00', '770.00']);
    expect(await linesOf('GOODS_RECEIPT', String(receipt.id))).toEqual({});
    await costReceiptAsTyped(app, admin, receipt.id);
    expect(await get(receipt.id)).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    expect(await valuations(receipt.id)).toEqual([
      { version: 1, doc_amount: '26400.00', discount_amount: '3828.00', amount: '20520.00' },
      { version: 1, doc_amount: '5500.00', discount_amount: '1320.00', amount: '3800.00' },
      { version: 1, doc_amount: '2200.00', discount_amount: '319.00', amount: '1710.00' },
      { version: 1, doc_amount: '0.00', discount_amount: null, amount: '0.00' },
    ]);
    // The payable is Σ net, input VAT its VAT, goods received cleared by the stock's arrival.
    expect(await linesOf('GOODS_RECEIPT', String(receipt.id))).toEqual({
      '130301': '2603.00',
      '310201': '26030.00',
      '310101': '-28633.00',
    });
    expect(await balance(vatSupplier)).toBe('28633.00');
    expect(await goodsReceivedOf(receipt.id)).toBe('0.00');
    const costing = (
      await http().get(`/api/v1/receipts/${receipt.id}/costing`).set(bearer(admin)).expect(200)
    ).body as { discounts: DiscountJson[]; total: string; docTotal: string };
    expect(costing).toMatchObject({ total: '26030.00', docTotal: '34100.00' });
    expect(costing.discounts.map((row) => [row.kind, row.total])).toEqual([
      ['NOTE', '1507.00'],
      ['LINES', '3190.00'],
      ['LINES', '770.00'],
    ]);

    // A re-costing that replaces the discounts with 10 % off the note books the difference.
    const recost = (
      await http()
        .put(`/api/v1/receipts/${receipt.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: 1,
          discounts: [{ kind: 'NOTE', pct: '10' }],
          // The note's amount corrected with it: the payable must match it (ADR-0115).
          noteTotalAmount: '30690',
          lines: [
            { lineId: l1, amount: '26400' },
            { lineId: l2, amount: '5500' },
            { lineId: l3, amount: '2200' },
            { lineId: free, freeGoods: true },
          ],
        })
        .expect(200)
    ).body as { discounts: DiscountJson[]; total: string };
    expect(recost.total).toBe('27900.00');
    expect(recost.discounts).toEqual([
      expect.objectContaining({ kind: 'NOTE', pct: '10', lineIds: [], total: '3410.00' }),
    ]);
    expect((await valuations(receipt.id)).filter((row) => row.version === 2)).toEqual([
      { version: 2, doc_amount: '26400.00', discount_amount: '2640.00', amount: '21600.00' },
      { version: 2, doc_amount: '5500.00', discount_amount: '550.00', amount: '4500.00' },
      { version: 2, doc_amount: '2200.00', discount_amount: '220.00', amount: '1800.00' },
      { version: 2, doc_amount: '0.00', discount_amount: null, amount: '0.00' },
    ]);
    // 30,690 owed now: 2,057 more, 187 of it VAT, 1,870 into the stock.
    expect(await linesOf('RECEIPT_RECOST', `${receipt.id}:2`)).toEqual({
      '130301': '187.00',
      '310201': '1870.00',
      '310101': '-2057.00',
    });
    expect(await balance(vatSupplier)).toBe('30690.00');
    expect(await goodsReceivedOf(receipt.id)).toBe('0.00');
    const after = await get(receipt.id);
    expect(after.totals).toMatchObject({
      discountTotal: '3410.00',
      discountTooLarge: false,
      netTotal: '30690.00',
    });
    expect(after.discounts).toHaveLength(1);
  });

  it('flags a discount larger than its lines on the draft and refuses it at the price check', async () => {
    const receipt = await draft(plainSupplier, [line(juice, '1', { docAmount: '100' })]);
    const [only] = receipt.lines.map((row) => row.id);
    // Two line discounts together may not take a line below zero.
    const flagged = (
      await setDiscounts(receipt.id, [
        { kind: 'LINES', pct: '100', lineIds: [only] },
        { kind: 'LINES', amount: '50', lineIds: [only] },
      ]).expect(200)
    ).body as ReceiptJson;
    expect(flagged.totals).toMatchObject({
      discountTotal: '0.00',
      discountTooLarge: true,
      netTotal: '100.00',
    });
    expect(flagged.discounts?.map((row) => row.total)).toEqual([null, null]);
    expect(flagged.lines[0]).toMatchObject({ discountAmount: '0.00', netAmount: '100.00' });
    // A note discount above the note.
    const note = (await setDiscounts(receipt.id, [{ kind: 'NOTE', amount: '100.01' }]).expect(200))
      .body as ReceiptJson;
    expect(note.totals?.discountTooLarge).toBe(true);
    // The whole note off fits.
    const whole = (await setDiscounts(receipt.id, [{ kind: 'NOTE', amount: '100' }]).expect(200))
      .body as ReceiptJson;
    expect(whole.totals).toMatchObject({ discountTooLarge: false, netTotal: '0.00' });

    // The keepers' posting no longer looks at prices (ADR-0115); the price check refuses a
    // discount too large and changes nothing.
    await post(receipt.id);
    const check = (discounts?: Record<string, unknown>[]) =>
      http()
        .put(`/api/v1/receipts/${receipt.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: 0,
          ...(discounts === undefined ? {} : { discounts }),
          lines: [{ lineId: only, amount: '100' }],
        });
    expect(
      (
        await check([
          { kind: 'LINES', pct: '100', lineIds: [only] },
          { kind: 'LINES', amount: '50', lineIds: [only] },
        ]).expect(422)
      ).body as ProblemJson,
    ).toMatchObject({ code: 'RECEIPT_DISCOUNT_TOO_LARGE', params: { index: 1 } });
    expect(
      (await check([{ kind: 'NOTE', amount: '100.01' }]).expect(422)).body as ProblemJson,
    ).toMatchObject({
      code: 'RECEIPT_DISCOUNT_TOO_LARGE',
      params: { discount: '100.01', total: '100.00', index: 0 },
    });
    expect(await get(receipt.id)).toMatchObject({ costingStatus: 'PENDING', costingVersion: 0 });
    expect(await valuations(receipt.id)).toEqual([]);
    // The draft's whole-note discount fits.
    await check().expect(200);
  });

  it('checks the discounts it is given and keeps them for cost holders on drafts only', async () => {
    const receipt = await draft(plainSupplier, [
      line(juice, '1', { docAmount: '1000' }),
      line(tea, '1', { freeGoods: true }),
    ]);
    const [priced, free] = receipt.lines.map((row) => row.id);
    const other = await draft(plainSupplier, [line(juice, '1', { docAmount: '500' })]);
    const foreign = other.lines[0]?.id;
    const refused: Record<string, unknown>[][] = [
      [
        { kind: 'NOTE', pct: '5' },
        { kind: 'NOTE', amount: '10' },
      ],
      [{ kind: 'LINES', pct: '5' }],
      [{ kind: 'LINES', pct: '5', lineIds: [] }],
      [{ kind: 'LINES', pct: '5', lineIds: [priced, free] }],
      [{ kind: 'LINES', pct: '5', lineIds: [foreign] }],
      [{ kind: 'NOTE', pct: '150' }],
      [{ kind: 'NOTE', pct: '0' }],
      [{ kind: 'NOTE', amount: '0' }],
      [{ kind: 'NOTE', pct: '5', amount: '10' }],
      [{ kind: 'NOTE' }],
      [{ kind: 'ITEM', pct: '5' }],
    ];
    for (const discounts of refused) {
      const res = await setDiscounts(receipt.id, discounts);
      expect([res.status, discounts]).toEqual([422, discounts]);
      expect((res.body as ProblemJson).code).toBe('VALIDATION_FAILED');
    }
    expect((await get(receipt.id)).discounts).toEqual([]);

    // A cost holder sets them and an empty list clears them; warehouse staff neither set nor see them.
    const valid = [{ kind: 'LINES', amount: '100', lineIds: [priced] }];
    const kept = (await setDiscounts(receipt.id, valid).expect(200)).body as ReceiptJson;
    expect(kept.discounts).toEqual([
      expect.objectContaining({ lineIds: [priced], total: '100.00' }),
    ]);
    expect((await setDiscounts(receipt.id, []).expect(200)).body).toMatchObject({ discounts: [] });
    await setDiscounts(receipt.id, valid).expect(200);
    const forbidden = await setDiscounts(receipt.id, [], worker).expect(403);
    expect((forbidden.body as ProblemJson).code).toBe('FORBIDDEN');
    const seen = await get(receipt.id, worker);
    expect(seen).not.toHaveProperty('discounts');
    expect(seen).not.toHaveProperty('totals');
    expect((await get(receipt.id)).discounts).toHaveLength(1);

    // A posted receipt changes its discounts only through the costing.
    await post(receipt.id);
    expect(((await setDiscounts(receipt.id, []).expect(409)).body as ProblemJson).code).toBe(
      'DOC_ALREADY_POSTED',
    );
    await cancel(other.id);
  });

  it('takes free goods for a line discount as the costing has them, not as the draft typed them', async () => {
    const receipt = await draft(plainSupplier, [
      line(juice, '1', { freeGoods: true }),
      line(tea, '1', { docAmount: '200' }),
      line(juice, '1'),
    ]);
    const [wasFree, wasPriced, unpriced] = receipt.lines.map((row) => row.id);
    // The note's amount is what the costing below makes payable (ADR-0115).
    expect((await post(receipt.id, 200, '370')).body).toMatchObject({ costingStatus: 'PENDING' });
    const costs = (discounts: Record<string, unknown>[]) =>
      http()
        .put(`/api/v1/receipts/${receipt.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: 0,
          discounts,
          lines: [
            { lineId: wasFree, amount: '300' },
            { lineId: wasPriced, freeGoods: true },
            { lineId: unpriced, amount: '100' },
          ],
        });
    // The line the costing makes free takes no line discount.
    expect(
      (
        (await costs([{ kind: 'LINES', pct: '10', lineIds: [wasPriced] }]).expect(422))
          .body as ProblemJson
      ).code,
    ).toBe('VALIDATION_FAILED');
    // The line the draft had as a bonus does, once the costing prices it.
    const costed = (await costs([{ kind: 'LINES', pct: '10', lineIds: [wasFree] }]).expect(200))
      .body as { discounts: DiscountJson[]; total: string };
    expect(costed).toMatchObject({
      total: '370.00',
      discounts: [expect.objectContaining({ lineIds: [wasFree], total: '30.00' })],
    });
  });

  it('drops a deleted line from its discounts', async () => {
    const receipt = await draft(plainSupplier, [
      line(juice, '1', { docAmount: '1000' }),
      line(tea, '1', { docAmount: '1000' }),
    ]);
    const [first, second] = receipt.lines.map((row) => row.id);
    await setDiscounts(receipt.id, [
      { kind: 'LINES', amount: '100', lineIds: [first, second] },
      { kind: 'NOTE', pct: '10' },
    ]).expect(200);
    const after = (
      await http().delete(`/api/v1/receipt-lines/${second}`).set(bearer(admin)).expect(200)
    ).body as ReceiptJson;
    // 100 on the line left, then 10 % of its 900.
    expect(after.discounts).toEqual([
      expect.objectContaining({ kind: 'LINES', lineIds: [first], total: '100.00' }),
      expect.objectContaining({ kind: 'NOTE', total: '90.00' }),
    ]);
    expect(after.totals).toMatchObject({
      docTotal: '1000.00',
      discountTotal: '190.00',
      netTotal: '810.00',
      discountTooLarge: false,
    });
    // A line discount whose last line goes is dropped with it; the note discount stays.
    const last = (
      await http().delete(`/api/v1/receipt-lines/${first}`).set(bearer(admin)).expect(200)
    ).body as ReceiptJson;
    expect(last.discounts).toEqual([expect.objectContaining({ kind: 'NOTE' })]);
    expect(last.totals).toMatchObject({ discountTooLarge: false });
    await cancel(receipt.id);
  });

  it('links each product to the supplier at posting and lists a supplier’s products', async () => {
    const supplier = (await partnersApi(app, admin).supplier({ name: 'Холбоос Нийлүүлэгч РД' })).id;
    const elsewhere = (await partnersApi(app, admin).supplier({ name: 'Өөр Нийлүүлэгч РД' })).id;
    // Named so that the list's order by name is known: А, Б, В.
    const already = await product('7811', 'А бараа РД');
    const fresh = await product('7812', 'Б бараа РД');
    const another = await product('7813', 'В бараа РД');
    const link = (productId: number, supplierId: number) =>
      http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    await link(already.id, elsewhere);
    await link(already.id, supplier);
    await link(another.id, elsewhere);
    const alreadyBefore = await linksOf(already.id);

    const lookup = (q: string, supplierId?: number) =>
      http()
        .get('/api/v1/products/lookup')
        .query({ q, ...(supplierId === undefined ? {} : { supplierId }) })
        .set(bearer(worker))
        .expect(200)
        .then((res) => (res.body as { id: number }[]).map((row) => row.id));
    // Only the supplier's products; an empty text lists them, without a supplier it finds nothing.
    expect(await lookup('', supplier)).toEqual([already.id]);
    expect(await lookup('бараа РД', supplier)).toEqual([already.id]);
    expect(await lookup('7812', supplier)).toEqual([]);
    expect(await lookup('7812')).toEqual([fresh.id]);
    expect(await lookup('')).toEqual([]);
    await http()
      .get('/api/v1/products/lookup')
      .query({ q: '', supplierId: 0 })
      .set(bearer(worker))
      .expect(422);

    const receipt = await draft(supplier, [
      line(already, '1'),
      line(fresh, '2'),
      line(fresh, '1'),
      line(another, '3'),
    ]);
    // A draft links nothing.
    expect(await linksOf(fresh.id)).toEqual([]);
    expect((await post(receipt.id)).body).toMatchObject({ costingStatus: 'PENDING' });

    // The first link of a product becomes its main supplier; a product with a main keeps it.
    expect(await linksOf(fresh.id)).toEqual([
      expect.objectContaining({ supplier_id: String(supplier), is_main: true }),
    ]);
    expect(await linksOf(another.id)).toEqual([
      expect.objectContaining({ supplier_id: String(elsewhere), is_main: true }),
      expect.objectContaining({ supplier_id: String(supplier), is_main: false }),
    ]);
    expect(await linksOf(already.id)).toEqual(alreadyBefore);
    expect(alreadyBefore).toEqual([
      expect.objectContaining({ supplier_id: String(elsewhere), is_main: true }),
      expect.objectContaining({ supplier_id: String(supplier), is_main: false }),
    ]);
    // The picker lists the products the posting linked, by name.
    expect(await lookup('', supplier)).toEqual([already.id, fresh.id, another.id]);
    expect(await lookup('7812', supplier)).toEqual([fresh.id]);
    expect(await lookup('', elsewhere)).toEqual([already.id, another.id]);
  });
});
