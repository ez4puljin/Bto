import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

/**
 * Company isolation in the Finance Core's schema `fin`, proved in the catalog (ADR-0076;
 * docs/modules/finance-core.md §4 scope rules, §17 "Another company's data" 4): every row carries
 * its scope, company-owned rows are reachable only with their company, tenant-level rows only
 * through the bridge rows, unique keys lead with the scope, and no foreign key leaves `fin`.
 * A new table that forgets a rule fails here, not in production.
 */
interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
}
interface UniqueRow {
  table: string;
  index: string;
  primary: boolean;
  cols: string[];
}
interface ForeignKeyRow {
  name: string;
  src_schema: string;
  src: string;
  dst_schema: string;
  dst: string;
  cols: string[];
  fcols: string[];
}

/** Tenant-level tables a company reaches only through `party_companies` / `source_grants`. */
const TENANT_LEVEL = new Set(['parties', 'source_systems']);
const BRIDGES = new Set(['party_companies', 'source_grants']);

describe('Finance Core isolation (catalog)', () => {
  let admin: Client;
  let columns: ColumnRow[];
  let uniques: UniqueRow[];
  let foreignKeys: ForeignKeyRow[];

  const tables = (): string[] => [...new Set(columns.map((c) => c.table_name))].sort();
  const has = (table: string, column: string, notNull = false): boolean =>
    columns.some(
      (c) =>
        c.table_name === table && c.column_name === column && (!notNull || c.is_nullable === 'NO'),
    );
  const companyOwned = (table: string): boolean => has(table, 'company_id', true);

  beforeAll(async () => {
    admin = await connectAs('admin');
    columns = (
      await admin.query<ColumnRow>(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'fin'`,
      )
    ).rows;
    uniques = (
      await admin.query<UniqueRow>(
        `SELECT t.relname AS table, i.relname AS index, ix.indisprimary AS primary,
                array(SELECT a.attname FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k (n, o)
                        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.n
                       ORDER BY k.o)::text[] AS cols
           FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'fin' AND ix.indisunique`,
      )
    ).rows;
    foreignKeys = (
      await admin.query<ForeignKeyRow>(
        `SELECT c.conname AS name, ns.nspname AS src_schema, src.relname AS src,
                nd.nspname AS dst_schema, dst.relname AS dst,
                array(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k (n, o)
                        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n
                       ORDER BY k.o)::text[] AS cols,
                array(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k (n, o)
                        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n
                       ORDER BY k.o)::text[] AS fcols
           FROM pg_constraint c
           JOIN pg_class src ON src.oid = c.conrelid
           JOIN pg_class dst ON dst.oid = c.confrelid
           JOIN pg_namespace ns ON ns.oid = src.relnamespace
           JOIN pg_namespace nd ON nd.oid = dst.relnamespace
          WHERE c.contype = 'f' AND (ns.nspname = 'fin' OR nd.nspname = 'fin')`,
      )
    ).rows;
  });
  afterAll(async () => {
    await admin.end();
  });

  it('knows the tables of P1', () => {
    expect(tables()).toEqual(
      expect.arrayContaining([
        'audit_log',
        'branch_refs',
        'branches',
        'companies',
        'company_tax_registrations',
        'parties',
        'party_companies',
        'party_refs',
        'posting_keys',
        'source_grants',
        'source_systems',
        'tenants',
      ]),
    );
  });

  it('gives every row its scope: a company or a tenant', () => {
    const unscoped = tables().filter(
      (t) => t !== 'tenants' && !has(t, 'company_id') && !has(t, 'tenant_id'),
    );
    expect(unscoped).toEqual([]);
  });

  it('keys every company-owned row by (company_id, id)', () => {
    const missing = tables().filter(
      (t) =>
        companyOwned(t) &&
        has(t, 'id') &&
        !uniques.some((u) => u.table === t && u.cols.join() === 'company_id,id'),
    );
    expect(missing).toEqual([]);
  });

  it('leads every unique key with the scope', () => {
    const unscoped = uniques.filter(
      (u) =>
        u.table !== 'tenants' &&
        !(u.primary && u.cols.join() === 'id') &&
        u.cols[0] !== 'company_id' &&
        u.cols[0] !== 'tenant_id',
    );
    expect(unscoped.map((u) => `${u.table}.${u.index}(${u.cols.join()})`)).toEqual([]);
  });

  it('never lets a foreign key leave the schema, in either direction', () => {
    const crossing = foreignKeys.filter((fk) => fk.src_schema !== fk.dst_schema);
    expect(crossing.map((fk) => `${fk.src_schema}.${fk.src} → ${fk.dst_schema}.${fk.dst}`)).toEqual(
      [],
    );
  });

  it('carries the company through every key between company-owned tables', () => {
    const loose = foreignKeys.filter((fk) => {
      if (!companyOwned(fk.src) || !companyOwned(fk.dst)) return false;
      const at = fk.cols.indexOf('company_id');
      return at < 0 || fk.fcols[at] !== 'company_id';
    });
    expect(loose.map((fk) => fk.name)).toEqual([]);
  });

  it('reaches tenant-level rows only with the tenant, and from a company only through a bridge', () => {
    const intoTenantLevel = foreignKeys.filter((fk) => TENANT_LEVEL.has(fk.dst));
    expect(intoTenantLevel.length).toBeGreaterThan(0);
    const withoutTenant = intoTenantLevel.filter((fk) => {
      const at = fk.cols.indexOf('tenant_id');
      return at < 0 || fk.fcols[at] !== 'tenant_id';
    });
    expect(withoutTenant.map((fk) => fk.name)).toEqual([]);
    const fromCompanyRows = intoTenantLevel.filter(
      (fk) => companyOwned(fk.src) && !BRIDGES.has(fk.src),
    );
    expect(fromCompanyRows.map((fk) => fk.name)).toEqual([]);
  });

  it('lets app use the schema but never delete, and gives ai_reader and PUBLIC nothing', async () => {
    const usage = await admin.query<{ app: boolean; reader: boolean }>(
      `SELECT has_schema_privilege('app', 'fin', 'USAGE') AS app,
              has_schema_privilege('ai_reader', 'fin', 'USAGE') AS reader`,
    );
    expect(usage.rows[0]).toEqual({ app: true, reader: false });
    const deletable = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE table_schema = 'fin' AND grantee IN ('app', 'PUBLIC')
          AND privilege_type IN ('DELETE', 'TRUNCATE')`,
    );
    expect(deletable.rows).toEqual([]);
    const publicAcl = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_namespace n, aclexplode(n.nspacl) a
        WHERE n.nspname = 'fin' AND a.grantee = 0`,
    );
    expect(publicAcl.rows[0]?.n).toBe('0');
  });

  it('refuses a row that mixes two companies or two tenants', async () => {
    await admin.query('BEGIN');
    try {
      const one = async (sql: string, params: unknown[] = []): Promise<number> => {
        const { rows } = await admin.query<{ id: string }>(sql, params);
        const id = rows[0]?.id;
        if (id === undefined) throw new Error(`no row: ${sql}`);
        return Number.parseInt(id, 10);
      };
      const t1 = await one(
        `INSERT INTO fin.tenants (code, name) VALUES ('T_ONE', 'One') RETURNING id`,
      );
      const t2 = await one(
        `INSERT INTO fin.tenants (code, name) VALUES ('T_TWO', 'Two') RETURNING id`,
      );
      const a = await one(
        `INSERT INTO fin.companies (tenant_id, code, legal_name) VALUES ($1, 'CA', 'A') RETURNING id`,
        [t1],
      );
      const b = await one(
        `INSERT INTO fin.companies (tenant_id, code, legal_name) VALUES ($1, 'CB', 'B') RETURNING id`,
        [t1],
      );
      const branchOfA = await one(
        `INSERT INTO fin.branches (company_id, code, name) VALUES ($1, 'MAIN', 'Main') RETURNING id`,
        [a],
      );
      const source = await one(
        `INSERT INTO fin.source_systems (tenant_id, code) VALUES ($1, 'TEST_SRC') RETURNING id`,
        [t1],
      );
      await admin.query(
        `INSERT INTO fin.source_grants (tenant_id, company_id, source_system_id) VALUES ($1, $2, $3)`,
        [t1, b, source],
      );
      const partyOfT2 = await one(
        `INSERT INTO fin.parties (tenant_id, kind, name) VALUES ($1, 'OTHER', 'P') RETURNING id`,
        [t2],
      );

      const attempt = async (sql: string, params: unknown[]): Promise<string | undefined> => {
        await admin.query('SAVEPOINT probe');
        const state = await sqlStateOf(admin.query(sql, params));
        await admin.query('ROLLBACK TO SAVEPOINT probe');
        return state;
      };
      // Company B points a ref at company A's branch.
      expect(
        await attempt(
          `INSERT INTO fin.branch_refs (company_id, source_system_id, external_id, branch_id)
           VALUES ($1, $2, '1', $3)`,
          [b, source, branchOfA],
        ),
      ).toBe('23503');
      // A tenant-2 party joins a tenant-1 company.
      expect(
        await attempt(
          `INSERT INTO fin.party_companies (company_id, party_id, tenant_id) VALUES ($1, $2, $3)`,
          [a, partyOfT2, t1],
        ),
      ).toBe('23503');
      expect(
        await attempt(
          `INSERT INTO fin.party_companies (company_id, party_id, tenant_id) VALUES ($1, $2, $3)`,
          [a, partyOfT2, t2],
        ),
      ).toBe('23503');
      // A tenant-2 party refers to a tenant-1 source.
      expect(
        await attempt(
          `INSERT INTO fin.party_refs (tenant_id, source_system_id, external_id, party_id)
           VALUES ($1, $2, 'x', $3)`,
          [t2, source, partyOfT2],
        ),
      ).toBe('23503');
      // A source not granted to company A cannot name A's branch.
      expect(
        await attempt(
          `INSERT INTO fin.branch_refs (company_id, source_system_id, external_id, branch_id)
           VALUES ($1, $2, '1', $3)`,
          [a, source, branchOfA],
        ),
      ).toBe('23503');
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});
