import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FinReports } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { codeOf } from '../harness/fin-intake';
import { bearer, login, seedUser } from '../harness/identity';
import { StaticCaller, TEST_COMPANY } from '../harness/static-caller';

/** Malformed filters must be rejected before SQL or before another employee is selected. */
describe('request boundaries: real dates and strict query values', () => {
  let app: NestExpressApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['2025-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-11-00'])(
    'rejects the nonexistent report date %s with a field error',
    async (from) => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/finance/reports/statements/balance')
        .set(bearer(admin))
        .query({ from, to: '2026-12-31' })
        .expect(422);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    },
  );

  it('accepts leap day and ordinary dates through the same report route', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/finance/reports/statements/balance')
      .set(bearer(admin))
      .query({ from: '2024-02-29', to: '2024-03-01' })
      .expect(200);
  });

  it.each(['1tail', '1.5', '1e3', '', '9007199254740992'])(
    'rejects a malformed employee filter %j instead of selecting an unintended employee',
    async (userId) => {
      for (const path of ['/api/v1/hr/requests', '/api/v1/payroll/advances']) {
        const response = await request(app.getHttpServer())
          .get(path)
          .set(bearer(admin))
          .query({ userId })
          .expect(422);
        expect(response.body.code).toBe('VALIDATION_FAILED');
      }
    },
  );

  it('rejects repeated scalar employee filters instead of dropping the filter', async () => {
    for (const path of ['/api/v1/hr/requests', '/api/v1/payroll/advances']) {
      await request(app.getHttpServer())
        .get(`${path}?userId=1&userId=2`)
        .set(bearer(admin))
        .expect(422);
    }
  });

  it.each(['yes', '0', '1', ''])(
    'rejects a malformed archive switch %j instead of interpreting it as false',
    async (includeArchived) => {
      for (const path of ['/api/v1/hr/divisions', '/api/v1/payroll/templates']) {
        await request(app.getHttpServer())
          .get(path)
          .set(bearer(admin))
          .query({ includeArchived })
          .expect(422);
      }
    },
  );

  it('preserves absent, true and false switches', async () => {
    for (const path of ['/api/v1/hr/divisions', '/api/v1/payroll/templates']) {
      for (const query of [{}, { includeArchived: 'true' }, { includeArchived: 'false' }]) {
        await request(app.getHttpServer()).get(path).set(bearer(admin)).query(query).expect(200);
      }
    }
  });

  it('also rejects nonexistent dates at the standalone Finance Core read boundary', async () => {
    const reports = app.get(FinReports);
    const reader = StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
    expect(
      await codeOf(
        reports.trialBalance(reader, {
          company: TEST_COMPANY,
          from: '2026-02-30',
          to: '2026-03-31',
        }),
      ),
    ).toBe('FIN_PAYLOAD_INVALID');
    // A malformed read made no transactions or journals in the real application database.
    const sql = await connectAs('app');
    try {
      expect(
        (await sql.query('SELECT count(*)::int AS n FROM fin.journal_entries')).rows[0]?.n,
      ).toBe(0);
    } finally {
      await sql.end();
    }
  });
});
