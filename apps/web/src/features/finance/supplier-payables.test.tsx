import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, list, UUID } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';
import type { PayableEntry, PayableOpenItem, SupplierBalance } from './api';
import { ACCOUNTS, CASH_BOX } from './finance-fixtures';

const STAMP = '2026-10-20T03:00:00.000Z';
const SUPPLIER: SupplierBalance = {
  supplierId: 5,
  code: '010',
  name: 'МСМ ХХК',
  status: 'ACTIVE',
  balance: '26400.00',
  oldestBillDate: '2026-10-18',
  updatedAt: STAMP,
};
const LEDGER: PayableEntry[] = [
  {
    id: 92,
    entryDate: '2026-10-20',
    kind: 'MANUAL',
    docType: 'JOURNAL',
    docId: 44,
    docNumber: 'Ж-20261020-0002',
    debit: '10000.00',
    credit: '0.00',
    balanceAfter: '26400.00',
    createdAt: STAMP,
  },
  {
    id: 91,
    entryDate: '2026-10-18',
    kind: 'BILL',
    docType: 'RECEIPT',
    docId: 7,
    docNumber: 'GR-20261018-0001',
    debit: '0.00',
    credit: '36400.00',
    balanceAfter: '36400.00',
    createdAt: STAMP,
  },
];
const item = (
  id: number,
  side: 'DEBIT' | 'CREDIT',
  kind: PayableOpenItem['kind'],
  number: string,
  date: string,
  open: string,
): PayableOpenItem => ({
  id,
  side,
  kind,
  documentType: kind === 'MANUAL' ? 'JOURNAL' : 'RECEIPT',
  documentId: id,
  number,
  itemDate: date,
  dueDate: date,
  amount: open,
  openAmount: open,
});
const OPEN_ITEMS: PayableOpenItem[] = [
  item(701, 'CREDIT', 'BILL', 'GR-20261018-0001', '2026-10-18', '6400.00'),
  item(702, 'CREDIT', 'BILL', 'GR-20261015-0004', '2026-10-15', '30000.00'),
  item(703, 'DEBIT', 'MANUAL', 'Ж-20261020-0002', '2026-10-20', '10000.00'),
];

const routes = () => ({
  'GET /api/v1/supplier-balances': () => list([SUPPLIER]),
  'GET /api/v1/supplier-balances/5': () => json(SUPPLIER),
  'GET /api/v1/supplier-balances/5/ledger': () =>
    json({ data: LEDGER, nextCursor: null, opening: '0.00' }),
  'GET /api/v1/supplier-balances/5/open-items': () => json({ data: OPEN_ITEMS }),
  'GET /api/v1/gl-accounts': () =>
    json([
      ...ACCOUNTS,
      {
        ...ACCOUNTS[0],
        id: 12,
        code: '310101',
        name: 'Дансны өглөг',
        kind: 'LIABILITY',
        role: 'AP',
      },
    ]),
  'GET /api/v1/money-accounts': () => json([CASH_BOX]),
  'GET /api/v1/journal-entries': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/suppliers': () =>
    list([
      {
        id: 5,
        code: '010',
        name: 'МСМ ХХК',
        tin: null,
        phone: null,
        vatPayer: true,
        status: 'ACTIVE',
      },
    ]),
});

describe('supplier payables (F3, ADR-0091)', () => {
  it('lists what is owed to suppliers and opens a supplier’s ledger', async () => {
    const user = userEvent.setup();
    renderApp('/', signedIn(ACCOUNTANT_ME, routes()));
    const sidebar = within(await findSidebar());
    await user.click(sidebar.getByRole('link', { name: mn.nav.supplierBalances }));
    const row = await screen.findByRole('row', { name: /МСМ ХХК/ });
    expect(within(row).getByText('26,400₮')).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: 'МСМ ХХК' }));
    expect(await screen.findByRole('heading', { name: 'МСМ ХХК' })).toBeInTheDocument();
    const bill = await screen.findByRole('row', { name: /GR-20261018-0001/ });
    expect(within(bill).getByText(mn.finance.apKinds.BILL)).toBeInTheDocument();
    expect(within(bill).getByRole('link', { name: 'GR-20261018-0001' })).toHaveAttribute(
      'href',
      '/inventory/receipts/7',
    );
    expect(screen.getByText(mn.finance.payables.howToPay)).toBeInTheDocument();
  });

  it('pairs a payment with the supplier’s bills oldest first', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/allocations': () =>
        json(
          {
            id: 611,
            number: 'Х-20261020-0002',
            date: '2026-10-20',
            customerId: null,
            supplierId: 5,
            amount: '10000.00',
            pairs: [],
          },
          201,
        ),
    });
    renderApp('/finance/suppliers/5?allocate=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.allocations.title }),
    );
    // The lone payment is chosen already; the bills are what it pays.
    expect(await dialog.findByRole('radio', { name: 'Ж-20261020-0002' })).toBeChecked();
    expect(dialog.getByText(mn.finance.payables.allocation.debits)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.oldestFirst }));
    const amount = (number: string) =>
      dialog.getByLabelText(`${mn.finance.allocations.amount}: ${number}`);
    expect(amount('GR-20261015-0004')).toHaveValue('10000');
    expect(amount('GR-20261018-0001')).toHaveValue('');
    await user.click(dialog.getByRole('button', { name: mn.finance.allocations.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/finance/allocations')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/finance/allocations')[0];
    expect(await bodyOf(request)).toEqual({
      supplierId: 5,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      description: null,
      pairs: [{ debitItemId: 703, creditItemId: 702, amount: '10000' }],
    });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
  }, 15_000);

  it('asks for the supplier of a manual line on the payables account', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, routes());
    renderApp('/finance/journal?new=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.finance.journal.dialog.title }),
    );
    await user.type(
      dialog.getByLabelText(mn.finance.journal.dialog.descriptionField),
      'Нийлүүлэгчид төлөв',
    );
    await user.selectOptions(dialog.getByLabelText(`${mn.finance.journal.dialog.account} 1`), '12');
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.debit} 1`), '10000');
    await user.selectOptions(dialog.getByLabelText(`${mn.finance.journal.dialog.account} 2`), '1');
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.credit} 2`), '10000');
    await user.click(dialog.getByRole('button', { name: mn.finance.journal.dialog.submit }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      mn.finance.journal.dialog.lineDetailsMissing,
    );
    expect(calls(fetchMock, 'POST', '/api/v1/journal-entries')).toHaveLength(0);
    expect(dialog.getByLabelText(`${mn.finance.journal.dialog.supplier} 1`)).toBeInTheDocument();
  }, 15_000);
});
