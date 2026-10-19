import type { Client } from 'pg';
import {
  FinOrgService,
  FinPartiesService,
  type FinCallContext,
  type FinDb,
} from '../../src/finance-core';
import { connectAs } from '../harness/apps';
import {
  createFinanceCoreOnly,
  StaticCaller,
  TEST_COMPANY,
  TEST_SOURCE,
  TEST_SPEC,
  TEST_TENANT,
} from '../harness/static-caller';

/**
 * The Finance Core on its own (ADR-0069 #8, ADR-0076, ADR-0084): no AppModule and no Bto module,
 * only the pool, the core and the test StaticCaller standing in for a second source system.
 */
describe('Finance Core without Bto (P1 organisation)', () => {
  let db: FinDb;
  let org: FinOrgService;
  let parties: FinPartiesService;
  let close: () => Promise<void>;
  let admin: Client;

  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${sql}`,
      params,
    );
    return Number.parseInt(rows[0]?.n ?? '0', 10);
  };
  const codeOf = async (call: Promise<unknown>): Promise<string | undefined> => {
    try {
      await call;
      return undefined;
    } catch (error: unknown) {
      return (error as { code?: string }).code;
    }
  };
  const upsert = (
    ctx: FinCallContext,
    party: Parameters<FinPartiesService['upsertPartyInTx']>[2]['party'],
    company = TEST_COMPANY,
  ) => db.transaction((tx) => parties.upsertPartyInTx(tx, ctx, { company, party }));

  beforeAll(async () => {
    const core = await createFinanceCoreOnly();
    db = core.db;
    close = core.close;
    org = core.module.get(FinOrgService);
    parties = core.module.get(FinPartiesService);
    admin = await connectAs('admin');
  });
  afterAll(async () => {
    await admin.end();
    await close();
  });

  describe('the installation step', () => {
    it('creates the organisation once, however often it runs', async () => {
      const first = await StaticCaller.ensure(db);
      const second = await StaticCaller.ensure(db);
      expect(second).toEqual(first);
      expect(await count('fin.tenants')).toBe(1);
      expect(await count('fin.companies')).toBe(1);
      expect(await count('fin.source_systems')).toBe(2);
      expect(await count('fin.source_grants')).toBe(2);
      expect(await count('fin.posting_keys')).toBe(2);
      expect(await count('fin.branches')).toBe(1);
      expect(await count('fin.branch_refs')).toBe(1);
      expect(await count(`fin.party_refs WHERE external_id = 'LEGACY_UNASSIGNED'`)).toBe(1);
      expect(await count('fin.party_companies')).toBe(1);
      expect(await count(`fin.audit_log WHERE actor_kind = 'SYSTEM' AND action = 'CREATE'`)).toBe(
        3,
      ); // company, legacy party, branch
    });

    it('follows a mapped branch and never maps an inactive one', async () => {
      await StaticCaller.ensure(db, {
        ...TEST_SPEC,
        branches: [
          { system: TEST_SOURCE, externalId: '1', code: 'MAIN', name: 'Төв салбар', active: true },
          { system: TEST_SOURCE, externalId: '2', code: 'OLD', name: 'Хаагдсан', active: false },
        ],
      });
      const view = await org.company(StaticCaller.source(), { company: TEST_COMPANY });
      expect(view.branches).toEqual([
        {
          code: 'MAIN',
          name: 'Төв салбар',
          status: 'ACTIVE',
          refs: [{ system: TEST_SOURCE, externalId: '1' }],
        },
      ]);

      await StaticCaller.ensure(db, {
        ...TEST_SPEC,
        branches: [
          { system: TEST_SOURCE, externalId: '1', code: 'MAIN', name: 'Төв салбар', active: false },
        ],
      });
      const closed = await org.company(StaticCaller.source(), { company: TEST_COMPANY });
      expect(closed.branches.map((b) => b.status)).toEqual(['INACTIVE']);
      expect(await count(`fin.audit_log WHERE entity = 'branch' AND action = 'UPDATE'`)).toBe(2);
      await StaticCaller.ensure(db); // back to the spec's active branch
    });
  });

  describe('the company record', () => {
    const reader = () => StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
    const manager = () =>
      StaticCaller.user({ [TEST_COMPANY]: ['finance.settings.manage'] }, TEST_TENANT, 'mgr');

    it('is read by a granted source and by a user with finance rights there', async () => {
      const bySource = await org.company(StaticCaller.source(), { company: TEST_COMPANY });
      expect(bySource).toMatchObject({
        code: TEST_COMPANY,
        legalName: 'Туршилтын ХХК',
        registerNo: null,
        tin: null,
        functionalCurrency: 'MNT',
        timezone: 'Asia/Ulaanbaatar',
        fiscalYearStartMonth: 1,
        status: 'ACTIVE',
        taxRegistrations: [],
      });
      expect(await org.company(reader(), { company: TEST_COMPANY })).toEqual(bySource);
    });

    it('refuses a user without rights there, an unknown company and an ungranted source', async () => {
      expect(await codeOf(org.company(StaticCaller.user({}), { company: TEST_COMPANY }))).toBe(
        'FIN_COMPANY_FORBIDDEN',
      );
      expect(
        await codeOf(
          org.company(StaticCaller.user({ OTHER: ['finance.read'] }), { company: TEST_COMPANY }),
        ),
      ).toBe('FIN_COMPANY_FORBIDDEN');
      expect(await codeOf(org.company(reader(), { company: 'NOPE' }))).toBe('FIN_COMPANY_UNKNOWN');
      expect(
        await codeOf(org.company(StaticCaller.source('GHOST'), { company: TEST_COMPANY })),
      ).toBe('FIN_SOURCE_NOT_GRANTED');
    });

    it('is invisible from another tenant, and a source sees only the companies it is granted', async () => {
      await StaticCaller.ensure(db, {
        ...TEST_SPEC,
        tenant: { code: 'TEST_T2', name: 'Өөр групп' },
        company: { ...TEST_SPEC.company, code: 'TST2', legalName: 'Өөр ХХК' },
        branches: [],
      });
      await StaticCaller.ensure(db, {
        ...TEST_SPEC,
        company: { ...TEST_SPEC.company, code: 'TST3', legalName: 'Гурав ХХК' },
        sources: [{ code: 'FIN', linkTemplate: null }],
        branches: [],
      });
      expect(
        await codeOf(
          org.company(StaticCaller.user({ TST2: ['finance.read'] }), { company: 'TST2' }),
        ),
      ).toBe('FIN_COMPANY_UNKNOWN');
      expect(await codeOf(org.company(StaticCaller.source(), { company: 'TST2' }))).toBe(
        'FIN_COMPANY_UNKNOWN',
      );
      expect(
        await codeOf(
          org.company(StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] }, 'TEST_T2'), {
            company: TEST_COMPANY,
          }),
        ),
      ).toBe('FIN_COMPANY_UNKNOWN');
      expect(await codeOf(org.company(StaticCaller.source(), { company: 'TST3' }))).toBe(
        'FIN_SOURCE_NOT_GRANTED',
      );
    });

    it('is edited only by a user holding finance.settings.manage there, and every change is audited', async () => {
      const patch = {
        company: TEST_COMPANY,
        legalName: 'Туршилтын ХХК',
        registerNo: '0000000',
        tin: null,
      };
      expect(await codeOf(org.updateCompany(reader(), patch))).toBe('FIN_COMPANY_FORBIDDEN');
      expect(await codeOf(org.updateCompany(StaticCaller.source(), patch))).toBe(
        'FIN_COMPANY_FORBIDDEN',
      );

      const updated = await org.updateCompany(manager(), {
        ...patch,
        legalName: '  Туршилтын шинэ ХХК ',
        tin: '   ',
      });
      expect(updated).toMatchObject({
        legalName: 'Туршилтын шинэ ХХК',
        registerNo: '0000000',
        tin: null,
      });
      const { rows } = await admin.query<{
        actor_kind: string;
        actor_ref: string;
        principal: string;
        before: unknown;
        after: unknown;
      }>(
        `SELECT actor_kind, actor_ref, principal, before, after FROM fin.audit_log
          WHERE entity = 'company' AND action = 'UPDATE' ORDER BY id`,
      );
      expect(rows).toEqual([
        {
          actor_kind: 'STAFF',
          actor_ref: 'mgr',
          principal: 'USER:mgr',
          before: { legalName: 'Туршилтын ХХК', registerNo: null, tin: null },
          after: { legalName: 'Туршилтын шинэ ХХК', registerNo: '0000000', tin: null },
        },
      ]);

      await org.updateCompany(manager(), { ...patch, legalName: 'Туршилтын шинэ ХХК' });
      expect(await count(`fin.audit_log WHERE entity = 'company' AND action = 'UPDATE'`)).toBe(1);
    });

    it('checks only the generic shapes of the legal identity', async () => {
      const base = {
        company: TEST_COMPANY,
        legalName: 'Туршилтын ХХК',
        registerNo: null,
        tin: null,
      };
      const invalid = async (patch: typeof base | Record<string, unknown>) => {
        try {
          await org.updateCompany(manager(), patch as typeof base);
          return undefined;
        } catch (error: unknown) {
          const coded = error as { code?: string; params?: { path?: string } };
          return `${coded.code}:${coded.params?.path}`;
        }
      };
      expect(await invalid({ ...base, legalName: '   ' })).toBe('FIN_PAYLOAD_INVALID:legalName');
      expect(await invalid({ ...base, legalName: 'x'.repeat(201) })).toBe(
        'FIN_PAYLOAD_INVALID:legalName',
      );
      expect(await invalid({ ...base, tin: '1'.repeat(33) })).toBe('FIN_PAYLOAD_INVALID:tin');
      expect(await invalid({ ...base, registerNo: 'АБ\u000712' })).toBe(
        'FIN_PAYLOAD_INVALID:registerNo',
      );
    });
  });

  describe('parties', () => {
    it('makes a party on first sight, joins the company, and follows the source later', async () => {
      const ctx = StaticCaller.source();
      const created = await upsert(ctx, { ref: 'guest:1', name: ' Бат ', kind: 'INDIVIDUAL' });
      expect(created).toEqual({ partyId: expect.any(String), system: TEST_SOURCE, ref: 'guest:1' });
      expect(await upsert(ctx, { ref: 'guest:1', name: 'Бат', kind: 'INDIVIDUAL' })).toEqual(
        created,
      );
      expect(
        await count(`fin.audit_log WHERE entity = 'party' AND entity_id = $1`, [created.partyId]),
      ).toBe(1);

      await upsert(ctx, { ref: 'guest:1', name: 'Бат ХХК', kind: 'COMPANY', tin: '12345678901' });
      const { rows } = await admin.query<{ kind: string; name: string; tin: string | null }>(
        'SELECT kind, name, tin FROM fin.parties WHERE id = $1',
        [created.partyId],
      );
      expect(rows).toEqual([{ kind: 'COMPANY', name: 'Бат ХХК', tin: '12345678901' }]);
      expect(
        await count(
          `fin.audit_log WHERE entity = 'party' AND action = 'UPDATE' AND entity_id = $1`,
          [created.partyId],
        ),
      ).toBe(1);
      expect(await count(`fin.party_companies WHERE party_id = $1`, [created.partyId])).toBe(1);

      expect(
        await db.transaction((tx) =>
          parties.resolvePartyInTx(tx, ctx, { company: TEST_COMPANY, ref: 'guest:1' }),
        ),
      ).toEqual(created);
      expect(
        await db.transaction((tx) =>
          parties.resolvePartyInTx(tx, ctx, { company: TEST_COMPANY, ref: 'guest:404' }),
        ),
      ).toBeNull();
    });

    it('never matches two refs by TIN', async () => {
      const ctx = StaticCaller.source();
      const a = await upsert(ctx, {
        ref: 'store:a',
        name: 'Дэлгүүр А',
        kind: 'COMPANY',
        tin: '55555555555',
      });
      const b = await upsert(ctx, {
        ref: 'store:b',
        name: 'Дэлгүүр Б',
        kind: 'COMPANY',
        tin: '55555555555',
      });
      expect(a.partyId).not.toBe(b.partyId);
    });

    it('makes one party when two first sights race', async () => {
      const ctx = StaticCaller.source();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          upsert(ctx, { ref: 'guest:race', name: 'Уралдаан', kind: 'INDIVIDUAL' }),
        ),
      );
      expect(new Set(results.map((r) => r.partyId)).size).toBe(1);
      expect(await count(`fin.party_refs WHERE external_id = 'guest:race'`)).toBe(1);
    });

    it('refuses a user principal, an ungranted source and a payload outside the contract', async () => {
      const party = { ref: 'guest:2', name: 'Дорж', kind: 'INDIVIDUAL' as const };
      expect(
        await codeOf(
          upsert(StaticCaller.user({ [TEST_COMPANY]: ['finance.settings.manage'] }), party),
        ),
      ).toBe('FIN_COMPANY_FORBIDDEN');
      expect(await codeOf(upsert(StaticCaller.source('GHOST'), party))).toBe(
        'FIN_SOURCE_NOT_GRANTED',
      );
      expect(
        await codeOf(upsert(StaticCaller.source(), { ...party, kind: 'ALIEN' as never })),
      ).toBe('FIN_PAYLOAD_INVALID');
      expect(await count(`fin.party_refs WHERE external_id = 'guest:2'`)).toBe(0);
    });

    it('refuses a context it did not issue', async () => {
      const forged = { ...StaticCaller.source() } as FinCallContext;
      await expect(
        upsert(forged, { ref: 'guest:3', name: 'Хуурамч', kind: 'INDIVIDUAL' }),
      ).rejects.toThrow(/createFinCallContext/);
      await expect(org.company(forged, { company: TEST_COMPANY })).rejects.toThrow(
        /createFinCallContext/,
      );
    });
  });
});
