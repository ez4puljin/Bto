import type { IntakeCommandV1, ItemRefV1 } from '@tugeel/fin-contract';
import type { Client } from 'pg';
import { reconcileBooks } from '../../src/finance-core';
import { connectAs } from '../harness/apps';
import {
  codeOf,
  command,
  guest,
  intakeCore,
  type IntakeCore,
  invoice,
  receipt,
  reverse,
  today,
} from '../harness/fin-intake';
import { StaticCaller, TEST_COMPANY } from '../harness/static-caller';

/**
 * The accountant's manual allocation (ADR-0072 #7, docs/modules/finance-core.md §17 «Manual
 * allocation»), the sub-ledger's reconcile and two racing reversals.
 */
describe('Finance Core: manual allocation and the sub-ledger', () => {
  let core: IntakeCore;
  let admin: Client;
  let next = 0;
  const accountant = () => StaticCaller.user({ [TEST_COMPANY]: ['finance.payments.record'] });
  const allocation = (
    ref: string,
    pairs: { debit: ItemRefV1; credit: ItemRefV1; amount: string }[],
  ): IntakeCommandV1 => {
    next += 1;
    const total = pairs.reduce((sum, pair) => sum + Number.parseFloat(pair.amount), 0).toFixed(2);
    return command(
      { system: 'FIN', docType: 'ALLOCATION', docId: `a${next}` },
      {
        action: 'POST',
        documentType: 'FIN.ALLOCATION',
        documentDate: today(),
        currency: 'MNT',
        party: guest(ref, ref),
        description: 'Тулгалт',
        controlTotal: total,
        lines: [],
        allocate: { key: 'AR', pairs },
      },
    );
  };
  const itemOf = async (docId: string): Promise<{ itemId: string }> => {
    const { rows } = await admin.query<{ id: string }>(
      `SELECT i.id::text AS id FROM fin.open_items i JOIN fin.documents d ON d.id = i.document_id
        WHERE d.source_doc_id = $1 AND d.reverses_document_id IS NULL`,
      [docId],
    );
    if (!rows[0]) throw new Error(`no item of ${docId}`);
    return { itemId: rows[0].id };
  };
  const open = async (docId: string): Promise<string> => {
    const { rows } = await admin.query<{ open: string }>(
      `SELECT i.open_amount::text AS open FROM fin.open_items i JOIN fin.documents d ON d.id = i.document_id
        WHERE d.source_doc_id = $1 AND d.reverses_document_id IS NULL`,
      [docId],
    );
    return rows[0]?.open ?? '';
  };
  const trialBalance = async (): Promise<string> => {
    const { rows } = await admin.query<{ tb: string }>(
      `SELECT string_agg(a.code || ':' || s.net::text, ',' ORDER BY a.code) AS tb
         FROM (SELECT account_id, sum(debit - credit) AS net FROM fin.journal_lines GROUP BY account_id) s
         JOIN fin.accounts a ON a.id = s.account_id`,
    );
    return rows[0]?.tb ?? '';
  };

  beforeAll(async () => {
    core = await intakeCore();
    admin = await connectAs('admin');
  });
  afterAll(async () => {
    await admin.end();
    await core.close();
  });

  it('(1, 4) pairs a credit with an invoice without an entry, and its reversal restores both', async () => {
    const p = guest('a:1', 'a:1');
    await core.submit(invoice('i1', '500', { party: p }));
    await core.submit(receipt('r1', '800', null, { party: p }));
    const before = await trialBalance();
    const entries = await admin.query<{ n: string }>('SELECT count(*)::text AS n FROM fin.journal_entries');
    const posted = await core.submit(
      allocation('a:1', [{ debit: await itemOf('i1'), credit: await itemOf('r1'), amount: '300' }]),
      accountant(),
    );
    expect(posted).toMatchObject({
      outcome: 'POSTED',
      document: { number: expect.stringMatching(/^A-\d{8}-\d{4}$/), journalNo: null, amount: '300.00' },
    });
    expect([await open('i1'), await open('r1')]).toEqual(['200.00', '500.00']);
    expect(await trialBalance()).toBe(before);
    const after = await admin.query<{ n: string }>('SELECT count(*)::text AS n FROM fin.journal_entries');
    expect(after.rows[0]?.n).toBe(entries.rows[0]?.n);
    const { rows: cache } = await admin.query<{ debit: string; credit: string }>(
      `SELECT b.open_debit::text AS debit, b.open_credit::text AS credit FROM fin.party_balances b
         JOIN fin.party_refs r ON r.party_id = b.party_id WHERE r.external_id = 'a:1'`,
    );
    expect(cache).toEqual([{ debit: '200.00', credit: '500.00' }]);
    // Reversed: both open amounts come back; a resend of the reversal is a duplicate.
    const undo = command({ system: 'FIN', docType: 'ALLOCATION', docId: `a${next}` }, { action: 'REVERSE', reason: 'Буруу' });
    expect((await core.submit(undo, accountant())).outcome).toBe('POSTED');
    expect([await open('i1'), await open('r1')]).toEqual(['500.00', '800.00']);
    expect((await core.submit({ ...undo, commandId: invoice('n', '1').commandId }, accountant())).outcome).toBe(
      'DUPLICATE',
    );
  });

  it('(2) refuses a pair above an open amount, of another party, or with the sides swapped', async () => {
    const p = guest('a:2', 'a:2');
    await core.submit(invoice('i2', '100', { party: p }));
    await core.submit(receipt('r2', '50', null, { party: p }));
    await core.submit(invoice('i2x', '100', { party: guest('a:2x', 'a:2x') }));
    expect(
      await codeOf(
        core.submit(allocation('a:2', [{ debit: await itemOf('i2'), credit: await itemOf('r2'), amount: '60' }]), accountant()),
      ),
    ).toBe('FIN_OVER_ALLOCATION');
    expect(
      await codeOf(
        core.submit(allocation('a:2', [{ debit: await itemOf('i2x'), credit: await itemOf('r2'), amount: '10' }]), accountant()),
      ),
    ).toBe('FIN_SETTLE_TARGET_NOT_FOUND');
    expect(
      await codeOf(
        core.submit(allocation('a:2', [{ debit: await itemOf('r2'), credit: await itemOf('i2'), amount: '10' }]), accountant()),
      ),
    ).toBe('FIN_CLASS_RULE');
    // Only the accountant's right allocates.
    const reader = StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
    expect(
      await codeOf(
        core.submit(allocation('a:2', [{ debit: await itemOf('i2'), credit: await itemOf('r2'), amount: '10' }]), reader),
      ),
    ).toBe('FIN_COMPANY_FORBIDDEN');
  });

  it('(3) lets only one of two allocations that together exceed a credit commit', async () => {
    const p = guest('a:3', 'a:3');
    await core.submit(invoice('i3a', '100', { party: p }));
    await core.submit(invoice('i3b', '100', { party: p }));
    await core.submit(receipt('r3', '100', null, { party: p }));
    const credit = await itemOf('r3');
    const results = await Promise.allSettled([
      core.submit(allocation('a:3', [{ debit: await itemOf('i3a'), credit, amount: '80' }]), accountant()),
      core.submit(allocation('a:3', [{ debit: await itemOf('i3b'), credit, amount: '80' }]), accountant()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await open('r3')).toBe('20.00');
  });

  it('(5) blocks a receipt’s reversal while an allocation uses its credit, until that is reversed', async () => {
    const p = guest('a:5', 'a:5');
    await core.submit(invoice('i5', '100', { party: p }));
    await core.submit(receipt('r5', '100', null, { party: p }));
    await core.submit(allocation('a:5', [{ debit: await itemOf('i5'), credit: await itemOf('r5'), amount: '100' }]), accountant());
    const used = `a${next}`;
    expect(await codeOf(core.submit(reverse('RECEIPT', 'r5')))).toBe('FIN_REVERSAL_BLOCKED');
    await core.submit(command({ system: 'FIN', docType: 'ALLOCATION', docId: used }, { action: 'REVERSE', reason: 'Буцаах' }), accountant());
    expect((await core.submit(reverse('RECEIPT', 'r5'))).outcome).toBe('POSTED');
  });

  it('(6) never applies an open credit to a new invoice on its own', async () => {
    const p = guest('a:6', 'a:6');
    await core.submit(receipt('r6', '300', null, { party: p }));
    await core.submit(invoice('i6', '200', { party: p }));
    expect([await open('r6'), await open('i6')]).toEqual(['300.00', '200.00']);
  });

  it('lets exactly one of two simultaneous reversals of a document commit', async () => {
    await core.submit(invoice('i7', '70', { party: guest('a:7', 'a:7') }));
    const results = await Promise.allSettled([
      core.submit(reverse('INVOICE', 'i7', 'Нэг')),
      core.submit(reverse('INVOICE', 'i7', 'Хоёр')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.documents WHERE source_doc_id = 'i7' AND reverses_document_id IS NOT NULL`,
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('finds the books clean, then each induced drift: a cache row, an item, a control line', async () => {
    const clean = await reconcileBooks(core.db, 'MANUAL');
    expect(clean.map((run) => [run.kind, run.status])).toEqual([
      ['CACHE', 'OK'],
      ['ITEMS', 'OK'],
      ['SUBLEDGER_GL', 'OK'],
    ]);
    await admin.query(
      `UPDATE fin.party_balances SET open_credit = open_credit + 1
        WHERE party_id = (SELECT party_id FROM fin.party_refs WHERE external_id = 'a:6')`,
    );
    const cache = await reconcileBooks(core.db, 'NIGHTLY');
    expect(cache.find((run) => run.kind === 'CACHE')?.status).toBe('DRIFT');
    expect((await reconcileBooks(core.db, 'MANUAL')).every((run) => run.status === 'OK')).toBe(true);
    // An item's open amount written by hand (the column the application may change).
    await admin.query(
      `UPDATE fin.open_items SET open_amount = open_amount - 1
        WHERE document_id = (SELECT id FROM fin.documents WHERE source_doc_id = 'i6')`,
    );
    const items = await reconcileBooks(core.db, 'MANUAL');
    expect(items.find((run) => run.kind === 'ITEMS')?.status).toBe('DRIFT');
    expect(items.find((run) => run.kind === 'SUBLEDGER_GL')?.status).toBe('DRIFT');
  });
});
