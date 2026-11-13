import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { presetRange } from '@tugeel/shared/reports';
import { businessDate } from '@tugeel/shared/time';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';
import { PROFIT, REFRESH_STATE } from './report-fixtures';

const v = mn.reports.views;
const name = (text: string, value: string) => text.replace('{{name}}', value);

const OWN = {
  id: 5,
  page: 'profit',
  name: 'Ангиллаар, энэ сар',
  query: 'by=category',
  period: 'thisMonth',
  shared: true,
  mine: true,
  editable: true,
  removable: true,
  createdBy: { id: 1, fullName: 'Админ' },
  updatedAt: '2026-11-13T05:00:00.000Z',
};
const OTHERS = {
  ...OWN,
  id: 6,
  name: 'Аравдугаар сар',
  query: 'by=product&from=2026-10-01&to=2026-10-31',
  period: null,
  mine: false,
  editable: false,
  removable: false,
  createdBy: { id: 9, fullName: 'Дорж' },
};

function server(extra: Record<string, (request: Request) => Response | Promise<Response>> = {}) {
  return signedIn(ADMIN_ME, {
    'GET /api/v1/reports/refresh-state': () => json(REFRESH_STATE),
    'GET /api/v1/reports/profit': () => json(PROFIT),
    'GET /api/v1/reports/views': () => json({ data: [OWN, OTHERS] }),
    ...extra,
  });
}
const lastProfit = (fetchMock: ReturnType<typeof signedIn>) =>
  new URL(calls(fetchMock, 'GET', '/api/v1/reports/profit').at(-1)?.url ?? 'http://x').searchParams;

describe('saved report views (ADR-0194)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists own and shared views and opens one with today’s dates of its period', async () => {
    const user = userEvent.setup();
    const fetchMock = server();
    renderApp('/reports/profit?from=2026-01-01&to=2026-01-31', fetchMock);

    await user.click(await screen.findByRole('button', { name: v.button }));
    const menu = within(await screen.findByRole('dialog', { name: v.title }));
    expect(menu.getByText(v.mine)).toBeInTheDocument();
    expect(menu.getByText(v.shared)).toBeInTheDocument();
    expect(menu.getByText(name(v.sharedBy, 'Дорж'))).toBeInTheDocument();
    // Only the caller's own view can be deleted.
    expect(menu.getByRole('button', { name: name(v.delete, OWN.name) })).toBeInTheDocument();
    expect(menu.queryByRole('button', { name: name(v.delete, OTHERS.name) })).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/reports/views')[0]?.url).toContain('page=profit');

    await user.click(menu.getByRole('button', { name: name(v.open, OWN.name) }));
    const range = presetRange('thisMonth', businessDate());
    await waitFor(() => expect(lastProfit(fetchMock).get('by')).toBe('category'));
    expect(lastProfit(fetchMock).get('from')).toBe(range.from);
    expect(lastProfit(fetchMock).get('to')).toBe(range.to);

    // A view with its own dates opens on them.
    await user.click(screen.getByRole('button', { name: v.button }));
    await user.click(await screen.findByRole('button', { name: name(v.open, OTHERS.name) }));
    await waitFor(() => expect(lastProfit(fetchMock).get('by')).toBe('product'));
    expect(lastProfit(fetchMock).get('from')).toBe('2026-10-01');
    expect(lastProfit(fetchMock).get('to')).toBe('2026-10-31');
  });

  it('saves the view on screen, suggesting the moving period its dates are today', async () => {
    const user = userEvent.setup();
    const range = presetRange('lastMonth', businessDate());
    const fetchMock = server({
      'POST /api/v1/reports/views': () => json({ ...OWN, id: 7, name: 'Өнгөрсөн сар' }, 201),
    });
    renderApp(`/reports/profit?to=${range.to}&by=product&from=${range.from}`, fetchMock);

    await user.click(await screen.findByRole('button', { name: v.button }));
    await user.click(await screen.findByRole('button', { name: v.save }));
    const dialog = within(await screen.findByRole('dialog', { name: v.saveTitle }));
    expect(dialog.getByLabelText(v.periodLabel)).toHaveValue('lastMonth');
    await user.type(dialog.getByLabelText(v.nameLabel), 'Өнгөрсөн сар');
    await user.click(dialog.getByLabelText(v.shareLabel));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/reports/views')).toHaveLength(1));
    const sent = calls(fetchMock, 'POST', '/api/v1/reports/views')[0];
    expect(await bodyOf(sent)).toEqual({
      page: 'profit',
      name: 'Өнгөрсөн сар',
      query: 'by=product',
      period: 'lastMonth',
      shared: true,
    });
    expect(sent?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(v.saved)).toBeInTheDocument();
  });

  it('replaces the caller’s view of the same name, keeping the dates when asked', async () => {
    const user = userEvent.setup();
    const fetchMock = server({
      'PATCH /api/v1/reports/views/5': () => json(OWN),
    });
    renderApp('/reports/profit?from=2026-03-01&to=2026-03-20&by=rep', fetchMock);

    await user.click(await screen.findByRole('button', { name: v.button }));
    await user.click(await screen.findByRole('button', { name: v.save }));
    const dialog = within(await screen.findByRole('dialog', { name: v.saveTitle }));
    // Dates that are no preset's today stay as they are.
    expect(dialog.getByLabelText(v.periodLabel)).toHaveValue('fixed');
    await user.type(dialog.getByLabelText(v.nameLabel), 'ангиллаар, ЭНЭ сар');
    expect(dialog.getByText(v.replaces)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.common.save }));

    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/reports/views/5')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/reports/views/5')[0])).toEqual({
      query: 'by=rep&from=2026-03-01&to=2026-03-20',
      period: null,
      shared: false,
    });
    expect(calls(fetchMock, 'POST', '/api/v1/reports/views')).toHaveLength(0);
    expect(await screen.findByText(v.replaced)).toBeInTheDocument();
  });

  it('deletes a view after a confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = server({
      'DELETE /api/v1/reports/views/5': () => new Response(null, { status: 204 }),
    });
    renderApp('/reports/profit', fetchMock);

    await user.click(await screen.findByRole('button', { name: v.button }));
    await user.click(await screen.findByRole('button', { name: name(v.delete, OWN.name) }));
    const confirm = within(
      await screen.findByRole('dialog', { name: name(v.deleteConfirm, OWN.name) }),
    );
    expect(confirm.getByText(v.deleteShared)).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: mn.common.delete }));
    await waitFor(() =>
      expect(calls(fetchMock, 'DELETE', '/api/v1/reports/views/5')).toHaveLength(1),
    );
    expect(await screen.findByText(v.deleted)).toBeInTheDocument();
  });
});
