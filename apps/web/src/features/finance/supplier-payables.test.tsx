import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, calls, list } from '@/test/inventory-fixtures';
import { choose } from '@/test/choose';
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
  latestBillDate: '2026-11-20',
  updatedAt: STAMP,
};
const LISTED = {
  ...SUPPLIER,
  categoryPath: 'Архи',
  segments: [{ id: 9, name: 'Том нийлүүлэгч' }],
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
    confirmedBy: null,
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
    confirmedBy: 'Б. Нягтлан',
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
  'GET /api/v1/supplier-balances': () => list([LISTED]),
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
    expect(screen.getByText(mn.finance.payables.howToPayDirect)).toBeInTheDocument();
  });

  it('filters by category and segment and shows the owner’s columns', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'GET /api/v1/supplier-categories': () =>
        json([
          {
            id: 4,
            parentId: null,
            name: 'Архи',
            path: 'Архи',
            active: true,
            sort: 0,
            supplierCount: 1,
          },
        ]),
      'GET /api/v1/segments': () =>
        list([
          {
            id: 9,
            entity: 'SUPPLIER',
            kind: 'RULES',
            name: 'Том нийлүүлэгч',
            description: null,
            definition: { match: 'ALL', groups: [] },
            appPosition: null,
            archivedAt: null,
            createdAt: STAMP,
            updatedAt: STAMP,
          },
        ]),
    });
    renderApp('/finance/suppliers?category=4&segment=9', fetchMock);
    const row = await screen.findByRole('row', { name: /МСМ ХХК/ });
    expect(within(row).getByText('010')).toBeInTheDocument();
    expect(within(row).getByText('Архи')).toBeInTheDocument();
    expect(within(row).getByText('Том нийлүүлэгч')).toBeInTheDocument();
    expect(within(row).getByText('2026-11-20')).toBeInTheDocument();
    for (const name of ['code', 'name', 'category', 'segment', 'balance', 'latestBill'] as const) {
      expect(
        screen.getByRole('columnheader', { name: mn.finance.payables[name] }),
      ).toBeInTheDocument();
    }
    const request = calls(fetchMock, 'GET', '/api/v1/supplier-balances')[0];
    const query = new URL(request?.url ?? '').searchParams;
    expect(query.get('categoryId')).toBe('4');
    expect(query.get('segmentId')).toBe('9');
  });

  it('names the accountant who confirmed each receipt and has no separate matching', async () => {
    renderApp('/finance/suppliers/5', signedIn(ACCOUNTANT_ME, routes()));
    const bill = await screen.findByRole('row', { name: /GR-20261018-0001/ });
    expect(within(bill).getByText('Б. Нягтлан')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: mn.finance.payables.confirmedBy }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: mn.finance.allocations.action }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: mn.finance.payables.pendingReceipts })).toHaveAttribute(
      'href',
      '/inventory/receipts?supplierId=5&costing=pending',
    );
  });

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
    await choose(user, dialog.getByLabelText(`${mn.finance.journal.dialog.account} 1`), /^310101/);
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.debit} 1`), '10000');
    await choose(user, dialog.getByLabelText(`${mn.finance.journal.dialog.account} 2`), /^100101/);
    await user.type(dialog.getByLabelText(`${mn.finance.journal.dialog.credit} 2`), '10000');
    await user.click(dialog.getByRole('button', { name: mn.finance.journal.dialog.submit }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      mn.finance.journal.dialog.lineDetailsMissing,
    );
    expect(calls(fetchMock, 'POST', '/api/v1/journal-entries')).toHaveLength(0);
    expect(dialog.getByLabelText(`${mn.finance.journal.dialog.supplier} 1`)).toBeInTheDocument();
  }, 15_000);
});
