import { screen, waitFor } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { json, renderApp, signedIn, signedOut } from '@/test/render-app';

describe('web shell', () => {
  it('renders the shell in Mongolian for a signed-in user', async () => {
    renderApp('/', signedIn());
    expect(await screen.findByRole('link', { name: mn.app.name })).toBeInTheDocument();
    // The brand is «Bto» (owner, 2026-10-13); the menu around it is Mongolian.
    expect(mn.nav.systemStatus).toMatch(/[Ѐ-ӿ]/u);
    expect(screen.getByRole('link', { name: mn.nav.systemStatus })).toBeInTheDocument();
  });

  it('shows component states from GET /health, including a degraded 503', async () => {
    const fetchMock = signedIn(undefined, {
      'GET /health': () =>
        json({ status: 'degraded', db: 'up', pgboss: 'down', version: 'test' }, 503),
    });
    renderApp('/system/status', fetchMock);
    expect(await screen.findByText(mn.systemStatus.state.down)).toBeInTheDocument();
    expect(screen.getByText(mn.systemStatus.state.up)).toBeInTheDocument();
    const health = fetchMock.mock.calls.find(([request]) => request.url.endsWith('/health'));
    expect(health?.[0].url).toBe('http://tugeel.test/health');
  });

  it('shows the not-found page for unknown routes', async () => {
    renderApp('/no-such-page', signedIn());
    expect(await screen.findByText(mn.errors.notFound)).toBeInTheDocument();
  });

  it('sends a visitor without a session to the login page and remembers the target', async () => {
    const { router } = renderApp('/system/status', signedOut());
    expect(await screen.findByRole('button', { name: mn.auth.login.submit })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain('next=%2Fsystem%2Fstatus');
  });
});
