import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn } from '@/test/render-app';
import type { IssueExpenseAccount, OpeningCheck } from './api';
import { ACCOUNTS } from './finance-fixtures';

const CHECK: OpeningCheck = {
  date: '2026-12-31',
  opening: { number: 'Ж-20261231-0001', date: '2026-12-31' },
  data: [
    {
      accountCode: '120101',
      accountName: 'Борлуулалтын авлага',
      partyKind: 'CUSTOMER',
      partyCode: '7701',
      partyName: 'Номин дэлгүүр',
      balance: '1000.00',
    },
    {
      accountCode: '120101',
      accountName: 'Борлуулалтын авлага',
      partyKind: 'CUSTOMER',
      partyCode: '7702',
      partyName: 'Оргил дэлгүүр',
      balance: '500.00',
    },
    {
      accountCode: '511020',
      accountName: 'Бусад орлого',
      partyKind: null,
      partyCode: null,
      partyName: null,
      balance: '-1500.00',
    },
  ],
  debit: '1500.00',
  credit: '1500.00',
};

const ISSUE_ACCOUNTS: IssueExpenseAccount[] = [
  {
    typeId: 1,
    name: 'Дотоод хэрэгцээ',
    active: true,
    seeded: true,
    own: true,
    accountId: 1,
    accountCode: '100101',
    accountName: 'Касс',
  },
  {
    typeId: 7,
    name: 'Дээж',
    active: true,
    seeded: false,
    own: false,
    accountId: 3,
    accountCode: '120101',
    accountName: 'Борлуулалтын авлага',
  },
];

describe('the questionnaire’s suggestions (ADR-0106)', () => {
  it('shows the opening’s balances per account and party with the subtotals', async () => {
    const user = userEvent.setup();
    renderApp(
      '/',
      signedIn(ACCOUNTANT_ME, {
        'GET /api/v1/finance/reports/opening-check': () => json(CHECK),
      }),
    );
    const sidebar = within(await findSidebar());
    await user.click(sidebar.getByRole('link', { name: mn.nav.openingCheck }));
    const nomin = await screen.findByRole('row', { name: /7701/ });
    expect(within(nomin).getByText('Номин дэлгүүр')).toBeInTheDocument();
    expect(within(nomin).getByText('1,000')).toBeInTheDocument();
    const subtotal = screen.getByRole('row', {
      name: new RegExp(mn.finance.reports.openingCheck.subtotal.replace('{{account}}', '120101')),
    });
    expect(within(subtotal).getByText('1,500')).toBeInTheDocument();
    // An account without parties shows its balance on its own row.
    const income = screen.getByRole('row', { name: /511020/ });
    expect(within(income).getByText('1,500')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: mn.finance.reports.print })).toHaveAttribute(
      'href',
      '/finance/opening-check/print?date=2026-12-31&format=a4',
    );
  });

  it('gives an admin-added expense type its own account from «Данс»', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/gl-accounts': () => json(ACCOUNTS),
      'GET /api/v1/finance/issue-expense-accounts': () => json(ISSUE_ACCOUNTS),
      'PUT /api/v1/finance/issue-expense-accounts/7': () =>
        json(
          ISSUE_ACCOUNTS.map((row) =>
            row.typeId === 7
              ? { ...row, own: true, accountId: 1, accountCode: '100101', accountName: 'Касс' }
              : row,
          ),
        ),
    });
    renderApp('/finance/accounts', fetchMock);
    await user.click(
      await screen.findByRole('button', { name: mn.finance.accounts.issueAccounts.open }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.issueAccounts.title }),
    );
    // A seeded type keeps F4's account; only the admin's type has a picker.
    expect(await dialog.findByText(mn.finance.accounts.issueAccounts.seeded)).toBeInTheDocument();
    const picker = dialog.getByRole('combobox');
    expect(picker).toHaveValue('');
    await user.selectOptions(picker, '1');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/finance/issue-expense-accounts/7')).toHaveLength(1),
    );
    expect(
      await bodyOf(calls(fetchMock, 'PUT', '/api/v1/finance/issue-expense-accounts/7')[0]),
    ).toEqual({ accountId: 1 });
  });
});
