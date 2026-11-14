import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKER_ME, json, renderApp, signedIn } from '@/test/render-app';
import type { ScreenUsageRow } from './usage-api';
import { usagePeriodOf } from './usage-api';
import { unusedNavItems } from './usage-menu';

const text = mn.usage;

const ROWS: ScreenUsageRow[] = [
  { app: 'web', screen: '/sales/work', opens: 60, seconds: 60 * 135, people: 4 },
  { app: 'web', screen: '/catalog/products/:id', opens: 30, seconds: 30 * 20, people: 2 },
  { app: 'web', screen: '/audit', opens: 10, seconds: 100, people: 1 },
  { app: 'staff', screen: '/order/:id', opens: 8, seconds: 400, people: 3 },
];

/** A translation with its `{{name}}` places filled, as i18next does. */
const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

const usageApi = (rows: ScreenUsageRow[] = ROWS) =>
  signedIn(undefined, {
    'GET /api/v1/usage/screens': () => json({ data: rows }),
    'POST /api/v1/usage/screens': () => new Response(null, { status: 204 }),
  });

describe('the screen usage helpers', () => {
  it('offers three periods and falls back to a month', () => {
    expect(usagePeriodOf('7')).toBe(7);
    expect(usagePeriodOf('90')).toBe(90);
    expect(usagePeriodOf('12')).toBe(30);
    expect(usagePeriodOf(null)).toBe(30);
  });

  it('counts a menu entry as used when a screen under it was opened', () => {
    const unused = unusedNavItems(ROWS).map((entry) => entry.item.to);
    // A product's page was opened: the products entry is used, though its list was not.
    expect(unused).not.toContain('/catalog/products');
    expect(unused).not.toContain('/audit');
    expect(unused).toContain('/roles');
    // The apps' screens say nothing about the web's menu.
    expect(unusedNavItems([{ ...ROWS[3]!, screen: '/roles' }]).map((e) => e.item.to)).toContain(
      '/roles',
    );
  });
});

describe('the screen usage page', () => {
  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('shows each client with its screens, the busiest first, and the menu nobody opened', async () => {
    renderApp('/system/usage', usageApi());

    const web = await screen.findByRole('region', { name: text.apps.web });
    expect(
      within(web).getByText(fill(text.summary, { screens: 3, opens: 100 })),
    ).toBeInTheDocument();
    const rows = within(web).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    // The menu's own name beside the screen's address; 60 of 100 opens, 2 min 15 s at a time.
    expect(within(rows[0]!).getByText('/sales/work')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('60%')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('4')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(fill(text.minutes, { minutes: 2, seconds: 15 })),
    ).toBeInTheDocument();
    expect(within(rows[1]!).getByText(mn.nav.products)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(fill(text.seconds, { seconds: 20 }))).toBeInTheDocument();

    const staff = screen.getByRole('region', { name: text.apps.staff });
    expect(within(staff).getByText('/order/:id')).toBeInTheDocument();
    // Nothing came from the stores' app in the period.
    const customer = screen.getByRole('region', { name: text.apps.customer });
    expect(within(customer).getByText(text.empty)).toBeInTheDocument();

    const unused = screen.getByRole('region', { name: text.unused.title });
    expect(within(unused).getByText(mn.nav.roles)).toBeInTheDocument();
    expect(within(unused).queryByText(mn.nav.audit)).not.toBeInTheDocument();
  });

  it('asks for the chosen period', async () => {
    const fetchMock = usageApi();
    renderApp('/system/usage', fetchMock);
    await screen.findByRole('region', { name: text.apps.web });
    const span = (url: string) => {
      const query = new URL(url).searchParams;
      return (
        (Date.parse(query.get('to') ?? '') - Date.parse(query.get('from') ?? '')) / 86_400_000 + 1
      );
    };
    const calls = () =>
      fetchMock.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method === 'GET' && request.url.includes('/usage/screens'));
    expect(span(calls().at(-1)!.url)).toBe(30);

    await userEvent.click(
      screen.getByRole('button', { name: fill(text.period.days, { count: 7 }) }),
    );
    await waitFor(() => expect(span(calls().at(-1)!.url)).toBe(7));
    expect(
      screen.getByRole('button', { name: fill(text.period.days, { count: 7 }) }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('is closed to who may not read the audit', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/system/usage', fetchMock);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([request]) => request.url.includes('/auth/me'))).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([request]) => request.method === 'GET' && request.url.includes('/usage/screens'),
      ),
    ).toBe(false);
  });

  it('sends the name of the screen in front when the tab goes out of sight, and nothing else', async () => {
    const fetchMock = usageApi();
    renderApp('/system/usage?days=7', fetchMock);
    await screen.findByRole('region', { name: text.apps.web });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    const sent = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([request]) => request.method === 'POST' && request.url.endsWith('/api/v1/usage/screens'),
      );
      expect(call).toBeDefined();
      return call![0];
    });
    const body = (await sent.clone().json()) as {
      app: string;
      events: { screen: string; opens: number; seconds: number }[];
    };
    expect(body.app).toBe('web');
    expect(body.events).toHaveLength(1);
    // The address's filter is not in the name.
    expect(body.events[0]).toMatchObject({ screen: '/system/usage', opens: 1 });
    expect(Object.keys(body.events[0]!).sort()).toEqual(['opens', 'screen', 'seconds']);
  });
});
