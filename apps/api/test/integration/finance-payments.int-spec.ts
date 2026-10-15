import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { ProductJson } from '../harness/catalog';
import { createHttpApp } from '../harness/apps';
import {
  financeApi,
  type InvoiceJson,
  type PaymentJson,
  type ProblemJson,
  salesFlow,
} from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

/**
 * The vouchers (ADR-0060 #5): a customer's payment settles the open invoices oldest due first or as
 * the accountant allocates it, the rest is an advance; refunds, other income and expenses hit
 * their accounts; a voided voucher gives the invoices their open amounts back; the cash book runs
 * a balance. Synthetic data only.
 */
describe('finance payments', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let water: ProductJson;
  let shop: CustomerJson;
  let cash: { id: number };
  let first: InvoiceJson;
  let second: InvoiceJson;
  let advance: PaymentJson;
  const today = businessDate();

  const sellFor = async (qty: string): Promise<InvoiceJson> => {
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(water), qty }]);
    await flow.sell(draft.id);
    const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    return invoice;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'FP');
    water = await flow.product('8201', 'Ус', '1000', '500');
    shop = await partnersApi(app, admin).customer({ name: 'Төлбөрийн дэлгүүр' });
    cash = await financeApi(app, admin).cashBox('FP-CASH');
    first = await sellFor('5');
    second = await sellFor('7');
  });
  afterAll(async () => {
    await app.close();
  });

  it('settles the open invoices oldest due first and keeps the rest as an advance', async () => {
    const finance = financeApi(app, accountant);
    // The office may not record money.
    await financeApi(app, office)
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: shop.id,
        amount: '8000',
        paidOn: today,
      })
      .expect(403);
    const payment = (
      await finance
        .payment({
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: cash.id,
          customerId: shop.id,
          amount: '8000',
          paidOn: today,
          description: 'Жолооч тушаасан',
        })
        .expect(201)
    ).body as PaymentJson;
    expect(payment).toMatchObject({
      number: expect.stringMatching(/^Т-\d{8}-\d{4}$/),
      status: 'POSTED',
      kind: 'CUSTOMER_PAYMENT',
      direction: 'IN',
      amount: '8000.00',
      allocatedAmount: '8000.00',
    });
    expect(payment.allocations).toEqual([
      expect.objectContaining({ invoiceId: first.id, amount: '5000.00', voidedAt: null }),
      expect.objectContaining({ invoiceId: second.id, amount: '3000.00', voidedAt: null }),
    ]);
    expect(await finance.invoice(first.id)).toMatchObject({
      settlement: 'PAID',
      openAmount: '0.00',
    });
    expect(await finance.invoice(second.id)).toMatchObject({
      settlement: 'PARTIAL',
      openAmount: '4000.00',
      allocations: [
        expect.objectContaining({
          sourceType: 'PAYMENT',
          sourceNumber: payment.number,
          amount: '3000.00',
        }),
      ],
    });
    // Dr cash / Cr receivables, the cash line naming the money account.
    const entry = await finance.journalGet(payment.journalEntryId ?? 0);
    expect(entry).toMatchObject({ source: 'AUTO_PAYMENT', sourceNumber: payment.number });
    expect(
      entry.lines?.map((line) => [line.accountCode, line.debit, line.credit, line.moneyAccountId]),
    ).toEqual([
      ['100101', '8000.00', '0.00', cash.id],
      ['120101', '0.00', '8000.00', null],
    ]);
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '4000.00', openInvoices: 1 });

    // 6,000 more: 4,000 settle the second invoice, 2,000 stay as an advance.
    advance = (
      await finance
        .payment({
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: cash.id,
          customerId: shop.id,
          amount: '6000',
          paidOn: today,
        })
        .expect(201)
    ).body as PaymentJson;
    expect(advance.allocatedAmount).toBe('4000.00');
    expect(await finance.invoice(second.id)).toMatchObject({ settlement: 'PAID' });
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '-2000.00', openInvoices: 0 });
    const ledger = await finance.ledger(shop.id);
    expect(ledger.data.map((row) => [row.kind, row.debit, row.credit, row.balanceAfter])).toEqual([
      ['PAYMENT', '0.00', '6000.00', '-2000.00'],
      ['PAYMENT', '0.00', '8000.00', '4000.00'],
      ['INVOICE', '7000.00', '0.00', '12000.00'],
      ['INVOICE', '5000.00', '0.00', '5000.00'],
    ]);
    // The cash book and the money account's balance.
    const book = await finance.book(cash.id);
    expect(book.data.map((row) => [row.number, row.balanceAfter])).toEqual([
      [advance.number, '14000.00'],
      [payment.number, '8000.00'],
    ]);
    expect((await finance.moneyAccounts()).find((account) => account.id === cash.id)).toMatchObject(
      { balance: '14000.00' },
    );
  });

  it('checks the allocations the accountant chooses', async () => {
    const finance = financeApi(app, accountant);
    const third = await sellFor('3');
    const base = {
      kind: 'CUSTOMER_PAYMENT',
      moneyAccountId: cash.id,
      customerId: shop.id,
      paidOn: today,
    };
    // A settled invoice is not open; more than the open amount; more than the payment.
    expect(
      (
        (
          await finance
            .payment({
              ...base,
              amount: '1000',
              allocations: [{ invoiceId: first.id, amount: '1000' }],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'allocations[0].invoiceId' })]);
    expect(
      (
        (
          await finance
            .payment({
              ...base,
              amount: '5000',
              allocations: [{ invoiceId: third.id, amount: '5000' }],
            })
            .expect(422)
        ).body as ProblemJson
      ).code,
    ).toBe('ALLOCATION_EXCEEDS');
    expect(
      (
        (
          await finance
            .payment({
              ...base,
              amount: '1000',
              allocations: [{ invoiceId: third.id, amount: '2000' }],
            })
            .expect(422)
        ).body as ProblemJson
      ).code,
    ).toBe('ALLOCATION_EXCEEDS');
    // A chosen partial allocation; the rest is an advance.
    const chosen = (
      await finance
        .payment({
          ...base,
          amount: '2500',
          allocations: [{ invoiceId: third.id, amount: '2000' }],
        })
        .expect(201)
    ).body as PaymentJson;
    expect(chosen.allocatedAmount).toBe('2000.00');
    expect(await finance.invoice(third.id)).toMatchObject({
      settlement: 'PARTIAL',
      openAmount: '1000.00',
    });
    // Shape errors: a customer payment names its customer, another expense its account, no future dates.
    await finance
      .payment({ kind: 'CUSTOMER_PAYMENT', moneyAccountId: cash.id, amount: '1', paidOn: today })
      .expect(422);
    await finance
      .payment({ kind: 'OTHER_OUT', moneyAccountId: cash.id, amount: '1', paidOn: today })
      .expect(422);
    await finance.payment({ ...base, amount: '1', paidOn: addDays(today, 1) }).expect(422);
  });

  it('voids a voucher: the invoices open again, the entry is reversed, the book forgets it', async () => {
    const finance = financeApi(app, accountant);
    const before = await finance.balance(shop.id);
    const voided = (await finance.voidPayment(advance.id, 'Буруу дүн').expect(200))
      .body as PaymentJson & {
      voidJournalEntryId: number | null;
    };
    expect(voided).toMatchObject({
      status: 'VOID',
      voidReason: 'Буруу дүн',
      allocatedAmount: '0.00',
    });
    expect(voided.allocations?.every((allocation) => allocation.voidedAt !== null)).toBe(true);
    expect(await finance.invoice(second.id)).toMatchObject({
      settlement: 'PARTIAL',
      openAmount: '4000.00',
    });
    expect((await finance.balance(shop.id)).balance).toBe(
      (Number.parseFloat(before.balance) + 6000).toFixed(2),
    );
    const reversal = await finance.journalGet(voided.voidJournalEntryId ?? 0);
    expect(reversal).toMatchObject({ source: 'AUTO_VOID', reversesId: advance.journalEntryId });
    expect(reversal.lines?.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['100101', '0.00', '6000.00'],
      ['120101', '6000.00', '0.00'],
    ]);
    expect((await finance.book(cash.id)).data.map((row) => row.number)).not.toContain(
      advance.number,
    );
    expect(
      ((await finance.voidPayment(advance.id, 'Дахин').expect(409)).body as ProblemJson).code,
    ).toBe('PAYMENT_STATE_INVALID');
    expect(
      (await finance.payments({ status: 'VOID', customerId: shop.id })).data.map((row) => row.id),
    ).toEqual([advance.id]);
  });

  it('records refunds, other income and expenses against their accounts', async () => {
    const finance = financeApi(app, accountant);
    const expense = await finance.account('730101');
    const other = (
      await finance
        .payment({
          kind: 'OTHER_OUT',
          moneyAccountId: cash.id,
          glAccountId: expense.id,
          amount: '1500',
          paidOn: today,
          counterpartyName: 'Цахилгаан',
          description: 'Сарын цахилгаан',
        })
        .expect(201)
    ).body as PaymentJson;
    expect(other).toMatchObject({ direction: 'OUT', glAccountId: expense.id, customerId: null });
    const entry = await finance.journalGet(other.journalEntryId ?? 0);
    expect(entry.lines?.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['730101', '1500.00', '0.00'],
      ['100101', '0.00', '1500.00'],
    ]);
    const before = await finance.balance(shop.id);
    const refund = (
      await finance
        .payment({
          kind: 'CUSTOMER_REFUND',
          moneyAccountId: cash.id,
          customerId: shop.id,
          amount: '500',
          paidOn: today,
        })
        .expect(201)
    ).body as PaymentJson;
    expect(refund).toMatchObject({ direction: 'OUT', allocatedAmount: '0.00' });
    expect((await finance.balance(shop.id)).balance).toBe(
      (Number.parseFloat(before.balance) + 500).toFixed(2),
    );
    expect((await finance.ledger(shop.id)).data[0]).toMatchObject({
      kind: 'REFUND',
      debit: '500.00',
      docNumber: refund.number,
    });
    const accounts = await finance.accounts();
    expect(accounts.find((account) => account.code === '730101')).toMatchObject({
      debit: '1500.00',
    });
    expect((await finance.payments({ kind: 'OTHER_OUT', moneyAccountId: cash.id })).data).toEqual([
      expect.objectContaining({ id: other.id }),
    ]);
  });
});
