import type { NestExpressApplication } from '@nestjs/platform-express';
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '@tugeel/shared/auth';
import { SETTING_KEYS } from '@tugeel/shared/settings';
import { addDays, businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import type { Client } from 'pg';
import { DB } from '../../src/common/db/db.tokens';
import type { Db, Tx } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { AppError } from '../../src/common/errors/app-error';
import { toProblem } from '../../src/common/errors/problem-details';
import {
  AuditService,
  NumberingService,
  OrgService,
  SettingsService,
  systemActor,
  WAREHOUSE_CREATED_HOOK,
  type Warehouse,
} from '../../src/modules/identity';
import { warehouses } from '../../src/modules/identity/schema';
import { connectAs, createHttpApp } from '../harness/apps';

const actor = systemActor('integration-test');

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return toProblem(error, {}).code;
  }
}

describe('identity core services', () => {
  const created: string[] = [];
  const hook = {
    async onWarehouseCreated(tx: Tx, warehouse: Warehouse) {
      // Runs inside the creating transaction: the new row is visible here.
      const rows = await tx.select().from(warehouses).where(eq(warehouses.id, warehouse.id));
      if (rows.length !== 1) throw new Error('hook ran outside the creating transaction');
      if (warehouse.code === 'HOOKFAIL') throw new Error('hook failed');
      created.push(warehouse.code);
    },
  };
  let app: NestExpressApplication;
  let db: Db;
  let sqlClient: Client;

  beforeAll(async () => {
    app = await createHttpApp({ providers: [{ provide: WAREHOUSE_CREATED_HOOK, useValue: hook }] });
    db = app.get<Db>(DB);
    sqlClient = await connectAs('app');
  });
  afterAll(async () => {
    await sqlClient.end();
    await app.close();
  });

  describe('reference data synced at boot', () => {
    async function snapshot() {
      const permissions = await sqlClient.query<{ code: string }>(
        'SELECT code FROM permissions ORDER BY code',
      );
      const roles = await sqlClient.query<{ code: string; count: string }>(
        `SELECT r.code, count(rp.permission_code)::text AS count FROM roles r
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
          WHERE r.is_system GROUP BY r.code ORDER BY r.code`,
      );
      const transit = await sqlClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM warehouses WHERE kind = 'TRANSIT'`,
      );
      return { permissions: permissions.rows, roles: roles.rows, transit: transit.rows[0]?.count };
    }

    it('matches the code catalog, with one TRANSIT warehouse announced to the hook', async () => {
      const state = await snapshot();
      expect(state.permissions.map((row) => row.code)).toEqual([...PERMISSIONS].sort());
      expect(state.roles.map((row) => row.code)).toEqual([...SYSTEM_ROLES].sort());
      for (const row of state.roles) {
        const role = row.code as (typeof SYSTEM_ROLES)[number];
        expect(Number.parseInt(row.count, 10)).toBe(SYSTEM_ROLE_PERMISSIONS[role].length);
      }
      expect(state.transit).toBe('1');
      expect(created).toContain('TRANSIT');
    });

    it('is idempotent across boots', async () => {
      const before = await snapshot();
      const second = await createHttpApp();
      await second.close();
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('AuditService', () => {
    it('writes inside the transaction and never stores secrets', async () => {
      const audit = app.get(AuditService);
      await inTransaction(db, (tx) =>
        audit.record(tx, actor, {
          action: 'UPDATE',
          entity: 'audit_probe',
          entityId: 1,
          before: {
            passwordHash: '$argon2id$hash',
            nested: { refreshToken: 'tok', keep: 1, list: [{ tokenHash: 'x', code: 'HQ' }] },
            at: new Date('2026-01-01T00:00:00Z'),
          },
        }),
      );
      const { rows } = await sqlClient.query<{ before: unknown; actor_label: string }>(
        `SELECT before, actor_label FROM audit_log WHERE entity = 'audit_probe'`,
      );
      expect(rows).toEqual([
        {
          actor_label: 'integration-test',
          before: { nested: { keep: 1, list: [{ code: 'HQ' }] }, at: '2026-01-01T00:00:00.000Z' },
        },
      ]);
    });

    it('rolls back with its transaction', async () => {
      const audit = app.get(AuditService);
      await expect(
        inTransaction(db, async (tx) => {
          await audit.record(tx, actor, {
            action: 'CREATE',
            entity: 'rollback_probe',
            entityId: 1,
          });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      const { rows } = await sqlClient.query(
        `SELECT 1 FROM audit_log WHERE entity = 'rollback_probe'`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('NumberingService', () => {
    it('counts per scope and period, and a rollback gives its number back', async () => {
      const numbering = app.get(NumberingService);
      const next = (scope: string, period: string) =>
        inTransaction(db, (tx) => numbering.next(tx, scope, period));
      expect([
        await next('GR', '2026'),
        await next('GR', '2026'),
        await next('GR', '2026'),
      ]).toEqual([1, 2, 3]);
      expect(await next('GR', '2027')).toBe(1);
      expect(await next('TR', '2026')).toBe(1);
      await expect(
        inTransaction(db, async (tx) => {
          await numbering.next(tx, 'GR', '2026');
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await next('GR', '2026')).toBe(4);
    });
  });

  describe('SettingsService', () => {
    const today = businessDate();

    it('has no tax default but defaults the session length', async () => {
      const settings = app.get(SettingsService);
      await expect(settings.get('tax.vat_rate_pct')).rejects.toMatchObject({
        code: 'SETTING_MISSING',
        params: { key: 'tax.vat_rate_pct' },
      });
      expect(await settings.get('auth.staff_session_hours')).toBe(12);
    });

    it('applies values from their effective date and keeps history immutable', async () => {
      const settings = app.get(SettingsService);
      await settings.create(actor, {
        key: 'tax.vat_rate_pct',
        value: '10',
        effectiveFrom: '2020-01-01',
      });
      expect(await settings.get('tax.vat_rate_pct')).toBe('10');
      expect(
        await codeOf(
          settings.create(actor, {
            key: 'tax.vat_rate_pct',
            value: '9',
            effectiveFrom: '2021-01-01',
          }),
        ),
      ).toBe('SETTING_NOT_EDITABLE');
      const future = await settings.create(actor, {
        key: 'tax.vat_rate_pct',
        value: '12',
        effectiveFrom: addDays(today, 30),
      });
      expect(await settings.get('tax.vat_rate_pct', today)).toBe('10');
      expect(await settings.get('tax.vat_rate_pct', addDays(today, 30))).toBe('12');
      const current = await settings.create(actor, {
        key: 'tax.vat_rate_pct',
        value: '11',
        effectiveFrom: today,
      });
      expect(await settings.get('tax.vat_rate_pct')).toBe('11');
      expect(
        await codeOf(
          settings.create(actor, { key: 'tax.vat_rate_pct', value: '13', effectiveFrom: today }),
        ),
      ).toBe('DUPLICATE_VALUE');
      expect(await codeOf(settings.remove(actor, current.id))).toBe('SETTING_NOT_EDITABLE');
      await settings.remove(actor, future.id);
      expect(await settings.get('tax.vat_rate_pct', addDays(today, 30))).toBe('11');
      const view = await settings.list();
      expect(view.map((entry) => entry.key)).toEqual(SETTING_KEYS);
      expect(view.find((entry) => entry.key === 'tax.vat_rate_pct')?.current).toBe('11');
      const audit = await sqlClient.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity = 'settings' ORDER BY id`,
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'CREATE', 'CREATE', 'DELETE']);
    });

    it('rejects unknown keys, malformed dates and invalid values with field errors', async () => {
      const settings = app.get(SettingsService);
      const attempt = (input: { key: string; value: unknown; effectiveFrom: string }) =>
        settings.create(actor, input).catch((error: unknown) => error);
      for (const [input, path] of [
        [{ key: 'tax.unknown', value: '1', effectiveFrom: today }, 'key'],
        [{ key: 'company.vat_payer', value: true, effectiveFrom: '2026-13-01' }, 'effectiveFrom'],
        [{ key: 'auth.staff_session_hours', value: 0, effectiveFrom: today }, 'value'],
      ] as const) {
        const error = await attempt(input);
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path }] });
      }
    });
  });

  describe('OrgService', () => {
    it('creates branches and admin warehouses, announcing each to the hook in the same transaction', async () => {
      const org = app.get(OrgService);
      const branch = await org.createBranch(actor, {
        code: 'HQ',
        name: 'Төв салбар',
        branchNo: '001',
      });
      const warehouse = await org.createWarehouse(actor, {
        code: 'WH-1',
        name: 'Төв агуулах',
        kind: 'WHOLESALE',
        branchId: branch.id,
      });
      expect(created).toContain('WH-1');
      expect(warehouse).toMatchObject({ kind: 'WHOLESALE', branchId: branch.id, status: 'ACTIVE' });
      expect((await org.getTransitWarehouse()).kind).toBe('TRANSIT');
      const renamed = await org.updateBranch(actor, branch.id, { name: 'Бөөний төв' });
      expect(renamed.name).toBe('Бөөний төв');
      expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(branch.updatedAt.getTime());
    });

    it('refuses system kinds, the reserved TRANSIT code and duplicate codes', async () => {
      const org = app.get(OrgService);
      const branch = await org.createBranch(actor, { code: 'STORE1', name: 'Супермаркет' });
      const base = { name: 'Агуулах', branchId: branch.id };
      expect(
        await codeOf(org.createWarehouse(actor, { ...base, code: 'T1', kind: 'TRANSIT' })),
      ).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
      expect(
        await codeOf(org.createWarehouse(actor, { ...base, code: 'V1', kind: 'VEHICLE' })),
      ).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
      expect(
        await codeOf(org.createWarehouse(actor, { ...base, code: 'TRANSIT', kind: 'STORE' })),
      ).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
      const transit = await org.getTransitWarehouse();
      expect(await codeOf(org.updateWarehouse(actor, transit.id, { name: 'x' }))).toBe(
        'WAREHOUSE_KIND_NOT_ALLOWED',
      );
      expect(await codeOf(org.createBranch(actor, { code: 'STORE1', name: 'Давхар' }))).toBe(
        'DUPLICATE_VALUE',
      );
    });

    it('rolls the warehouse back when the creation hook fails', async () => {
      const org = app.get(OrgService);
      const [branch] = await org.listBranches();
      await expect(
        org.createWarehouse(actor, {
          code: 'HOOKFAIL',
          name: 'Алдаа',
          kind: 'STORE',
          branchId: branch?.id ?? 0,
        }),
      ).rejects.toThrow('hook failed');
      const { rows } = await sqlClient.query(`SELECT 1 FROM warehouses WHERE code = 'HOOKFAIL'`);
      expect(rows).toHaveLength(0);
    });
  });
});
