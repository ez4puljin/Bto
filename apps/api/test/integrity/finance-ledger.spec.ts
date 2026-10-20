import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { ArLedgerService } from '../../src/modules/finance';
import { connectAs, createHttpApp } from '../harness/apps';
import { financeApi, salesFlow } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/**
 * The receivables cache against the ledger (ADR-0060 #4; since F2 the Finance Core's party balances
 * against its open items, ADR-0090): every document leaves them equal, the reconciliation says so,
 * notices a cache written wrong, records it and repairs it.
 */
describe('finance ledger reconciliation', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let customerId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const flow = await salesFlow(app, admin, 'FL');
    const product = await flow.product('8601', 'Будаа', '1000', '50');
    const shop = await partnersApi(app, admin).customer({ name: 'Тулгалтын дэлгүүр' });
    customerId = shop.id;
    const finance = financeApi(app, admin);
    const sold = await flow.draft(shop.id, [{ productUnitId: flow.pcs(product), qty: '6' }]);
    await flow.sell(sold.id);
    const cash = await finance.cashBox('FL-CASH');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: shop.id,
        amount: '2500',
        paidOn: businessDate(),
      })
      .expect(201);
  });
  afterAll(async () => {
    await migrator.end();
    await app.close();
  });

  it('finds the cache equal to the ledger, then catches and repairs a wrong row', async () => {
    const ledger = app.get(ArLedgerService);
    const clean = await ledger.reconcile('MANUAL');
    expect(clean).toMatchObject({ status: 'OK', drifted: 0, details: [] });
    expect(clean.checked).toBeGreaterThanOrEqual(1);
    expect((await ledger.balanceOf(customerId)).balance.toFixed(2)).toBe('3500.00');

    // The cache moved to the Finance Core (F2, ADR-0090): the party's balance row.
    await migrator.query(
      `UPDATE fin.party_balances SET open_debit = open_debit + 1
        WHERE party_id = (SELECT party_id FROM fin.party_refs WHERE external_id = $1)`,
      [`customer:${customerId}`],
    );
    const drifted = await ledger.reconcile('NIGHTLY');
    expect(drifted).toMatchObject({ status: 'DRIFT', drifted: 1, details: [] });
    const cache = drifted.core.find((run) => run.kind === 'CACHE');
    expect(cache).toMatchObject({ status: 'DRIFT', drifted: 1 });
    expect(cache?.details).toEqual([
      expect.objectContaining({ expected: '3500.00/0.00', found: '3501.00/0.00' }),
    ]);
    const runs = await migrator.query<{ kind: string; status: string; drifted: number }>(
      'SELECT kind, status, drifted FROM finance_reconcile_runs WHERE id = $1',
      [drifted.id],
    );
    expect(runs.rows).toEqual([{ kind: 'NIGHTLY', status: 'DRIFT', drifted: 1 }]);
    const core = await migrator.query<{ kind: string; status: string; drifted: number }>(
      'SELECT kind, status, drifted FROM fin.reconcile_runs WHERE id = $1',
      [cache?.id],
    );
    expect(core.rows).toEqual([{ kind: 'CACHE', status: 'DRIFT', drifted: 1 }]);
    // Repaired by the run; the next one is clean again.
    expect((await ledger.balanceOf(customerId)).balance.toFixed(2)).toBe('3500.00');
    expect(await ledger.reconcile('MANUAL')).toMatchObject({ status: 'OK', drifted: 0 });
  });
});
