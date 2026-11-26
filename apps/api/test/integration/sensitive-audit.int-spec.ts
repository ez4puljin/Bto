import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { AuditService, systemActor } from '../../src/modules/identity';
import { auditLog } from '../../src/modules/identity/schema';
import { createHttpApp } from '../harness/apps';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

describe('generic audit salary privacy, including immutable historical entries', () => {
  let app: NestExpressApplication;
  let db: Db;
  let admin: string;
  let auditor: string;
  let payrollAuditor: string;
  const http = () => request(app.getHttpServer());
  const entries = async (token: string, entity: string, id: number) =>
    (
      await http()
        .get('/api/v1/audit')
        .query({ entity, entityId: String(id) })
        .set(bearer(token))
        .expect(200)
    ).body.data as Record<string, unknown>[];

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    auditor = await customRoleUser(app, admin, ['identity.audit.read']);
    payrollAuditor = await customRoleUser(app, admin, ['identity.audit.read', 'hr.payroll.view']);
  });
  afterAll(async () => {
    await app.close();
  });

  it('does not put a new position salary into the generic create/update snapshots', async () => {
    const created = await http()
      .post('/api/v1/hr/positions')
      .set(bearer(admin))
      .send({ name: 'Private salary position', baseSalary: '1234567.89', roleIds: [] })
      .expect(201);
    const id = (created.body as { id: number }).id;
    await http()
      .put(`/api/v1/hr/positions/${id}`)
      .set(bearer(admin))
      .send({ name: 'Updated salary position', baseSalary: '2345678.90', roleIds: [] })
      .expect(200);
    const stored = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'hr_position'), eq(auditLog.entityId, String(id))));
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toMatch(/1234567\.89|2345678\.90|baseSalary/);
    expect(await entries(auditor, 'hr_position', id)).toHaveLength(2);
  });

  it('redacts old salary snapshots at read time while retaining authorized access and stored evidence', async () => {
    const id = 987654;
    const snapshots = [
      {
        entity: 'hr_position',
        before: { name: 'Historical position', baseSalary: '3456789.01' },
        after: {
          name: 'Historical position',
          nextBaseSalary: '4567890.12',
          salaryHistory: [{ effectiveMonth: '2026-10', baseSalary: '3456789.01' }],
        },
      },
      {
        entity: 'payroll_terms',
        before: { baseSalary: '3456789.01' },
        after: { baseSalary: '4567890.12', items: [{ amount: '54321.09' }] },
      },
      { entity: 'payroll_advance', before: null, after: { userId: 1, amount: '65432.10' } },
      { entity: 'products', before: null, after: { name: 'Historical product', amount: '123.45' } },
    ];
    await inTransaction(db, async (tx) => {
      for (const snapshot of snapshots)
        await app.get(AuditService).record(tx, systemActor('legacy-sensitive-audit-test'), {
          ...snapshot,
          action: 'UPDATE',
          entityId: id,
        });
    });
    for (const snapshot of snapshots) {
      const [limited] = await entries(auditor, snapshot.entity, id);
      expect(limited).toMatchObject({
        action: 'UPDATE',
        entity: snapshot.entity,
        entityId: String(id),
        actorLabel: 'legacy-sensitive-audit-test',
      });
      if (snapshot.entity === 'hr_position') {
        expect(limited).toMatchObject({
          before: { name: 'Historical position' },
          after: { name: 'Historical position' },
        });
        expect(JSON.stringify(limited)).not.toMatch(/Salary|salaryHistory|3456789|4567890/);
      } else if (snapshot.entity.startsWith('payroll_')) {
        expect(limited).toMatchObject({ before: null, after: null });
      } else expect(limited).toMatchObject({ after: snapshot.after });
      for (const token of [admin, payrollAuditor]) {
        const [allowed] = await entries(token, snapshot.entity, id);
        expect(allowed).toMatchObject({ before: snapshot.before, after: snapshot.after });
      }
      const [stored] = await db
        .select({ before: auditLog.before, after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.entity, snapshot.entity), eq(auditLog.entityId, String(id))));
      expect(stored).toEqual({ before: snapshot.before, after: snapshot.after });
    }
  });
});
