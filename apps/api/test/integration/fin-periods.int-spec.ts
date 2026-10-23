import { addDays, addMonths } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { FinChartService, FinPeriodsService } from '../../src/finance-core';
import { connectAs } from '../harness/apps';
import {
  codeOf,
  command,
  guest,
  intakeCore,
  type IntakeCore,
  invoice,
  today,
} from '../harness/fin-intake';
import { StaticCaller, TEST_COMPANY } from '../harness/static-caller';

/**
 * The month close, its reopen and the opening documents without Bto (F5, ADR-0102;
 * docs/modules/finance-core.md §13): a month closes once it has ended, after the earlier ones and
 * with a clean reconcile; a closed month refuses postings; only the latest closed month reopens,
 * with a reason; an OPENING document carries its parties' items with their own dates.
 */
describe('Finance Core month close and opening (F5)', () => {
  let core: IntakeCore;
  let periods: FinPeriodsService;
  let admin: Client;
  const closer = () =>
    StaticCaller.user({
      [TEST_COMPANY]: ['finance.read', 'finance.periods.close', 'finance.periods.reopen'],
    });
  const company = TEST_COMPANY;
  const monthStart = `${today().slice(0, 7)}-01`;
  /** The month `back` months before this one, `YYYY-MM`, and a day inside it. */
  const month = (back: number) => addMonths(monthStart, -back).slice(0, 7);
  const dayIn = (back: number) => `${month(back)}-15`;

  beforeAll(async () => {
    core = await intakeCore();
    periods = core.module.get(FinPeriodsService);
    admin = await connectAs('admin');
  });
  afterAll(async () => {
    await admin.end();
    await core.close();
  });

  it('refuses a month that has not ended and a user without the right', async () => {
    expect(await codeOf(periods.close(closer(), { company, period: month(0) }))).toBe(
      'FIN_PERIOD_NOT_ENDED',
    );
    const reader = StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
    expect(await codeOf(periods.close(reader, { company, period: month(3) }))).toBe(
      'FIN_COMPANY_FORBIDDEN',
    );
    expect(await codeOf(periods.close(closer(), { company, period: '2026-13' }))).toBe(
      'FIN_PAYLOAD_INVALID',
    );
  });

  it('closes in order, then refuses postings in the closed months and before them', async () => {
    await core.submit(invoice('p3', '100', { date: dayIn(3), party: guest('guest:p') }));
    await core.submit(invoice('p2', '200', { date: dayIn(2), party: guest('guest:p') }));
    // The earlier month is open: the later one waits.
    expect(await codeOf(periods.close(closer(), { company, period: month(2) }))).toBe(
      'FIN_PERIOD_ORDER',
    );
    const first = await periods.close(closer(), { company, period: month(3) });
    expect(first).toMatchObject({
      code: month(3),
      status: 'CLOSED',
      lastEvent: { action: 'CLOSE', reason: null, actorLabel: 'Тест хэрэглэгч' },
    });
    await periods.close(closer(), { company, period: month(2) });
    // Closing again changes nothing.
    await periods.close(closer(), { company, period: month(2) });
    const events = await periods.events(closer(), { company });
    expect(events.map((event) => [event.period, event.action])).toEqual([
      [month(2), 'CLOSE'],
      [month(3), 'CLOSE'],
    ]);
    expect(events[0]?.checks).toEqual([
      expect.objectContaining({ item: 'RECONCILE', status: 'OK' }),
    ]);
    expect(await codeOf(core.submit(invoice('p2b', '5', { date: dayIn(2) })))).toBe(
      'FIN_PERIOD_CLOSED',
    );
    // A month before the closed ones that has no row is not opened by a posting.
    expect(await codeOf(core.submit(invoice('p5', '5', { date: dayIn(5) })))).toBe(
      'FIN_PERIOD_CLOSED',
    );
    const { rows } = await admin.query(`SELECT 1 FROM fin.fiscal_periods WHERE code = $1`, [
      month(5),
    ]);
    expect(rows).toHaveLength(0);
    // The month after the closed ones still takes postings.
    await core.submit(invoice('p1', '5', { date: dayIn(1) }));
  });

  it('reopens only the latest closed month, with a reason, and posts in it again', async () => {
    expect(
      await codeOf(periods.reopen(closer(), { company, period: month(3), reason: 'Засвар' })),
    ).toBe('FIN_PERIOD_ORDER');
    expect(
      await codeOf(periods.reopen(closer(), { company, period: month(2), reason: '   ' })),
    ).toBe('FIN_PAYLOAD_INVALID');
    const closeOnly = StaticCaller.user({ [TEST_COMPANY]: ['finance.periods.close'] });
    expect(
      await codeOf(periods.reopen(closeOnly, { company, period: month(2), reason: 'Засвар' })),
    ).toBe('FIN_COMPANY_FORBIDDEN');
    const reopened = await periods.reopen(closer(), {
      company,
      period: month(2),
      reason: 'Нэхэмжлэл хоцорч ирсэн',
    });
    expect(reopened).toMatchObject({
      status: 'OPEN',
      lastEvent: { action: 'REOPEN', reason: 'Нэхэмжлэл хоцорч ирсэн' },
    });
    await core.submit(invoice('p2c', '7', { date: dayIn(2) }));
    const { rows } = await admin.query<{ action: string }>(
      `SELECT action FROM fin.audit_log WHERE entity = 'period' ORDER BY id`,
    );
    expect(rows.map((row) => row.action)).toEqual(['CLOSE', 'CLOSE', 'REOPEN']);
  });

  it('keeps the events append-only', async () => {
    for (const role of ['app', 'migrator'] as const) {
      const client = await connectAs(role);
      try {
        await expect(client.query(`UPDATE fin.period_events SET reason = 'x'`)).rejects.toThrow();
        await expect(client.query(`DELETE FROM fin.period_events`)).rejects.toThrow();
      } finally {
        await client.end();
      }
    }
  });

  it('refuses a close while the reconcile finds a drift', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `SELECT i.id FROM fin.open_items i JOIN fin.documents d ON d.id = i.document_id
        WHERE d.number = 'Н-p2c'`,
    );
    const itemId = rows[0]?.id;
    await admin.query(`UPDATE fin.open_items SET open_amount = open_amount - 1 WHERE id = $1`, [
      itemId,
    ]);
    try {
      expect(await codeOf(periods.close(closer(), { company, period: month(2) }))).toBe(
        'FIN_CHECKLIST_FAILED',
      );
    } finally {
      await admin.query(`UPDATE fin.open_items SET open_amount = open_amount + 1 WHERE id = $1`, [
        itemId,
      ]);
    }
    await periods.close(closer(), { company, period: month(2) });
  });

  it('posts an opening with its parties’ items, dates and due dates, and reverses it', async () => {
    const accountant = StaticCaller.user({ [TEST_COMPANY]: ['finance.journal.manage'] });
    // The party exists (its source posted an invoice); the core's screens name it by its ref.
    await core.submit(invoice('o0', '1', { party: guest('guest:o', 'Эхний ХХК') }));
    const date = addDays(today(), -1);
    const opening = command(
      { system: 'FIN', docType: 'OPENING', docId: 'import:1:1' },
      {
        action: 'POST',
        documentType: 'FIN.OPENING',
        documentDate: date,
        currency: 'MNT',
        description: 'Эхний үлдэгдэл',
        controlTotal: '1500',
        lines: [
          {
            lineNo: 1,
            key: 'MANUAL',
            side: 'DEBIT',
            amount: '1000',
            accountCode: '1201',
            party: guest('guest:o', 'Эхний ХХК'),
            openItem: { itemRef: 'INV-77', itemDate: '2026-06-30', dueDate: '2026-07-30' },
          },
          {
            lineNo: 2,
            key: 'MANUAL',
            side: 'DEBIT',
            amount: '500',
            accountCode: '1001',
            moneyAccount: 'BOX',
          },
          { lineNo: 3, key: 'MANUAL', side: 'CREDIT', amount: '1500', accountCode: '5101' },
        ],
      },
    );
    const posted = await core.submit(opening, accountant);
    expect(posted.document).toMatchObject({
      openItems: [expect.objectContaining({ side: 'DEBIT', amount: '1000.00' })],
    });
    const { rows } = await admin.query<{ ref: string; item: string; due: string }>(
      `SELECT item_ref AS ref, item_date::text AS item, due_date::text AS due
         FROM fin.open_items WHERE document_id = $1`,
      [posted.document?.id],
    );
    expect(rows).toEqual([{ ref: 'INV-77', item: '2026-06-30', due: '2026-07-30' }]);
    // The reader sees it overdue from its own due date.
    const exposure = await core.reader.exposure(StaticCaller.source(), {
      company,
      party: { system: 'TEST_PMS', ref: 'guest:o' },
    });
    expect(exposure.overdue).toBe('1000.00');
    const reversed = await core.submit(
      command(
        { system: 'FIN', docType: 'OPENING', docId: 'import:1:1' },
        { action: 'REVERSE', accountingDate: date, reason: 'Буцаасан' },
      ),
      accountant,
    );
    expect(reversed.outcome).toBe('POSTED');
    expect(
      (
        await core.reader.exposure(StaticCaller.source(), {
          company,
          party: { system: 'TEST_PMS', ref: 'guest:o' },
        })
      ).receivableOpen,
    ).toBe('1.00');
  });

  it('imports a chart: creates, updates, moves a rule and refuses a used account’s control', async () => {
    const chart = core.module.get(FinChartService);
    const user = StaticCaller.user({
      [TEST_COMPANY]: ['finance.journal.manage', 'finance.settings.manage', 'finance.read'],
    });
    const before = await chart.accounts(StaticCaller.source(), { company });
    const sales = before.find((account) => account.code === '5101');
    const applied = await core.db.transaction((tx) =>
      chart.importChartInTx(tx, user, {
        company,
        on: today(),
        rows: [
          {
            code: '5101',
            name: 'Бараа борлуулсны орлого',
            kind: 'INCOME',
            normalSide: null,
            control: null,
            group: { code: '51', name: 'Үндсэн үйл ажиллагааны орлого' },
            key: null,
          },
          {
            code: '5102',
            name: 'Үйлчилгээний орлого',
            kind: 'INCOME',
            normalSide: null,
            control: null,
            group: { code: '51', name: null },
            key: 'SALES',
          },
        ],
      }),
    );
    expect(applied.map((row) => [row.code, row.action, row.rule?.key ?? null])).toEqual([
      ['5101', 'UPDATE', null],
      ['5102', 'CREATE', 'SALES'],
    ]);
    const rules = await chart.rules(StaticCaller.source(), { company, on: today() });
    expect(rules.get('SALES')?.accountId).toBe(applied[1]?.accountId);
    const groups = await chart.groups(StaticCaller.source(), { company });
    expect(groups.map((group) => [group.code, group.name])).toEqual([
      ['51', 'Үндсэн үйл ажиллагааны орлого'],
    ]);
    // A used account keeps its control.
    expect(
      await codeOf(
        core.db.transaction((tx) =>
          chart.importChartInTx(tx, user, {
            company,
            on: today(),
            rows: [
              {
                code: '1201',
                name: 'Авлага',
                kind: 'ASSET',
                normalSide: null,
                control: 'NONE',
                group: null,
                key: null,
              },
            ],
          }),
        ),
      ),
    ).toBe('FIN_ACCOUNT_IN_USE');
    // The revert takes it all back.
    await core.db.transaction((tx) =>
      chart.revertChartInTx(tx, user, { company, applied, on: today() }),
    );
    const after = await chart.accounts(StaticCaller.source(), { company });
    expect(after.find((account) => account.code === '5101')).toMatchObject({
      name: sales?.name,
      groupId: null,
    });
    expect(after.find((account) => account.code === '5102')?.status).toBe('INACTIVE');
    const back = await chart.rules(StaticCaller.source(), { company, on: today() });
    expect(back.get('SALES')?.accountId).toBe(sales?.id);
    expect((await chart.groups(StaticCaller.source(), { company }))[0]?.status).toBe('INACTIVE');
  });
});
