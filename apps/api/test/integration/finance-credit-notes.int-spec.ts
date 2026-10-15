import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { financeApi, type InvoiceJson, type ProblemJson, salesFlow } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';

interface CreditNoteJson {
  id: number;
  number: string;
  invoiceId: number;
  total: string;
  vatTotal: string;
  allocatedAmount: string;
  warehouseId: number | null;
  binCode: string | null;
  journalEntryId: number | null;
  lines: { invoiceLineId: number; qty: string; qtyBase: string; total: string }[];
}

/**
 * Credit notes (ADR-0060 #6): goods of an invoice come back into the RETURNS bin at the invoiced
 * prices, the invoice is settled up to its open amount, the receivable and the sales returns are
 * posted; a settled invoice's return becomes an advance; nothing is returned twice. Synthetic data
 * only.
 */
describe('finance credit notes', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let milk: ProductJson;
  let shop: CustomerJson;
  const today = businessDate();

  const stockOf = async (productId: number) =>
    (
      await sql.query<{ bin: string; on_hand: string }>(
        `SELECT b.type AS bin, bs.on_hand::text FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id
          WHERE bs.product_id = $1 AND bs.on_hand <> 0 ORDER BY b.type`,
        [productId],
      )
    ).rows;
  const sellFor = async (qty: string): Promise<InvoiceJson> => {
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(milk), qty }]);
    await flow.sell(draft.id);
    const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    return invoice;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'FN');
    milk = await flow.product('8401', 'Сүү', '1000', '100');
    shop = await partnersApi(app, admin).customer({ name: 'Буцаалтын дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('takes goods back into RETURNS, settles the invoice and posts the return', async () => {
    const finance = financeApi(app, accountant);
    const invoice = await sellFor('10');
    const line = invoice.lines?.[0];
    if (!line) throw new Error('no line');
    expect(await stockOf(milk.id)).toEqual([{ bin: 'STORAGE', on_hand: '90.000' }]);
    await financeApi(app, office)
      .creditNote({
        invoiceId: invoice.id,
        reason: 'Гэмтэлтэй',
        warehouseId: flow.wh.id,
        lines: [{ invoiceLineId: line.id, qty: '3' }],
      })
      .expect(403);
    const note = (
      await finance
        .creditNote({
          invoiceId: invoice.id,
          reason: 'Гэмтэлтэй',
          warehouseId: flow.wh.id,
          lines: [{ invoiceLineId: line.id, qty: '3' }],
        })
        .expect(201)
    ).body as CreditNoteJson;
    expect(note).toMatchObject({
      number: expect.stringMatching(/^К-\d{8}-\d{4}$/),
      invoiceId: invoice.id,
      total: '3000.00',
      allocatedAmount: '3000.00',
      warehouseId: flow.wh.id,
      binCode: expect.any(String),
    });
    expect(note.lines).toEqual([
      expect.objectContaining({ invoiceLineId: line.id, qty: '3', qtyBase: '3', total: '3000.00' }),
    ]);
    expect(await stockOf(milk.id)).toEqual([
      { bin: 'RETURNS', on_hand: '3.000' },
      { bin: 'STORAGE', on_hand: '90.000' },
    ]);
    const movements = await sql.query<{ movement_type: string; qty_base: string }>(
      `SELECT movement_type, qty_base::text FROM stock_ledger WHERE doc_type = 'CN' AND doc_id = $1`,
      [note.id],
    );
    expect(movements.rows).toEqual([{ movement_type: 'RETURN_IN', qty_base: '3.000' }]);
    const after = await finance.invoice(invoice.id);
    expect(after).toMatchObject({ settlement: 'PARTIAL', openAmount: '7000.00' });
    expect(after.lines?.[0]?.returnedBase).toBe('3');
    expect(after.allocations).toEqual([
      expect.objectContaining({
        sourceType: 'CREDIT_NOTE',
        sourceNumber: note.number,
        amount: '3000.00',
      }),
    ]);
    expect(after.creditNotes).toEqual([expect.objectContaining({ number: note.number })]);
    const entry = await finance.journalGet(note.journalEntryId ?? 0);
    expect(entry).toMatchObject({ source: 'AUTO_CREDIT_NOTE', sourceNumber: note.number });
    expect(entry.lines?.map((row) => [row.accountCode, row.debit, row.credit])).toEqual([
      ['520101', '3000.00', '0.00'],
      ['120101', '0.00', '3000.00'],
    ]);
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '7000.00', openInvoices: 1 });
    expect((await finance.ledger(shop.id)).data[0]).toMatchObject({
      kind: 'CREDIT_NOTE',
      docNumber: note.number,
      credit: '3000.00',
    });
    // Never more than was invoiced; only lines of that invoice; the number of the ledger's document.
    expect(
      (
        (
          await finance
            .creditNote({
              invoiceId: invoice.id,
              reason: 'Дахин',
              warehouseId: flow.wh.id,
              lines: [{ invoiceLineId: line.id, qty: '8' }],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'lines[0].qty', constraint: 'max' })]);
    const other = await sellFor('1');
    expect(
      (
        (
          await finance
            .creditNote({
              invoiceId: other.id,
              reason: 'Өөр',
              warehouseId: flow.wh.id,
              lines: [{ invoiceLineId: line.id, qty: '1' }],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'lines[0].invoiceLineId' })]);
    const history = (
      await inventoryApi(app, admin)
        .http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'CN', productId: milk.id })
        .set(inventoryApi(app, admin).auth)
        .expect(200)
    ).body as { data: { docNumber: string | null }[] };
    expect(history.data.map((row) => row.docNumber)).toEqual([note.number]);
  });

  it('credits a settled invoice as an advance and corrects a price without stock', async () => {
    const finance = financeApi(app, accountant);
    const invoice = await sellFor('2');
    const cash = await financeApi(app, admin).cashBox('FN-CASH');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: shop.id,
        amount: '2000',
        paidOn: today,
        allocations: [{ invoiceId: invoice.id, amount: '2000' }],
      })
      .expect(201);
    const before = await finance.balance(shop.id);
    const stockBefore = await stockOf(milk.id);
    const note = (
      await finance
        .creditNote({
          invoiceId: invoice.id,
          reason: 'Үнийн зөрүү',
          warehouseId: null,
          lines: [{ invoiceLineId: invoice.lines?.[0]?.id, qty: '1' }],
        })
        .expect(201)
    ).body as CreditNoteJson;
    expect(note).toMatchObject({ total: '1000.00', allocatedAmount: '0.00', warehouseId: null });
    expect(await stockOf(milk.id)).toEqual(stockBefore);
    expect((await finance.balance(shop.id)).balance).toBe(
      (Number.parseFloat(before.balance) - 1000).toFixed(2),
    );
    expect(await finance.invoice(invoice.id)).toMatchObject({
      settlement: 'PAID',
      openAmount: '0.00',
    });
    // A voided invoice takes no credit note.
    const voidable = await sellFor('1');
    await finance.voidInvoice(voidable.id, 'Буруу').expect(200);
    expect(
      (
        (
          await finance
            .creditNote({
              invoiceId: voidable.id,
              reason: 'Хүчингүй',
              warehouseId: null,
              lines: [{ invoiceLineId: voidable.lines?.[0]?.id, qty: '1' }],
            })
            .expect(409)
        ).body as ProblemJson
      ).code,
    ).toBe('INVOICE_STATE_INVALID');
    expect((await finance.creditNotes({ customerId: shop.id })).data).toHaveLength(2);
  });
});
