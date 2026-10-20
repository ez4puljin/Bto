import type { PostBody } from '@tugeel/fin-contract';
import type { Client } from 'pg';
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
import { StaticCaller, TEST_COMPANY, TEST_SPEC } from '../harness/static-caller';

/**
 * The intake's business key (ADR-0071 #2-#4, docs/modules/finance-core.md §17 «Duplicates»): a
 * resend is a DUPLICATE with the same numbers, another payload under a key is a CONFLICT, a refusal
 * never consumes the key, a revision follows only a reversal, and concurrent twins book once.
 */
describe('Finance Core intake: duplicates and conflicts', () => {
  let core: IntakeCore;
  let admin: Client;
  const count = async (table: string): Promise<number> => {
    const { rows } = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    return Number.parseInt(rows[0]?.n ?? '0', 10);
  };

  beforeAll(async () => {
    core = await intakeCore();
    admin = await connectAs('admin');
  });
  afterAll(async () => {
    await admin.end();
    await core.close();
  });

  it('(1, 2) answers a resend DUPLICATE with the same numbers, the counter untouched', async () => {
    const first = await core.submit(receipt('d1', '100'));
    const documents = await count('fin.documents');
    const entries = await count('fin.journal_entries');
    // The same payload under a new transmission id, the amount written another way, revision 1 named.
    const again = receipt('d1', '100.00');
    again.source = { ...again.source, revision: 1 };
    const second = await core.submit(again);
    expect(second.outcome).toBe('DUPLICATE');
    expect(second.commandId).toBe(again.commandId);
    expect(second.document).toEqual(first.document);
    expect(await count('fin.documents')).toBe(documents);
    expect(await count('fin.journal_entries')).toBe(entries);
    const next = await core.submit(receipt('d1-next', '1'));
    const seq = (number: string | undefined) => Number.parseInt(number?.slice(-4) ?? '0', 10);
    expect(seq(next.document?.number)).toBe(seq(first.document?.number) + 1);
  });

  it('(3) refuses another payload under a posted key and keeps the attempt', async () => {
    await core.submit(receipt('d3', '100'));
    const changed = receipt('d3', '150');
    expect(await codeOf(core.intake.submit(StaticCaller.source(), changed))).toBe(
      'FIN_PAYLOAD_CONFLICT',
    );
    const { rows } = await admin.query<{ outcome: string; error_code: string }>(
      `SELECT a.outcome, a.error_code FROM fin.intake_attempts a
         JOIN fin.intake_requests r ON r.id = a.request_id
        WHERE r.source_doc_id = 'd3' ORDER BY a.id`,
    );
    expect(rows).toEqual([
      { outcome: 'POSTED', error_code: null },
      { outcome: 'CONFLICT', error_code: 'FIN_PAYLOAD_CONFLICT' },
    ]);
    const { rows: requests } = await admin.query<{ status: string }>(
      `SELECT status FROM fin.intake_requests WHERE source_doc_id = 'd3'`,
    );
    expect(requests).toEqual([{ status: 'POSTED' }]);
  });

  it('(4) refuses the same key for another company, while two sources keep their own keys', async () => {
    await StaticCaller.ensure(core.db, {
      ...TEST_SPEC,
      company: { ...TEST_SPEC.company, code: 'TST2', legalName: 'Хоёрдугаар ХХК' },
    });
    await core.submit(invoice('d4', '10'));
    const elsewhere = { ...invoice('d4', '10'), company: 'TST2' };
    const refused = await codeOf(core.submit(elsewhere));
    expect(refused).toBe('FIN_SOURCE_COMPANY_MISMATCH');
    // The core's own screens have their own key space: a FIN receipt with the same id posts.
    const user = StaticCaller.user({ [TEST_COMPANY]: ['finance.payments.record'] });
    const own = command(
      { system: 'FIN', docType: 'RECEIPT', docId: 'd4' },
      { ...(receipt('x', '5').body as PostBody), documentType: 'FIN.RECEIPT' },
    );
    expect((await core.submit(own, user)).outcome).toBe('POSTED');
  });

  it('(5) books ten simultaneous twins once, and one of two different payloads', async () => {
    const twins = Array.from({ length: 10 }, () => receipt('d5', '70'));
    const results = await Promise.allSettled(twins.map((twin) => core.submit(twin)));
    const outcomes = results.map((result) =>
      result.status === 'fulfilled' ? result.value.outcome : 'ERROR',
    );
    expect(outcomes.filter((own) => own === 'POSTED')).toHaveLength(1);
    expect(outcomes.filter((own) => own === 'DUPLICATE')).toHaveLength(9);
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.documents WHERE source_doc_id = 'd5'`,
    );
    expect(rows[0]?.n).toBe('1');
    const pair = await Promise.allSettled([
      core.submit(receipt('d5b', '10')),
      core.submit(receipt('d5b', '20')),
    ]);
    const codes = await Promise.all(
      pair.map((result) =>
        result.status === 'fulfilled'
          ? Promise.resolve(result.value.outcome)
          : codeOf(Promise.reject(result.reason as Error)),
      ),
    );
    expect(codes.sort()).toEqual(['FIN_PAYLOAD_CONFLICT', 'POSTED']);
  });

  it('(6) keeps a refusal on its key and posts the fix under the same key', async () => {
    const unmapped = command(
      { docType: 'JOURNAL', docId: 'd6' },
      {
        action: 'POST',
        documentType: 'TEST.JOURNAL',
        documentDate: today(),
        currency: 'MNT',
        description: 'Дүрэмгүй түлхүүр',
        controlTotal: '5',
        lines: [
          { lineNo: 1, key: 'MANUAL', side: 'DEBIT', amount: '5' },
          { lineNo: 2, key: 'SALES', side: 'CREDIT', amount: '5' },
        ],
      },
    );
    expect(await codeOf(core.intake.submit(StaticCaller.source(), unmapped))).toBe(
      'FIN_MAPPING_MISSING',
    );
    const config = StaticCaller.user({ [TEST_COMPANY]: ['finance.config.manage'] });
    const accounts = await core.chart.accounts(StaticCaller.source(), { company: TEST_COMPANY });
    const clearing = accounts.find((account) => account.code === '1301')?.id ?? 0;
    await core.db.transaction((tx) =>
      core.chart.setRuleInTx(tx, config, {
        company: TEST_COMPANY,
        key: 'MANUAL',
        accountId: clearing,
        effectiveFrom: today(),
      }),
    );
    const fixed = {
      ...unmapped,
      commandId: command({ docType: 'X', docId: 'x' }, unmapped.body).commandId,
    };
    expect((await core.intake.submit(StaticCaller.source(), fixed)).outcome).toBe('POSTED');
    const { rows } = await admin.query<{ status: string; attempts: number; tries: string }>(
      `SELECT r.status, r.attempts,
              (SELECT count(*)::text FROM fin.intake_attempts a WHERE a.request_id = r.id) AS tries
         FROM fin.intake_requests r WHERE r.source_doc_id = 'd6'`,
    );
    expect(rows).toEqual([{ status: 'POSTED', attempts: 2, tries: '2' }]);
  });

  it('(7) takes revision 2 only after revision 1 is reversed', async () => {
    await core.submit(invoice('d7', '40'));
    const second = invoice('d7', '45');
    second.source = { ...second.source, revision: 2 };
    expect(await codeOf(core.submit(second))).toBe('FIN_REVISION_NOT_ALLOWED');
    await core.submit(reverse('INVOICE', 'd7'));
    expect((await core.submit({ ...second, commandId: invoice('n', '1').commandId })).outcome).toBe(
      'POSTED',
    );
  });

  it('(8) answers a lost REVERSE DUPLICATE, another reason CONFLICT, and cancels a refused target', async () => {
    await core.submit(invoice('d8', '30'));
    const first = await core.submit(reverse('INVOICE', 'd8', 'Алдаа'));
    expect(first.outcome).toBe('POSTED');
    expect((await core.submit(reverse('INVOICE', 'd8', 'Алдаа'))).outcome).toBe('DUPLICATE');
    expect(await codeOf(core.submit(reverse('INVOICE', 'd8', 'Өөр шалтгаан')))).toBe(
      'FIN_PAYLOAD_CONFLICT',
    );
    // A refused document (kept REJECTED by `submit`) is cancelled by its REVERSE, with no entry.
    const refused = invoice('d8b', '10', { party: guest('guest:8', 'Найм') });
    const bad = { ...refused, body: { ...(refused.body as PostBody), currency: 'USD' } };
    expect(await codeOf(core.intake.submit(StaticCaller.source(), bad))).toBe(
      'FIN_CURRENCY_UNSUPPORTED',
    );
    const entries = await count('fin.journal_entries');
    expect((await core.submit(reverse('INVOICE', 'd8b'))).outcome).toBe('CANCELLED');
    expect(await count('fin.journal_entries')).toBe(entries);
  });
});
