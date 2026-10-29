import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, calls } from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';
import { ACCOUNTS } from './finance-fixtures';

type Line = components['schemas']['AccountLedgerLine'];

const LINE: Line = {
  id: 1,
  entryId: 31,
  entryNumber: 'Ж-20261016-0001',
  entryDate: '2026-10-16',
  entryDescription: 'Хүнд тооцсон GI-2026-000001/WH1 — Бат-Эрдэнэ Дорж',
  source: 'AUTO_INVOICE',
  lineNo: 1,
  debit: '4000.00',
  credit: '0.00',
  customerId: null,
  customerName: null,
  partyId: '12',
  partyName: 'Бат-Эрдэнэ Дорж',
  description: null,
  balanceAfter: '4000.00',
};

/** The account report by account and party (ADR-0117 #2). */
describe('account ledger by party', () => {
  it('filters the account’s lines by a party and names the party on each line', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/gl-accounts': () => json(ACCOUNTS),
      'GET /api/v1/gl-accounts/3/parties': () =>
        json([
          { partyId: '12', name: 'Бат-Эрдэнэ Дорж', kind: 'EMPLOYEE', lineCount: 1 },
          { partyId: '9', name: 'Номин дэлгүүр', kind: 'COMPANY', lineCount: 3 },
        ]),
      'GET /api/v1/gl-accounts/3/ledger': () =>
        json({ data: [LINE], nextCursor: null, opening: '0.00' }),
    });
    renderApp('/finance/accounts/3', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('row', { name: /Ж-20261016-0001/ })).toHaveTextContent(
      'Бат-Эрдэнэ Дорж',
    );
    const filter = screen.getByRole('combobox', { name: mn.finance.accounts.partyFilter });
    expect(await screen.findByRole('option', { name: 'Бат-Эрдэнэ Дорж' })).toBeInTheDocument();
    await user.selectOptions(filter, '12');
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/gl-accounts/3/ledger').some(
          (request) => new URL(request.url).searchParams.get('partyId') === '12',
        ),
      ).toBe(true),
    );
  });
});
