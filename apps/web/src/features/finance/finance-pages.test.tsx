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
  INVOICE_ALLOCATED,
  INVOICE_ROW,
  LEDGER,
  OPEN_ITEMS,
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
  'GET /api/v1/customer-balances/9/open-items': () => json({ data: OPEN_ITEMS }),
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

  it('pairs a payment remainder with invoices oldest due first on the customer ledger', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/allocations': () =>
        json(
          {
            id: 601,
            number: 'Х-20261020-0001',
            date: '2026-10-20',
            customerId: 9,
            amount: '80000.00',
            pairs: [],
          },
          201,
        ),
    });
    renderApp('/finance/customers/9', fetchMock);
    await user.click(await screen.findByRole('button', { name: mn.finance.allocations.action }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.allocations.title }),
    );
    // Two credits: nothing is chosen for the accountant, and nothing is sent without one.
    await dialog.findByRole('radio', { name: 'Т-20261020-0002' });
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.submit }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(mn.finance.allocations.chooseCredit);
    await user.click(dialog.getByRole('radio', { name: 'Т-20261020-0002' }));
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.oldestFirst }));
    // The older invoice (due 2026-10-31) is settled whole first, the rest goes on the next one.
    const amount = (number: string) =>
      dialog.getByLabelText(`${mn.finance.allocations.amount}: ${number}`);
    expect(amount('Н-20261001-0003')).toHaveValue('30000');
    expect(amount('Н-20261016-0001')).toHaveValue('50000');
    expect(calls(fetchMock, 'POST', '/api/v1/finance/allocations')).toHaveLength(0);
    // More than the invoice still owes is refused before sending.
    await user.clear(amount('Н-20261001-0003'));
    await user.click(amount('Н-20261001-0003'));
    await user.paste('35000');
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      mn.finance.allocations.overDebit.replace('{{number}}', 'Н-20261001-0003'),
    );
    await user.clear(amount('Н-20261001-0003'));
    await user.click(amount('Н-20261001-0003'));
    await user.paste('30000');
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/finance/allocations')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/finance/allocations')[0];
    expect(await bodyOf(request)).toEqual({
      customerId: 9,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      description: null,
      pairs: [
        { debitItemId: 502, creditItemId: 503, amount: '30000' },
        { debitItemId: 501, creditItemId: 503, amount: '50000' },
      ],
    });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByText(mn.finance.allocations.done.replace('{{number}}', 'Х-20261020-0001')),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }, 15_000);

  it('opens the allocation dialog from the address', async () => {
    renderApp('/finance/customers/9?allocate=1', signedIn(ACCOUNTANT_ME, routes()));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.allocations.title }),
    );
    expect(await dialog.findByRole('row', { name: /К-20261018-0001/ })).toBeInTheDocument();
  });

  it('reverses an allocation from the invoice panel with a reason', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'GET /api/v1/invoices/11': () => json(INVOICE_ALLOCATED),
      'POST /api/v1/finance/allocations/601/reverse': () =>
        json({ id: 602, number: 'Х-20261020-0002' }),
    });
    renderApp('/finance/invoices?invoice=11', fetchMock);
    const panel = within(
      await screen.findByRole('dialog', {
        name: mn.finance.invoices.panelTitle.replace('{{number}}', 'Н-20261016-0001'),
      }),
    );
    const row = within(await panel.findByRole('row', { name: /Х-20261020-0001/ }));
    expect(row.getByText(mn.finance.arKinds.ALLOCATION)).toBeInTheDocument();
    // A payment's own allocation is voided with its voucher, not from here.
    expect(
      panel.queryByRole('button', { name: `Т-20261016-0001: ${mn.common.actions}` }),
    ).toBeNull();
    await user.click(row.getByRole('button', { name: `Х-20261020-0001: ${mn.common.actions}` }));
    await user.click(await screen.findByRole('menuitem', { name: mn.finance.allocations.reverse }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.allocations.reverseTitle }),
    );
    await user.type(dialog.getByLabelText(mn.finance.fields.reason), 'Буруу тулгасан');
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.reverse }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/finance/allocations/601/reverse')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/finance/allocations/601/reverse')[0];
    expect(await bodyOf(request)).toEqual({ reason: 'Буруу тулгасан' });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByText(mn.finance.allocations.reversed)).toBeInTheDocument();
  }, 15_000);
});
