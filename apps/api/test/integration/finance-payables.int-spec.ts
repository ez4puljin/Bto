import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { describeConversion, PurchaseDiscountsService } from '../../src/modules/finance';
import { systemActor } from '../../src/modules/identity';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, type ProblemJson, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postIssue,
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
 * The suppliers' payables (F3, ADR-0091): a receipt that gets its prices is the supplier's bill,
 * one entry on the receipt's date (stock and input VAT against the payable, nothing through goods
 * received, ADR-0233), a re-costing books its difference, a supplier return
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
  /** The payable's own lines of a Bto purchase document, in the entry's order. */
  const payableLinesOf = async (docType: string, docId: string) =>
    (
      await sql.query<{ debit: string; credit: string; description: string | null }>(
        `SELECT l.debit::text, l.credit::text, l.description
           FROM fin.documents d
           JOIN fin.source_systems s ON s.id = d.source_system_id AND s.code = 'BTO'
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE d.source_doc_type = $1 AND d.source_doc_id = $2 AND a.code = '310101'
            AND d.reverses_document_id IS NULL
          ORDER BY l.line_no`,
        [docType, docId],
      )
    ).rows;
  /** Dr − Cr on goods received (310201) over every Bto document of one receipt: none (ADR-0233). */
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
  /** Every journal entry of one receipt (its confirmation, its bill, its re-costings), oldest first. */
  const entriesOf = async (receiptId: number) =>
    (
      await sql.query<{ docType: string; docId: string; date: string; accounts: string }>(
        `SELECT d.source_doc_type AS "docType", d.source_doc_id AS "docId",
                e.entry_date::text AS date, string_agg(DISTINCT a.code, ',' ORDER BY a.code) AS accounts
           FROM fin.documents d
           JOIN fin.source_systems s ON s.id = d.source_system_id AND s.code = 'BTO'
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE (d.source_doc_type = 'STOCK' AND d.source_doc_id LIKE $1)
             OR (d.source_doc_type IN ('STOCK_REVALUE', 'RECEIPT_RECOST') AND d.source_doc_id LIKE $2)
             OR (d.source_doc_type = 'GOODS_RECEIPT' AND d.source_doc_id = $3)
          GROUP BY d.id, d.source_doc_type, d.source_doc_id, e.id, e.entry_date
          ORDER BY e.id`,
        [`GR:${receiptId}:%`, `${receiptId}:%`, String(receiptId)],
      )
    ).rows;
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
      '140101': '24000.00',
      '310101': '-26400.00',
    });
    expect(await balance(vatSupplier)).toMatchObject({
      name: 'НӨАТ Нийлүүлэгч АП',
      balance: '26400.00',
      oldestBillDate: today,
      latestBillDate: today,
    });
    // The accountant who confirmed the prices is named on the receipt and on its ledger line.
    const confirmedBy = (posted as ReceiptJson & { costedBy: string | null }).costedBy;
    expect(confirmedBy).toEqual(expect.any(String));
    expect(await ledger(vatSupplier)).toEqual([
      expect.objectContaining({
        kind: 'BILL',
        docType: 'RECEIPT',
        docId: posted.id,
        docNumber: posted.number,
        credit: '26400.00',
        balanceAfter: '26400.00',
        confirmedBy,
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

  it('narrows the balances by category and segment, naming both on each row (owner 2026-11-27)', async () => {
    const category = (
      await http()
        .post('/api/v1/supplier-categories')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Архи АП' })
        .expect(201)
    ).body as { id: number; path: string };
    const spirits = (
      await http()
        .post('/api/v1/suppliers')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Архи Нийлүүлэгч АП', categoryId: category.id })
        .expect(201)
    ).body as { id: number };
    const other = await supplier('Сегментгүй Нийлүүлэгч АП');
    for (const id of [spirits.id, other]) {
      await billed(id, [
        { productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', docUnitPrice: '1100' },
      ]);
    }
    const segment = (
      await http()
        .post('/api/v1/segments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          entity: 'SUPPLIER',
          name: 'Сонгосон АП',
          definition: {
            match: 'ALL',
            groups: [
              { match: 'ALL', conditions: [{ field: 'supplier', op: 'IN', ids: [spirits.id] }] },
            ],
          },
        })
        .expect(201)
    ).body as { id: number };
    const rows = async (query: Record<string, unknown>) =>
      (
        (
          await http()
            .get('/api/v1/supplier-balances')
            .query(query)
            .set(bearer(accountant))
            .expect(200)
        ).body as {
          data: (BalanceJson & {
            categoryPath: string | null;
            segments: { id: number; name: string }[];
          })[];
        }
      ).data;
    const bySegment = await rows({ segmentId: segment.id });
    expect(bySegment).toEqual([
      expect.objectContaining({
        supplierId: spirits.id,
        categoryPath: category.path,
        segments: [{ id: segment.id, name: 'Сонгосон АП' }],
        latestBillDate: today,
      }),
    ]);
    expect((await rows({ categoryId: category.id })).map((row) => row.supplierId)).toEqual([
      spirits.id,
    ]);
    expect(await rows({ q: 'Сегментгүй Нийлүүлэгч АП' })).toEqual([
      expect.objectContaining({ supplierId: other, categoryPath: null, segments: [] }),
    ]);
    // Within a segment, the search still applies.
    expect(await rows({ segmentId: segment.id, q: 'Сегментгүй' })).toEqual([]);
    // A category condition keeps the suppliers of that category too.
    const byCategory = (
      await http()
        .post('/api/v1/segments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          entity: 'SUPPLIER',
          name: 'Архины АП',
          definition: {
            match: 'ALL',
            groups: [
              {
                match: 'ALL',
                conditions: [{ field: 'supplierCategory', op: 'IN', ids: [category.id] }],
              },
            ],
          },
        })
        .expect(201)
    ).body as { id: number };
    expect((await rows({ segmentId: byCategory.id })).map((row) => row.supplierId)).toEqual([
      spirits.id,
    ]);
    await http()
      .post('/api/v1/segments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        entity: 'SUPPLIER',
        name: 'Буруу АП',
        definition: {
          match: 'ALL',
          groups: [
            {
              match: 'ALL',
              conditions: [{ field: 'supplierCategory', op: 'IN', ids: [999_999_999] }],
            },
          ],
        },
      })
      .expect(422);
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
    // Nothing sold meanwhile: the whole cost is stock, straight against the payable (ADR-0233).
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '130301': '1000.00',
      '140101': '10000.00',
      '310101': '-11000.00',
    });
    // Up: a bill of the difference (stock 1,000 more, VAT 100 more).
    await cost(posted.id, 1, [{ lineId, amount: '12100' }], '12100').expect(200);
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '130301': '100.00',
      '140101': '1000.00',
      '310101': '-1100.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '12100.00' });
    // Down: a credit of the difference that settles the receipt's open bills.
    await cost(posted.id, 2, [{ lineId, amount: '9900' }], '9900').expect(200);
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:3`)).toEqual({
      '130301': '-200.00',
      '140101': '-2000.00',
      '310101': '2200.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '9900.00' });
    const open = await items(shop);
    expect(open.every((item) => item.side === 'CREDIT')).toBe(true);
    expect(open.reduce((sum, item) => sum + Number.parseFloat(item.openAmount), 0)).toBe(9900);
    expect((await ledger(shop)).map((entry) => entry.kind)).toEqual(['RECOST', 'RECOST', 'BILL']);
  });

  it('books a receipt’s discount as income against the payable, and a re-costing’s change of it (ADR-0236)', async () => {
    const shop = await supplier('Хөнгөлөлт АП', true);
    const posted = await billed(
      shop,
      [{ productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' }],
      { discounts: [{ kind: 'NOTE', pct: '10' }] },
    );
    expect(posted).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    // 26,400 on the note, 10 % off: the stock at 24,000 (before the discount, without VAT), the
    // input VAT 2,160 on the 23,760 owed, the discount without its VAT income on 520202.
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '130301': '2160.00',
      '140101': '24000.00',
      '310101': '-23760.00',
      '520202': '-2400.00',
    });
    // The payable is credited with the note and debited with the discount, in one entry.
    expect(await payableLinesOf('GOODS_RECEIPT', String(posted.id))).toEqual([
      { debit: '0.00', credit: '26400.00', description: null },
      { debit: '2640.00', credit: '0.00', description: 'Падааны хөнгөлөлт' },
    ]);
    // The debit closed part of the bill's own item: the note less the discount stays open.
    expect(await balance(shop)).toMatchObject({ balance: '23760.00' });
    expect(await items(shop)).toEqual([
      expect.objectContaining({
        side: 'CREDIT',
        kind: 'BILL',
        documentId: posted.id,
        amount: '26400.00',
        openAmount: '23760.00',
      }),
    ]);
    // «Нийлүүлэгчийн тооцоо» lists both lines under the receipt, newest first.
    expect((await ledger(shop)).slice(0, 2)).toEqual([
      expect.objectContaining({
        kind: 'BILL',
        docType: 'RECEIPT',
        docId: posted.id,
        debit: '2640.00',
        credit: '0.00',
        balanceAfter: '23760.00',
      }),
      expect.objectContaining({
        kind: 'BILL',
        docType: 'RECEIPT',
        docId: posted.id,
        debit: '0.00',
        credit: '26400.00',
        balanceAfter: '26400.00',
      }),
    ]);
    expect(await goodsReceivedOf(posted.id)).toBe('0');
    const recost = (version: number, discount: Record<string, unknown>, amount = '26400') =>
      http()
        .put(`/api/v1/receipts/${posted.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: version,
          ...discount,
          lines: [{ lineId: posted.lines[0]?.id, amount }],
        })
        .expect(200);
    // The discount dropped: it is taken back from the income and owed again; the stock stays.
    await recost(1, { discounts: [], noteTotalAmount: '26400' });
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '130301': '240.00',
      '310101': '-2640.00',
      '520202': '2400.00',
    });
    expect(await payableLinesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual([
      { debit: '0.00', credit: '2640.00', description: 'Падааны хөнгөлөлт' },
    ]);
    expect(await balance(shop)).toMatchObject({ balance: '26400.00' });
    // An amount instead: a credit of the discount settling the receipt's open bill.
    await recost(2, { discounts: [{ kind: 'NOTE', amount: '1100' }], noteTotalAmount: '25300' });
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:3`)).toEqual({
      '130301': '-100.00',
      '310101': '1100.00',
      '520202': '-1000.00',
    });
    expect(await balance(shop)).toMatchObject({ balance: '25300.00' });
    expect((await items(shop)).every((item) => item.side === 'CREDIT')).toBe(true);
    // The price and the discount both change: 33,000 on the note, 10 % off, 29,700 owed. The
    // payable takes the note's 6,600 more and the discount's 2,200 more, each on its own line.
    await recost(
      3,
      { discounts: [{ kind: 'NOTE', pct: '10' }], noteTotalAmount: '29700' },
      '33000',
    );
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:4`)).toEqual({
      '130301': '400.00',
      '140101': '6000.00',
      '310101': '-4400.00',
      '520202': '-2000.00',
    });
    expect(await payableLinesOf('RECEIPT_RECOST', `${posted.id}:4`)).toEqual([
      { debit: '0.00', credit: '6600.00', description: null },
      { debit: '2200.00', credit: '0.00', description: 'Падааны хөнгөлөлт' },
    ]);
    expect(await balance(shop)).toMatchObject({ balance: '29700.00' });
    // Over all its entries: the stock at 30,000, the discount's income 3,000, nothing on 310201.
    const total = async (code: string) =>
      (
        await sql.query<{ amount: string }>(
          `SELECT coalesce(sum(l.debit) - sum(l.credit), 0)::text AS amount
             FROM fin.documents d
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE a.code = $1 AND ((d.source_doc_type = 'GOODS_RECEIPT' AND d.source_doc_id = $2)
               OR (d.source_doc_type = 'RECEIPT_RECOST' AND d.source_doc_id LIKE $3))`,
          [code, String(posted.id), `${posted.id}:%`],
        )
      ).rows[0]?.amount;
    expect(await total('140101')).toBe('30000.00');
    expect(await total('520202')).toBe('-3000.00');
    expect(await goodsReceivedOf(posted.id)).toBe('0');
  });

  it('books a discount of a supplier without VAT whole, and line discounts with the note’s', async () => {
    const shop = await supplier('НӨАТгүй хөнгөлөлт АП');
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId: shop,
          supplierDocDate: today,
          lines: [
            { productUnitId: unitOf(water, 'PCS').id, enteredQty: '10', docAmount: '10000' },
            { productUnitId: unitOf(water, 'PCS').id, enteredQty: '5', docAmount: '6000' },
            { productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', freeGoods: true },
          ],
        })
        .expect(201)
    ).body as ReceiptJson;
    // 1,000 off the first line, then 10 % off what the note keeps: 1,500; 13,500 owed.
    await http()
      .put(`/api/v1/receipts/${draft.id}/discounts`)
      .set(bearer(admin))
      .send({
        discounts: [
          { kind: 'LINES', amount: '1000', lineIds: [draft.lines[0]?.id] },
          { kind: 'NOTE', pct: '10' },
        ],
      })
      .expect(200);
    await postReceipt(app, worker, draft.id);
    await costReceiptAsTyped(app, accountant, draft.id);
    expect(await linesOf('GOODS_RECEIPT', String(draft.id))).toEqual({
      '140101': '16000.00',
      '310101': '-13500.00',
      '520202': '-2500.00',
    });
    expect(await payableLinesOf('GOODS_RECEIPT', String(draft.id))).toEqual([
      { debit: '0.00', credit: '16000.00', description: null },
      { debit: '2500.00', credit: '0.00', description: 'Падааны хөнгөлөлт' },
    ]);
    expect(await balance(shop)).toMatchObject({ balance: '13500.00' });
  });

  it('brings a receipt costed with its discount inside the cost to income: a dry run, then the run', async () => {
    // Shaped like the real system's only such receipt: a supplier without VAT, 43,812,000 on the
    // note, a note discount of 9,446,666, so 34,365,334 owed and in the stock.
    const shop = await supplier('Хуучин аргын АП');
    const catalog = catalogApi(app, admin);
    const goods = await catalog.product({
      sku: '7903',
      name: 'Хуучин өртөгтэй бараа АП',
      categoryId: await catalog.category('Хуучин АП'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventoryApi(app, admin).setHome(goods.id, wh.id);
    const posted = await billed(shop, [
      { productUnitId: unitOf(goods, 'PCS').id, enteredQty: '1000', docAmount: '34365334' },
    ]);
    // As the costing before ADR-0236 left it: the note's amount and the discount on the costing
    // row, the cost after the discount. Only the table's owner can rewrite history.
    const owner = await connectAs('admin');
    try {
      await owner.query(
        'ALTER TABLE stock_valuation_adjustments DISABLE TRIGGER stock_valuation_adjustments_no_update_delete',
      );
      await owner.query(
        `UPDATE stock_valuation_adjustments SET doc_amount = 43812000, discount_amount = 9446666
          WHERE doc_type = 'GR' AND doc_id = $1`,
        [posted.id],
      );
      await owner.query(
        'ALTER TABLE stock_valuation_adjustments ENABLE TRIGGER stock_valuation_adjustments_no_update_delete',
      );
      await owner.query(
        `INSERT INTO goods_receipt_discounts (receipt_id, kind, amount) VALUES ($1, 'NOTE', 9446666)`,
        [posted.id],
      );
    } finally {
      await owner.end();
    }
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '140101': '34365334.00',
      '310101': '-34365334.00',
    });
    // A quarter of it leaves before the conversion: its share of the discount is cost of sales.
    const types = (await http().get('/api/v1/issues/expense-types').set(bearer(worker)).expect(200))
      .body as { id: number; code: string | null }[];
    const issue = (
      await http()
        .post('/api/v1/issues')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          expenseTypeId: types.find((type) => type.code === 'INTERNAL_USE')?.id,
          recipient: { kind: 'OTHER', name: 'Төв оффис АП' },
          lines: [{ productUnitId: unitOf(goods, 'PCS').id, enteredQty: '250' }],
        })
        .expect(201)
    ).body as { id: number };
    await postIssue(app, admin, issue.id);
    const average = async () =>
      (
        await sql.query<{ avg: string }>(
          'SELECT avg_cost::text AS avg FROM warehouse_stock WHERE product_id = $1',
          [goods.id],
        )
      ).rows[0]?.avg;
    expect(await average()).toBe('34365.3340');

    const service = app.get(PurchaseDiscountsService);
    const actor = systemActor('test:purchase-discounts');
    const dry = await service.convert(actor, posted.id, { dryRun: true });
    expect(dry).toMatchObject({ applied: false, version: 2 });
    expect(
      dry?.entry?.lines.map((line) => [
        line.accountCode,
        line.debit.toFixed(2),
        line.credit.toFixed(2),
      ]),
    ).toEqual([
      ['140101', '7084999.50', '0.00'],
      ['610101', '2361666.50', '0.00'],
      ['310101', '0.00', '9446666.00'],
      ['310101', '9446666.00', '0.00'],
      ['520202', '0.00', '9446666.00'],
    ]);
    expect(dry?.lines).toEqual([
      expect.objectContaining({ productName: 'Хуучин өртөгтэй бараа АП' }),
    ]);
    expect(dry?.lines[0]?.costBefore.toFixed(2)).toBe('34365334.00');
    expect(dry?.lines[0]?.costAfter.toFixed(2)).toBe('43812000.00');
    expect(dry?.lines[0]?.avgAfter.toFixed(4)).toBe('43812.0000');
    // What the command prints.
    expect(describeConversion(dry as NonNullable<typeof dry>)).toEqual([
      `${posted.number} (receipt ${posted.id}): costing version 2, DRY RUN, nothing written.`,
      'Product costs (cost before → after; of the difference: to the stock on hand, to the cost of goods sold; average before → after):',
      '  Хуучин өртөгтэй бараа АП × 1000: discount 9446666.00; cost 34365334.00 → 43812000.00; stock +7084999.50, cost of sales +2361666.50; average 34365.3340 → 43812.0000',
      `Entry (not numbered: dry run) dated ${today}:`,
      '  Dr 140101 Бараа материал 7084999.50',
      '  Dr 610101 Борлуулсан барааны өртөг 2361666.50',
      '  Cr 310101 Дансны өглөг 9446666.00',
      '  Dr 310101 Дансны өглөг 9446666.00 (Падааны хөнгөлөлт)',
      '  Cr 520202 Худалдан авалтын хөнгөлөлт 9446666.00',
    ]);
    // Nothing was written.
    expect(await average()).toBe('34365.3340');
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({});
    expect(
      (await http().get(`/api/v1/receipts/${posted.id}`).set(bearer(admin)).expect(200)).body,
    ).toMatchObject({ costingVersion: 1 });

    const done = await service.convert(actor, posted.id, { dryRun: false });
    expect(done).toMatchObject({ applied: true, version: 2 });
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '140101': '7084999.50',
      '310101': '0.00',
      '520202': '-9446666.00',
      '610101': '2361666.50',
    });
    expect(await average()).toBe('43812.0000');
    // The supplier is owed the same, on the bill's item; the new credit closed with its debit.
    expect(await balance(shop)).toMatchObject({ balance: '34365334.00' });
    expect(await items(shop)).toEqual([
      expect.objectContaining({ kind: 'BILL', amount: '34365334.00', openAmount: '34365334.00' }),
    ]);
    // Once only: the receipt now keeps its discount out of its cost.
    expect(await service.convert(actor, posted.id, { dryRun: false })).toBeNull();
    expect(await service.convert(actor, posted.id, { dryRun: true })).toBeNull();
  });

  it('pays a supplier by a manual entry and lets the accountant pair it with the bill', async () => {
    const shop = await supplier('Төлбөр АП');
    const posted = await billed(shop, [
      { productUnitId: unitOf(water, 'PCS').id, enteredQty: '5', docAmount: '5000' },
    ]);
    // No VAT for a supplier that pays none.
    expect(await linesOf('GOODS_RECEIPT', String(posted.id))).toEqual({
      '140101': '5000.00',
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
    // The accountant sends, the keeper confirms (ADR-0117); the admin holds both rights here.
    const draft = (
      await http()
        .post('/api/v1/issues')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          expenseTypeId: returned?.id,
          recipient: { kind: 'SUPPLIER', supplierId: vatSupplier },
          lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '3' }],
        })
        .expect(201)
    ).body as { id: number };
    const posted = (await postIssue(app, admin, draft.id)).body as { id: number; number: string };
    // One credit per confirmed warehouse, `<issue>:<warehouse>` (ADR-0117 #2).
    const lines = await linesOf('SUPPLIER_RETURN', `${posted.id}:${wh.id}`);
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
      docNumber: `${posted.number}/${wh.code}`,
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

  it('books the pricing as one entry on the receipt’s date, and a re-costing likewise (ADR-0233)', async () => {
    const shop = await supplier('Нэг бичилт АП');
    const day = addDays(today, today.endsWith('-01') ? 0 : -1);
    const posted = await receipt(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '4' }],
      { amount: '4000', supplierDocDate: day },
    );
    // The confirmation moved the quantities only: the books hold nothing of the receipt yet.
    expect(await entriesOf(posted.id)).toEqual([]);
    const lineId = posted.lines[0]?.id ?? 0;
    await cost(posted.id, 0, [{ lineId, amount: '4000' }]).expect(200);
    await cost(posted.id, 1, [{ lineId, amount: '4400' }], '4400').expect(200);
    expect(await entriesOf(posted.id)).toEqual([
      { docType: 'GOODS_RECEIPT', docId: String(posted.id), date: day, accounts: '140101,310101' },
      { docType: 'RECEIPT_RECOST', docId: `${posted.id}:2`, date: day, accounts: '140101,310101' },
    ]);
    expect(await linesOf('RECEIPT_RECOST', `${posted.id}:2`)).toEqual({
      '140101': '400.00',
      '310101': '-400.00',
    });
    expect(await items(shop)).toEqual([
      expect.objectContaining({ side: 'CREDIT', amount: '4000.00' }),
      expect.objectContaining({ side: 'CREDIT', amount: '400.00' }),
    ]);
  });

  it('books the pricing today when the receipt’s month is closed (ADR-0233)', async () => {
    const shop = await supplier('Хаасан сар АП');
    const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const day = `${lastMonth}-15`;
    const posted = await receipt(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '3' }],
      { amount: '3000', supplierDocDate: day },
    );
    const period = (action: string, body?: Record<string, unknown>) =>
      http()
        .post(`/api/v1/finance/periods/${lastMonth}/${action}`)
        .set(bearer(accountant))
        .set(idempotency())
        .send(body);
    await period('close').expect(200);
    try {
      await cost(posted.id, 0, [{ lineId: posted.lines[0]?.id ?? 0, amount: '3000' }]).expect(200);
    } finally {
      await period('reopen', { reason: 'Шалгалтын дараа' }).expect(200);
    }
    // The entry is on the first open day; the bill keeps the receipt's date as its own.
    expect(await entriesOf(posted.id)).toEqual([
      {
        docType: 'GOODS_RECEIPT',
        docId: String(posted.id),
        date: today,
        accounts: '140101,310101',
      },
    ]);
    const bill = await sql.query<{ date: string }>(
      `SELECT document_date::text AS date FROM fin.documents
        WHERE source_doc_type = 'GOODS_RECEIPT' AND source_doc_id = $1`,
      [String(posted.id)],
    );
    expect(bill.rows).toEqual([{ date: day }]);
    expect(await balance(shop)).toMatchObject({ balance: '3000.00' });
  });

  it('never posts a receipt on goods received (ADR-0233)', async () => {
    const used = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM fin.documents d
         JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
         JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
         JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE a.code = '310201'
          AND (d.source_doc_type IN ('GOODS_RECEIPT', 'RECEIPT_RECOST', 'STOCK_REVALUE')
            OR (d.source_doc_type = 'STOCK' AND d.source_doc_id LIKE 'GR:%'))`,
    );
    expect(used.rows[0]?.n).toBe('0');
  });

  it('bills the account the receipt names, and refuses one off the list (ADR-0154)', async () => {
    const shop = await supplier('Тусгай данс АП');
    for (const [code, name] of [
      ['310177', 'Тусгай өглөг'],
      ['313011', 'Тооллогын зөрүү'],
    ] as const) {
      await http()
        .post('/api/v1/gl-accounts')
        .set(bearer(admin))
        .send({ code, name, journal: 'RECEIVABLE_PAYABLE' })
        .expect(201);
    }
    const list = (
      await http().get('/api/v1/receipts/counter-accounts').set(bearer(worker)).expect(200)
    ).body as { code: string; isDefault: boolean }[];
    expect(list.map((row) => row.code)).toEqual(expect.arrayContaining(['310177', '313011']));
    expect(list.find((row) => row.isDefault)?.code).toBe('310101');
    // The goods-received clearing is not a choice, nor is a money account.
    expect(list.map((row) => row.code)).not.toContain('310201');
    for (const code of ['310201', '100101']) {
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId: shop,
          counterAccountCode: code,
          lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1' }],
        })
        .expect(422);
    }

    const draft = await receipt(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '5', docUnitPrice: '1000' }],
      { counterAccountCode: '310177' },
    );
    await costReceiptAsTyped(app, accountant, draft.id);
    expect(await linesOf('GOODS_RECEIPT', String(draft.id))).toEqual({
      '140101': '5000.00',
      '310177': '-5000.00',
    });
    const detail = (await http().get(`/api/v1/receipts/${draft.id}`).set(bearer(admin)).expect(200))
      .body as { counterAccountCode: string; counterAccountName: string };
    expect(detail).toMatchObject({
      counterAccountCode: '310177',
      counterAccountName: 'Тусгай өглөг',
    });

    // The count difference takes its own key too, a re-costing stays on the same account.
    const counted = await receipt(
      shop,
      [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '2', docUnitPrice: '1000' }],
      { counterAccountCode: '313011' },
    );
    await costReceiptAsTyped(app, accountant, counted.id);
    expect(await linesOf('GOODS_RECEIPT', String(counted.id))).toEqual({
      '140101': '2000.00',
      '313011': '-2000.00',
    });
  });
});
