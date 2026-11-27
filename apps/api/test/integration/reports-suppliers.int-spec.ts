import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface RowJson {
  partyId: number;
  supplierId: number | null;
  purchases: string;
  purchasesExVat: string;
  otherBills: string;
  discounts: string | null;
  payments: string;
  balance: string;
}
interface ReportJson {
  rows: RowJson[];
  totals: Omit<RowJson, 'partyId' | 'supplierId'>;
}
interface EntryJson {
  kind: string;
  receiptId: number | null;
  amount: string;
  discount: string | null;
  reversal: boolean;
}

/**
 * The supplier report's discount view (ADR-0234): by default a receipt is a purchase after its
 * discount, as the books owe it; with `splitDiscounts` it stands at the delivery note's amount
 * before the discount and the discount apart, a re-costing carrying the change of the discount;
 * the balance is the same in both, and the Excel follows. Synthetic data only.
 */
describe('supplier report: discount view', () => {
  let app: NestExpressApplication;
  let admin: string;
  let supplierId: number;
  let water: ProductJson;
  let juice: ProductJson;
  let discounted: number;
  let plain: number;
  const today = businessDate();
  const from = `${today.slice(0, 7)}-01`;
  const http = () => request(app.getHttpServer());
  const get = (path: string, query: Record<string, unknown> = {}) =>
    http().get(`/api/v1/reports${path}`).query(query).set(bearer(admin));
  const report = async (splitDiscounts?: boolean) =>
    (
      await get('/suppliers', {
        from,
        to: today,
        q: 'нийлүүлэгч РСД',
        ...(splitDiscounts === undefined ? {} : { splitDiscounts }),
      }).expect(200)
    ).body as ReportJson;
  const receipt = async (lines: Record<string, unknown>[], discounts: unknown[] = []) => {
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({ supplierId, supplierDocDate: today, lines })
        .expect(201)
    ).body as { id: number };
    if (discounts.length > 0) {
      await http()
        .put(`/api/v1/receipts/${draft.id}/discounts`)
        .set(bearer(admin))
        .send({ discounts })
        .expect(200);
    }
    await postReceipt(app, admin, draft.id);
    await costReceiptAsTyped(app, admin, draft.id);
    return draft.id;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    const wh = await inventoryApi(app, admin).warehouse('RSD1');
    supplierId = (
      await partnersApi(app, admin).supplier({
        name: 'Хөнгөлөлтийн нийлүүлэгч РСД',
        vatPayer: true,
      })
    ).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ус РСД');
    const pcs = await catalog.uomId('PCS');
    water = await catalog.product({
      sku: '7861',
      name: 'Ус РСД',
      categoryId: category,
      baseUomId: pcs,
    });
    juice = await catalog.product({
      sku: '7862',
      name: 'Жүүс РСД',
      categoryId: category,
      baseUomId: pcs,
    });
    await inventoryApi(app, admin).setHome(water.id, wh.id);
    await inventoryApi(app, admin).setHome(juice.id, wh.id);

    // 16,500 on the note, 10 % off it: 14,850 owed.
    discounted = await receipt(
      [
        { productUnitId: unitOf(water, 'PCS').id, enteredQty: '10', docAmount: '11000' },
        { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '5', docAmount: '5500' },
      ],
      [{ kind: 'NOTE', pct: '10' }],
    );
    // 2,200 without a discount.
    plain = await receipt([
      { productUnitId: unitOf(water, 'PCS').id, enteredQty: '2', docAmount: '2200' },
    ]);
    // Re-costed with 1,000 off instead of 1,650: 650 more owed, the discount 650 less.
    const current = (
      await http().get(`/api/v1/receipts/${discounted}`).set(bearer(admin)).expect(200)
    ).body as { lines: { id: number; productId: number }[] };
    await http()
      .put(`/api/v1/receipts/${discounted}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 1,
        discounts: [{ kind: 'NOTE', amount: '1000' }],
        noteTotalAmount: '15500',
        lines: current.lines.map((line) => ({
          lineId: line.id,
          amount: line.productId === water.id ? '11000' : '5500',
        })),
      })
      .expect(200);
    // 5,000 paid.
    const finance = financeApi(app, admin);
    const payable = await finance.account('310101');
    const cash = await finance.account('100101');
    const box = await finance.cashBox('RSD-CASH');
    await finance
      .journal({
        entryDate: today,
        description: 'Нийлүүлэгчид төлөв РСД',
        lines: [
          { accountId: payable.id, debit: '5000', supplierId },
          { accountId: cash.id, credit: '5000', moneyAccountId: box.id },
        ],
      })
      .expect(201);
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await app.close();
  });

  it('shows purchases after their discounts by default', async () => {
    const row = (await report()).rows.find((entry) => entry.supplierId === supplierId);
    expect(row).toMatchObject({
      purchases: '17700.00',
      discounts: null,
      payments: '5000.00',
      balance: '12700.00',
    });
    const entries = (
      await get(`/suppliers/${row?.partyId ?? 0}/entries`, { from, to: today }).expect(200)
    ).body as { data: EntryJson[] };
    expect(entries.data.map((entry) => [entry.receiptId, entry.amount, entry.discount])).toEqual([
      [discounted, '14850.00', null],
      [plain, '2200.00', null],
      [discounted, '650.00', null],
      [null, '-5000.00', null],
    ]);
  });

  it('reads the same from books that carry the note’s amount and the discount (ADR-0236)', async () => {
    // The bill credits the payable with 16,500 and debits it with the 1,650 discount, and the
    // re-costing takes 650 of the discount back: neither debit nor credit is a payment or a bill
    // of its own in the report above, and 520202 holds the discount without its VAT.
    const sql = await connectAs('app');
    try {
      const { rows } = await sql.query<{
        doc: string;
        code: string;
        debit: string;
        credit: string;
      }>(
        `SELECT d.source_doc_type || '/' || d.source_doc_id AS doc, a.code,
                l.debit::text, l.credit::text
           FROM fin.documents d
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE a.code IN ('310101', '520202')
            AND ((d.source_doc_type = 'GOODS_RECEIPT' AND d.source_doc_id = $1)
              OR (d.source_doc_type = 'RECEIPT_RECOST' AND d.source_doc_id LIKE $2))
          ORDER BY e.id, l.line_no`,
        [String(discounted), `${discounted}:%`],
      );
      expect(rows).toEqual([
        { doc: `GOODS_RECEIPT/${discounted}`, code: '310101', debit: '0.00', credit: '16500.00' },
        { doc: `GOODS_RECEIPT/${discounted}`, code: '310101', debit: '1650.00', credit: '0.00' },
        { doc: `GOODS_RECEIPT/${discounted}`, code: '520202', debit: '0.00', credit: '1500.00' },
        { doc: `RECEIPT_RECOST/${discounted}:2`, code: '310101', debit: '0.00', credit: '650.00' },
        { doc: `RECEIPT_RECOST/${discounted}:2`, code: '520202', debit: '590.91', credit: '0.00' },
      ]);
    } finally {
      await sql.end();
    }
  });

  it('splits the discounts out with the same balance, entry by entry and in Excel', async () => {
    const net = (await report(false)).rows.find((entry) => entry.supplierId === supplierId);
    const split = await report(true);
    const row = split.rows.find((entry) => entry.supplierId === supplierId);
    // 16,500 + 2,200 before the discounts; the discount now 1,000 (1,650 less the re-costing's 650).
    expect(row).toMatchObject({
      purchases: '18700.00',
      purchasesExVat: net?.purchasesExVat,
      discounts: '1000.00',
      payments: '5000.00',
      balance: '12700.00',
    });
    expect(split.totals.discounts).not.toBeNull();

    const entries = (
      await get(`/suppliers/${row?.partyId ?? 0}/entries`, {
        from,
        to: today,
        splitDiscounts: true,
      }).expect(200)
    ).body as { data: EntryJson[] };
    expect(
      entries.data.map((entry) => [entry.kind, entry.receiptId, entry.amount, entry.discount]),
    ).toEqual([
      ['PURCHASE', discounted, '16500.00', '1650.00'],
      ['PURCHASE', plain, '2200.00', '0.00'],
      ['PURCHASE', discounted, '0.00', '-650.00'],
      ['PAYMENT', null, '-5000.00', '0.00'],
    ]);

    // The switch takes only true or false.
    await get('/suppliers', { from, to: today, splitDiscounts: 'maybe' }).expect(422);

    const file = await get('/suppliers.xlsx', {
      from,
      to: today,
      q: 'нийлүүлэгч РСД',
      splitDiscounts: true,
    })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const header = (sheet?.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Код',
      'Нийлүүлэгч',
      'Худалдан авалт (хөнгөлөлтийн өмнө)',
      'Худалдан авалт (НӨАТ-гүй)',
      'Бусад өглөг',
      'Хөнгөлөлт',
      'Төлбөр',
      'Өглөгийн үлдэгдэл',
    ]);
    const values = (sheet?.getRow(2).values as unknown[]).slice(3);
    expect(values[0]).toBe(18700);
    expect(values[3]).toBe(1000);
    expect(values[5]).toBe(12700);
  });
});
