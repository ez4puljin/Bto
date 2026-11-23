import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { reconcileReceivables } from '../../src/modules/finance';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { FAKE_BUYER } from '../harness/fake-posapi';
import { financeApi, type InvoiceJson, type ProblemJson, salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';

interface WaiverJson {
  id: number;
  invoiceId: number;
  status: string;
  waiverDate: string;
  pct: string;
  baseAmount: string;
  amount: string;
  accountCode: string;
  description: string;
  documentNumber: string | null;
  journalEntryId: number | null;
  createdByName: string | null;
}

interface VatInvoiceJson extends InvoiceJson {
  vatWaiver: WaiverJson | null;
  vatWaiverPreview: { pct: string; baseAmount: string; amount: string; blockedBy: string | null };
  receipt: { id: number; receiptType: string; status: string } | null;
}

interface SideJson {
  count: number;
  total: string;
  vatTotal: string;
  openAmount: string;
  waiverAmount: string;
}

interface CounterAccountJson {
  customerId: number;
  own: boolean;
  account: { id: number; code: string; name: string } | null;
}

/**
 * «НӨАТ хасуулах» (ADR-0240): a customer who takes no VAT receipt for a sale has the receivable
 * reduced by a percent of it, in one entry on the customer's counter account against receivables,
 * settling that invoice's own item; the undo puts everything back. Every refusal, the right, the
 * customer's own account, the rounding, a paid invoice's open credit, the e-Barimt guard both
 * ways, the filter and the totals, and the books' reconcile at the end. Synthetic data only.
 */
describe('finance VAT waivers', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let migrator: Client;
  let admin: string;
  let accountant: string;
  let waiverUser: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let receiptFlow: Awaited<ReturnType<typeof salesFlow>>;
  let milk: ProductJson;
  let odd: ProductJson;
  let cola: ProductJson;
  let shop: CustomerJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const sellFor = async (
    customerId: number,
    product: ProductJson,
    qty: string,
    via: Awaited<ReturnType<typeof salesFlow>> = flow,
    fields: Record<string, unknown> = {},
  ): Promise<VatInvoiceJson> => {
    const draft = await via.draft(customerId, [{ productUnitId: via.pcs(product), qty }], fields);
    await via.sell(draft.id);
    const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    return invoice as VatInvoiceJson;
  };
  const invoiceOf = async (id: number) =>
    (await financeApi(app, accountant).invoice(id)) as VatInvoiceJson;
  const waive = (token: string, invoiceId: number, key = idempotency()) =>
    http().post(`/api/v1/invoices/${invoiceId}/vat-waiver`).set(bearer(token)).set(key).send({});
  const undo = (token: string, invoiceId: number, reason?: string) =>
    http()
      .post(`/api/v1/invoices/${invoiceId}/vat-waiver/reverse`)
      .set(bearer(token))
      .set(idempotency())
      .send(reason === undefined ? {} : { reason });
  const refusal = async (response: Promise<{ body: unknown }>) =>
    (await response).body as ProblemJson;
  const counterAccount = async (customerId: number, token = accountant) =>
    (
      await http()
        .get(`/api/v1/customer-balances/${customerId}/counter-account`)
        .set(bearer(token))
        .expect(200)
    ).body as CounterAccountJson;
  const setCounterAccount = (token: string, customerId: number, accountId: number | null) =>
    http()
      .put(`/api/v1/customer-balances/${customerId}/counter-account`)
      .set(bearer(token))
      .send({ accountId });
  const setSettings = (token: string, body: Record<string, unknown>) =>
    http().put('/api/v1/finance-settings/vat-waiver').set(bearer(token)).send(body);
  const linesOf = async (entryId: number | null) => {
    const entry = await financeApi(app, accountant).journalGet(entryId ?? 0);
    return {
      entry,
      lines: entry.lines?.map((row) => [row.accountCode, row.debit, row.credit, row.customerId]),
    };
  };
  const waiverRows = async (invoiceId: number) =>
    (
      await sql.query<{ status: string; amount: string; reverse_reason: string | null }>(
        `SELECT status, amount::text, reverse_reason FROM vat_waivers WHERE invoice_id = $1 ORDER BY id`,
        [invoiceId],
      )
    ).rows;
  const itemOpen = async (invoiceId: number) =>
    (
      await sql.query<{ open: string }>(
        `SELECT i.open_amount::text AS open FROM fin.open_items i
           JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
          WHERE d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text
            AND d.reverses_document_id IS NULL`,
        [invoiceId],
      )
    ).rows[0]?.open;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    migrator = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    // «Зөвхөн тусгайлан эрх олгогдсон хүн»: a role an admin ticked the right on, and nothing else
    // but reading finance.
    waiverUser = await customRoleUser(app, admin, ['finance.read', 'finance.vat_waiver.manage']);
    flow = await salesFlow(app, admin, 'VW');
    receiptFlow = await salesFlow(app, admin, 'VR', { ebarimt: true });
    milk = await flow.product('8601', 'Сүү НӨАТ', '1000', '200');
    odd = await flow.product('8602', 'Сондгой үнэтэй', '337', '50');
    cola = await receiptFlow.product('8603', 'Кола НӨАТ', '1000', '50');
    shop = await partnersApi(app, admin).customer({ name: 'НӨАТ хасуулах дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await migrator.end();
    await app.close();
  });

  it('keeps the percent and the words as settings of finance.settings.manage', async () => {
    const read = async () =>
      (await http().get('/api/v1/finance-settings/vat-waiver').set(bearer(accountant)).expect(200))
        .body as { pct: string; description: string };
    expect(await read()).toEqual(
      expect.objectContaining({ pct: '2.00', description: 'Борлуулалтын хөнгөлөлт' }),
    );
    await setSettings(accountant, { pct: '3', description: 'Хөнгөлөлт' }).expect(403);
    for (const pct of ['0', '100.01', '2.555', 'x']) {
      await setSettings(admin, { pct, description: 'Хөнгөлөлт' }).expect(422);
    }
    await setSettings(admin, { pct: '2', description: '  ' }).expect(422);
    expect(
      (await setSettings(admin, { pct: '3.5', description: ' Хөнгөлөлт ' }).expect(200)).body,
    ).toEqual(expect.objectContaining({ pct: '3.50', description: 'Хөнгөлөлт' }));
    // The number formats stay as they were: the row started from the defaults in force.
    expect(await financeApi(app, accountant).numbering()).toMatchObject({
      INVOICE: { pattern: 'Н-{year}{month}{day}-', digits: 4 },
    });
    await setSettings(admin, { pct: '2.00', description: 'Борлуулалтын хөнгөлөлт' }).expect(200);
    expect(await read()).toEqual(
      expect.objectContaining({ pct: '2.00', description: 'Борлуулалтын хөнгөлөлт' }),
    );
  });

  it('reduces the receivable by 2 % on the sales discount account, once, for the one who holds the right', async () => {
    const finance = financeApi(app, accountant);
    const invoice = await sellFor(shop.id, milk, '10');
    expect(invoice).toMatchObject({ total: '10000.00', openAmount: '10000.00', vatWaiver: null });
    expect(invoice.vatWaiverPreview).toEqual({
      pct: '2.00',
      baseAmount: '10000.00',
      amount: '200.00',
      blockedBy: null,
    });
    // The accountant reads but holds no right to waive; nobody waives without signing in.
    await waive(accountant, invoice.id).expect(403);
    await http().post(`/api/v1/invoices/${invoice.id}/vat-waiver`).set(idempotency()).expect(401);
    await http()
      .post(`/api/v1/invoices/${invoice.id}/vat-waiver`)
      .set(bearer(waiverUser))
      .expect(400);
    expect(await waiverRows(invoice.id)).toEqual([]);

    const key = idempotency();
    const waived = (await waive(waiverUser, invoice.id, key).expect(200)).body as VatInvoiceJson;
    expect(waived).toMatchObject({
      id: invoice.id,
      total: '10000.00',
      openAmount: '9800.00',
      settlement: 'PARTIAL',
    });
    expect(waived.vatWaiver).toMatchObject({
      invoiceId: invoice.id,
      status: 'POSTED',
      waiverDate: today,
      pct: '2.00',
      baseAmount: '10000.00',
      amount: '200.00',
      accountCode: '520201',
      description: 'Борлуулалтын хөнгөлөлт',
      documentNumber: expect.stringMatching(/^НХ-\d{8}-\d{4}$/),
      createdByName: expect.any(String),
    });
    expect(waived.vatWaiverPreview.blockedBy).toBe('VAT_WAIVED');
    expect(waived.allocations).toEqual([
      expect.objectContaining({
        sourceType: 'VAT_WAIVER',
        sourceId: waived.vatWaiver?.id,
        sourceNumber: waived.vatWaiver?.documentNumber,
        amount: '200.00',
        voidedAt: null,
      }),
    ]);
    // The same key again answers the same invoice and writes nothing more.
    const replay = (await waive(waiverUser, invoice.id, key).expect(200)).body as VatInvoiceJson;
    expect(replay.vatWaiver?.id).toBe(waived.vatWaiver?.id);
    expect(await waiverRows(invoice.id)).toEqual([
      { status: 'POSTED', amount: '200.00', reverse_reason: null },
    ]);

    // One entry: Dr the sales discount, Cr receivables on the customer; nothing on a tax account.
    const { entry, lines } = await linesOf(waived.vatWaiver?.journalEntryId ?? null);
    expect(lines).toEqual([
      ['520201', '200.00', '0.00', null],
      ['120101', '0.00', '200.00', shop.id],
    ]);
    expect(entry.description).toBe(`${waived.vatWaiver?.documentNumber} — Борлуулалтын хөнгөлөлт`);
    expect(entry.entryDate).toBe(today);
    // The invoice's own item is settled by it, and the mirror follows the item.
    expect(await itemOpen(invoice.id)).toBe('9800.00');
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '9800.00', openInvoices: 1 });
    expect((await finance.ledger(shop.id)).data[0]).toMatchObject({
      docNumber: waived.vatWaiver?.documentNumber,
      credit: '200.00',
      balanceAfter: '9800.00',
    });
    // The invoice's own entry and totals are as the sale left them.
    const own = await linesOf(invoice.journalEntryId ?? null);
    expect(own.lines?.find((row) => row[0] === '120101')).toEqual([
      '120101',
      '10000.00',
      '0.00',
      shop.id,
    ]);
    expect(await invoiceOf(invoice.id)).toMatchObject({
      total: invoice.total,
      vatTotal: invoice.vatTotal,
      subtotal: invoice.subtotal,
    });

    // Twice is refused; a voided-looking invoice with a waiver is not voidable either.
    expect(await refusal(waive(waiverUser, invoice.id).expect(409))).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: { number: invoice.number, status: 'VAT_WAIVED' },
    });
    expect(await refusal(waive(admin, invoice.id).expect(409))).toMatchObject({
      params: { status: 'VAT_WAIVED' },
    });
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'vat_waivers' AND entity_id = $1::text`,
      [waived.vatWaiver?.id],
    );
    expect(audit.rows).toEqual([{ action: 'CREATE' }]);
  });

  it('takes a waiver back, puts the invoice and the balance back and lets it be waived again', async () => {
    const finance = financeApi(app, accountant);
    const invoice = await sellFor(shop.id, milk, '4');
    const before = await finance.balance(shop.id);
    const first = (await waive(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(first).toMatchObject({ openAmount: '3920.00' });
    await undo(accountant, invoice.id, 'Буруу').expect(403);
    await undo(waiverUser, invoice.id, 'x'.repeat(501)).expect(422);

    const undone = (await undo(waiverUser, invoice.id, ' Баримт авна гэв ').expect(200))
      .body as VatInvoiceJson;
    expect(undone).toMatchObject({
      openAmount: '4000.00',
      settlement: 'OPEN',
      vatWaiver: null,
      vatWaiverPreview: { amount: '80.00', blockedBy: null },
    });
    // The allocation stays on the invoice's history as undone.
    expect(undone.allocations).toEqual([
      expect.objectContaining({ sourceType: 'VAT_WAIVER', amount: '80.00' }),
    ]);
    expect(undone.allocations?.[0]?.voidedAt).not.toBeNull();
    expect(await itemOpen(invoice.id)).toBe('4000.00');
    expect(await finance.balance(shop.id)).toMatchObject({ balance: before.balance });
    const row = await sql.query<{
      status: string;
      reverse_reason: string | null;
      reversed: boolean;
      reverse_journal_entry_id: string | null;
    }>(
      `SELECT status, reverse_reason, reversed_by IS NOT NULL AND reversed_at IS NOT NULL AS reversed,
              reverse_journal_entry_id::text
         FROM vat_waivers WHERE id = $1`,
      [first.vatWaiver?.id],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'REVERSED',
      reverse_reason: 'Баримт авна гэв',
      reversed: true,
    });
    // The reversal is the mirror entry of the waiver's.
    const mirror = await linesOf(Number.parseInt(row.rows[0]?.reverse_journal_entry_id ?? '0', 10));
    expect(mirror.lines).toEqual([
      ['520201', '0.00', '80.00', null],
      ['120101', '80.00', '0.00', shop.id],
    ]);
    expect(mirror.entry.reversesId).toBe(first.vatWaiver?.journalEntryId);

    // Nothing to take back twice; the reason is optional; a new waiver is a new document.
    expect(await refusal(undo(waiverUser, invoice.id).expect(409))).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: { status: 'NOT_VAT_WAIVED' },
    });
    const again = (await waive(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(again.vatWaiver?.id).not.toBe(first.vatWaiver?.id);
    expect(again.vatWaiver?.documentNumber).not.toBe(first.vatWaiver?.documentNumber);
    expect(again).toMatchObject({ openAmount: '3920.00' });
    expect(await waiverRows(invoice.id)).toEqual([
      { status: 'REVERSED', amount: '80.00', reverse_reason: 'Баримт авна гэв' },
      { status: 'POSTED', amount: '80.00', reverse_reason: null },
    ]);
    const withoutReason = (await undo(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(withoutReason).toMatchObject({ openAmount: '4000.00', vatWaiver: null });
    expect((await waiverRows(invoice.id))[1]).toEqual({
      status: 'REVERSED',
      amount: '80.00',
      reverse_reason: null,
    });
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'vat_waivers' AND entity_id = $1::text ORDER BY id`,
      [first.vatWaiver?.id],
    );
    expect(audit.rows).toEqual([{ action: 'CREATE' }, { action: 'REVERSE' }]);
  });

  it("debits the customer's own counter account, which only a plain active account may be", async () => {
    const admins = financeApi(app, admin);
    const buyer = await partnersApi(app, admin).customer({ name: 'Өөрийн данстай дэлгүүр' });
    expect(await counterAccount(buyer.id)).toMatchObject({
      own: false,
      account: { code: '520201', name: 'Борлуулалтын хөнгөлөлт' },
    });
    const own = (
      await admins.createAccount({ code: '520299', name: 'НӨАТ-ын хөнгөлөлт', kind: 'INCOME' })
    ).body as { id: number };
    await setCounterAccount(accountant, buyer.id, own.id).expect(403);
    // A receivable, a cash, a stock and a switched-off account are refused, each with its reason.
    const off = (await admins.createAccount({ code: '520298', name: 'Унтраасан', kind: 'INCOME' }))
      .body as { id: number };
    await admins.patchAccount(off.id, { status: 'INACTIVE' }).expect(200);
    for (const [code, constraint] of [
      ['120101', 'control'],
      ['310101', 'control'],
      ['100101', 'money'],
      ['140101', 'inventory'],
      ['520298', 'active'],
    ] as const) {
      const account = await admins.account(code);
      expect(
        (await refusal(setCounterAccount(admin, buyer.id, account.id).expect(422))).errors,
      ).toEqual([expect.objectContaining({ path: 'counterAccount', constraint })]);
    }
    await setCounterAccount(admin, buyer.id, 999_999).expect(404);
    await setCounterAccount(admin, 999_999, own.id).expect(404);
    expect((await setCounterAccount(admin, buyer.id, own.id).expect(200)).body).toMatchObject({
      customerId: buyer.id,
      own: true,
      account: { id: own.id, code: '520299' },
    });
    expect(await counterAccount(buyer.id)).toMatchObject({
      own: true,
      account: { code: '520299' },
    });

    const invoice = await sellFor(buyer.id, milk, '3');
    const waived = (await waive(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(waived.vatWaiver).toMatchObject({ amount: '60.00', accountCode: '520299' });
    expect((await linesOf(waived.vatWaiver?.journalEntryId ?? null)).lines).toEqual([
      ['520299', '60.00', '0.00', null],
      ['120101', '0.00', '60.00', buyer.id],
    ]);

    // The account switched off after it was chosen: the waiver is refused, nothing is written.
    const next = await sellFor(buyer.id, milk, '1');
    await admins.patchAccount(own.id, { status: 'INACTIVE' }).expect(200);
    expect((await refusal(waive(waiverUser, next.id).expect(422))).errors).toEqual([
      expect.objectContaining({ path: 'counterAccount', constraint: 'usable' }),
    ]);
    expect(await waiverRows(next.id)).toEqual([]);
    expect(await invoiceOf(next.id)).toMatchObject({ openAmount: '1000.00', vatWaiver: null });
    // Back to the default: the sales discount account takes it again.
    expect((await setCounterAccount(admin, buyer.id, null).expect(200)).body).toMatchObject({
      own: false,
      account: { code: '520201' },
    });
    const byDefault = (await waive(waiverUser, next.id).expect(200)).body as VatInvoiceJson;
    expect(byDefault.vatWaiver).toMatchObject({ amount: '20.00', accountCode: '520201' });
  });

  it('takes the percent of what the returns left, rounded half up, frozen on the waiver', async () => {
    const finance = financeApi(app, accountant);
    const buyer = await partnersApi(app, admin).customer({ name: 'Тооцооны дэлгүүр' });
    // 337 × 2.50 % = 8.425 → 8.43 (half up; half-even would give 8.42).
    await setSettings(admin, { pct: '2.5', description: 'НӨАТ-ын хөнгөлөлт' }).expect(200);
    const small = await sellFor(buyer.id, odd, '1');
    expect(small.vatWaiverPreview).toMatchObject({ pct: '2.50', amount: '8.43' });
    const rounded = (await waive(waiverUser, small.id).expect(200)).body as VatInvoiceJson;
    expect(rounded).toMatchObject({ total: '337.00', openAmount: '328.57' });
    expect(rounded.vatWaiver).toMatchObject({
      pct: '2.50',
      baseAmount: '337.00',
      amount: '8.43',
      description: 'НӨАТ-ын хөнгөлөлт',
    });
    await setSettings(admin, { pct: '2.00', description: 'Борлуулалтын хөнгөлөлт' }).expect(200);
    // A later change of the setting reaches no waiver already made.
    expect((await invoiceOf(small.id)).vatWaiver).toMatchObject({
      pct: '2.50',
      amount: '8.43',
      description: 'НӨАТ-ын хөнгөлөлт',
    });

    // A return first: the waiver is 2 % of what is left of the invoice.
    const invoice = await sellFor(buyer.id, milk, '10');
    const line = invoice.lines?.[0];
    if (!line) throw new Error('no line');
    await finance
      .creditNote({
        invoiceId: invoice.id,
        reason: 'Үнийн залруулга',
        warehouseId: null,
        lines: [{ invoiceLineId: line.id, qty: '3' }],
      })
      .expect(201);
    expect((await invoiceOf(invoice.id)).vatWaiverPreview).toMatchObject({
      baseAmount: '7000.00',
      amount: '140.00',
    });
    const waived = (await waive(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(waived).toMatchObject({ openAmount: '6860.00' });
    expect(waived.vatWaiver).toMatchObject({ baseAmount: '7000.00', amount: '140.00' });

    // Everything returned: nothing is left to waive.
    const gone = await sellFor(buyer.id, milk, '2');
    const goneLine = gone.lines?.[0];
    if (!goneLine) throw new Error('no line');
    await finance
      .creditNote({
        invoiceId: gone.id,
        reason: 'Бүгдийг буцаав',
        warehouseId: null,
        lines: [{ invoiceLineId: goneLine.id, qty: '2' }],
      })
      .expect(201);
    expect((await invoiceOf(gone.id)).vatWaiverPreview).toMatchObject({
      amount: '0.00',
      blockedBy: 'NOTHING_LEFT',
    });
    expect(await refusal(waive(waiverUser, gone.id).expect(409))).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: { status: 'NOTHING_LEFT' },
    });
  });

  it("leaves the customer an open credit when the invoice is paid already, as a credit note's rest", async () => {
    const finance = financeApi(app, accountant);
    const buyer = await partnersApi(app, admin).customer({ name: 'Төлсөн дэлгүүр' });
    const cash = await financeApi(app, admin).cashBox('VWC');
    const invoice = await sellFor(buyer.id, milk, '5');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: buyer.id,
        amount: '4950',
        paidOn: today,
      })
      .expect(201);
    expect(await invoiceOf(invoice.id)).toMatchObject({ openAmount: '50.00' });
    // 2 % of 5,000 is 100: 50 settles what is open, 50 stays the customer's credit.
    const waived = (await waive(waiverUser, invoice.id).expect(200)).body as VatInvoiceJson;
    expect(waived).toMatchObject({ openAmount: '0.00', settlement: 'PAID' });
    expect(waived.vatWaiver).toMatchObject({ amount: '100.00' });
    expect(waived.allocations?.filter((row) => row.sourceType === 'VAT_WAIVER')).toEqual([
      expect.objectContaining({ amount: '50.00' }),
    ]);
    expect((await linesOf(waived.vatWaiver?.journalEntryId ?? null)).lines).toEqual([
      ['520201', '100.00', '0.00', null],
      ['120101', '0.00', '100.00', buyer.id],
    ]);
    expect(await finance.balance(buyer.id)).toMatchObject({ balance: '-50.00', openInvoices: 0 });

    // Paid in full before the waiver: the whole discount is an open credit.
    const paid = await sellFor(buyer.id, milk, '2');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: buyer.id,
        amount: '2000',
        paidOn: today,
        allocations: [{ invoiceId: paid.id, amount: '2000' }],
      })
      .expect(201);
    const credit = (await waive(waiverUser, paid.id).expect(200)).body as VatInvoiceJson;
    expect(credit).toMatchObject({ openAmount: '0.00' });
    expect(credit.allocations?.filter((row) => row.sourceType === 'VAT_WAIVER')).toEqual([]);
    expect(await finance.balance(buyer.id)).toMatchObject({ balance: '-90.00' });
    await undo(waiverUser, paid.id).expect(200);
    expect(await finance.balance(buyer.id)).toMatchObject({ balance: '-50.00' });
  });

  it('refuses a void invoice and a closed month, and writes nothing', async () => {
    const buyer = await partnersApi(app, admin).customer({ name: 'Татгалзах дэлгүүр' });
    const voided = await sellFor(buyer.id, milk, '1');
    await financeApi(app, accountant).voidInvoice(voided.id, 'Буруу борлуулалт').expect(200);
    expect((await invoiceOf(voided.id)).vatWaiverPreview.blockedBy).toBe('VOID');
    expect(await refusal(waive(waiverUser, voided.id).expect(409))).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: { number: voided.number, status: 'VOID' },
    });
    await waive(waiverUser, 999_999).expect(404);
    await undo(waiverUser, 999_999).expect(404);

    // The entry is dated today: with this month closed the core refuses it and its undo.
    const invoice = await sellFor(buyer.id, milk, '2');
    const waivedBefore = await sellFor(buyer.id, milk, '1');
    await waive(waiverUser, waivedBefore.id).expect(200);
    const month = today.slice(0, 7);
    const setMonth = (status: string) =>
      migrator.query(`UPDATE fin.fiscal_periods SET status = $2 WHERE code = $1`, [month, status]);
    await setMonth('CLOSED');
    try {
      expect(await refusal(waive(waiverUser, invoice.id).expect(409))).toMatchObject({
        code: 'FIN_PERIOD_CLOSED',
      });
      expect(await refusal(undo(waiverUser, waivedBefore.id).expect(409))).toMatchObject({
        code: 'FIN_PERIOD_CLOSED',
      });
    } finally {
      await setMonth('OPEN');
    }
    expect(await waiverRows(invoice.id)).toEqual([]);
    expect(await invoiceOf(invoice.id)).toMatchObject({ openAmount: '2000.00', vatWaiver: null });
    expect(await waiverRows(waivedBefore.id)).toEqual([
      { status: 'POSTED', amount: '20.00', reverse_reason: null },
    ]);
  });

  it("refuses a waiver while the customer holds a company's VAT receipt, and that receipt after a waiver", async () => {
    const finance = financeApi(app, accountant);
    const partners = partnersApi(app, admin);
    const company = await partners.customer({ name: 'НӨАТ авдаг ХХК', tin: FAKE_BUYER.tin });
    const person = await partners.customer({ kind: 'INDIVIDUAL', name: 'НӨАТ авахгүй иргэн' });
    const pending = await partners.customer({ name: 'ТТД хүлээж буй ХХК' });

    // A company's receipt waits for the store edge: the customer takes the VAT receipt.
    const taken = await sellFor(company.id, cola, '2', receiptFlow, {
      paymentMethod: 'BANK_TRANSFER',
    });
    expect(taken.receipt).toMatchObject({ receiptType: 'B2B', status: 'PENDING' });
    expect(taken.vatWaiverPreview).toMatchObject({ amount: '40.00', blockedBy: 'B2B_RECEIPT' });
    expect(await refusal(waive(waiverUser, taken.id).expect(409))).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: { number: taken.number, status: 'B2B_RECEIPT' },
    });
    expect(await waiverRows(taken.id)).toEqual([]);

    // A consumer's receipt does not stand in the way.
    const consumer = await sellFor(person.id, cola, '1', receiptFlow);
    expect(consumer.receipt).toMatchObject({ receiptType: 'B2C', status: 'PENDING' });
    expect((await waive(waiverUser, consumer.id).expect(200)).body).toMatchObject({
      openAmount: '980.00',
    });

    // A company's receipt that was never issued (no TIN yet) does not block the waiver, but after
    // the waiver it cannot be prepared again until the waiver is taken back.
    const unissued = await sellFor(pending.id, cola, '3', receiptFlow);
    expect(unissued.receipt).toMatchObject({ receiptType: 'B2B', status: 'ERROR' });
    expect(unissued.vatWaiverPreview.blockedBy).toBeNull();
    await waive(waiverUser, unissued.id).expect(200);
    expect(await refusal(finance.prepareReceipt(unissued.id).expect(409))).toMatchObject({
      code: 'EBARIMT_RECEIPT_STATE_INVALID',
      params: { status: 'VAT_WAIVED' },
    });
    await undo(waiverUser, unissued.id).expect(200);
    await finance.prepareReceipt(unissued.id).expect(200);
  });

  it('filters a customer’s sales by the waiver and totals both sides', async () => {
    const finance = financeApi(app, accountant);
    const all = (await finance.invoices({ customerId: shop.id, status: 'ISSUED', limit: 200 }))
      .data as VatInvoiceJson[];
    const waived = (
      await finance.invoices({ customerId: shop.id, status: 'ISSUED', vatWaived: true })
    ).data as VatInvoiceJson[];
    const taking = (
      await finance.invoices({ customerId: shop.id, status: 'ISSUED', vatWaived: false })
    ).data as VatInvoiceJson[];
    // The first test's invoice is waived, the second's was taken back.
    expect(waived.map((row) => row.vatWaiver?.status)).toEqual(['POSTED']);
    expect(taking.every((row) => row.vatWaiver === null)).toBe(true);
    expect(taking.length).toBeGreaterThan(0);
    expect([...waived, ...taking].map((row) => row.id).sort()).toEqual(
      all.map((row) => row.id).sort(),
    );
    await http()
      .get('/api/v1/invoices')
      .query({ vatWaived: 'maybe' })
      .set(bearer(accountant))
      .expect(422);

    const sum = (rows: VatInvoiceJson[], pick: (row: VatInvoiceJson) => string) =>
      rows.reduce((cents, row) => cents + Math.round(Number.parseFloat(pick(row)) * 100), 0);
    const side = (rows: VatInvoiceJson[]): SideJson => ({
      count: rows.length,
      total: (sum(rows, (row) => row.total) / 100).toFixed(2),
      vatTotal: (sum(rows, (row) => row.vatTotal) / 100).toFixed(2),
      openAmount: (sum(rows, (row) => row.openAmount) / 100).toFixed(2),
      waiverAmount: (sum(rows, (row) => row.vatWaiver?.amount ?? '0') / 100).toFixed(2),
    });
    const totals = async (query: Record<string, unknown>) =>
      (
        await http()
          .get(`/api/v1/customer-balances/${shop.id}/vat-totals`)
          .query(query)
          .set(bearer(accountant))
          .expect(200)
      ).body as { from: string | null; to: string | null; takesVat: SideJson; waived: SideJson };
    expect(await totals({ from: today, to: today })).toEqual({
      customerId: shop.id,
      from: today,
      to: today,
      takesVat: side(taking),
      waived: side(waived),
    });
    expect((await totals({})).waived).toEqual({
      count: 1,
      total: '10000.00',
      vatTotal: waived[0]?.vatTotal,
      openAmount: '9800.00',
      waiverAmount: '200.00',
    });
    // Outside the range: nothing on either side.
    const empty = {
      count: 0,
      total: '0.00',
      vatTotal: '0.00',
      openAmount: '0.00',
      waiverAmount: '0.00',
    };
    expect(await totals({ from: '2020-01-01', to: '2020-01-31' })).toMatchObject({
      takesVat: empty,
      waived: empty,
    });
  });

  it('leaves the books reconciled: balances, items, allocations and the invoices’ mirror', async () => {
    const run = await reconcileReceivables(app.get<Db>(DB), 'MANUAL');
    expect(run).toMatchObject({ status: 'OK', drifted: 0 });
  });
});
