import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, UUID } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn } from '@/test/render-app';
import {
  BALANCE,
  COUNTER_ACCOUNT,
  INVOICE,
  INVOICE_ROW,
  LEDGER,
  VAT_WAIVER,
} from './finance-fixtures';

const text = mn.finance.vatWaiver;
const WAIVED_ROW = {
  ...INVOICE_ROW,
  id: 12,
  number: 'Н-20261017-0002',
  invoiceDate: '2026-10-17',
  total: '50000.00',
  vatTotal: '4545.45',
  openAmount: '49000.00',
  vatWaiver: { ...VAT_WAIVER, id: 4, invoiceId: 12, baseAmount: '50000.00', amount: '1000.00' },
  vatWaiverPreview: {
    pct: '2.00',
    baseAmount: '50000.00',
    amount: '1000.00',
    blockedBy: 'VAT_WAIVED' as const,
  },
  receipt: null,
};
const TOTALS = {
  customerId: 9,
  from: null,
  to: null,
  takesVat: {
    count: 1,
    total: '150000.00',
    vatTotal: '13636.36',
    openAmount: '100000.00',
    waiverAmount: '0.00',
  },
  waived: {
    count: 1,
    total: '50000.00',
    vatTotal: '4545.45',
    openAmount: '49000.00',
    waiverAmount: '1000.00',
  },
};
const ACCOUNT = {
  id: 77,
  code: '520299',
  name: 'НӨАТ-ын хөнгөлөлт',
  kind: 'INCOME',
  role: null,
  status: 'ACTIVE',
  groupId: null,
  journal: 'GENERAL',
  currency: 'MNT',
  debit: '0.00',
  credit: '0.00',
  balance: '0.00',
};

const routes = (
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/customer-balances/9': () => json(BALANCE),
  'GET /api/v1/customer-balances/9/ledger': () =>
    json({ data: LEDGER, nextCursor: null, opening: '0.00' }),
  'GET /api/v1/customer-balances/9/counter-account': () => json(COUNTER_ACCOUNT),
  'GET /api/v1/customer-balances/9/vat-totals': () => json(TOTALS),
  'GET /api/v1/finance-settings/vat-waiver': () =>
    json({ pct: '2.00', description: 'Борлуулалтын хөнгөлөлт', updatedAt: null }),
  'GET /api/v1/gl-accounts': () => json([ACCOUNT]),
  'GET /api/v1/invoices': (request: Request) => {
    const waived = new URL(request.url).searchParams.get('vatWaived');
    const data =
      waived === 'true'
        ? [WAIVED_ROW]
        : waived === 'false'
          ? [INVOICE_ROW]
          : [WAIVED_ROW, INVOICE_ROW];
    return json({ data, nextCursor: null, total: data.length });
  },
  ...extra,
});

