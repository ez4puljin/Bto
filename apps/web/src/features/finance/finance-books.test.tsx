import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, UUID } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn } from '@/test/render-app';
import { ACCOUNTS, CASH_BOX, ENTRY, ENTRY_ROW, NUMBERING } from './finance-fixtures';

const routes = () => ({
  'GET /api/v1/gl-accounts': () => json(ACCOUNTS),
  'GET /api/v1/journal-entries': () => json({ data: [ENTRY_ROW], nextCursor: null }),
  'GET /api/v1/journal-entries/31': () => json(ENTRY),
  'GET /api/v1/money-accounts': () => json([CASH_BOX]),
  'GET /api/v1/finance-settings/numbering': () => json(NUMBERING),
  'GET /api/v1/branches': () =>
    json({ data: [{ id: 1, code: 'ORGIL', name: 'Оргил Бөөний төв', status: 'ACTIVE' }] }),
});

describe('finance books (ADR-0060 #7, #8)', () => {
  it('lists the journal and shows an entry with its lines', async () => {
    const user = userEvent.setup();
    renderApp('/finance/journal', signedIn(ACCOUNTANT_ME, routes()));
    const row = await screen.findByRole('row', { name: /Ж-20261016-0001/ });
    expect(within(row).getByText(mn.finance.sources.AUTO_INVOICE)).toBeInTheDocument();
    await user.click(within(row).getByText('Ж-20261016-0001'));
    const panel = within(
      await screen.findByRole('dialog', {
        name: mn.finance.journal.panelTitle.replace('{{number}}', 'Ж-20261016-0001'),
      }),
    );
    expect(panel.getByRole('link', { name: 'Н-20261016-0001' })).toHaveAttribute(
      'href',
      '/finance/invoices?invoice=11',
    );
    expect(panel.getByText('Борлуулалтын авлага')).toBeInTheDocument();
    expect(panel.getByText('136,363.64')).toBeInTheDocument();
    // An automatic entry is not reversed by hand.
    expect(panel.queryByRole('button', { name: mn.finance.actions.other })).toBeNull();
  });

  it('refuses an unbalanced manual entry and posts a balanced one', async () => {
    const user = userEvent.setup();
    const posted = {
      ...ENTRY,
      id: 40,
      number: 'Ж-20261016-0003',
      source: 'MANUAL' as const,
      sourceType: null,
      sourceId: null,
      sourceNumber: null,
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/journal-entries': () => json(posted, 201),
      'GET /api/v1/journal-entries/40': () => json(posted),
    });
    renderApp('/finance/journal?new=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.journal.dialog.title }),
    );
    await user.type(
      dialog.getByLabelText(mn.finance.journal.dialog.descriptionField),
      'Бусад орлого',
    );
    await user.selectOptions(dialog.getByLabelText(`${mn.finance.journal.dialog.account} 1`), '1');
    // A line on the cash account names its cash box; the only one is chosen already (ADR-0090).
    expect(dialog.getByLabelText(`${mn.finance.journal.dialog.moneyAccount} 1`)).toHaveValue('1');
    expect(dialog.queryByLabelText(`${mn.finance.journal.dialog.moneyAccount} 2`)).toBeNull();
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.debit} 1`), '5000');
    await user.selectOptions(dialog.getByLabelText(`${mn.finance.journal.dialog.account} 2`), '8');
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.credit} 2`), '4000');
    expect(dialog.getByText(/1,000/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.finance.journal.dialog.submit }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      mn.finance.journal.dialog.unbalanced,
    );
    expect(calls(fetchMock, 'POST', '/api/v1/journal-entries')).toHaveLength(0);
    await user.clear(dialog.getByLabelText(`${mn.finance.journal.dialog.credit} 2`));
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.credit} 2`), '5000');
    expect(dialog.getByText(mn.finance.journal.dialog.balanced)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.finance.journal.dialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/journal-entries')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/journal-entries')[0];
    expect(await bodyOf(request)).toEqual({
      entryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      description: 'Бусад орлого',
      lines: [
        { accountId: 1, debit: '5000', credit: '0', moneyAccountId: 1, description: null },
        { accountId: 8, debit: '0', credit: '5000', description: null },
      ],
    });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByRole('dialog', {
        name: mn.finance.journal.panelTitle.replace('{{number}}', 'Ж-20261016-0003'),
      }),
    ).toBeInTheDocument();
  });

  it('lets an admin move a role and shows the refusal when another account holds it', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(),
      'PUT /api/v1/gl-accounts/8/role': () =>
        problem('ACCOUNT_ROLE_TAKEN', 409, { role: 'AR', code: '120101' }),
    });
    renderApp('/finance/accounts', fetchMock);
    const row = await screen.findByRole('row', { name: /511020/ });
    // The name and the role read the same here.
    expect(within(row).getAllByText(mn.finance.roles.OTHER_INCOME)).toHaveLength(2);
    await user.click(within(row).getByRole('button', { name: `511020: ${mn.common.actions}` }));
    await user.click(await screen.findByRole('menuitem', { name: mn.finance.actions.setRole }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.accounts.roleDialog.title }),
    );
    await user.selectOptions(dialog.getByRole('combobox'), 'AR');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/8/role')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/gl-accounts/8/role')[0])).toEqual({
      role: 'AR',
    });
    expect(await dialog.findByRole('alert')).toHaveTextContent(mn.errors.ACCOUNT_ROLE_TAKEN);
  });

  it('saves the number formats and adds a bank account from the settings', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(),
      'PUT /api/v1/finance-settings/numbering': () =>
        json({ ...NUMBERING, updatedAt: '2026-10-16T02:00:00.000Z' }),
      'POST /api/v1/money-accounts': () =>
        json({ ...CASH_BOX, id: 2, code: 'KHAN', kind: 'BANK' }, 201),
    });
    renderApp('/finance/settings', fetchMock);
    const numbering = within(
      await screen.findByRole('region', { name: mn.finance.settings.numbering }),
    );
    expect(numbering.getByText('Н-{year}{month}{day}-')).toBeInTheDocument();
    await user.click(
      numbering.getByRole('button', {
        name: mn.common.editRecord.replace('{{name}}', mn.finance.settings.numbering),
      }),
    );
    const pattern = numbering.getByLabelText(mn.finance.settings.journalPattern);
    await user.clear(pattern);
    await user.paste('J{year}{month}{day}-');
    await user.click(numbering.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/finance-settings/numbering')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/finance-settings/numbering')[0])).toEqual({
      INVOICE: { pattern: 'Н-{year}{month}{day}-', digits: 4 },
      PAYMENT: { pattern: 'Т-{year}{month}{day}-', digits: 4 },
      CREDIT_NOTE: { pattern: 'К-{year}{month}{day}-', digits: 4 },
      JOURNAL: { pattern: 'J{year}{month}{day}-', digits: 4 },
    });
    await user.click(screen.getByRole('button', { name: mn.finance.actions.newMoneyAccount }));
    const dialog = within(
      await screen.findByRole('dialog', {
        name: mn.finance.settings.moneyAccountDialog.createTitle,
      }),
    );
    await user.type(dialog.getByLabelText(mn.finance.settings.moneyAccountDialog.code), 'KHAN');
    await user.type(
      dialog.getByLabelText(mn.finance.settings.moneyAccountDialog.name),
      'Хаан банк',
    );
    const showToCustomers = mn.finance.settings.moneyAccountDialog.showToCustomers;
    // A cash box is never listed in the customer app (ADR-0079 #7).
    expect(dialog.queryByRole('switch', { name: showToCustomers })).toBeNull();
    await user.selectOptions(
      dialog.getByLabelText(mn.finance.settings.moneyAccountDialog.kind),
      'BANK',
    );
    await user.type(
      dialog.getByLabelText(mn.finance.settings.moneyAccountDialog.bankAccountNo),
      '5000000000',
    );
    await user.selectOptions(
      dialog.getByLabelText(mn.finance.settings.moneyAccountDialog.glAccount),
      '1',
    );
    const shown = dialog.getByRole('switch', { name: showToCustomers });
    expect(shown).not.toBeChecked();
    expect(shown).toHaveAccessibleDescription(
      mn.finance.settings.moneyAccountDialog.showToCustomersHint,
    );
    await user.click(shown);
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/money-accounts')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/money-accounts')[0])).toEqual({
      code: 'KHAN',
      name: 'Хаан банк',
      kind: 'BANK',
      branchId: null,
      bankName: null,
      bankAccountNo: '5000000000',
      glAccountId: 1,
      showToCustomers: true,
    });
  });

  it('marks a bank account shown to customers and turns it off', async () => {
    const user = userEvent.setup();
    const KHAN = {
      ...CASH_BOX,
      id: 2,
      code: 'KHAN',
      name: 'Хаан банк',
      kind: 'BANK' as const,
      bankName: 'Хаан банк',
      bankAccountNo: '5000000000',
      showToCustomers: true,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(),
      'GET /api/v1/money-accounts': () => json([CASH_BOX, KHAN]),
      'PUT /api/v1/money-accounts/2': () => json({ ...KHAN, showToCustomers: false }),
    });
    renderApp('/finance/settings', fetchMock);
    const row = within(await screen.findByRole('row', { name: /KHAN/ }));
    expect(row.getByText(mn.finance.settings.shownToCustomers)).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /CASH-1/ })).queryByText(
        mn.finance.settings.shownToCustomers,
      ),
    ).toBeNull();
    await user.click(row.getByRole('button', { name: `KHAN: ${mn.common.actions}` }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.edit }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.settings.moneyAccountDialog.editTitle }),
    );
    const shown = dialog.getByRole('switch', {
      name: mn.finance.settings.moneyAccountDialog.showToCustomers,
    });
    expect(shown).toBeChecked();
    await user.click(shown);
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/money-accounts/2')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/money-accounts/2')[0])).toMatchObject({
      code: 'KHAN',
      status: 'ACTIVE',
      showToCustomers: false,
    });
  });
});
