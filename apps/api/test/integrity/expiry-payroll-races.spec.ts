import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { systemActor } from '../../src/modules/identity';
import {
  PayrollSourceDeductionsService,
  type PayrollSourceDeductionInput,
} from '../../src/modules/payroll';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser, type SeededUser } from '../harness/identity';

interface SourceJson {
  id: number;
  state: string;
  amount: string;
  settlements: { id: number; releasedAt: string | null }[];
}
interface RunJson {
  id: number;
  lines: {
    userId: number;
    gross: string;
    net: string;
    deductions: string;
    otherAdditions: string;
  }[];
}

describe('integrity: expiry payroll source concurrency', () => {
  let app: NestExpressApplication;
  let db: Db;
  let sources: PayrollSourceDeductionsService;
  let admin: string;
  let employee: SeededUser;
  let run: RunJson;
  const month = businessDate().slice(0, 7);
  const actor = systemActor('expiry payroll races');
  const http = () => request(app.getHttpServer());
  const postSource = (input: PayrollSourceDeductionInput) =>
    inTransaction(db, (tx) => sources.recordInTx(tx, actor, input));
  const sale = (sourceKey: string, amount: string): PayrollSourceDeductionInput => ({
    sourceKind: 'EXPIRY_SALE',
    sourceKey,
    sourceReference: 'EXP-RACE',
    requestedMonth: month,
    allocations: [{ userId: employee.id, amount }],
  });

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    sources = app.get(PayrollSourceDeductionsService);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    employee = await seedUser(app);
    await http()
      .put(`/api/v1/payroll/terms/${employee.id}`)
      .set(bearer(admin))
      .send({ baseSalary: '1000', paysSocialInsurance: false, active: true, items: [] })
      .expect(200);
    run = (
      await http()
        .post('/api/v1/payroll/runs')
        .set(bearer(admin))
        .set(idempotency())
        .send({ month })
        .expect(201)
    ).body as RunJson;
  });
  afterAll(async () => {
    await app.close();
  });

  it('serializes cumulative concurrent returns and rolls back a source with its customer transaction', async () => {
    const original = await postSource(sale('race:sale', '100'));
    const returns = await Promise.allSettled(
      ['60', '50'].map((amount) =>
        postSource({
          sourceKind: 'EXPIRY_RETURN',
          sourceKey: `race:return:${amount}`,
          sourceReference: 'EXP-RACE',
          requestedMonth: month,
          reversesSourceKey: 'race:sale',
          allocations: [{ userId: employee.id, amount: `-${amount}` }],
        }),
      ),
    );
    expect(returns.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(returns.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const client = await connectAs('app');
    try {
      // The database guard rejects over-reversal even outside the trusted port.
      expect(
        await sqlStateOf(
          client.query(
            "INSERT INTO payroll_source_deductions (source_kind, source_key, source_reference, user_id, amount, reverses_id) VALUES ('EXPIRY_RETURN', 'race:over-reverse-sql', 'EXP-RACE', $1, -51, $2)",
            [employee.id, original[0]!.id],
          ),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          client.query(
            "INSERT INTO payroll_source_deductions (source_kind, source_key, source_reference, user_id, amount) VALUES ('EXPIRY_SALE', 'race:nan', 'EXP-RACE', $1, 'NaN'::numeric)",
            [employee.id],
          ),
        ),
      ).toBe('23514');
    } finally {
      await client.end();
    }
    await expect(
      inTransaction(db, async (tx) => {
        await sources.recordInTx(tx, actor, sale('race:rolled-back', '20'));
        throw new Error('sale failed');
      }),
    ).rejects.toThrow('sale failed');
    const rows = (
      await http().get('/api/v1/payroll/source-deductions').set(bearer(admin)).expect(200)
    ).body as (SourceJson & { sourceKey: string })[];
    expect(rows.some((row) => row.sourceKey === 'race:rolled-back')).toBe(false);
  });

  it('racing approval and a finalized sale either settles once or keeps a visible closed-month obligation', async () => {
    const [approved] = await Promise.all([
      http().post(`/api/v1/payroll/runs/${run.id}/approve`).set(bearer(admin)).expect(200),
      postSource(sale('race:approval-sale', '7')),
    ]);
    const frozen = approved.body as RunJson;
    const rows = (
      await http().get('/api/v1/payroll/source-deductions').set(bearer(admin)).expect(200)
    ).body as SourceJson[];
    const amountsSettled = rows.filter((row) =>
      row.settlements.some((settlement) => settlement.releasedAt === null),
    );
    const netSource = amountsSettled.reduce((total, row) => total.plus(row.amount), new Decimal(0));
    const line = frozen.lines.find((entry) => entry.userId === employee.id)!;
    expect(new Decimal(line.gross).minus(line.net).toFixed(2)).toBe(netSource.toFixed(2));
    const late = rows.find((row) => row.amount === '7.00')!;
    expect(['SETTLED', 'MONTH_CLOSED']).toContain(late.state);
    expect(late.settlements.filter((settlement) => settlement.releasedAt === null)).toHaveLength(
      late.state === 'SETTLED' ? 1 : 0,
    );
    await postSource(sale('race:approval-sale', '7'));
    const reread = (
      await http().get(`/api/v1/payroll/runs/${run.id}`).set(bearer(admin)).expect(200)
    ).body as RunJson;
    expect(reread.lines).toEqual(frozen.lines);
  });
});
