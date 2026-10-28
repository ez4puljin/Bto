import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, type InvoiceJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, postReceipt } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * The stock's value in the books (F4, ADR-0097): every stock posting books its value — a surplus,
 * a sale's cost, a sales return, a goods issue by its expense type, an unpriced receipt against
 * goods received, its costing (what had already left goes to the cost of goods sold) — so the
 * inventory account follows the stock's value and goods received clears with the bill. A goods
 * issue to a supplier is the supplier's credit (F3), never a stock entry. Synthetic data only.
 */
describe('finance stock and cost', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let flour: ProductJson;
  let shop: number;
  let supplier: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  /** The journal lines of the stock documents of one Bto document: account code → Dr − Cr. */
  const stockLines = async (docType: string, docId: number) =>
    Object.fromEntries(
      (
        await sql.query<{ code: string; amount: string }>(
          `SELECT a.code, (sum(l.debit) - sum(l.credit))::text AS amount
             FROM fin.documents d
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE d.source_doc_type = $1 AND d.source_doc_id LIKE $2
            GROUP BY a.code ORDER BY a.code`,
          ['STOCK', `${docType}:${docId}:%`],
        )
      ).rows.map((row) => [row.code, row.amount]),
    );
  /** The Bto branches the lines of a source's documents carry (null: none). */
  const branchesOf = async (docType: string, docId: string) =>
    (
      await sql.query<{ branch: string | null }>(
        `SELECT DISTINCT r.external_id AS branch
           FROM fin.documents d
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           LEFT JOIN fin.branch_refs r ON r.company_id = l.company_id AND r.branch_id = l.branch_id
          WHERE d.source_doc_type = $1 AND d.source_doc_id LIKE $2`,
        [docType, docId],
      )
    ).rows.map((row) => row.branch);
  /** Dr − Cr of an account over the whole journal. */
  const balance = async (code: string) =>
    (
      await sql.query<{ amount: string }>(
        `SELECT coalesce(sum(l.debit) - sum(l.credit), 0)::text AS amount
           FROM fin.journal_lines l
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
          WHERE a.code = $1`,
        [code],
      )
    ).rows[0]?.amount;
  const stockValue = async () =>
    (
      await sql.query<{ value: string }>(
        `SELECT coalesce(sum(round(on_hand * avg_cost, 2)), 0)::text AS value FROM warehouse_stock`,
      )
    ).rows[0]?.value;
  const issueTypes = async () =>
    (await http().get('/api/v1/issues/expense-types').set(bearer(admin)).expect(200)).body as {
      id: number;
      code: string | null;
    }[];
  const issue = async (code: string, recipient: Record<string, unknown>, qty: string) => {
    const type = (await issueTypes()).find((entry) => entry.code === code);
    const draft = (
      await http()
        .post('/api/v1/issues')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: flow.wh.id,
          expenseTypeId: type?.id,
          recipient,
          lines: [{ productUnitId: unitOf(flour, 'PCS').id, enteredQty: qty }],
        })
        .expect(201)
    ).body as { id: number };
    await http()
      .post(`/api/v1/issues/${draft.id}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    return draft.id;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    flow = await salesFlow(app, admin, 'FS');
    // 50 pieces found at a cost of 700 (a SURPLUS adjustment): 35,000 into the stock.
    flour = await flow.product('8951', 'Гурил ФС', '1000', '50');
    const partners = partnersApi(app, admin);
    shop = (await partners.customer({ name: 'Өртгийн дэлгүүр ФС' })).id;
    supplier = (await partners.supplier({ name: 'Өртгийн нийлүүлэгч ФС' })).id;
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('books a surplus as a gain and a sale at its cost', async () => {
    const [adjustment] = (
      await sql.query<{ id: number }>(`SELECT id FROM adjustments ORDER BY id DESC LIMIT 1`)
    ).rows;
    expect(await stockLines('ADJ', adjustment?.id ?? 0)).toEqual({
      '140101': '35000.00',
      '511030': '-35000.00',
    });
    const draft = await flow.draft(shop, [{ productUnitId: flow.pcs(flour), qty: '5' }]);
    await flow.sell(draft.id);
    expect(await stockLines('SO', draft.id)).toEqual({
      '140101': '-3500.00',
      '610101': '3500.00',
    });
    // The sales return takes the goods back at the average into the stock.
    const finance = financeApi(app, accountant);
    const invoice = (await finance.invoiceOfOrder(draft.id)) as InvoiceJson;
    const line = invoice.lines?.[0];
    const note = (
      await finance
        .creditNote({
          invoiceId: invoice.id,
          reason: 'Буцаалт ФС',
          warehouseId: flow.wh.id,
          lines: [{ invoiceLineId: line?.id, qty: '2' }],
        })
        .expect(201)
    ).body as { id: number };
    expect(await stockLines('CN', note.id)).toEqual({
      '140101': '1400.00',
      '610101': '-1400.00',
    });
  });

  it('books a goods issue on its expense type, and none for a supplier return', async () => {
    const internal = await issue('INTERNAL_USE', { kind: 'OTHER', name: 'Оффис ФС' }, '1');
    expect(await stockLines('GI', internal)).toEqual({ '140101': '-700.00', '730201': '700.00' });
    const returned = await issue(
      'SUPPLIER_RETURN',
      { kind: 'SUPPLIER', supplierId: supplier },
      '1',
    );
    expect(await stockLines('GI', returned)).toEqual({});
    // The supplier's credit takes it out instead (F3): Cr 140101 at the cost.
    const credit = await sql.query<{ amount: string }>(
      `SELECT (sum(l.debit) - sum(l.credit))::text AS amount
         FROM fin.documents d
         JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
         JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
         JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        WHERE d.source_doc_type = 'SUPPLIER_RETURN' AND d.source_doc_id = $1 AND a.code = '140101'`,
      [String(returned)],
    );
    expect(credit.rows[0]?.amount).toBe('-700.00');
  });

  it('books an unpriced receipt against goods received, and its costing and bill clear it', async () => {
    // The receipt brings the flour onto its fixed shelf in its home (ADR-0099 #1).
    await inventoryApi(app, admin).homeShelf(flour.id, flow.wh.id, flow.shelf.id);
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId: supplier,
          supplierDocDate: today,
          lines: [{ productUnitId: unitOf(flour, 'PCS').id, enteredQty: '10' }],
        })
        .expect(201)
    ).body as { id: number; lines: { id: number }[] };
    // The note's amount is the price the accountant checks below (ADR-0115).
    await postReceipt(app, admin, draft.id, { amount: '9000' });
    // In at the provisional cost (the average, 700).
    expect(await stockLines('GR', draft.id)).toEqual({
      '140101': '7000.00',
      '310201': '-7000.00',
    });
    // 50 of the 55 pieces leave before the price arrives: half the receipt is sold already.
    const sale = await flow.draft(shop, [{ productUnitId: flow.pcs(flour), qty: '50' }]);
    await flow.sell(sale.id);
    await http()
      .put(`/api/v1/receipts/${draft.id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ costingVersion: 0, lines: [{ lineId: draft.lines[0]?.id, amount: '9000' }] })
      .expect(200);
    const costing = Object.fromEntries(
      (
        await sql.query<{ code: string; amount: string }>(
          `SELECT a.code, (sum(l.debit) - sum(l.credit))::text AS amount
             FROM fin.documents d
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE d.source_doc_type = 'STOCK_REVALUE' AND d.source_doc_id = $1
            GROUP BY a.code`,
          [`${draft.id}:1`],
        )
      ).rows.map((row) => [row.code, row.amount]),
    );
    // 2,000 more: part still on hand moves the stock, the part already sold the cost of goods sold.
    expect(costing['310201']).toBe('-2000.00');
    expect(
      Number.parseFloat(costing['140101'] ?? '0') + Number.parseFloat(costing['610101'] ?? '0'),
    ).toBeCloseTo(2000, 2);
    expect(Number.parseFloat(costing['610101'] ?? '0')).toBeGreaterThan(0);
    // The bill (F3) debits goods received with the cost: nothing is left on it.
    expect(await balance('310201')).toBe('0.00');
  });

  it('tags each document with its warehouse’s branch (ADR-0106 #4)', async () => {
    const branch = String(flow.wh.branchId);
    const sale = await flow.draft(shop, [{ productUnitId: flow.pcs(flour), qty: '1' }]);
    await flow.sell(sale.id);
    expect(await branchesOf('STOCK', `SO:${sale.id}:%`)).toEqual([branch]);
    const invoice = (await financeApi(app, accountant).invoiceOfOrder(sale.id)) as InvoiceJson;
    expect(await branchesOf('SALES_INVOICE', String(invoice.id))).toEqual([branch]);
    const internal = await issue('INTERNAL_USE', { kind: 'OTHER', name: 'Салбар ФС' }, '1');
    expect(await branchesOf('STOCK', `GI:${internal}:%`)).toEqual([branch]);
    const returned = await issue(
      'SUPPLIER_RETURN',
      { kind: 'SUPPLIER', supplierId: supplier },
      '1',
    );
    expect(await branchesOf('SUPPLIER_RETURN', String(returned))).toEqual([branch]);
    // A voucher of the core's screens (source FIN) carries its cash box's branch.
    const finance = financeApi(app, admin);
    const box = (
      await finance
        .createMoneyAccount({
          code: 'FS-BOX',
          name: 'Касс ФС',
          kind: 'CASH',
          glAccountId: (await finance.account('100101')).id,
          branchId: flow.wh.branchId,
        })
        .expect(201)
    ).body as { id: number };
    const voucher = (
      await financeApi(app, accountant)
        .payment({
          kind: 'OTHER_IN',
          moneyAccountId: box.id,
          glAccountId: (await finance.account('511020')).id,
          amount: '100',
          paidOn: today,
        })
        .expect(201)
    ).body as { id: number };
    const [document] = (
      await sql.query<{ source_doc_id: string }>(
        `SELECT source_doc_id FROM fin.documents WHERE id = $1`,
        [voucher.id],
      )
    ).rows;
    expect(await branchesOf('RECEIPT', document?.source_doc_id ?? '')).toEqual([branch]);
  });

  it('books an admin-added expense type on «бусад» until it gets its own account (ADR-0106 #3)', async () => {
    const type = (
      await http()
        .post('/api/v1/issues/expense-types')
        .set(bearer(admin))
        .send({ name: 'Дээж ФС' })
        .expect(201)
    ).body as { id: number };
    const sample = await flow.product('8952', 'Дээжийн бараа ФС', '1000', '10');
    const issueOf = async () => {
      const draft = (
        await http()
          .post('/api/v1/issues')
          .set(bearer(admin))
          .set(idempotency())
          .send({
            warehouseId: flow.wh.id,
            expenseTypeId: type.id,
            recipient: { kind: 'OTHER', name: 'Дээж' },
            lines: [{ productUnitId: unitOf(sample, 'PCS').id, enteredQty: '1' }],
          })
          .expect(201)
      ).body as { id: number };
      await http()
        .post(`/api/v1/issues/${draft.id}/post`)
        .set(bearer(admin))
        .set(idempotency())
        .expect(200);
      return draft.id;
    };
    const first = await issueOf();
    expect(Object.keys(await stockLines('GI', first))).toEqual(['140101', '730209']);

    const list = async () =>
      (
        await http()
          .get('/api/v1/finance/issue-expense-accounts')
          .set(bearer(accountant))
          .expect(200)
      ).body as { typeId: number; seeded: boolean; own: boolean; accountCode: string | null }[];
    expect((await list()).find((row) => row.typeId === type.id)).toMatchObject({
      seeded: false,
      own: false,
      accountCode: '730209',
    });
    const marketing = await financeApi(app, admin).account('730203');
    await http()
      .put(`/api/v1/finance/issue-expense-accounts/${type.id}`)
      .set(bearer(accountant))
      .send({ accountId: marketing.id })
      .expect(403);
    await http()
      .put(`/api/v1/finance/issue-expense-accounts/${type.id}`)
      .set(bearer(admin))
      .send({ accountId: marketing.id })
      .expect(200);
    expect((await list()).find((row) => row.typeId === type.id)).toMatchObject({
      own: true,
      accountCode: '730203',
    });
    const second = await issueOf();
    expect(Object.keys(await stockLines('GI', second))).toEqual(['140101', '730203']);
    // A seeded type keeps F4's account, changed with its role on «Данс».
    const seeded = (await issueTypes()).find((entry) => entry.code === 'INTERNAL_USE');
    await http()
      .put(`/api/v1/finance/issue-expense-accounts/${seeded?.id}`)
      .set(bearer(admin))
      .send({ accountId: marketing.id })
      .expect(422);
  });

  it('keeps the inventory account at the stock’s value', async () => {
    const books = Number.parseFloat((await balance('140101')) ?? '0');
    const stock = Number.parseFloat((await stockValue()) ?? '0');
    // The averages are rounded to 4 decimals: at most a few cents apart.
    expect(Math.abs(books - stock)).toBeLessThan(0.1);
  });
});
