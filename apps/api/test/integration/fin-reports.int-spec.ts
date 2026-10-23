import { addMonths } from '@tugeel/shared/time';
import { FinReports } from '../../src/finance-core';
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
 * The Finance Core's reports without Bto (F6, ADR-0105): the trial balance of any dates and the
 * month's VAT by source document type with the bases the lines carry.
 */
describe('Finance Core reports (F6)', () => {
  let core: IntakeCore;
  let reports: FinReports;
  const company = TEST_COMPANY;
  const reader = () => StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] });
  const monthStart = `${today().slice(0, 7)}-01`;
  const lastMonthDay = `${addMonths(monthStart, -1).slice(0, 7)}-15`;

  /** An invoice with its VAT line: Dr receivable, Cr sales and Cr VAT on its base. */
  const vatInvoice = (docId: string, net: string, vat: string, base = net) =>
    command(
      { docType: 'INVOICE', docId, docNo: `Н-${docId}` },
      {
        action: 'POST',
        documentType: 'TEST.INVOICE',
        documentDate: today(),
        currency: 'MNT',
        party: guest('guest:vat', 'НӨАТ ХХК'),
        description: `Н-${docId}`,
        controlTotal: (Number.parseFloat(net) + Number.parseFloat(vat)).toFixed(2),
        lines: [
          {
            lineNo: 1,
            key: 'AR',
            side: 'DEBIT',
            amount: (Number.parseFloat(net) + Number.parseFloat(vat)).toFixed(2),
          },
          { lineNo: 2, key: 'SALES', side: 'CREDIT', amount: net },
          {
            lineNo: 3,
            key: 'VAT_OUTPUT',
            side: 'CREDIT',
            amount: vat,
            tax: { code: 'MN.VAT.STD', base },
          },
        ],
      },
    );

  beforeAll(async () => {
    core = await intakeCore();
    reports = core.module.get(FinReports);
  });
  afterAll(async () => {
    await core.close();
  });

  it('opens, moves and closes every account and balances', async () => {
    await core.submit(invoice('tb1', '1100', { date: lastMonthDay }));
    await core.submit(invoice('tb2', '500'));
    const report = await reports.trialBalance(reader(), { company, from: monthStart, to: today() });
    const row = (code: string) => report.rows.find((entry) => entry.code === code);
    expect(row('1201')).toMatchObject({ kind: 'ASSET', group: null });
    expect(row('1201')?.opening.toFixed(2)).toBe('1100.00');
    expect(row('1201')?.debit.toFixed(2)).toBe('500.00');
    expect(row('1201')?.closing.toFixed(2)).toBe('1600.00');
    expect(row('5101')?.closing.toFixed(2)).toBe('-1600.00');
    expect(report.totals.opening.toFixed(2)).toBe('0.00');
    expect(report.totals.closing.toFixed(2)).toBe('0.00');
    expect(report.totals.debit.eq(report.totals.credit)).toBe(true);
    // Accounts without lines only when asked.
    expect(report.rows.some((entry) => entry.code === '3101')).toBe(false);
    const all = await reports.trialBalance(reader(), {
      company,
      from: monthStart,
      to: today(),
      all: true,
    });
    expect(all.rows.some((entry) => entry.code === '3101')).toBe(true);
    expect(
      await codeOf(reports.trialBalance(reader(), { company, from: today(), to: '2000-01-01' })),
    ).toBe('FIN_PAYLOAD_INVALID');
    const nobody = StaticCaller.user({ [TEST_COMPANY]: ['finance.periods.close'] });
    expect(
      await codeOf(reports.trialBalance(nobody, { company, from: monthStart, to: today() })),
    ).toBe('FIN_COMPANY_FORBIDDEN');
  });

  it('sums the month’s VAT by document type with its base, reversals netted', async () => {
    await core.submit(vatInvoice('v1', '1000', '100'));
    await core.submit(vatInvoice('v2', '500', '50'));
    const report = await reports.vatReport(reader(), { company, period: today().slice(0, 7) });
    expect(report.groups).toEqual([
      expect.objectContaining({ side: 'OUTPUT', system: 'TEST_PMS', docType: 'INVOICE' }),
    ]);
    expect(report.groups[0]?.vat.toFixed(2)).toBe('150.00');
    expect(report.groups[0]?.base.toFixed(2)).toBe('1500.00');
    expect(report.output.toFixed(2)).toBe('150.00');
    expect(report.payable.toFixed(2)).toBe('150.00');
    expect(report.documents.map((row) => [row.documentNumber, row.output.toFixed(2)])).toEqual([
      ['Н-v1', '100.00'],
      ['Н-v2', '50.00'],
    ]);
    await core.submit(
      command({ docType: 'INVOICE', docId: 'v2' }, { action: 'REVERSE', reason: 'Буруу' }),
    );
    const after = await reports.vatReport(reader(), { company, period: today().slice(0, 7) });
    expect(after.output.toFixed(2)).toBe('100.00');
    expect(after.groups[0]?.base.toFixed(2)).toBe('1000.00');
    expect(after.documents.find((row) => row.reversal)?.output.toFixed(2)).toBe('-50.00');
    expect(
      (
        await reports.vatReport(reader(), { company, period: lastMonthDay.slice(0, 7) })
      ).output.toFixed(2),
    ).toBe('0.00');
  });

  it('lists the result accounts the year close posts away', async () => {
    const balances = await reports.resultBalances(reader(), { company, asOf: today() });
    expect(balances.map((row) => row.code)).toEqual(['5101']);
    expect(balances[0]?.balance.toFixed(2)).toBe('-2600.00');
  });
});
