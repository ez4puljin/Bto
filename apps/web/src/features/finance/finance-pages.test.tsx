import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, list, UUID, WAREHOUSE_ME } from '@/test/inventory-fixtures';
import { findSidebar, json, problem, renderApp, signedIn } from '@/test/render-app';
import {
  BALANCE,
  CASH_BOX,
  INVOICE,
  INVOICE_ROW,
  LEDGER,
  PAYMENT,
  PAYMENT_ROW,
} from './finance-fixtures';

const CUSTOMER_ROW = {
  id: 9,
  code: '1001',
  kind: 'COMPANY',
  name: 'Номин дэлгүүр',
  regNo: null,
  tin: null,
  phone: null,
  status: 'ACTIVE',
  creditHold: false,
  tinPending: false,
  address: null,
  hasGps: false,
  contact: null,
};

const routes = () => ({
  'GET /api/v1/invoices': () => json({ data: [INVOICE_ROW], nextCursor: null, total: 1 }),
  'GET /api/v1/invoices/11': () => json(INVOICE),
  'GET /api/v1/payments': () => json({ data: [PAYMENT_ROW], nextCursor: null, total: 1 }),
  'GET /api/v1/payments/21': () => json(PAYMENT),
  'GET /api/v1/money-accounts': () => json([CASH_BOX]),
  'GET /api/v1/money-accounts/1/book': () =>
    json({
      data: [{ ...PAYMENT_ROW, balanceAfter: '50000.00' }],
      nextCursor: null,
      opening: '0.00',
    }),
  'GET /api/v1/customer-balances': () => list([BALANCE]),
  'GET /api/v1/customer-balances/9': () => json(BALANCE),
  'GET /api/v1/customer-balances/9/ledger': () =>
    json({ data: LEDGER, nextCursor: null, opening: '0.00' }),
  'GET /api/v1/customers': () => list([CUSTOMER_ROW]),
  'GET /api/v1/users': () => list([]),
  'GET /api/v1/gl-accounts': () => json([]),
  'GET /api/v1/finance/attention': () =>
    json({ overdueAmount: '0.00', overdueCustomers: 0, openAmount: '100000.00', openInvoices: 1 }),
});

