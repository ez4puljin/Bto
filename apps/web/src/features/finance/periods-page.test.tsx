import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, UUID } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';
import type { FinancePeriod, FinancePeriodEvent } from './api';

const STAMP = '2026-10-02T03:00:00.000Z';
const CLOSE_EVENT: FinancePeriodEvent = {
  id: 2,
  period: '2026-09',
  action: 'CLOSE',
  reason: null,
  actorLabel: 'Нягтлан Сараа',
  createdAt: STAMP,
};
const PERIODS: FinancePeriod[] = [
  {
    id: 3,
    code: '2026-10',
    startsOn: '2026-10-01',
    endsOn: '2026-10-31',
    status: 'OPEN',
    lastEvent: null,
  },
  {
    id: 2,
    code: '2026-09',
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    status: 'CLOSED',
    lastEvent: CLOSE_EVENT,
  },
  {
    id: 1,
    code: '2026-08',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    status: 'CLOSED',
    lastEvent: { ...CLOSE_EVENT, id: 1, period: '2026-08' },
  },
];

const routes = () => ({
  'GET /api/v1/finance/periods': () => json({ data: PERIODS }),
  'GET /api/v1/finance/periods/events': () =>
    json({ data: [CLOSE_EVENT, { ...CLOSE_EVENT, id: 1, period: '2026-08' }] }),
});

describe('month close (F5, ADR-0102)', () => {
  it('lists the months and reopens only the latest closed one, with a reason', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/periods/2026-09/reopen': () => json({ ...PERIODS[1], status: 'OPEN' }),
    });
    renderApp('/', fetchMock);
    const sidebar = within(await findSidebar());
    await user.click(sidebar.getByRole('link', { name: mn.nav.financePeriods }));
    const september = await screen.findByRole('row', { name: /^2026-09/ });
    expect(within(september).getByText(mn.finance.periods.statuses.CLOSED)).toBeInTheDocument();
    const august = screen.getByRole('row', { name: /^2026-08/ });
    expect(
      within(august).queryByRole('button', { name: mn.finance.periods.reopen }),
    ).not.toBeInTheDocument();
    await user.click(within(september).getByRole('button', { name: mn.finance.periods.reopen }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByLabelText(mn.finance.fields.reason));
    await user.paste('Нэхэмжлэл хоцорсон');
    await user.click(dialog.getByRole('button', { name: mn.finance.periods.reopen }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/finance/periods/2026-09/reopen')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/finance/periods/2026-09/reopen')[0];
    expect(await bodyOf(request)).toEqual({ reason: 'Нэхэмжлэл хоцорсон' });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
  }, 15_000);

  it('closes the chosen month after a confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/periods/2026-07/close': () =>
        json({ ...PERIODS[2], code: '2026-07', status: 'CLOSED' }),
    });
    renderApp('/finance/periods', fetchMock);
    const month = await screen.findByLabelText(mn.finance.periods.month);
    await user.clear(month);
    await user.type(month, '2026-07');
    await user.click(screen.getByRole('button', { name: mn.finance.periods.close }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: mn.finance.periods.close }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/finance/periods/2026-07/close')).toHaveLength(1),
    );
  }, 15_000);
});
