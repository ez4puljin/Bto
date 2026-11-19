import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { addDays, addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { ERKHET_FETCH, type ErkhetFetch } from '../../src/integrations/erkhet';
import { ErkhetLedgerFlowService } from '../../src/modules/erkhet/services/erkhet-ledger-flow.service';
import { ErkhetLedgerService } from '../../src/modules/erkhet/services/erkhet-ledger.service';
import { systemActor } from '../../src/modules/identity';
import { WorkerModule } from '../../src/worker.module';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { financeApi } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/** Not a real sign-in: no test reaches Erkhet, the «Erkhet» below is scripted. */
const PASSWORD = 'test-erkhet-password-not-real';
const COMPANY = '1234567890';
const AR = '120101';
const AP = '310101';
/** Erkhet's internal ids of the two accounts, which are not their codes. */
const ACCOUNT_ID: Record<string, string> = { [AR]: '9', [AP]: '92' };
/** Lines on a page of the scripted journal: small, so pages end inside transactions. */
const PAGE = 3;

interface Line {
  customer: string;
  debit: string;
  credit: string;
  description?: string;
  bill?: string;
}
interface Tr {
  trId: number;
  ptrId: number;
  date: string;
  lines: Line[];
}

const today = businessDate();
/** The first day copied line by line: the first of last month. */
const START = addMonths(`${today.slice(0, 7)}-01`, -1);
const THROUGH = addDays(START, -1);
const LAST_MONTH = START.slice(0, 7);
const day = (offset: number) => addDays(START, offset);

/**
 * «Авлага, өглөгийн гүйлгээ» (ADR-0219) over HTTP, with each run executed as the worker runs it.
 * Erkhet is scripted and every name and amount is made up; what is checked is ours: rights, that a
 * check posts nothing, that the books follow Erkhet (new, changed, vanished, unmatched), the undo,
 * Bto's own documents, a closed month, and that only GET requests reach Erkhet.
 */
describe('Erkhet ledger copy', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let flow: ErkhetLedgerFlowService;
  let ledger: ErkhetLedgerService;
  let sql: Client;
  let admin: string;
  let reader: string;
  let outsider: string;
  let shop: { id: number };
  let kiosk: { id: number };
  let late: { id: number } | null = null;
  let byHand: { id: number } | null = null;
  let vendor: { id: number };
  let finance: ReturnType<typeof financeApi>;

  /** What the scripted Erkhet holds per account code; a test changes it before a run. */
  const erkhet: { trs: Record<string, Tr[]>; sent: { method: string; url: string }[] } = {
    trs: { [AR]: [], [AP]: [] },
    sent: [],
  };
  const http = () => request(app.getHttpServer());

  const journalPage = (account: string, from: string, to: string, page: number): string => {
    const items: Record<string, unknown>[] = [];
    // Newest first, as Erkhet lists them.
    const trs = (erkhet.trs[account] ?? [])
      .filter((tr) => tr.date >= from && tr.date <= to)
      .sort((a, b) => (a.date === b.date ? b.trId - a.trId : a.date < b.date ? 1 : -1));
    const flat = trs.flatMap((tr) => tr.lines.map((line, at) => ({ tr, line, first: at === 0 })));
    const slice = flat.slice((page - 1) * PAGE, page * PAGE);
    for (const row of slice) {
      // A header only where the transaction starts: a page may begin inside one.
      if (row.first) items.push({ ptr__id: row.tr.ptrId, tr_id: row.tr.trId, is_ptr: true });
      items.push({
        description: row.line.description ?? 'Туршилтын гүйлгээ',
        debit_text: row.line.debit,
        credit_text: row.line.credit,
        account__name: 'Туршилтын данс',
        full_code: account,
        date: row.tr.date,
        bill_number: row.line.bill ?? '',
        customer: row.line.customer,
        department: '',
        tr__user: 'tester',
        ptr__id: row.tr.ptrId,
      });
    }
    return `<html><script>var items = ${JSON.stringify(items)};</script></html>`;
  };

  const scriptedErkhet: ErkhetFetch = (url, init) => {
    const headers = init.headers as Record<string, string>;
    const { pathname, searchParams } = new URL(url);
    erkhet.sent.push({ method: init.method ?? 'GET', url });
    const redirect = (location: string, cookie?: string) =>
      new Response(null, {
        status: 302,
        headers: { location, ...(cookie ? { 'set-cookie': cookie } : {}) },
      });
    if (pathname === '/login/' && init.method !== 'POST') {
      return Promise.resolve(
        new Response('<form>', { headers: { 'set-cookie': 'csrftoken=t1; Path=/' } }),
      );
    }
    if (pathname === '/login/') return Promise.resolve(redirect(`/${COMPANY}/`, 'sessionid=s1'));
    if (!headers.Cookie?.includes('sessionid=s1')) return Promise.resolve(redirect('/login/'));
    if (pathname === `/${COMPANY}/`) return Promise.resolve(new Response('home'));
    if (pathname === `/${COMPANY}/transactions/get-filter-form/`) {
      const options = Object.entries(ACCOUNT_ID)
        .map(([code, id]) => `<option value="${id}">${code} - Туршилтын данс</option>`)
        .join('');
      return Promise.resolve(
        Response.json({ content: `<form><select name="account">${options}</select></form>` }),
      );
    }
    if (pathname === `/${COMPANY}/transactions/get-ptr-actions/`) {
      const trId = searchParams.get('tr_id') ?? '';
      return Promise.resolve(
        Response.json({
          status: 'ok',
          update_url: `/${COMPANY}/debt/trs/update/${trId}/?record_id=1`,
          delete_url: `/${COMPANY}/debt/trs/delete/${trId}/`,
        }),
      );
    }
    if (pathname === `/${COMPANY}/transactions/`) {
      const account = Object.entries(ACCOUNT_ID).find(
        ([, id]) => id === searchParams.get('account'),
      )?.[0];
      if (!account) return Promise.resolve(new Response('<html>', { status: 404 }));
      return Promise.resolve(
        new Response(
          journalPage(
            account,
            searchParams.get('date1') ?? '',
            searchParams.get('date2') ?? '',
            Number.parseInt(searchParams.get('page') ?? '1', 10),
          ),
        ),
      );
    }
    return Promise.resolve(new Response('<html>', { status: 404 }));
  };

  interface RunJson {
    id: number;
    kind: string;
    status: string;
    failure: string | null;
    failureDetail: Record<string, string> | null;
    ownReversed: number;
    summary: {
      accounts: {
        account: string;
        trs: number;
        lines: number;
        opening: string;
        debit: string;
        credit: string;
        closing: string;
      }[];
      trs: { post: number; revise: number; reverse: number; unmatched: number };
      openings: { post: number; revise: number; reverse: number; unmatched: number };
      unmatchedParties: number;
      ownDocuments: { count: number; total: string };
      done: { posted: number; reversed: number; blocked: number; ownReversed: number } | null;
    } | null;
  }
  const overview = async (token = admin) =>
    (await http().get('/api/v1/erkhet/ledger').set(bearer(token)).expect(200)).body as {
      configured: boolean;
      posting: boolean;
      checked: boolean;
      posted: number;
      blocked: number;
      startDate: string;
      latest: RunJson | null;
      failed: RunJson | null;
    };
  const start = (body: Record<string, unknown>, token = admin) =>
    http().post('/api/v1/erkhet/ledger/runs').set(bearer(token)).send(body);
  /** A run from the button to its end, as the worker would run it. */
  const run = async (body: Record<string, unknown>): Promise<RunJson> => {
    const started = (await start(body).expect(200)).body as {
      started: boolean;
      refusal: string | null;
      run: { id: number } | null;
    };
    if (!started.run) throw new Error(`the run did not start: ${started.refusal}`);
    await flow.execute(started.run.id);
    const state = await overview();
    const ended = [state.latest, state.failed].find((one) => one?.id === started.run?.id);
    if (!ended) throw new Error('the run did not end');
    return ended;
  };
  const refusal = async (body: Record<string, unknown>) =>
    ((await start(body).expect(200)).body as { started: boolean; refusal: string | null }).refusal;
  const documents = async () =>
    (
      await sql.query<{ type: string; n: string }>(
        `SELECT t.code AS type, count(*)::text AS n
           FROM fin.documents d
           JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
          WHERE t.code LIKE 'ERKHET.%' GROUP BY 1 ORDER BY 1`,
      )
    ).rows.map((row) => `${row.type}:${row.n}`);
  const balance = async (customerId: number) => (await finance.balance(customerId)).balance;
  const payable = async (supplierId: number) =>
    (
      (await http().get(`/api/v1/supplier-balances/${supplierId}`).set(bearer(admin)).expect(200))
        .body as { balance: string }
    ).balance;
  const clearing = async () =>
    (
      await sql.query<{ balance: string }>(
        `SELECT coalesce(sum(l.debit - l.credit), 0)::text AS balance
           FROM fin.journal_lines l WHERE l.posting_key = 'ERKHET_CLEARING'`,
      )
    ).rows[0]?.balance;

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(ERKHET_FETCH).useValue(scriptedErkhet),
    });
    // The worker's side without its job polling: the test runs each run itself.
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ERKHET_FETCH)
      .useValue(scriptedErkhet)
      .compile();
    flow = worker.get(ErkhetLedgerFlowService, { strict: false });
    // Starting a run enqueues its job: that is the api's side, whose queue is open.
    ledger = app.get(ErkhetLedgerService, { strict: false });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    reader = await customRoleUser(app, admin, ['erkhet.sync.read']);
    outsider = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    finance = financeApi(app, admin);

    const partners = partnersApi(app, admin);
    shop = await partners.customer({ code: '90001', name: 'Туршилт дэлгүүр' });
    kiosk = await partners.customer({ code: '90002', name: 'Туршилт мухлаг' });
    vendor = await partners.supplier({ code: '80001', name: 'Туршилт нийлүүлэгч' });

    await http()
      .patch('/api/v1/erkhet/settings')
      .set(bearer(admin))
      .send({
        baseUrl: 'https://erkhet.test',
        companyId: COMPANY,
        username: 'tester',
        password: PASSWORD,
      })
      .expect(200);
    await http()
      .patch('/api/v1/erkhet/ledger/settings')
      .set(bearer(admin))
      .send({ startDate: START })
      .expect(200);

    erkhet.trs[AR] = [
      // Before the start date: only the balance of these is copied.
      {
        trId: 1001,
        ptrId: 501,
        date: addDays(THROUGH, -20),
        lines: [{ customer: '90001 - Туршилт дэлгүүр', debit: '1,000.00', credit: '0.00' }],
      },
      {
        trId: 1002,
        ptrId: 502,
        date: THROUGH,
        lines: [
          { customer: '90001 - Туршилт дэлгүүр', debit: '0.00', credit: '400.00' },
          { customer: '70007 - Бүртгэлгүй харилцагч', debit: '50.00', credit: '0.00' },
        ],
      },
      // From the start date: copied line by line.
      {
        trId: 2001,
        ptrId: 601,
        date: day(2),
        lines: [
          {
            customer: '90001 - Туршилт дэлгүүр',
            debit: '22,432.11',
            credit: '0.00',
            description: 'Туршилтын борлуулалт',
            bill: 'T-001',
          },
        ],
      },
      {
        trId: 2002,
        ptrId: 602,
        date: day(5),
        lines: [
          { customer: '90001 - Туршилт дэлгүүр', debit: '0.00', credit: '10,000.00' },
          { customer: '90002 - Туршилт мухлаг', debit: '300.00', credit: '0.00' },
          { customer: '90002 - Туршилт мухлаг', debit: '200.00', credit: '0.00' },
          { customer: '90001 - Туршилт дэлгүүр', debit: '0.00', credit: '32.11' },
        ],
      },
      {
        trId: 2003,
        ptrId: 603,
        date: day(6),
        lines: [{ customer: '70007 - Бүртгэлгүй харилцагч', debit: '75.00', credit: '0.00' }],
      },
      {
        trId: 2004,
        ptrId: 604,
        date: day(8),
        lines: [{ customer: '90002 - Туршилт мухлаг', debit: '0.00', credit: '120.00' }],
      },
    ];
    erkhet.trs[AP] = [
      {
        trId: 3001,
        ptrId: 701,
        date: addDays(THROUGH, -3),
        lines: [{ customer: '80001 - Туршилт нийлүүлэгч', debit: '0.00', credit: '5,000.00' }],
      },
      {
        trId: 3002,
        ptrId: 702,
        date: day(3),
        lines: [{ customer: '80001 - Туршилт нийлүүлэгч', debit: '0.00', credit: '1,500.00' }],
      },
      {
        trId: 3003,
        ptrId: 703,
        date: day(9),
        lines: [{ customer: '80001 - Туршилт нийлүүлэгч', debit: '2,000.00', credit: '0.00' }],
      },
    ];
  });

  afterAll(async () => {
    await sql.end();
    await worker.close();
    await app.close();
  });

  it("gives the clearing key its account by the key, never on another account's code (0112 data section)", async () => {
    const text = readFileSync(
      join(__dirname, '../../src/db/migrations/0112_erkhet_ledger_copy.sql'),
      'utf8',
    );
    const statements = text
      .slice(
        text.indexOf('-- erkhet_ledger_copy:data:begin'),
        text.indexOf('-- erkhet_ledger_copy:data:end'),
      )
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter((part) => part.replace(/^--.*$/gm, '').trim().length > 0);
    expect(statements).toHaveLength(2);
    const admin = await connectAs('admin');
    const clearing = async () =>
      (
        await admin.query<{ code: string; name: string }>(
          `SELECT a.code, a.name FROM fin.posting_rules r
             JOIN fin.accounts a ON a.company_id = r.company_id AND a.id = r.account_id
            WHERE r.posting_key = 'ERKHET_CLEARING'`,
        )
      ).rows;
    const replay = async () => {
      for (const statement of statements) await admin.query(statement);
    };
    /** The rules are append-only: taking one away is the test's own doing, with the triggers off. */
    const unmap = async () => {
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM fin.posting_rules WHERE posting_key = 'ERKHET_CLEARING'`);
      await admin.query('SET LOCAL session_replication_role = origin');
    };
    try {
      // The chart template mapped the key at boot: a replay leaves a mapped key alone.
      await admin.query('BEGIN');
      await replay();
      expect(await clearing()).toEqual([{ code: '390102', name: expect.any(String) }]);

      // A chart without the key's rule and without the account gets both, on 390102.
      await unmap();
      await admin.query(`DELETE FROM fin.accounts WHERE code = '390102'`);
      await replay();
      expect(await clearing()).toEqual([
        { code: '390102', name: 'Эрхэтээс хуулсан гүйлгээний тохируулга' },
      ]);

      // 390102 belongs to something else: it is left as it is, and the account goes beside it.
      await unmap();
      await admin.query(`UPDATE fin.accounts SET name = 'Өөр данс' WHERE code = '390102'`);
      await replay();
      expect(await clearing()).toEqual([
        { code: '390103', name: 'Эрхэтээс хуулсан гүйлгээний тохируулга' },
      ]);
      const foreign = await admin.query<{ name: string }>(
        `SELECT name FROM fin.accounts WHERE code = '390102'`,
      );
      expect(foreign.rows).toEqual([{ name: 'Өөр данс' }]);
    } finally {
      await admin.query('ROLLBACK');
      await admin.end();
    }
  });

  it('keeps the routes to their rights', async () => {
    await http().get('/api/v1/erkhet/ledger').set(bearer(outsider)).expect(403);
    await http().get('/api/v1/erkhet/ledger/parties').set(bearer(outsider)).expect(403);
    await http().get('/api/v1/erkhet/ledger/own-documents').set(bearer(outsider)).expect(403);
    await http().get('/api/v1/erkhet/ledger').set(bearer(reader)).expect(200);
    for (const token of [reader, outsider]) {
      await start({ kind: 'CHECK' }, token).expect(403);
      await http()
        .patch('/api/v1/erkhet/ledger/settings')
        .set(bearer(token))
        .send({ startDate: START })
        .expect(403);
    }
    await start({ kind: 'DELETE' }).expect(422);
  });

  it('refuses a post before a check, and a revert with nothing posted', async () => {
    expect(await refusal({ kind: 'POST' })).toBe('NOT_CHECKED');
    expect(await refusal({ kind: 'REVERT' })).toBe('NOTHING_POSTED');
    expect(await ledger.startNightly(systemActor('test'))).toMatchObject({
      started: false,
      reason: 'NOT_POSTED_YET',
    });
  });

  it('checks: shows what would be posted and posts nothing', async () => {
    const checked = await run({ kind: 'CHECK' });
    expect(checked).toMatchObject({ kind: 'CHECK', status: 'DONE', failure: null });
    const receivable = checked.summary?.accounts.find((one) => one.account === AR);
    // Opening 1,000 − 400 + 50; since the start 22,432.11 + 300 + 200 + 75 debit.
    expect(receivable).toMatchObject({
      trs: 4,
      lines: 7,
      opening: '650.00',
      debit: '23007.11',
      credit: '10152.11',
      closing: '13505.00',
    });
    expect(checked.summary?.accounts.find((one) => one.account === AP)).toMatchObject({
      trs: 2,
      opening: '-5000.00',
      debit: '2000.00',
      credit: '1500.00',
      closing: '-4500.00',
    });
    expect(checked.summary?.trs).toEqual({ post: 5, revise: 0, reverse: 0, unmatched: 1 });
    expect(checked.summary?.openings).toEqual({ post: 2, revise: 0, reverse: 0, unmatched: 1 });
    expect(checked.summary?.unmatchedParties).toBe(1);
    expect(checked.summary?.done).toBeNull();

    expect(await documents()).toEqual([]);
    expect(await balance(shop.id)).toBe('0.00');
    expect((await overview()).checked).toBe(true);

    const unmatched = (
      await http()
        .get('/api/v1/erkhet/ledger/parties')
        .query({ unmatched: true })
        .set(bearer(reader))
        .expect(200)
    ).body as { data: Record<string, unknown>[] };
    expect(unmatched.data).toEqual([
      expect.objectContaining({
        account: AR,
        code: '70007',
        name: 'Бүртгэлгүй харилцагч',
        btoId: null,
        lines: 1,
        opening: '50.00',
        debit: '75.00',
        closing: '125.00',
      }),
    ]);
  });

  it('posts: each party balance is Erkhet’s opening plus debits less credits', async () => {
    const posted = await run({ kind: 'POST' });
    expect(posted).toMatchObject({ kind: 'POST', status: 'DONE' });
    expect(posted.summary?.done).toMatchObject({ posted: 7, reversed: 0, blocked: 0 });
    // shop: 600 + 22,432.11 − 10,000 − 32.11; kiosk: 300 + 200 − 120; vendor owes 5,000 + 1,500 − 2,000.
    expect(await balance(shop.id)).toBe('13000.00');
    expect(await balance(kiosk.id)).toBe('380.00');
    expect(await payable(vendor.id)).toBe('4500.00');
    // The other side of every copy is the clearing account: the mirror of the two balances.
    expect(await clearing()).toBe('-8880.00');
    expect(await overview()).toMatchObject({ posting: true, posted: 7, blocked: 0 });

    // Credits closed debits oldest first: what is open is the balance, on the newest debit.
    const open = await sql.query<{ side: string; open: string }>(
      `SELECT i.side, sum(i.open_amount)::text AS open FROM fin.open_items i
         JOIN fin.accounts a ON a.company_id = i.company_id AND a.id = i.account_id
        WHERE a.code = $1 AND i.open_amount > 0 GROUP BY 1 ORDER BY 1`,
      [AR],
    );
    expect(open.rows).toEqual([{ side: 'DEBIT', open: '13380.00' }]);

    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'erkhet_ledger_runs' ORDER BY id`,
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['POST', 'POSTED']);
  });

  it('shows a copied row as Erkhet’s in the ledgers, with its address in Erkhet', async () => {
    const page = (
      await http().get(`/api/v1/customer-balances/${shop.id}/ledger`).set(bearer(admin)).expect(200)
    ).body as {
      data: {
        kind: string;
        docNumber: string;
        debit: string;
        erkhet: {
          kind: string;
          key: string | null;
          billNumber: string | null;
          text: string | null;
        } | null;
      }[];
    };
    const sale = page.data.find((row) => row.debit === '22432.11');
    expect(sale).toMatchObject({
      docNumber: 'T-001',
      erkhet: {
        kind: 'TR',
        key: `${AR}:2001`,
        billNumber: 'T-001',
        text: 'Туршилтын борлуулалт',
      },
    });
    expect(page.data.find((row) => row.erkhet?.kind === 'OPENING')).toMatchObject({
      debit: '600.00',
      erkhet: { kind: 'OPENING', key: null },
    });
    const links = (
      await http()
        .get('/api/v1/erkhet/ledger/links')
        .query({ keys: `${AR}:2001,${AR}:999999` })
        .set(bearer(admin))
        .expect(200)
    ).body as { key: string; url: string; exact: boolean }[];
    // The check asked Erkhet where each transaction opens; an unknown key is left out.
    expect(links).toEqual([
      {
        key: `${AR}:2001`,
        url: `https://erkhet.test/${COMPANY}/debt/trs/update/2001/?record_id=1`,
        exact: true,
      },
    ]);
    // Until that address is known the link opens the journal list of that day and account.
    await sql.query(
      `UPDATE erkhet_ledger_trs SET update_path = NULL, path_asked_at = NULL WHERE tr_id = 2001`,
    );
    const fallback = (
      await http()
        .get('/api/v1/erkhet/ledger/links')
        .query({ keys: `${AR}:2001` })
        .set(bearer(admin))
        .expect(200)
    ).body as { url: string; exact: boolean }[];
    expect(fallback[0]).toEqual({
      key: `${AR}:2001`,
      url: `https://erkhet.test/${COMPANY}/transactions/?date1=${day(2)}&date2=${day(2)}&account=9`,
      exact: false,
    });
    await http()
      .get('/api/v1/erkhet/ledger/links')
      .query({ keys: 'x' })
      .set(bearer(admin))
      .expect(422);
    await http()
      .get('/api/v1/erkhet/ledger/links')
      .query({ keys: `${AR}:2001` })
      .set(bearer(reader))
      .expect(403);
    const payables = (
      await http()
        .get(`/api/v1/supplier-balances/${vendor.id}/ledger`)
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { erkhet: { kind: string; key: string | null } | null }[] };
    expect(payables.data.map((row) => row.erkhet?.key ?? row.erkhet?.kind)).toEqual(
      expect.arrayContaining([`${AP}:3002`, `${AP}:3003`, 'OPENING']),
    );
  });

  it('reads the copied balance for the settlement SMS list', async () => {
    const list = (
      await http()
        .get('/api/v1/settlement-sms/customers')
        .query({ group: 'DAY_20', withBalance: 'false' })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { customerId: number; balance: string }[] };
    expect(list.data.find((row) => row.customerId === shop.id)?.balance).toBe('13000.00');
  });

  it('posts nothing on a second run, and fills a missing address', async () => {
    const before = await documents();
    const again = await run({ kind: 'POST' });
    expect(again.summary?.done).toMatchObject({ posted: 0, reversed: 0, blocked: 0 });
    expect(await documents()).toEqual(before);
    expect(await balance(shop.id)).toBe('13000.00');
    const [link] = (
      await http()
        .get('/api/v1/erkhet/ledger/links')
        .query({ keys: `${AR}:2001` })
        .set(bearer(admin))
        .expect(200)
    ).body as { url: string; exact: boolean }[];
    expect(link).toEqual({
      key: `${AR}:2001`,
      url: `https://erkhet.test/${COMPANY}/debt/trs/update/2001/?record_id=1`,
      exact: true,
    });
    const stored = await sql.query<{ path: string }>(
      `SELECT update_path AS path FROM erkhet_ledger_trs WHERE update_path IS NOT NULL`,
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(stored.rows.some((row) => row.path.includes('delete'))).toBe(false);
  });

  it('follows a changed and a vanished transaction', async () => {
    const sale = erkhet.trs[AR]?.find((tr) => tr.trId === 2001);
    if (!sale?.lines[0]) throw new Error('no sale');
    sale.lines[0].debit = '20,000.00';
    erkhet.trs[AR] = (erkhet.trs[AR] ?? []).filter((tr) => tr.trId !== 2004);
    const followed = await run({ kind: 'POST' });
    expect(followed.summary?.trs).toMatchObject({ post: 0, revise: 1, reverse: 1 });
    expect(followed.summary?.done).toMatchObject({ posted: 1, reversed: 2, blocked: 0 });
    // shop: 600 + 20,000 − 10,032.11; kiosk: 500 with its credit of 120 gone.
    expect(await balance(shop.id)).toBe('10567.89');
    expect(await balance(kiosk.id)).toBe('500.00');
    const revisions = await sql.query<{ revision: number; state: string }>(
      `SELECT live_revision AS revision, state FROM erkhet_ledger_trs WHERE tr_id IN (2001, 2004)
        ORDER BY tr_id`,
    );
    expect(revisions.rows).toEqual([
      { revision: 2, state: 'POSTED' },
      { revision: null, state: 'REVERSED' },
    ]);
  });

  it('picks up a left-out party once it exists', async () => {
    late = await partnersApi(app, admin).customer({ code: '70007', name: 'Шинэ бүртгэл' });
    const picked = await run({ kind: 'POST' });
    expect(picked.summary?.done).toMatchObject({ posted: 2, reversed: 0 });
    expect(picked.summary?.unmatchedParties).toBe(0);
    // Its opening of 50 and the 75 since.
    expect(await balance(late.id)).toBe('125.00');
  });

  it('lists Bto’s own documents and refuses a post until a person chooses', async () => {
    const cash = await finance.cashBox('ERK1');
    const receipt = (
      await finance
        .payment({
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: cash.id,
          customerId: kiosk.id,
          amount: '500',
          paidOn: today,
          description: 'Эрхэтэд ч бүртгэгдсэн төлбөр',
        })
        .expect(201)
    ).body as { id: number; number: string };
    // The receipt closed the kiosk's copied debits, so with it the balance reads zero…
    expect(await balance(kiosk.id)).toBe('0.00');
    // …and Erkhet holds the same payment: with its copy the balance would go to −500.
    erkhet.trs[AR]?.push({
      trId: 2010,
      ptrId: 610,
      date: today,
      lines: [{ customer: '90002 - Туршилт мухлаг', debit: '0.00', credit: '500.00' }],
    });

    const own = (
      await http().get('/api/v1/erkhet/ledger/own-documents').set(bearer(reader)).expect(200)
    ).body as { data: Record<string, unknown>[]; total: string; truncated: boolean };
    expect(own).toMatchObject({ total: '-500.00', truncated: false });
    expect(own.data).toEqual([
      expect.objectContaining({
        documentId: receipt.id,
        number: receipt.number,
        date: today,
        side: 'RECEIVABLE',
        kind: 'VOUCHER',
        blocker: null,
        partyName: 'Туршилт мухлаг',
        amount: '-500.00',
      }),
    ]);

    expect(await refusal({ kind: 'POST' })).toBe('CHOICE_REQUIRED');
    // The reason is the person's: it is written on each reversal.
    await start({ kind: 'POST', ownDocuments: 'REVERSE' }).expect(422);

    const posted = await run({
      kind: 'POST',
      ownDocuments: 'REVERSE',
      reason: 'Эрхэтэд давхар бүртгэгдсэн',
    });
    expect(posted).toMatchObject({ status: 'DONE', ownReversed: 1 });
    expect(posted.summary?.done).toMatchObject({ ownReversed: 1, blocked: 0 });
    // The receipt is void, not deleted, and the balance is Erkhet's: 500 − 500.
    const voided = await finance.paymentGet(receipt.id);
    expect(voided.status).toBe('VOID');
    expect(await balance(kiosk.id)).toBe('0.00');
    expect(
      (await http().get('/api/v1/erkhet/ledger/own-documents').set(bearer(reader)).expect(200))
        .body,
    ).toMatchObject({ data: [], total: '0.00' });
    const audit = await sql.query<{ after: { ownChoice: string; ownReversed: string[] } }>(
      `SELECT after FROM audit_log WHERE entity = 'erkhet_ledger_runs' AND action = 'POST'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]?.after).toMatchObject({
      ownChoice: 'REVERSE',
      ownReversed: [receipt.number],
    });
  });

  it('keeps Bto’s own document when the person says it is not in Erkhet', async () => {
    const cash = (await finance.moneyAccounts()).find((account) => account.code === 'ERK1') as {
      id: number;
    };
    const receipt = (
      await finance
        .payment({
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: cash.id,
          customerId: shop.id,
          amount: '567.89',
          paidOn: today,
        })
        .expect(201)
    ).body as { id: number };
    expect(await refusal({ kind: 'POST' })).toBe('CHOICE_REQUIRED');
    const kept = await run({ kind: 'POST', ownDocuments: 'KEEP' });
    expect(kept).toMatchObject({ status: 'DONE', ownReversed: 0 });
    expect((await finance.paymentGet(receipt.id)).status).toBe('POSTED');
    expect(await balance(shop.id)).toBe('10000.00');
  });

  it('marks a copy BLOCKED when Bto’s own allocation holds its item, and goes on', async () => {
    // The accountant applies the kept receipt to the shop's copied sale by hand: Erkhet now
    // changes that sale, which would reverse the copy the receipt is applied to.
    const items = (
      await http()
        .get(`/api/v1/customer-balances/${shop.id}/open-items`)
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { id: number; side: string; openAmount: string }[] };
    const credit = items.data.find((item) => item.side === 'CREDIT');
    const debit = items.data.find((item) => item.side === 'DEBIT');
    expect(credit?.openAmount).toBe('567.89');
    byHand = (
      await http()
        .post('/api/v1/finance/allocations')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          customerId: shop.id,
          pairs: [{ debitItemId: debit?.id, creditItemId: credit?.id, amount: '567.89' }],
        })
        .expect(201)
    ).body as { id: number };
    const sale = erkhet.trs[AR]?.find((tr) => tr.trId === 2001);
    if (!sale?.lines[0]) throw new Error('no sale');
    sale.lines[0].debit = '21,000.00';
    const blocked = await run({ kind: 'POST', ownDocuments: 'KEEP' });
    expect(blocked.status).toBe('DONE');
    expect(blocked.summary?.done).toMatchObject({ blocked: 1 });
    expect((await overview()).blocked).toBe(1);
    expect(await balance(shop.id)).toBe('10000.00');
    // Erkhet as it was again: the copy agrees with the books and is no longer blocked.
    sale.lines[0].debit = '20,000.00';
    await run({ kind: 'POST', ownDocuments: 'KEEP' });
    expect((await overview()).blocked).toBe(0);
    expect(await balance(shop.id)).toBe('10000.00');
  });

  it('fails cleanly on a closed month and posts nothing of the run', async () => {
    const month = (code: string, action: 'close' | 'reopen') =>
      http()
        .post(`/api/v1/finance/periods/${code}/${action}`)
        .set(bearer(admin))
        .set(idempotency())
        .send(action === 'reopen' ? { reason: 'Туршилт' } : {});
    await month(THROUGH.slice(0, 7), 'close').expect(200);
    await month(LAST_MONTH, 'close').expect(200);
    // One transaction in the closed month and one in the open one.
    erkhet.trs[AR]?.push(
      {
        trId: 2020,
        ptrId: 620,
        date: day(10),
        lines: [{ customer: '90001 - Туршилт дэлгүүр', debit: '111.00', credit: '0.00' }],
      },
      {
        trId: 2021,
        ptrId: 621,
        date: today,
        lines: [{ customer: '90001 - Туршилт дэлгүүр', debit: '222.00', credit: '0.00' }],
      },
    );
    const before = await documents();
    const failed = await run({ kind: 'POST', ownDocuments: 'KEEP' });
    expect(failed).toMatchObject({
      status: 'FAILED',
      failure: 'PERIOD_CLOSED',
      failureDetail: { month: LAST_MONTH },
    });
    expect(await documents()).toEqual(before);
    expect(await balance(shop.id)).toBe('10000.00');

    await month(LAST_MONTH, 'reopen').expect(200);
    await month(THROUGH.slice(0, 7), 'reopen').expect(200);
    const done = await run({ kind: 'POST', ownDocuments: 'KEEP' });
    expect(done.summary?.done).toMatchObject({ posted: 2 });
    expect(await balance(shop.id)).toBe('10333.00');
  });

  it('keeps up at night once posted, once a day', async () => {
    const night = await ledger.startNightly(systemActor('test'));
    expect(night.started).toBe(true);
    await flow.execute(night.runId ?? 0);
    expect((await overview()).latest).toMatchObject({ id: night.runId, status: 'DONE' });
    expect(await ledger.startNightly(systemActor('test'))).toMatchObject({
      started: false,
      reason: 'ALREADY_TODAY',
    });
  });

  it('reverts: every copy is reversed and the balances are Bto’s own again', async () => {
    // A copy that one of Bto's own receipts is applied to cannot be reversed: that allocation
    // and the receipt are taken back first.
    await http()
      .post(`/api/v1/finance/allocations/${byHand?.id ?? 0}/reverse`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Туршилт' })
      .expect(200);
    const kept = (await finance.payments({ customerId: shop.id })).data.find(
      (payment) => payment.status === 'POSTED',
    );
    if (!kept) throw new Error('no kept receipt');
    expect((await finance.voidPayment(kept.id, 'Туршилт')).status).toBeLessThan(300);
    expect(await balance(shop.id)).toBe('10900.89');
    const reverted = await run({ kind: 'REVERT' });
    expect(reverted).toMatchObject({ kind: 'REVERT', status: 'DONE' });
    expect(reverted.summary?.done?.blocked).toBe(0);
    // Nothing of Erkhet is left, and the receipts reversed on the way are not brought back.
    expect(await balance(shop.id)).toBe('0.00');
    expect(await balance(kiosk.id)).toBe('0.00');
    expect(await balance(late?.id ?? 0)).toBe('0.00');
    expect(await payable(vendor.id)).toBe('0.00');
    expect(await clearing()).toBe('0.00');
    expect(await overview()).toMatchObject({ posting: false, posted: 0, checked: false });
    expect(await refusal({ kind: 'POST', ownDocuments: 'KEEP' })).toBe('NOT_CHECKED');
    // The books still reconcile after all of it.
    const drift = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.open_items i
        WHERE i.open_amount < 0 OR i.open_amount > i.amount`,
    );
    expect(drift.rows[0]?.n).toBe('0');
  });

  it('never sent Erkhet anything but GET after the sign-in, and never asked for a delete', () => {
    const writes = erkhet.sent.filter((one) => one.method !== 'GET');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((one) => new URL(one.url).pathname === '/login/')).toBe(true);
    expect(erkhet.sent.some((one) => one.url.includes('delete'))).toBe(false);
  });
});