describe('finance pages (ADR-0060 #11)', () => {
  it('shows the «Санхүү» menu to the accountant and hides it from the warehouse', async () => {
    renderApp('/', signedIn(ACCOUNTANT_ME, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('button', { name: mn.nav.groups.finance })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: mn.nav.invoices })).toHaveAttribute(
      'href',
      '/finance/invoices',
    );
    // The settings are the admin's.
    expect(sidebar.queryByRole('link', { name: mn.nav.financeSettings })).toBeNull();
  });

  it('keeps the menu from a warehouse worker', async () => {
    renderApp('/', signedIn(WAREHOUSE_ME, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.queryByRole('button', { name: mn.nav.groups.finance })).toBeNull();
  });

  it('lists invoices, opens one in the panel and voids it with a reason', async () => {
    const user = userEvent.setup();
    const voided = {
      ...INVOICE,
      status: 'VOID' as const,
      openAmount: '0.00',
      voidReason: 'Давхар',
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/invoices/11/void': () => json(voided),
    });
    renderApp('/finance/invoices', fetchMock);
    const row = await screen.findByRole('row', { name: /Н-20261016-0001/ });
    expect(within(row).getByText('Номин дэлгүүр')).toBeInTheDocument();
    // Lists show money with ₮ (ADR-0066).
    expect(within(row).getByText('150,000₮')).toBeInTheDocument();
    expect(within(row).getByText(mn.finance.settlements.PARTIAL)).toBeInTheDocument();
    await user.click(within(row).getByText('Н-20261016-0001'));
    const panel = within(
      await screen.findByRole('dialog', {
        name: mn.finance.invoices.panelTitle.replace('{{number}}', 'Н-20261016-0001'),
      }),
    );
    expect(panel.getByRole('link', { name: '20261016_0005' })).toHaveAttribute(
      'href',
      '/sales/boards?order=5',
    );
    expect(panel.getByText('Кока кола')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: 'Т-20261016-0001' })).toHaveAttribute(
      'href',
      '/finance/payments?payment=21',
    );
    expect(panel.getByRole('link', { name: mn.finance.actions.print })).toHaveAttribute(
      'href',
      '/finance/invoices/11/print?format=a4',
    );
    await user.click(panel.getByRole('button', { name: mn.finance.actions.other }));
    await user.click(await screen.findByRole('menuitem', { name: mn.finance.actions.void }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.invoices.voidTitle }),
    );
    await user.type(dialog.getByLabelText(mn.finance.fields.reason), 'Давхар');
    await user.click(dialog.getByRole('button', { name: mn.finance.actions.void }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/invoices/11/void')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/invoices/11/void')[0];
    expect(await bodyOf(request)).toEqual({ reason: 'Давхар' });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByText(mn.finance.invoices.voided)).toBeInTheDocument();
  });

  it('records a customer payment allocated oldest due first and opens the voucher', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/payments': () => json(PAYMENT, 201),
    });
    renderApp('/finance/payments?new=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.payments.dialog.title }),
    );
    await user.type(dialog.getByLabelText(mn.finance.payments.dialog.customer), 'Номин');
    await user.click(await dialog.findByRole('button', { name: /Номин дэлгүүр/ }));
    await user.type(dialog.getByLabelText(mn.finance.payments.dialog.amount), '50000');
    // The open invoice is settled first; the preview shows the whole 50,000₮ on it.
    const invoiceRow = await dialog.findByRole('row', { name: /Н-20261016-0001/ });
    expect(within(invoiceRow).getAllByText('50,000₮').length).toBeGreaterThan(0);
    expect(
      dialog.getByText(mn.finance.payments.dialog.allocated.replace('{{amount}}', '50,000')),
    ).toBeInTheDocument();
    await user.type(
      dialog.getByLabelText(mn.finance.payments.dialog.description),
      'Жолооч тушаасан',
    );
    await user.click(dialog.getByRole('button', { name: mn.finance.payments.dialog.submit }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/payments')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/payments')[0])).toEqual({
      kind: 'CUSTOMER_PAYMENT',
      moneyAccountId: 1,
      customerId: 9,
      glAccountId: null,
      amount: '50000',
      paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      description: 'Жолооч тушаасан',
      reference: null,
      counterpartyName: null,
      collectedBy: null,
      allocations: null,
    });
    // The voucher opens in the panel, named after its number.
    const panel = within(
      await screen.findByRole('dialog', {
        name: mn.finance.payments.panelTitle.replace('{{number}}', 'Т-20261016-0001'),
      }),
    );
    expect(panel.getByRole('link', { name: 'Н-20261016-0001' })).toHaveAttribute(
      'href',
      '/finance/invoices?invoice=11',
    );
    expect(panel.getByText(/Жолооч Дорж/)).toBeInTheDocument();
  });

  it('shows the cash book of the chosen account with the balance after each voucher', async () => {
    renderApp('/finance/cash', signedIn(ACCOUNTANT_ME, routes()));
    const accounts = within(
      await screen.findByRole('navigation', { name: mn.finance.cash.accounts }),
    );
    expect(
      await accounts.findByRole('link', { name: /Касс \(Оргил Бөөний төв\)/ }),
    ).toHaveAttribute('aria-current', 'page');
    const row = await screen.findByRole('row', { name: /Т-20261016-0001/ });
    expect(within(row).getAllByText('50,000')).toHaveLength(2);
    expect(within(row).getByRole('link', { name: 'Т-20261016-0001' })).toHaveAttribute(
      'href',
      '/finance/payments?payment=21',
    );
  });

  it('lists who owes what and opens a customer ledger with its balance card', async () => {
    const user = userEvent.setup();
    renderApp('/finance/customers', signedIn(ACCOUNTANT_ME, routes()));
    const row = await screen.findByRole('row', { name: /Номин дэлгүүр/ });
    // The balance (₮) and its not-due aging bucket (plain, under «Насжилт (₮)») read the same.
    expect(within(row).getByText('100,000₮')).toBeInTheDocument();
    expect(within(row).getByText('100,000')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: mn.finance.balances.agingGroup }),
    ).toBeInTheDocument();
    await user.click(within(row).getByText('Номин дэлгүүр'));
    expect(await screen.findByRole('heading', { name: 'Номин дэлгүүр' })).toBeInTheDocument();
    const card = within(await screen.findByRole('region', { name: mn.finance.balances.card }));
    expect(card.getAllByText('100,000₮').length).toBeGreaterThan(0);
    expect(card.getByText('5,000,000₮')).toBeInTheDocument();
    const ledger = await screen.findByRole('row', { name: /Н-20261016-0001/ });
    // The debit and the balance after it read the same on the first entry.
    expect(within(ledger).getAllByText('150,000')).toHaveLength(2);
    expect(within(ledger).getByRole('link', { name: 'Н-20261016-0001' })).toHaveAttribute(
      'href',
      '/finance/invoices?invoice=11',
    );
  });

  it('shows the home tile of overdue receivables to the accountant', async () => {
    renderApp(
      '/',
      signedIn(ACCOUNTANT_ME, {
        ...routes(),
        'GET /api/v1/inventory/attention': () => problem('FORBIDDEN', 403),
        'GET /api/v1/finance/attention': () =>
          json({
            overdueAmount: '250000.00',
            overdueCustomers: 3,
            openAmount: '1.00',
            openInvoices: 1,
          }),
      }),
    );
    expect(
      await screen.findByRole('link', { name: `${mn.home.attention.overdueReceivables}: 3` }),
    ).toHaveAttribute('href', '/finance/customers?overdue=1');
  });
});
