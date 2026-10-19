import type { Client } from 'pg';
import type { FinDb } from '../../src/finance-core';
import { connectAs, sqlStateOf } from '../harness/apps';
import { createFinanceCoreOnly, StaticCaller } from '../harness/static-caller';

/**
 * The organisation's guards (0032_fin_foundation, ADR-0069 #4, ADR-0084): the audit trail and the
 * tax registrations are append-only for every role, no `fin` row is deleted by the application,
 * and installations starting together create the organisation once.
 */
describe('integrity: Finance Core organisation', () => {
  let db: FinDb;
  let close: () => Promise<void>;
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    const core = await createFinanceCoreOnly();
    db = core.db;
    close = core.close;
    app = await connectAs('app');
    migrator = await connectAs('migrator');
  });
  afterAll(async () => {
    await app.end();
    await migrator.end();
    await close();
  });

  it('creates one tenant, one company and one legacy party when ten installations start together', async () => {
    await Promise.all(Array.from({ length: 10 }, () => StaticCaller.ensure(db)));
    const { rows } = await migrator.query<{
      tenants: string;
      companies: string;
      legacy: string;
      audit: string;
    }>(
      `SELECT (SELECT count(*) FROM fin.tenants)::text AS tenants,
              (SELECT count(*) FROM fin.companies)::text AS companies,
              (SELECT count(*) FROM fin.party_refs WHERE external_id = 'LEGACY_UNASSIGNED')::text AS legacy,
              (SELECT count(*) FROM fin.audit_log WHERE action = 'CREATE')::text AS audit`,
    );
    expect(rows[0]).toEqual({ tenants: '1', companies: '1', legacy: '1', audit: '3' });
  });

  it('app may not update the audit trail or tax registrations, nor delete or truncate any fin table (42501)', async () => {
    await migrator.query(
      `INSERT INTO fin.company_tax_registrations (company_id, tax_kind, effective_from, registered)
       SELECT id, 'VAT', DATE '2026-01-01', true FROM fin.companies`,
    );
    expect(await sqlStateOf(app.query(`UPDATE fin.audit_log SET action = 'X'`))).toBe('42501');
    expect(
      await sqlStateOf(app.query(`UPDATE fin.company_tax_registrations SET registered = false`)),
    ).toBe('42501');
    for (const table of [
      'audit_log',
      'company_tax_registrations',
      'parties',
      'companies',
      'branches',
    ]) {
      expect(await sqlStateOf(app.query(`DELETE FROM fin.${table}`))).toBe('42501');
      expect(await sqlStateOf(app.query(`TRUNCATE fin.${table}`))).toBe('42501');
    }
  });

  it('even the migrator cannot rewrite the audit trail or tax registrations (trigger: 23001)', async () => {
    for (const table of ['audit_log', 'company_tax_registrations']) {
      const set = table === 'audit_log' ? `action = 'X'` : 'registered = false';
      expect(await sqlStateOf(migrator.query(`UPDATE fin.${table} SET ${set}`))).toBe('23001');
      expect(await sqlStateOf(migrator.query(`DELETE FROM fin.${table}`))).toBe('23001');
      expect(await sqlStateOf(migrator.query(`TRUNCATE fin.${table} CASCADE`))).toBe('23001');
    }
  });
});
