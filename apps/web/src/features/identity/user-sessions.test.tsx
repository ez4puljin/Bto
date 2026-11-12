import { QueryClient } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AuthSession } from '@/lib/auth/auth-session';
import { json, signedIn } from '@/test/render-app';
import { UserSessionsCard } from './user-access';

const text = mn.users.detail;

/** A translation with its `{{name}}` places filled, as i18next does. */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

const APP_AGENT = 'Bto-staff/0.19.0 (Android 14; samsung SM-A546E; id 3f2a9c1e)';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const session = (id: string, over: Record<string, unknown>) => ({
  id,
  createdAt: '2026-11-13T01:00:00.000Z',
  lastUsedAt: '2026-11-13T01:30:00.000Z',
  expiresAt: '2026-11-13T13:00:00.000Z',
  userAgent: null,
  ip: '203.0.113.7',
  endedAt: null,
  endReason: null,
  ...over,
});

const LIVE = [
  session('00000000-0000-4000-8000-000000000001', { userAgent: APP_AGENT }),
  session('00000000-0000-4000-8000-000000000002', { userAgent: CHROME, ip: '192.168.1.20' }),
];
const TRAIL = [
  ...LIVE,
  session('00000000-0000-4000-8000-000000000003', {
    userAgent: 'okhttp/4.9.2',
    endedAt: '2026-11-12T10:00:00.000Z',
    endReason: 'ADMIN',
  }),
  session('00000000-0000-4000-8000-000000000004', {
    userAgent: 'curl/8.21.0',
    endedAt: '2026-11-11T10:00:00.000Z',
    endReason: 'EXPIRED',
  }),
];

function renderCard() {
  const fetchMock = signedIn(undefined, {
    'GET /api/v1/users/7/sessions': (request) =>
      json({
        data: new URL(request.url).searchParams.get('history') === 'true' ? TRAIL : LIVE,
        nextCursor: null,
      }),
  });
  const authSession = new AuthSession({
    baseUrl: 'http://tugeel.test',
    fetch: fetchMock,
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders session={authSession} queryClient={queryClient}>
      <UserSessionsCard userId={7} />
    </AppProviders>,
  );
  return fetchMock;
}

const appText = fill(text.appOn, {
  device: 'samsung SM-A546E',
  os: 'Android 14',
  app: 'Bto-staff',
  version: '0.19.0',
  install: '3f2a9c1e',
});
const browserText = fill(text.browserOn, { browser: 'Chrome 142', os: 'Windows 10/11' });

describe('the sign-ins of a staff member', () => {
  it('says each live device in words: the phone of the app, the browser of the web', async () => {
    renderCard();
    expect(await screen.findByText(`${appText} · 203.0.113.7`)).toBeInTheDocument();
    expect(screen.getByText(`${browserText} · 192.168.1.20`)).toBeInTheDocument();
    // The raw header is not what the office reads.
    expect(screen.queryByText(/Mozilla\/5\.0/)).not.toBeInTheDocument();
  });

  it('opens the trail on demand, with when and why each sign-in ended', async () => {
    const user = userEvent.setup();
    const fetchMock = renderCard();
    await screen.findByText(`${appText} · 203.0.113.7`);
    const asked = () =>
      fetchMock.mock.calls.filter(([request]) => request.url.includes('history=true')).length;
    expect(asked()).toBe(0);

    await user.click(screen.getByRole('button', { name: text.showHistory }));
    const trail = await screen.findByRole('table', { name: text.history });
    expect(asked()).toBe(1);
    const rows = within(trail).getAllByRole('row');
    expect(rows).toHaveLength(1 + TRAIL.length);
    expect(within(trail).getAllByText(text.live)).toHaveLength(2);
    expect(within(trail).getByText(text.oldApp)).toBeInTheDocument();
    expect(within(trail).getByText('curl/8.21.0')).toBeInTheDocument();
    expect(within(trail).getByText(new RegExp(text.endReasons.ADMIN))).toBeInTheDocument();
    expect(within(trail).getByText(new RegExp(text.endReasons.EXPIRED))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: text.hideHistory }));
    expect(screen.queryByRole('table', { name: text.history })).not.toBeInTheDocument();
  });
});
