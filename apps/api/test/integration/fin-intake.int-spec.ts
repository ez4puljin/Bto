import { addDays } from '@tugeel/shared/time';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import { FinConfig, FinJournalPosting } from '../../src/finance-core';
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
 * The Finance Core's intake without Bto (F2, ADR-0090; docs/modules/finance-core.md §6): every class
 * a source posts, the rules and the controls, the core's numbers, settling at posting, reversals,
 * and the reads Bto relies on.
 */
describe('Finance Core intake (F2)', () => {
  let core: IntakeCore;
  let admin: Client;
  const source = () => StaticCaller.source();
  const party = (ref = 'guest:1') => ({ system: 'TEST_PMS', ref });

  beforeAll(async () => {
    core = await intakeCore();
    admin = await connectAs('admin');
  });
  afterAll(async () => {
    await admin.end();
    await core.close();
  });

  it('posts an invoice with its item, keeps the sender’s number and answers with the booking', async () => {
    const result = await core.submit(invoice('1', '110000.00'));
    expect(result).toMatchObject({
      outcome: 'POSTED',
      action: 'POST',
      source: { system: 'TEST_PMS', docType: 'INVOICE', docId: '1', revision: 1 },
      document: {
        number: 'Н-1',
        journalNo: expect.stringMatching(/^J-\d{8}-\d{4}$/),
        amount: '110000.00',
        period: today().slice(0, 7),
        reversed: false,
        lines: [
          { lineNo: 1, account: '1201', side: 'DEBIT', amount: '110000.00' },
          { lineNo: 2, account: '5101', side: 'CREDIT', amount: '110000.00' },
        ],
        openItems: [{ key: 'AR', side: 'DEBIT', amount: '110000.00', openAmount: '110000.00' }],
        allocations: [],
      },
    });
    const exposure = await core.reader.exposure(source(), { company: TEST_COMPANY, party: party() });
    expect(exposure).toEqual({
      receivableOpen: '110000.00',
      creditsOpen: '0.00',
      net: '110000.00',
      overdue: '0.00',
      oldestDueDate: null,
    });
  });

  it('settles the oldest invoice first, numbers the receipt from its series and caches the balance', async () => {
    const p = guest('guest:2', 'Хоёр');
    await core.submit(invoice('2a', '1000', { party: p, dueDate: addDays(today(), 5) }));
    await core.submit(invoice('2b', '500', { party: p, dueDate: addDays(today(), 1) }));
    const paid = await core.submit(receipt('r2', '700', 'FIFO', { party: p }));
    expect(paid.document?.number).toMatch(/^R-\d{8}-\d{4}$/);
    expect(paid.document?.allocations.map((row) => row.amount)).toEqual(['500.00', '200.00']);
    const items = await core.reader.openItems(source(), {
      company: TEST_COMPANY,
      partyId: await partyId('guest:2'),
    });
    expect(items.map((item) => [item.document.number, item.openAmount.toFixed(2)])).toEqual([
      ['Н-2a', '800.00'],
    ]);
    const balance = await core.reader.partyBalance(source(), {
      company: TEST_COMPANY,
      partyId: await partyId('guest:2'),
    });
    expect(balance.net.toFixed(2)).toBe('800.00');
    // An overpayment stays an open credit; nothing applies it to a later invoice (D7).
    await core.submit(receipt('r2b', '1000', 'FIFO', { party: p }));
    await core.submit(invoice('2c', '300', { party: p }));
    const open = await core.reader.openItems(source(), {
      company: TEST_COMPANY,
      partyId: await partyId('guest:2'),
    });
    expect(open.map((item) => [item.side, item.openAmount.toFixed(2)])).toEqual([
      ['CREDIT', '200.00'],
      ['DEBIT', '300.00'],
    ]);
  });

  it('settles named targets and refuses an amount above the open one', async () => {
    const p = guest('guest:3', 'Гурав');
    await core.submit(invoice('3a', '400', { party: p }));
    const target = { system: 'TEST_PMS', docType: 'INVOICE', docId: '3a' };
    expect(
      await codeOf(core.submit(receipt('r3x', '500', [{ target, amount: '450' }], { party: p }))),
    ).toBe('FIN_OVER_ALLOCATION');
    const paid = await core.submit(receipt('r3', '500', [{ target, amount: '400' }], { party: p }));
    expect(paid.document?.openItems).toEqual([
      expect.objectContaining({ side: 'CREDIT', amount: '500.00', openAmount: '100.00' }),
    ]);
    expect(
      await codeOf(
        core.submit(
          receipt('r3y', '10', [{ target: { ...target, docId: 'missing' } }], { party: p }),
        ),
      ),
    ).toBe('FIN_SETTLE_TARGET_NOT_FOUND');
  });

  it('enforces the class rules, the controls, the amounts and the mappings', async () => {
    const base = invoice('4', '100');
    const body = base.body as Extract<typeof base.body, { action: 'POST' }>;
    const variant = (patch: Partial<typeof body>, docId: string) =>
      core.submit(command({ docType: 'INVOICE', docId, docNo: docId }, { ...body, ...patch }));
    expect(await codeOf(variant({ controlTotal: '90.00' }, '4a'))).toBe('FIN_TOTAL_MISMATCH');
    expect(
      await codeOf(
        variant(
          {
            lines: [
              { lineNo: 1, key: 'AR', side: 'DEBIT', amount: '100' },
              { lineNo: 2, key: 'SALES', side: 'CREDIT', amount: '90' },
            ],
          },
          '4b',
        ),
      ),
    ).toBe('FIN_UNBALANCED');
    expect(await codeOf(variant({ currency: 'USD' }, '4c'))).toBe('FIN_CURRENCY_UNSUPPORTED');
    expect(await codeOf(variant({ documentType: 'TEST.NOPE' }, '4d'))).toBe('FIN_DOCTYPE_UNKNOWN');
    expect(await codeOf(variant({ documentDate: addDays(today(), 2) }, '4e'))).toBe(
      'FIN_FUTURE_DATE',
    );
    const { party: _party, ...withoutParty } = body;
    expect(
      await codeOf(
        core.submit(command({ docType: 'INVOICE', docId: '4f', docNo: '4f' }, withoutParty)),
      ),
    ).toBe('FIN_PARTY_REQUIRED');
    expect(
      await codeOf(
        variant(
          {
            lines: [
              { lineNo: 1, key: 'AR', side: 'DEBIT', amount: '100' },
              { lineNo: 2, key: 'NO_SUCH_KEY', side: 'CREDIT', amount: '100' },
            ],
          },
          '4g',
        ),
      ),
    ).toBe('FIN_MAPPING_MISSING');
    expect(
      await codeOf(
        variant(
          {
            lines: [
              { lineNo: 1, key: 'AR', side: 'DEBIT', amount: '100' },
              { lineNo: 2, key: 'VAT_OUTPUT', side: 'CREDIT', amount: '100' },
            ],
          },
          '4h',
        ),
      ),
    ).toBe('FIN_TAX_CODE_UNKNOWN');
    // Two receivable lines are no invoice; a cash line without its cash box is refused.
    expect(
      await codeOf(
        variant(
          {
            controlTotal: '100',
            lines: [
              { lineNo: 1, key: 'AR', side: 'DEBIT', amount: '50' },
              { lineNo: 2, key: 'AR', side: 'DEBIT', amount: '50' },
              { lineNo: 3, key: 'SALES', side: 'CREDIT', amount: '100' },
            ],
          },
          '4i',
        ),
      ),
    ).toBe('FIN_CLASS_RULE');
    expect(
      await codeOf(
        core.submit(
          command(
            { docType: 'JOURNAL', docId: '4j' },
            {
              action: 'POST',
              documentType: 'TEST.JOURNAL',
              documentDate: today(),
              currency: 'MNT',
              description: 'Касс',
              controlTotal: '10',
              lines: [
                { lineNo: 1, key: 'CASH', side: 'DEBIT', amount: '10' },
                { lineNo: 2, key: 'SALES', side: 'CREDIT', amount: '10' },
              ],
            },
          ),
        ),
      ),
    ).toBe('FIN_MONEY_ACCOUNT_REQUIRED');
    // A source names no account by code: that is the core's own screens' (source FIN).
    expect(
      await codeOf(
        variant(
          {
            lines: [
              { lineNo: 1, key: 'AR', side: 'DEBIT', amount: '100' },
              { lineNo: 2, key: 'SALES', side: 'CREDIT', amount: '100', accountCode: '5101' },
            ],
          },
          '4k',
        ),
      ),
    ).toBe('FIN_CLASS_RULE');
    // Nothing of the refused commands was booked.
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.documents WHERE source_doc_id LIKE '4%'`,
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('reverses a receipt, giving its settlements back, once', async () => {
    const p = guest('guest:5', 'Тав');
    await core.submit(invoice('5', '1000', { party: p }));
    await core.submit(receipt('r5', '600', 'FIFO', { party: p }));
    const reversed = await core.submit(reverse('RECEIPT', 'r5'));
    expect(reversed).toMatchObject({ outcome: 'POSTED', action: 'REVERSE' });
    expect(reversed.document?.lines.map((row) => [row.account, row.side, row.amount])).toEqual([
      ['1001', 'CREDIT', '600.00'],
      ['1201', 'DEBIT', '600.00'],
    ]);
    const items = await core.reader.openItems(source(), {
      company: TEST_COMPANY,
      partyId: await partyId('guest:5'),
    });
    expect(items.map((item) => [item.document.number, item.openAmount.toFixed(2)])).toEqual([
      ['Н-5', '1000.00'],
    ]);
    expect(await codeOf(core.submit(reverse('RECEIPT', 'r5', 'Дахин')))).toBe(
      'FIN_PAYLOAD_CONFLICT',
    );
    // The reversal of an invoice is blocked while another document settles it.
    await core.submit(receipt('r5b', '100', 'FIFO', { party: p }));
    expect(await codeOf(core.submit(reverse('INVOICE', '5')))).toBe('FIN_REVERSAL_BLOCKED');
  });

  it('posts supplier bills, credits and payments on the payable', async () => {
    const supplier = guest('supplier:1', 'Нийлүүлэгч');
    const bill = await core.submit(
      command(
        { docType: 'BILL', docId: 'b1', docNo: 'B-1' },
        {
          action: 'POST',
          documentType: 'TEST.BILL',
          documentDate: today(),
          currency: 'MNT',
          party: supplier,
          dueDate: addDays(today(), 10),
          description: 'Падаан',
          controlTotal: '900',
          lines: [
            { lineNo: 1, key: 'CLEARING', side: 'DEBIT', amount: '900' },
            { lineNo: 2, key: 'AP', side: 'CREDIT', amount: '900' },
          ],
        },
      ),
    );
    expect(bill.document?.openItems).toEqual([
      expect.objectContaining({ key: 'AP', side: 'CREDIT', openAmount: '900.00' }),
    ]);
    const credit = await core.submit(
      command(
        { docType: 'BILL_CREDIT', docId: 'bc1', docNo: 'BC-1' },
        {
          action: 'POST',
          documentType: 'TEST.BILL_CREDIT',
          documentDate: today(),
          currency: 'MNT',
          party: supplier,
          description: 'Буцаалт',
          controlTotal: '100',
          lines: [
            {
              lineNo: 1,
              key: 'AP',
              side: 'DEBIT',
              amount: '100',
              settles: [{ target: { system: 'TEST_PMS', docType: 'BILL', docId: 'b1' } }],
            },
            { lineNo: 2, key: 'CLEARING', side: 'CREDIT', amount: '100' },
          ],
        },
      ),
    );
    expect(credit.document?.allocations).toEqual([expect.objectContaining({ amount: '100.00' })]);
    const paid = await core.submit(
      command(
        { docType: 'SUPPLIER_PAYMENT', docId: 'sp1' },
        {
          action: 'POST',
          documentType: 'TEST.SUPPLIER_PAYMENT',
          documentDate: today(),
          currency: 'MNT',
          party: supplier,
          description: 'Төлбөр',
          controlTotal: '800',
          lines: [
            { lineNo: 1, key: 'AP', side: 'DEBIT', amount: '800', settles: 'FIFO' },
            { lineNo: 2, key: 'CASH', side: 'CREDIT', amount: '800', moneyAccount: 'BOX' },
          ],
        },
      ),
    );
    expect(paid.document?.allocations).toEqual([expect.objectContaining({ amount: '800.00' })]);
    const { rows } = await admin.query<{ open: string }>(
      `SELECT sum(open_amount)::text AS open FROM fin.open_items i
         JOIN fin.party_refs r ON r.party_id = i.party_id WHERE r.external_id = 'supplier:1'`,
    );
    expect(rows[0]?.open).toBe('0.00');
  });

  it('lets the core’s screens post a journal by account code as the user, numbered once', async () => {
    const user = StaticCaller.user({ [TEST_COMPANY]: ['finance.journal.manage'] });
    const journal = (docId: string) =>
      command(
        { system: 'FIN', docType: 'JOURNAL', docId },
        {
          action: 'POST',
          documentType: 'FIN.JOURNAL',
          documentDate: today(),
          currency: 'MNT',
          description: 'Гараар',
          controlTotal: '50',
          lines: [
            { lineNo: 1, key: 'MANUAL', side: 'DEBIT', amount: '50', accountCode: '1301' },
            { lineNo: 2, key: 'MANUAL', side: 'CREDIT', amount: '50', accountCode: '5101' },
          ],
        },
      );
    const posted = await core.submit(journal('j1'), user);
    expect(posted.document?.number).toBe(posted.document?.journalNo);
    const readOnly = StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
    expect(await codeOf(core.submit(journal('j2'), readOnly))).toBe('FIN_COMPANY_FORBIDDEN');
    // A source cannot speak for the core's own screens.
    expect(await codeOf(core.submit(journal('j3')))).toBe('FIN_SOURCE_MISMATCH');
  });

  it('keeps the façade to the POS entries: no line on a party-control account', async () => {
    const posting = core.module.get(FinJournalPosting);
    const accounts = await core.chart.accounts(source(), { company: TEST_COMPANY });
    const id = (code: string) => accounts.find((account) => account.code === code)?.id ?? 0;
    expect(
      await codeOf(
        core.db.transaction((tx) =>
          posting.postEntryInTx(tx, source(), {
            company: TEST_COMPANY,
            entryDate: today(),
            description: 'Хуучин зам',
            lines: [
              { accountId: id('1201'), debit: new Decimal(10), credit: new Decimal(0) },
              { accountId: id('5101'), debit: new Decimal(0), credit: new Decimal(10) },
            ],
          }),
        ),
      ),
    ).toBe('FIN_CLASS_RULE');
    // And a raw line on the receivable without its item never commits (the deferred trigger).
    expect(
      await codeOf(
        (async () => {
          await admin.query('BEGIN');
          try {
            const { rows } = await admin.query<{ id: string; company_id: string }>(
              `INSERT INTO fin.journal_entries (company_id, number, entry_date, period_id, source_system_id,
                                                description, actor_kind, actor_ref, actor_label)
               SELECT c.id, 'RAW-1', $1, p.id, s.id, 'raw', 'SYSTEM', 'test', 'test'
                 FROM fin.companies c
                 JOIN fin.fiscal_periods p ON p.company_id = c.id AND p.code = $2
                 JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'FIN'
                WHERE c.code = $3 RETURNING id, company_id`,
              [today(), today().slice(0, 7), TEST_COMPANY],
            );
            const entry = rows[0];
            const partyRow = await admin.query<{ party_id: string }>(
              `SELECT party_id FROM fin.party_refs WHERE external_id = 'guest:1'`,
            );
            await admin.query(
              `INSERT INTO fin.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, party_id)
               VALUES ($1, $2, 1, $3, 10, 0, $5), ($1, $2, 2, $4, 0, 10, NULL)`,
              [entry?.company_id, entry?.id, id('1201'), id('5101'), partyRow.rows[0]?.party_id],
            );
            await admin.query('COMMIT');
          } catch (error) {
            await admin.query('ROLLBACK');
            throw error;
          }
        })(),
      ),
    ).toBe('23514');
  });

  it('configures the series a company numbers from', async () => {
    const config = core.module.get(FinConfig);
    const manager = StaticCaller.user({ [TEST_COMPANY]: ['finance.settings.manage'] });
    await core.db.transaction((tx) =>
      config.setNumberSeriesInTx(tx, manager, {
        company: TEST_COMPANY,
        code: 'PAYMENT',
        pattern: 'P{year}-',
        digits: 2,
      }),
    );
    const paid = await core.submit(receipt('r9', '10', undefined, { party: guest('guest:9', 'Ес') }));
    expect(paid.document?.number).toBe(`P${today().slice(0, 4)}-01`);
    expect(
      await codeOf(
        core.db.transaction((tx) =>
          config.setNumberSeriesInTx(tx, manager, {
            company: TEST_COMPANY,
            code: 'PAYMENT',
            pattern: 'P{week}-',
            digits: 2,
          }),
        ),
      ),
    ).toBe('FIN_PAYLOAD_INVALID');
  });

  async function partyId(ref: string): Promise<number> {
    const { rows } = await admin.query<{ party_id: string }>(
      'SELECT party_id FROM fin.party_refs WHERE external_id = $1',
      [ref],
    );
    const found = rows[0];
    if (!found) throw new Error(`no party ${ref}`);
    return Number.parseInt(found.party_id, 10);
  }
});
