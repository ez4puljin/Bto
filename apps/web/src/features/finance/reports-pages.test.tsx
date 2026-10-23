import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { addMonths, businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, calls, UUID } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';
import type { TrialBalance, VatReport, YearCloseStatus } from './api';

const TRIAL_BALANCE: TrialBalance = {
  from: '2026-10-01',
  to: '2026-10-23',
  data: [
    {
      accountId: 1,
      code: '100101',
      name: 'Касс',
      kind: 'ASSET',
      status: 'ACTIVE',
      groupCode: '10',
      groupName: 'Мөнгө',
      opening: '5000.00',
      debit: '1000.00',
      credit: '0.00',
      closing: '6000.00',
    },
    {
      accountId: 2,
      code: '510101',
      name: 'Борлуулалтын орлого',
      kind: 'INCOME',
      status: 'ACTIVE',
      groupCode: null,
      groupName: null,
      opening: '-5000.00',
      debit: '0.00',
      credit: '1000.00',
      closing: '-6000.00',
    },
  ],
  opening: '0.00',
  debit: '1000.00',
  credit: '1000.00',
  closing: '0.00',
};

const VAT: VatReport = {
  period: '2026-10',
  from: '2026-10-01',
  to: '2026-10-31',
  groups: [
    {
      side: 'OUTPUT',
      system: 'BTO',
      docType: 'SALES_INVOICE',
      vat: '1000.00',
      base: '10000.00',
      linesWithoutBase: 0,
    },
    {
      side: 'INPUT',
      system: 'BTO',
      docType: 'GOODS_RECEIPT',
      vat: '400.00',
      base: '4000.00',
      linesWithoutBase: 0,
    },
  ],
  documents: [
    {
      entryId: 9,
      entryNumber: 'Ж-20261015-0001',
      entryDate: '2026-10-15',
      system: 'BTO',
      docType: 'SALES_INVOICE',
      documentNumber: 'Н-20261015-0001',
      reversal: false,
      output: '1000.00',
      input: '0.00',
      base: '10000.00',
    },
  ],
  truncated: false,
  output: '1000.00',
  input: '400.00',
  payable: '600.00',
};

const lastYear = Number.parseInt(addMonths(businessDate(), -12).slice(0, 4), 10);
const OPEN_YEAR: YearCloseStatus = {
  year: lastYear,
  ended: true,
  documents: [],
  income: '1000000.00',
  expense: '800000.00',
  profit: '200000.00',
};

describe('reports (F6, ADR-0105)', () => {
  it('shows the trial balance by group with the subtotal and the balance check', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      signedIn(ACCOUNTANT_ME, {
        'GET /api/v1/finance/reports/trial-balance': () => json(TRIAL_BALANCE),
      }),
    );
    const sidebar = within(await findSidebar());
    await user.click(sidebar.getByRole('link', { name: mn.nav.trialBalance }));
    const cash = await screen.findByRole('row', { name: /100101/ });
    expect(within(cash).getByText('5,000')).toBeInTheDocument();
    expect(within(cash).getByText('6,000')).toBeInTheDocument();
    expect(screen.getByText('10 Мөнгө')).toBeInTheDocument();
    expect(screen.getByText(mn.finance.reports.trialBalance.noGroup)).toBeInTheDocument();
    expect(screen.getByText(mn.finance.reports.trialBalance.balanced)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '100101' })).toHaveAttribute(
      'href',
      '/finance/accounts/1',
    );
  });

  it('shows the month’s VAT, what is payable and the documents', async () => {
    renderApp(
      '/finance/vat?period=2026-10',
      signedIn(ACCOUNTANT_ME, { 'GET /api/v1/finance/reports/vat': () => json(VAT) }),
    );
    expect(await screen.findByText(mn.finance.reports.vat.payable)).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();
    expect(
      screen.getAllByText(mn.finance.reports.vat.docTypes.SALES_INVOICE).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(mn.finance.reports.vat.docTypes.GOODS_RECEIPT)).toBeInTheDocument();
    expect(screen.getByText('Н-20261015-0001')).toBeInTheDocument();
  });

  it('closes last year from «Сарын хаалт» after a confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/finance/periods': () => json({ data: [] }),
      'GET /api/v1/finance/periods/events': () => json({ data: [] }),
      [`GET /api/v1/finance/year-close/${lastYear}`]: () => json(OPEN_YEAR),
      [`POST /api/v1/finance/year-close/${lastYear}`]: () =>
        json({
          ...OPEN_YEAR,
          documents: [{ id: 1, number: 'Ж-0001', date: `${lastYear}-12-31` }],
          income: '0.00',
          expense: '0.00',
          profit: '0.00',
        }),
    });
    renderApp('/finance/periods', fetchMock);
    expect(await screen.findByText('200,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.finance.reports.yearClose.close }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.finance.reports.yearClose.close }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', `/api/v1/finance/year-close/${lastYear}`)).toHaveLength(1),
    );
    expect(
      calls(fetchMock, 'POST', `/api/v1/finance/year-close/${lastYear}`)[0]?.headers.get(
        'Idempotency-Key',
      ),
    ).toMatch(UUID);
  }, 15_000);
});
