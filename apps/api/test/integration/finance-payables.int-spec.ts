import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, type ProblemJson, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface ReceiptJson {
  id: number;
  number: string | null;
  costingStatus: string | null;
  costingVersion: number;
  lines: { id: number }[];
}
interface BalanceJson {
  supplierId: number;
  name: string;
  balance: string;
  oldestBillDate: string | null;
}
interface EntryJson {
  kind: string;
  docType: string;
  docId: number;
  docNumber: string;
  debit: string;
  credit: string;
  balanceAfter: string;
}
interface ItemJson {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  kind: string;
  documentType: string;
  documentId: number;
  number: string;
  amount: string;
  openAmount: string;
}

/**
 * The suppliers' payables (F3, ADR-0091): a receipt that gets its prices is the supplier's bill
 * (stock and input VAT against the payable), a re-costing books its difference, a supplier return
 * lowers the payable at cost plus VAT, a manual entry pays a supplier and the accountant pairs it
 * with the bill; «Нийлүүлэгчийн тооцоо» reads it all. Synthetic data only.
 */
describe('finance payables', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let accountant: string;
  let wh: WarehouseJson;
  let water: ProductJson;
  let vatSupplier: number;
  let plainSupplier: number;
  let cashBox: { id: number; code: string };
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const receipt = async (
    supplierId: number,
    lines: Record<string, unknown>[],
    { discounts, amount, ...extra }: Record<string, unknown> = {},
  ): Promise<ReceiptJson> => {
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({ supplierId, supplierDocDate: today, lines, ...extra })
        .expect(201)
    ).body as ReceiptJson;
    // A cost holder types the discounts on the draft (ADR-0103).
    if (discounts !== undefined) {
      await http()
        .put(`/api/v1/receipts/${draft.id}/discounts`)
        .set(bearer(admin))
        .send({ discounts })
        .expect(200);
    }
    // The warehouse posts it; the bill waits for the accountant's price check (ADR-0115).
    return (await postReceipt(app, worker, draft.id, typeof amount === 'string' ? { amount } : {}))
      .body as ReceiptJson;
  };
  /**
   * A receipt posted, then priced by the accountant as typed: the price check makes the bill
   * (ADR-0115), booked as Bto itself, no finance right needed.
   */
  const billed = async (
    supplierId: number,
    lines: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ): Promise<ReceiptJson> => {
    const posted = await receipt(supplierId, lines, extra);
    await costReceiptAsTyped(app, accountant, posted.id);
    return (await http().get(`/api/v1/receipts/${posted.id}`).set(bearer(admin)).expect(200))
      .body as ReceiptJson;
  };
  /** A costing; `noteTotalAmount` corrects the note's amount the payable must match (ADR-0115). */
  const cost = (
    id: number,
    version: number,
    lines: Record<string, unknown>[],
    noteTotalAmount?: string,
  ) =>
    http()
      .put(`/api/v1/receipts/${id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: version,
        lines,
        ...(noteTotalAmount === undefined ? {} : { noteTotalAmount }),
      });
  const balance = async (supplierId: number) =>
    (
      await http()
        .get(`/api/v1/supplier-balances/${supplierId}`)
        .set(bearer(accountant))
        .expect(200)
    ).body as BalanceJson;
  const ledger = async (supplierId: number) =>
    (
      (
        await http()
          .get(`/api/v1/supplier-balances/${supplierId}/ledger`)
          .set(bearer(accountant))
          .expect(200)
      ).body as { data: EntryJson[]; opening: string }
    ).data;
  const items = async (supplierId: number) =>
    (
      (
        await http()
          .get(`/api/v1/supplier-balances/${supplierId}/open-items`)
          .set(bearer(accountant))
          .expect(200)
      ).body as { data: ItemJson[] }
    ).data;
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
  /** Dr − Cr on goods received (310201) over every Bto document of one receipt (F3 + F4). */
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
  const supplier = async (name: string, vatPayer = false) =>
    (await partnersApi(app, admin).supplier({ name, vatPayer })).id;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    accountant = await token('ACCOUNTANT');
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    wh = await inventoryApi(app, admin).warehouse('AP1');
    vatSupplier = await supplier('НӨАТ Нийлүүлэгч АП', true);
    plainSupplier = await supplier('Энгийн Нийлүүлэгч АП');
    const catalog = catalogApi(app, admin);
    water = await catalog.product({
      sku: '7901',
      name: 'Ус АП',
      categoryId: await catalog.category('Ус АП'),
      baseUomId: await catalog.uomId('PCS'),
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '12' }],
    });
    // A receipt's lines go to their product's home (ADR-0099 #1).
    await inventoryApi(app, admin).setHome(water.id, wh.id);
    cashBox = await financeApi(app, admin).cashBox('AP-CASH');
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('books a priced receipt as the supplier’s bill: stock and input VAT against the payable', async () => {
    const draft = await receipt(vatSupplier, [
      { productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' },
    ]);
    // Priced in full, the posting still bills nothing: only the price check does (ADR-0115).
    expect(draft).toMatchObject({ costingStatus: 'PENDING', costingVersion: 0 });
    expect(await linesOf('GOODS_RECEIPT', String(draft.id))).toEqual({});
    expect(await balance(vatSupplier)).toMatchObject({ balance: '0.00' });
    await costReceiptAsTyped(app, accountant, draft.id);
    const posted = (await http().get(`/api/v1/receipts/${draft.id}`).set(bearer(admin)).expect(200))
      .body as ReceiptJson;
    expect(posted).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '130301': '2400.00',
      '310201': '24000.00',
      '310101': '-26400.00',
    });
    expect(await balance(vatSupplier)).toMatchObject({
      name: 'НӨАТ Нийлүүлэгч АП',
      balance: '26400.00',
      oldestBillDate: today,
    });
    expect(await ledger(vatSupplier)).toEqual([
      expect.objectContaining({
        kind: 'BILL',
        docType: 'RECEIPT',
        docId: posted.id,
        docNumber: posted.number,
        credit: '26400.00',
        balanceAfter: '26400.00',
      }),
    ]);
    const list = (
      await http()
        .get('/api/v1/supplier-balances')
        .query({ q: 'НӨАТ Нийлүүлэгч АП' })
        .set(bearer(accountant))
        .expect(200)
    ).body as { data: BalanceJson[] };
    expect(list.data).toEqual([expect.objectContaining({ supplierId: vatSupplier })]);
  });

  it('books a pending receipt when it is costed, then each re-costing’s difference', async () => {
    const shop = await supplier('Дахин өртөг АП', true);
    const posted = await receipt(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '10' }],
      { amount: '11000' },
    );
    expect(posted).toMatchObject({ costingStatus: 'PENDING' });
    expect(await balance(shop)).toMatchObject({ balance: '0.00' });
    const lineId = posted.lines[0]?.id ?? 0;

    await cost(posted.id, 0, [{ lineId, amount: '11000' }]).expect(200);
    expect(await balance(shop)).toMatchObject({ balance: '11000.00' });
    // Up: a bill of the difference (stock 1,000 more, VAT 100 more).
    await cost(posted.id, 1, [{ lineId, amount: '12100' }], '12100').expect(200);
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '130301': '100.00',
      '310201': '1000.00',
      '310101': '-1100.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '12100.00' });
    // Down: a credit of the difference that settles the receipt's open bills.
    await cost(posted.id, 2, [{ lineId, amount: '9900' }], '9900').expect(200);
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:3`)).toEqual({
      '130301': '-200.00',
      '310201': '-2000.00',
      '310101': '2200.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '9900.00' });
    const open = await items(shop);
    expect(open.every((item) => item.side === 'CREDIT')).toBe(true);
    expect(open.reduce((sum, item) => sum + Number.parseFloat(item.openAmount), 0)).toBe(9900);
    expect((await ledger(shop)).map((entry) => entry.kind)).toEqual(['RECOST', 'RECOST', 'BILL']);
  });

  it('books a discounted receipt at its net, and a re-costing’s new discount as the difference', async () => {
    const shop = await supplier('Хөнгөлөлт АП', true);
    const posted = await billed(
      shop,
      [{ productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' }],
      { discounts: [{ kind: 'NOTE', pct: '10' }] },
    );
    expect(posted).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    // 26,400 less 10 %: 23,760 owed, 2,160 of it input VAT, 21,600 into the stock.
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '130301': '2160.00',
      '310201': '21600.00',
      '310101': '-23760.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '23760.00' });
    expect(await goodsReceivedOf(posted.id)).toBe('0.00');
    const recost = (version: number, discount: Record<string, unknown>) =>
      http()
        .put(`/api/v1/receipts/${posted.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: version,
          ...discount,
          lines: [{ lineId: posted.lines[0]?.id, amount: '26400' }],
        })
        .expect(200);
    // The discount dropped: the difference is billed.
    await recost(1, { discounts: [], noteTotalAmount: '26400' });
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '130301': '240.00',
      '310201': '2400.00',
      '310101': '-2640.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '26400.00' });
    // An amount instead: a credit of the difference.
    await recost(2, { discounts: [{ kind: 'NOTE', amount: '1100' }], noteTotalAmount: '25300' });
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:3`)).toEqual({
      '130301': '-100.00',
      '310201': '-1000.00',
      '310101': '1100.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '25300.00' });
    // Goods received clears with each bill.
    expect(await goodsReceivedOf(posted.id)).toBe('0.00');
  });

  it('pays a supplier by a manual entry and lets the accountant pair it with the bill', async () => {
    const shop = await supplier('Төлбөр АП');
    const posted = await billed(shop, [
      { productUnitId: unitOf(water, 'PCS').id, enteredQty: '5', docAmount: '5000' },
    ]);
    // No VAT for a supplier that pays none.
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '310201': '5000.00',
      '310101': '-5000.00',
    });
    const finance = financeApi(app, accountant);
    const payable = await finance.account('310101');
    const cash = await finance.account('100101');
    const entry = (supplierId: number | null) => ({
      entryDate: today,
      description: 'Нийлүүлэгчид төлөв АП',
      lines: [
        { accountId: payable.id, debit: '3000', ...(supplierId ? { supplierId } : {}) },
        { accountId: cash.id, credit: '3000', moneyAccountId: cashBox.id },
      ],
    });
    const refused = (await finance.journal(entry(null)).expect(422)).body as ProblemJson;
    expect(refused.errors).toEqual([expect.objectContaining({ path: 'lines[0].supplierId' })]);
    const paid = (await finance.journal(entry(shop)).expect(201)).body as {
      lines: { supplierId: number | null; supplierName: string | null }[];
    };
    expect(paid.lines[0]).toMatchObject({ supplierId: shop, supplierName: 'Төлбөр АП' });
    expect(await balance(shop)).toMatchObject({ balance: '2000.00' });

    const open = await items(shop);
    const bill = open.find((item) => item.side === 'CREDIT');
    const payment = open.find((item) => item.side === 'DEBIT');
    expect(bill).toMatchObject({ kind: 'BILL', documentType: 'RECEIPT', documentId: posted.id });
    expect(payment).toMatchObject({
      kind: 'MANUAL',
      documentType: 'JOURNAL',
      openAmount: '3000.00',
    });
    const allocated = (
      await http()
        .post('/api/v1/finance/allocations')
        .set(bearer(accountant))
        .set(idempotency())
        .send({
          supplierId: shop,
          pairs: [{ debitItemId: payment?.id, creditItemId: bill?.id, amount: '3000' }],
        })
        .expect(201)
    ).body as { supplierId: number | null; customerId: number | null; amount: string };
    expect(allocated).toMatchObject({ supplierId: shop, customerId: null, amount: '3000.00' });
    expect(await items(shop)).toEqual([
      expect.objectContaining({ side: 'CREDIT', openAmount: '2000.00' }),
    ]);
    expect(await balance(shop)).toMatchObject({ balance: '2000.00' });
    // Both a customer and a supplier, or neither: refused.
    await http()
      .post('/api/v1/finance/allocations')
      .set(bearer(accountant))
      .set(idempotency())
      .send({ pairs: [{ debitItemId: 1, creditItemId: 2, amount: '1' }] })
      .expect(422);
  });

  it('keeps a re-costing’s credit open when the bill is paid already', async () => {
    const shop = await supplier('Төлөгдсөн АП');
    const posted = await billed(shop, [
      { productUnitId: unitOf(water, 'PCS').id, enteredQty: '4', docAmount: '4000' },
    ]);
    const finance = financeApi(app, accountant);
    await finance
      .journal({
        entryDate: today,
        description: 'Бүтэн төлөв АП',
        lines: [
          { accountId: (await finance.account('310101')).id, debit: '4000', supplierId: shop },
          {
            accountId: (await finance.account('100101')).id,
            credit: '4000',
            moneyAccountId: cashBox.id,
          },
        ],
      })
      .expect(201);
    const [bill, pay] = [
      (await items(shop)).find((item) => item.side === 'CREDIT'),
      (await items(shop)).find((item) => item.side === 'DEBIT'),
    ];
    await http()
      .post('/api/v1/finance/allocations')
      .set(bearer(accountant))
      .set(idempotency())
      .send({
        supplierId: shop,
        pairs: [{ debitItemId: pay?.id, creditItemId: bill?.id, amount: '4000' }],
      })
      .expect(201);
    await cost(posted.id, 1, [{ lineId: posted.lines[0]?.id, amount: '3500' }], '3500').expect(200);
    expect(await balance(shop)).toMatchObject({ balance: '-500.00' });
    expect(await items(shop)).toEqual([
      expect.objectContaining({ side: 'DEBIT', kind: 'RECOST', openAmount: '500.00' }),
    ]);
  });

  it('books nothing for a receipt of free goods only, and only the bill for a cash receipt', async () => {
    const shop = await supplier('Бэлэн АП');
    await billed(shop, [
      { productUnitId: unitOf(water, 'PCS').id, enteredQty: '2', freeGoods: true },
    ]);
    expect(await balance(shop)).toMatchObject({ balance: '0.00' });
    await billed(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '2', docAmount: '2000' }],
      { paymentMethod: 'CASH', moneyAccountId: cashBox.id },
    );
    // The payment method is a note: the accountant records the payment by hand (owner 2026-10-20).
    expect(await balance(shop)).toMatchObject({ balance: '2000.00' });
  });

  it('lowers the payable by a supplier return at cost plus the supplier’s VAT', async () => {
    const types = (await http().get('/api/v1/issues/expense-types').set(bearer(worker)).expect(200))
      .body as { id: number; code: string | null }[];
    const returned = types.find((type) => type.code === 'SUPPLIER_RETURN');
    const before = await balance(vatSupplier);
    const draft = (
      await http()
        .post('/api/v1/issues')
        .set(bearer(worker))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          expenseTypeId: returned?.id,
          recipient: { kind: 'SUPPLIER', supplierId: vatSupplier },
          lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '3' }],
        })
        .expect(201)
    ).body as { id: number };
    const posted = (
      await http()
        .post(`/api/v1/issues/${draft.id}/post`)
        .set(bearer(worker))
        .set(idempotency())
        .expect(200)
    ).body as { id: number; number: string };
    const lines = await linesOf('SUPPLIER_RETURN', String(posted.id));
    const stock = Number.parseFloat(lines['140101'] ?? '0');
    const vat = Number.parseFloat(lines['130301'] ?? '0');
    expect(stock).toBeLessThan(0);
    expect(vat).toBeCloseTo(stock / 10, 2);
    expect(Number.parseFloat(lines['310101'] ?? '0')).toBeCloseTo(-(stock + vat), 2);
    const after = await balance(vatSupplier);
    expect(Number.parseFloat(before.balance) - Number.parseFloat(after.balance)).toBeCloseTo(
      -(stock + vat),
      2,
    );
    expect((await ledger(vatSupplier))[0]).toMatchObject({
      kind: 'RETURN',
      docType: 'ISSUE',
      docId: posted.id,
      docNumber: posted.number,
    });
  });

  it('keeps the supplier’s party in step with its name', async () => {
    await http()
      .patch(`/api/v1/suppliers/${plainSupplier}`)
      .set(bearer(admin))
      .send({ name: 'Шинэ нэр АП' })
      .expect(200);
    const party = await sql.query<{ name: string; kind: string }>(
      `SELECT p.name, p.kind FROM fin.parties p
         JOIN fin.party_refs r ON r.tenant_id = p.tenant_id AND r.party_id = p.id
        WHERE r.external_id = $1`,
      [`supplier:${plainSupplier}`],
    );
    expect(party.rows).toEqual([{ name: 'Шинэ нэр АП', kind: 'COMPANY' }]);
  });
});
