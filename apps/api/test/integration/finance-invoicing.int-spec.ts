import type { NestExpressApplication } from '@nestjs/platform-express';
import { settlementDueDate } from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import type { ProductJson } from '../harness/catalog';
import { createHttpApp } from '../harness/apps';
import { financeApi, type ProblemJson, salesFlow, setSetting } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';

/**
 * Invoices (ADR-0060 #3): the sale issues one for the delivered quantities at the frozen prices,
 * the VAT split per line, the entry balanced and the receivable on the ledger; nothing delivered
 * means no invoice; an unpaid invoice is voided by a reversing entry, a settled one is not.
 * Synthetic data only.
 */
describe('finance invoicing', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let cola: ProductJson;
  let shop: CustomerJson;
  const today = businessDate();

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    // The company pays VAT at 10 % and no city tax: the split per line (ADR-0010 #4).
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    flow = await salesFlow(app, admin, 'FI');
    cola = await flow.product('8101', 'Кола', '1000', '100');
    shop = await partnersApi(app, admin).customer({ name: 'Нэхэмжлэхийн дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('invoices the sale for the delivered quantity, the taxes split and the entry balanced', async () => {
    const finance = financeApi(app, accountant);
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(cola), qty: '12' }]);
    // The picker finds 10 of the 12: the invoice is for 10.
    const sold = await flow.sell(draft.id, { 0: '10' });
    expect(sold.status).toBe('INVOICED');
    expect(sold.events.at(-1)).toMatchObject({
      fromStatus: 'DELIVERED',
      toStatus: 'INVOICED',
      reason: expect.stringMatching(/^Н-\d{8}-\d{4}$/),
    });
    const invoice = await finance.invoiceOfOrder(draft.id);
    expect(invoice).toMatchObject({
      number: sold.events.at(-1)?.reason,
      status: 'ISSUED',
      settlement: 'OPEN',
      customerId: shop.id,
      orderId: draft.id,
      orderNumber: draft.number,
      invoiceDate: today,
      // The settlement day of the harness's DAY_20 customer (ADR-0101).
      dueDate: settlementDueDate('DAY_20', today),
      overdue: false,
      paymentMethod: 'CASH',
      subtotal: '10000.00',
      discountTotal: '0.00',
      total: '10000.00',
      vatTotal: '909.09',
      cityTaxTotal: '0.00',
      openAmount: '10000.00',
      lineCount: 1,
      allocations: [],
      creditNotes: [],
    });
    expect(invoice?.lines).toEqual([
      expect.objectContaining({
        lineNo: 1,
        productId: cola.id,
        uomName: 'ш',
        qty: '10',
        qtyBase: '10',
        unitPrice: '1000.00',
        subtotal: '10000.00',
        total: '10000.00',
        vatRatePct: '10.00',
        vatAmount: '909.09',
        cityTaxAmount: '0.00',
        returnedBase: '0',
      }),
    ]);
    // The entry: Dr receivables, Cr sales net of VAT, Cr VAT payable.
    const entry = await finance.journalGet(invoice?.journalEntryId ?? 0);
    expect(entry).toMatchObject({
      number: invoice?.journalNumber,
      source: 'AUTO_INVOICE',
      sourceType: 'INVOICE',
      sourceId: invoice?.id,
      sourceNumber: invoice?.number,
      amount: '10000.00',
      entryDate: today,
    });
    expect(entry.lines?.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['120101', '10000.00', '0.00'],
      ['510101', '0.00', '9090.91'],
      ['311004', '0.00', '909.09'],
    ]);
    expect(entry.lines?.[0]?.customerId).toBe(shop.id);
    // The receivable: the ledger entry and the cache.
    expect(await finance.balance(shop.id)).toMatchObject({
      balance: '10000.00',
      openInvoices: 1,
      overdueAmount: '0.00',
      oldestDueDate: settlementDueDate('DAY_20', today),
      aging: expect.objectContaining({ NOT_DUE: '10000.00', D1_30: '0.00' }),
    });
    expect((await finance.ledger(shop.id)).data).toEqual([
      expect.objectContaining({
        kind: 'INVOICE',
        docType: 'INVOICE',
        docNumber: invoice?.number,
        debit: '10000.00',
        credit: '0.00',
        balanceAfter: '10000.00',
      }),
    ]);
    const attention = await finance.attention();
    expect(attention.openInvoices).toBeGreaterThanOrEqual(1);
    // Everyone with finance.read lists invoices; the order's invoice is found by its order.
    const listed = await financeApi(app, office).invoices({ customerId: shop.id });
    expect(listed.data.map((row) => row.id)).toEqual([invoice?.id]);
    expect(listed.total).toBe(1);
    expect((await finance.invoices({ q: draft.number ?? '' })).data.map((row) => row.id)).toEqual([
      invoice?.id,
    ]);
    expect((await finance.invoices({ settlement: 'PAID', customerId: shop.id })).data).toEqual([]);
  });

  it('issues no invoice when nothing was delivered: the order stays DELIVERED', async () => {
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(cola), qty: '3' }]);
    const sold = await flow.sell(draft.id, { 0: '0' });
    expect(sold.status).toBe('DELIVERED');
    expect(await financeApi(app, accountant).invoiceOfOrder(draft.id)).toBeNull();
  });

  it('voids an unpaid invoice with a reversing entry and refuses a settled one', async () => {
    const finance = financeApi(app, accountant);
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(cola), qty: '4' }]);
    await flow.sell(draft.id);
    const invoice = await finance.invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    const before = await finance.balance(shop.id);
    // The office reads but never voids.
    await financeApi(app, office).voidInvoice(invoice.id, 'Буруу').expect(403);
    expect(
      ((await finance.voidInvoice(invoice.id, '   ').expect(422)).body as ProblemJson).code,
    ).toBe('VALIDATION_FAILED');
    const voided = (await finance.voidInvoice(invoice.id, 'Давхар бичигдсэн').expect(200))
      .body as typeof invoice & { voidJournalEntryId: number | null };
    expect(voided).toMatchObject({
      status: 'VOID',
      settlement: 'PAID',
      openAmount: '0.00',
      voidReason: 'Давхар бичигдсэн',
    });
    const reversal = await finance.journalGet(voided.voidJournalEntryId ?? 0);
    expect(reversal).toMatchObject({ source: 'AUTO_VOID', reversesId: invoice.journalEntryId });
    expect(reversal.lines?.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['120101', '0.00', '4000.00'],
      ['510101', '3636.36', '0.00'],
      ['311004', '363.64', '0.00'],
    ]);
    const original = await finance.journalGet(invoice.journalEntryId ?? 0);
    expect(original.reversedById).toBe(reversal.id);
    expect((await finance.balance(shop.id)).balance).toBe(
      (Number.parseFloat(before.balance) - 4000).toFixed(2),
    );
    expect((await finance.ledger(shop.id)).data[0]).toMatchObject({
      kind: 'VOID',
      docNumber: invoice.number,
      credit: '4000.00',
    });
    // Voided once; a settled invoice is refused too.
    expect(
      ((await finance.voidInvoice(invoice.id, 'Дахин').expect(409)).body as ProblemJson).code,
    ).toBe('INVOICE_STATE_INVALID');
    const paidDraft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(cola), qty: '2' }]);
    await flow.sell(paidDraft.id);
    const paid = await finance.invoiceOfOrder(paidDraft.id);
    if (!paid) throw new Error('no invoice');
    const cash = await financeApi(app, admin).cashBox('FI-CASH');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: shop.id,
        amount: '2000',
        paidOn: today,
        allocations: [{ invoiceId: paid.id, amount: '2000' }],
      })
      .expect(201);
    const refused = (await finance.voidInvoice(paid.id, 'Төлсөн').expect(409)).body as ProblemJson;
    expect(refused).toMatchObject({
      code: 'INVOICE_STATE_INVALID',
      params: expect.objectContaining({ status: 'ALLOCATED' }),
    });
  });
});
