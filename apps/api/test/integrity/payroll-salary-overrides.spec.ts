import type { NestExpressApplication } from '@nestjs/platform-express';
import { addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { seedUser } from '../harness/identity';

describe('employee salary override history guards', () => {
  let app: NestExpressApplication;
  let db: Client;
  let userId: number;
  let otherId: number;
  const month = businessDate().slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  beforeAll(async () => {
    app = await createHttpApp();
    db = await connectAs('app');
    userId = (await seedUser(app)).id;
    otherId = (await seedUser(app)).id;
  });
  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it('permits only next-month changes and rejects invalid money', async () => {
    for (const target of [
      month,
      addMonths(`${month}-01`, -1).slice(0, 7),
      addMonths(`${month}-01`, 2).slice(0, 7),
      '2026-13',
    ]) {
      expect(
        await sqlStateOf(
          db.query(
            'INSERT INTO payroll_salary_overrides(user_id,effective_month,base_salary) VALUES ($1,$2,10)',
            [userId, target],
          ),
        ),
      ).toBe('23514');
    }
    await db.query(
      'INSERT INTO payroll_salary_overrides(user_id,effective_month,base_salary) VALUES ($1,$2,0)',
      [userId, nextMonth],
    );
    for (const amount of ['-1', 'NaN']) {
      expect(
        await sqlStateOf(
          db.query('UPDATE payroll_salary_overrides SET base_salary=$1 WHERE user_id=$2', [
            amount,
            userId,
          ]),
        ),
      ).toBe('23514');
    }
    await db.query('UPDATE payroll_salary_overrides SET base_salary=NULL WHERE user_id=$1', [
      userId,
    ]);
    expect(
      await sqlStateOf(
        db.query('UPDATE payroll_salary_overrides SET user_id=$1 WHERE user_id=$2', [
          otherId,
          userId,
        ]),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        db.query('UPDATE payroll_salary_overrides SET effective_month=$1 WHERE user_id=$2', [
          month,
          userId,
        ]),
      ),
    ).toBe('23514');
  });

  it('does not let the runtime delete or truncate salary history', async () => {
    expect(
      await sqlStateOf(db.query('DELETE FROM payroll_salary_overrides WHERE user_id=$1', [userId])),
    ).toBe('42501');
    expect(await sqlStateOf(db.query('TRUNCATE payroll_salary_overrides'))).toBe('42501');
  });
});