describe('a customer’s sales and «НӨАТ хасуулах» (ADR-0240)', () => {
  it('keeps the ledger as the default view and shows the counter account under the balance', async () => {
    renderApp('/finance/customers/9', signedIn(ACCOUNTANT_ME, routes()));
    const tabs = within(await screen.findByRole('tablist', { name: text.tabs.label }));
    expect(tabs.getByRole('tab', { name: text.tabs.ledger })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(tabs.getByRole('tab', { name: text.tabs.sales })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('region', { name: mn.finance.balances.ledgerTitle })).toBeVisible();
    const account = within(await screen.findByRole('region', { name: text.counterAccount.label }));
    expect(await account.findByText('520201 Борлуулалтын хөнгөлөлт (анхдагч)')).toBeInTheDocument();
    // The accountant reads it; setting it is the settings right's.
    expect(account.queryByRole('button', { name: text.counterAccount.changeLabel })).toBeNull();
  });

  it('lists the sales with the VAT badge, filters them and totals the filter in view', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    renderApp('/finance/customers/9?tab=sales', fetchMock);
    const sales = within(await screen.findByRole('region', { name: text.salesLabel }));
    const waivedRow = within(
      (await sales.findByText('Н-20261017-0002')).closest('tr') as HTMLElement,
    );
    expect(waivedRow.getByText(text.waived)).toBeInTheDocument();
    expect(waivedRow.getByText('1,000₮')).toBeInTheDocument();
    const takingRow = within(sales.getByText(INVOICE.number).closest('tr') as HTMLElement);
    expect(takingRow.getByText(text.takes)).toBeInTheDocument();
    // Reading finance is not the right to waive: no row action.
    expect(
      sales.queryByRole('button', {
        name: text.rowAction.replace('{{number}}', INVOICE.number),
      }),
    ).toBeNull();
    // Both sides added up while nothing is filtered.
    const totals = within(screen.getByRole('region', { name: text.totals.label }));
    await waitFor(() => expect(totals.getByText('200,000₮')).toBeInTheDocument());
    expect(totals.getByText('149,000₮')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('tablist', { name: text.filter.label })).getByRole('tab', {
        name: text.filter.waived,
      }),
    );
    await waitFor(() => expect(sales.queryByText(INVOICE.number)).toBeNull());
    expect(sales.getByText('Н-20261017-0002')).toBeInTheDocument();
    const request = calls(fetchMock, 'GET', '/api/v1/invoices').at(-1);
    const query = new URL(request?.url ?? 'http://x').searchParams;
    expect(query.get('vatWaived')).toBe('true');
    expect(query.get('customerId')).toBe('9');
    expect(query.get('status')).toBe('ISSUED');
    await waitFor(() => expect(totals.getByText('50,000₮')).toBeInTheDocument());
    expect(totals.getByText('49,000₮')).toBeInTheDocument();
  });

  it('waives a sale after saying what it will write, and takes a waiver back with a reason', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'POST /api/v1/invoices/11/vat-waiver': () => json({ ...INVOICE, vatWaiver: VAT_WAIVER }),
        'POST /api/v1/invoices/12/vat-waiver/reverse': () => json({ ...INVOICE, id: 12 }),
      }),
    );
    renderApp('/finance/customers/9?tab=sales', fetchMock);
    await user.click(
      await screen.findByRole('button', {
        name: text.rowAction.replace('{{number}}', INVOICE.number),
      }),
    );
    const dialog = within(await screen.findByRole('dialog', { name: text.dialog.title }));
    expect(dialog.getByText(text.dialog.sentence)).toBeInTheDocument();
    expect(dialog.getByText(`${INVOICE.number} · ${INVOICE.invoiceDate}`)).toBeInTheDocument();
    expect(dialog.getByText('150,000₮')).toBeInTheDocument();
    expect(dialog.getByText('2.00 %')).toBeInTheDocument();
    expect(dialog.getByText('3,000₮')).toBeInTheDocument();
    expect(await dialog.findByText('520201 Борлуулалтын хөнгөлөлт (анхдагч)')).toBeInTheDocument();
    expect(await dialog.findByText('Борлуулалтын хөнгөлөлт')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: text.dialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/invoices/11/vat-waiver')).toHaveLength(1),
    );
    expect(
      calls(fetchMock, 'POST', '/api/v1/invoices/11/vat-waiver')[0]?.headers.get('Idempotency-Key'),
    ).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent(text.done);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(
      screen.getByRole('button', {
        name: text.rowReverse.replace('{{number}}', 'Н-20261017-0002'),
      }),
    );
    const undo = within(await screen.findByRole('dialog', { name: text.reverseDialog.title }));
    await user.type(undo.getByLabelText(text.reverseDialog.reason), 'Баримт авна');
    await user.click(undo.getByRole('button', { name: text.reverseDialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/invoices/12/vat-waiver/reverse')).toHaveLength(1),
    );
    expect(
      await bodyOf(calls(fetchMock, 'POST', '/api/v1/invoices/12/vat-waiver/reverse')[0]),
    ).toEqual({ reason: 'Баримт авна' });
    expect(await screen.findByRole('status')).toHaveTextContent(text.reversed);
  });

  it('says a refusal in plain words and keeps the button off for a sale that cannot be waived', async () => {
    const user = userEvent.setup();
    const blocked = {
      ...INVOICE_ROW,
      receipt: { id: 5, receiptType: 'B2B' as const, status: 'CONFIRMED' as const },
      vatWaiverPreview: { ...INVOICE_ROW.vatWaiverPreview, blockedBy: 'B2B_RECEIPT' as const },
    };
    let refuse = false;
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'GET /api/v1/invoices': () =>
          json({ data: [refuse ? INVOICE_ROW : blocked], nextCursor: null, total: 1 }),
        'POST /api/v1/invoices/11/vat-waiver': () =>
          problem('INVOICE_STATE_INVALID', 409, { number: INVOICE.number, status: 'VAT_WAIVED' }),
      }),
    );
    renderApp('/finance/customers/9?tab=sales', fetchMock);
    const open = async () => {
      await user.click(
        await screen.findByRole('button', {
          name: text.rowAction.replace('{{number}}', INVOICE.number),
        }),
      );
      return within(await screen.findByRole('dialog', { name: text.dialog.title }));
    };
    let dialog = await open();
    expect(dialog.getByRole('alert')).toHaveTextContent(text.errors.B2B_RECEIPT);
    expect(dialog.getByRole('button', { name: text.dialog.submit })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Someone else waived it meanwhile: the server's refusal reads as the owner wrote it.
    refuse = true;
    await user.click(
      within(screen.getByRole('tablist', { name: text.filter.label })).getByRole('tab', {
        name: text.filter.takes,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(mn.finance.ebarimtReceipts.types.B2B, { exact: false })).toBeNull(),
    );
    dialog = await open();
    await user.click(dialog.getByRole('button', { name: text.dialog.submit }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(text.errors.VAT_WAIVED);
  });

  it('lets the settings right choose the customer’s counter account and go back to the default', async () => {
    const user = userEvent.setup();
    const own = {
      customerId: 9,
      own: true,
      account: { id: 77, code: '520299', name: 'НӨАТ-ын хөнгөлөлт' },
      updatedAt: null,
    };
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'PUT /api/v1/customer-balances/9/counter-account': async (request: Request) =>
          json(
            ((await request.clone().json()) as { accountId: number | null }).accountId
              ? own
              : COUNTER_ACCOUNT,
          ),
      }),
    );
    renderApp('/finance/customers/9', fetchMock);
    const row = within(await screen.findByRole('region', { name: text.counterAccount.label }));
    await user.click(await row.findByRole('button', { name: text.counterAccount.changeLabel }));
    const dialog = within(
      await screen.findByRole('dialog', { name: text.counterAccount.dialogTitle }),
    );
    expect(dialog.queryByRole('button', { name: text.counterAccount.useDefault })).toBeNull();
    const field = dialog.getByLabelText(text.counterAccount.label);
    await user.click(field);
    await user.type(field, '520299');
    await user.keyboard('{Enter}');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/customer-balances/9/counter-account')).toHaveLength(
        1,
      ),
    );
    expect(
      await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer-balances/9/counter-account')[0]),
    ).toEqual({ accountId: 77 });
    expect(await row.findByText('520299 НӨАТ-ын хөнгөлөлт')).toBeInTheDocument();

    await user.click(row.getByRole('button', { name: text.counterAccount.changeLabel }));
    const again = within(
      await screen.findByRole('dialog', { name: text.counterAccount.dialogTitle }),
    );
    await user.click(again.getByRole('button', { name: text.counterAccount.useDefault }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/customer-balances/9/counter-account')).toHaveLength(
        2,
      ),
    );
    expect(
      await bodyOf(calls(fetchMock, 'PUT', '/api/v1/customer-balances/9/counter-account')[1]),
    ).toEqual({ accountId: null });
    expect(await row.findByText('520201 Борлуулалтын хөнгөлөлт (анхдагч)')).toBeInTheDocument();
  });
  it('keeps the percent and the words on «Санхүү → Тохиргоо»', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'GET /api/v1/money-accounts': () => json([]),
        'PUT /api/v1/finance-settings/vat-waiver': async (request: Request) =>
          json({ ...((await request.clone().json()) as object), pct: '2.50', updatedAt: null }),
      }),
    );
    renderApp('/finance/settings', fetchMock);
    const card = within(await screen.findByRole('region', { name: text.settings.title }));
    expect(await card.findByText('2.00 %')).toBeInTheDocument();
    expect(card.getByText('Борлуулалтын хөнгөлөлт')).toBeInTheDocument();
    await user.click(
      card.getByRole('button', { name: `${mn.common.edit}: ${text.settings.title}` }),
    );
    const pct = card.getByLabelText(text.settings.pct);
    // Nothing above 100 or with three decimals leaves the form.
    await user.clear(pct);
    await user.type(pct, '120');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    expect(await card.findByText(text.settings.pctInvalid)).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/finance-settings/vat-waiver')).toHaveLength(0);
    await user.clear(pct);
    await user.type(pct, '2,5');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/finance-settings/vat-waiver')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/finance-settings/vat-waiver')[0])).toEqual(
      { pct: '2.5', description: 'Борлуулалтын хөнгөлөлт' },
    );
    expect(await screen.findByRole('status')).toHaveTextContent(text.settings.saved);
  });
});
