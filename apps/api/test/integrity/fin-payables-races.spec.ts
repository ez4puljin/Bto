import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface ItemJson {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  openAmount: string;
}

/**
 * Races on a supplier's party (F3, ADR-0091): receipts of one supplier posted at once all book
 * their bills, two allocations of one payment never spend it twice, and a re-costing racing an
 * allocation of the same bill leaves the books whole. The party lock serialises them.
 */
describe('payables races', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let wh: WarehouseJson;
  let rice: ProductJson;
  let cash: { id: number };
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const draft = async (supplierId: number, amount: string) =>
    (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId,
          supplierDocDate: today,
          lines: [{ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1', docAmount: amount }],
        })
        .expect(201)
    ).body as { id: number; lines: { id: number }[] };
  const post = (id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(admin)).set(idempotency());
  const owed = async (supplierId: number) =>
    (
      (
        await http()
          .get(`/api/v1/supplier-balances/${supplierId}`)
          .set(bearer(accountant))
          .expect(200)
      ).body as { balance: string }
    ).balance;
  const items = async (supplierId: number) =>
    (
      (
        await http()
          .get(`/api/v1/supplier-balances/${supplierId}/open-items`)
          .set(bearer(accountant))
          .expect(200)
      ).body as { data: ItemJson[] }
    ).data;
  const pay = async (supplierId: number, amount: string) => {
    const finance = financeApi(app, accountant);
    await finance
      .journal({
        entryDate: today,
        description: 'Нийлүүлэгчид төлөв УР',
        lines: [
          { accountId: (await finance.account('310101')).id, debit: amount, supplierId },
          {
            accountId: (await finance.account('100101')).id,
            credit: amount,
            moneyAccountId: cash.id,
          },
        ],
      })
      .expect(201);
  };
  const allocate = (supplierId: number, debit: number, credit: number, amount: string) =>
    http()
      .post('/api/v1/finance/allocations')
      .set(bearer(accountant))
      .set(idempotency())
      .send({ supplierId, pairs: [{ debitItemId: debit, creditItemId: credit, amount }] });
  const reconciled = async () =>
    (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK');

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    wh = await inventoryApi(app, admin).warehouse('PR1');
    const catalog = catalogApi(app, admin);
    rice = await catalog.product({
      sku: '7951',
      name: 'Будаа УР',
      categoryId: await catalog.category('Будаа УР'),
      baseUomId: await catalog.uomId('PCS'),
    });
    // A receipt's lines go to their product's home (ADR-0099 #1).
    await inventoryApi(app, admin).setHome(rice.id, wh.id);
    cash = await financeApi(app, admin).cashBox('PR-CASH');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('books every bill of receipts of one supplier posted at once', async () => {
    const supplier = (await partnersApi(app, admin).supplier({ name: 'Уралдаан УР 1' })).id;
    const drafts = await Promise.all(
      ['1000', '2000', '3000', '4000', '5000'].map((amount) => draft(supplier, amount)),
    );
    const results = await Promise.all(drafts.map((receipt) => post(receipt.id)));
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await owed(supplier)).toBe('15000.00');
    expect(await reconciled()).toBe(true);
  });

  it('never spends one payment twice in two simultaneous allocations', async () => {
    const supplier = (await partnersApi(app, admin).supplier({ name: 'Уралдаан УР 2' })).id;
    const receipt = await draft(supplier, '5000');
    await post(receipt.id).expect(200);
    await pay(supplier, '3000');
    const open = await items(supplier);
    const bill = open.find((item) => item.side === 'CREDIT')?.id ?? 0;
    const payment = open.find((item) => item.side === 'DEBIT')?.id ?? 0;
    const results = await Promise.all([
      allocate(supplier, payment, bill, '3000'),
      allocate(supplier, payment, bill, '3000'),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 422]);
    expect(results.find((res) => res.status === 422)?.body).toMatchObject({
      code: 'FIN_OVER_ALLOCATION',
    });
    expect(await items(supplier)).toEqual([
      expect.objectContaining({ side: 'CREDIT', openAmount: '2000.00' }),
    ]);
    expect(await reconciled()).toBe(true);
  });

  it('keeps the books whole when a re-costing races an allocation of the same bill', async () => {
    const supplier = (await partnersApi(app, admin).supplier({ name: 'Уралдаан УР 3' })).id;
    const receipt = await draft(supplier, '5000');
    await post(receipt.id).expect(200);
    await pay(supplier, '5000');
    const open = await items(supplier);
    const bill = open.find((item) => item.side === 'CREDIT')?.id ?? 0;
    const payment = open.find((item) => item.side === 'DEBIT')?.id ?? 0;
    const [paired, recosted] = await Promise.all([
      allocate(supplier, payment, bill, '5000'),
      http()
        .put(`/api/v1/receipts/${receipt.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({ costingVersion: 1, lines: [{ lineId: receipt.lines[0]?.id, amount: '4000' }] }),
    ]);
    expect(recosted.status).toBe(200);
    // Paired first, the credit stays open; costed first, the bill holds 4,000 and the pairing
    // of 5,000 is refused. Either way the company paid 1,000 more than it owes.
    expect([201, 422]).toContain(paired.status);
    expect(await owed(supplier)).toBe('-1000.00');
    expect(await reconciled()).toBe(true);
  });
});
