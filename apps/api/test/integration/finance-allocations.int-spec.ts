import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { idempotency } from '../harness/catalog';
import { financeApi, type InvoiceJson, type ProblemJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

interface OpenItemJson {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  kind: string;
  documentType: string;
  documentId: number;
  number: string;
  openAmount: string;
}

/**
 * The accountant's manual allocation (F2, ADR-0090; docs/modules/finance-core.md §11): an advance
 * paid before the sale stays open until the accountant pairs it with the invoice; the pairing shows
 * on the invoice, the balance stays, and its reversal gives both open amounts back.
 */
describe('finance manual allocation', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let office: string;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('pairs an advance with a later invoice by hand and reverses the pairing', async () => {
    const flow = await salesFlow(app, admin, 'FA');
    const product: ProductJson = await flow.product('8901', 'Гурил', '1000', '50');
    const shop = await partnersApi(app, admin).customer({ name: 'Тулгалтын харилцагч' });
    const finance = financeApi(app, accountant);
    const cash = await financeApi(app, admin).cashBox('FA-CASH');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: shop.id,
        amount: '8000',
        paidOn: today,
      })
      .expect(201);
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(product), qty: '5' }]);
    await flow.sell(draft.id);
    const invoice = (await finance.invoiceOfOrder(draft.id)) as InvoiceJson;
    expect(invoice.openAmount).toBe('5000.00');

    const items = (
      await http()
        .get(`/api/v1/customer-balances/${shop.id}/open-items`)
        .set(bearer(accountant))
        .expect(200)
    ).body as { data: OpenItemJson[] };
    const credit = items.data.find((item) => item.side === 'CREDIT');
    const debit = items.data.find((item) => item.side === 'DEBIT');
    expect(credit).toMatchObject({ kind: 'PAYMENT', documentType: 'PAYMENT', openAmount: '8000.00' });
    expect(debit).toMatchObject({
      kind: 'INVOICE',
      documentType: 'INVOICE',
      documentId: invoice.id,
      number: invoice.number,
      openAmount: '5000.00',
    });
    const body = {
      customerId: shop.id,
      pairs: [{ debitItemId: debit?.id, creditItemId: credit?.id, amount: '5000' }],
    };
    // Only the right that records payments allocates.
    await http()
      .post('/api/v1/finance/allocations')
      .set(bearer(office))
      .set(idempotency())
      .send(body)
      .expect(403);
    const tooMuch = (
      await http()
        .post('/api/v1/finance/allocations')
        .set(bearer(accountant))
        .set(idempotency())
        .send({ ...body, pairs: [{ ...body.pairs[0], amount: '6000' }] })
        .expect(422)
    ).body as ProblemJson;
    expect(tooMuch.code).toBe('FIN_OVER_ALLOCATION');
    const allocation = (
      await http()
        .post('/api/v1/finance/allocations')
        .set(bearer(accountant))
        .set(idempotency())
        .send(body)
        .expect(201)
    ).body as { id: number; number: string; amount: string };
    expect(allocation).toMatchObject({ number: expect.stringMatching(/^Х-\d{8}-\d{4}$/), amount: '5000.00' });
    expect(await finance.invoice(invoice.id)).toMatchObject({
      settlement: 'PAID',
      openAmount: '0.00',
      allocations: [
        expect.objectContaining({
          sourceType: 'ALLOCATION',
          sourceId: allocation.id,
          sourceNumber: allocation.number,
          amount: '5000.00',
          voidedAt: null,
        }),
      ],
    });
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '-3000.00', openInvoices: 0 });

    await http()
      .post(`/api/v1/finance/allocations/${allocation.id}/reverse`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ reason: 'Буруу тулгасан' })
      .expect(200);
    expect(await finance.invoice(invoice.id)).toMatchObject({
      settlement: 'OPEN',
      openAmount: '5000.00',
      allocations: [expect.objectContaining({ voidedAt: expect.any(String) })],
    });
    expect(await finance.balance(shop.id)).toMatchObject({ balance: '-3000.00', openInvoices: 1 });
    await http()
      .post(`/api/v1/finance/allocations/${allocation.id}/reverse`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ reason: 'Дахин' })
      .expect(422);
  });
});
