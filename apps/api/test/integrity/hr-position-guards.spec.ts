import type { NestExpressApplication } from '@nestjs/platform-express';
import { addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

describe('position money and access database guards', () => {
  let app: NestExpressApplication;
  let db: Client;
  let positionId: number;
  let userId: number;
  const month = businessDate().slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);

  beforeAll(async () => {
    app = await createHttpApp();
    db = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const roles = (
      await request(app.getHttpServer()).get('/api/v1/roles').set(bearer(admin)).expect(200)
    ).body as { data: { id: number; code: string }[] };
    const officeRole = roles.data.find((row) => row.code === 'OFFICE')!.id;
    const position = await request(app.getHttpServer())
      .post('/api/v1/hr/positions')
      .set(bearer(admin))
      .send({ name: 'Guarded position', baseSalary: '1000000', roleIds: [officeRole] })
      .expect(201);
    positionId = (position.body as { id: number }).id;
    const staff = await request(app.getHttpServer())
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        firstName: 'Guard',
        lastName: 'Test',
        phone: '88119901',
        positionId,
        position: null,
        divisionId: null,
        employmentType: 'PERMANENT',
        gender: null,
        employedOn: null,
        scheduleId: null,
        password: 'Guards-2026',
      })
      .expect(201);
    userId = (staff.body as { userId: number }).userId;
  });
  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it('refuses rewriting salary history and backdated or far-future inserts', async () => {
    expect(
      await sqlStateOf(
        db.query(
          'UPDATE hr_position_salaries SET base_salary=1 WHERE position_id=$1 AND effective_month=$2',
          [positionId, month],
        ),
      ),
    ).toBe('23514');
    for (const value of [
      addMonths(`${month}-01`, -1).slice(0, 7),
      addMonths(`${month}-01`, 2).slice(0, 7),
    ]) {
      expect(
        await sqlStateOf(
          db.query(
            'INSERT INTO hr_position_salaries (position_id,effective_month,base_salary) VALUES ($1,$2,1)',
            [positionId, value],
          ),
        ),
      ).toBe('23514');
    }
    await db.query(
      'INSERT INTO hr_position_salaries (position_id,effective_month,base_salary) VALUES ($1,$2,1200000)',
      [positionId, nextMonth],
    );
    await db.query(
      'UPDATE hr_position_salaries SET base_salary=1300000 WHERE position_id=$1 AND effective_month=$2',
      [positionId, nextMonth],
    );
    expect(
      await sqlStateOf(
        db.query(
          'UPDATE hr_employee_position_assignments SET position_id=position_id WHERE user_id=$1 AND effective_month=$2',
          [userId, month],
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        db.query(
          'INSERT INTO hr_employee_position_assignments (user_id,position_id,effective_month) VALUES ($1,$2,$3)',
          [userId, positionId, addMonths(`${month}-01`, 2).slice(0, 7)],
        ),
      ),
    ).toBe('23514');
  });

  it('rejects direct role drift, clearing the position/ownership and truncation', async () => {
    expect(await sqlStateOf(db.query('DELETE FROM user_roles WHERE user_id=$1', [userId]))).toBe(
      '23514',
    );
    expect(
      await sqlStateOf(
        db.query('DELETE FROM hr_position_roles WHERE position_id=$1', [positionId]),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(
        db.query('UPDATE hr_employees SET position_id=NULL WHERE user_id=$1', [userId]),
      ),
    ).toBe('23514');
    expect(
      await sqlStateOf(db.query('UPDATE users SET roles_managed_by=NULL WHERE id=$1', [userId])),
    ).toBe('23514');
    for (const table of [
      'hr_positions',
      'hr_position_roles',
      'hr_position_salaries',
      'hr_employee_position_assignments',
    ]) {
      expect(await sqlStateOf(db.query(`TRUNCATE ${table} CASCADE`))).toBe('42501');
    }
  });
});
