import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createApiClient } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderApp(path: string, fetchMock: (request: Request) => Promise<Response>) {
  const apiClient = createApiClient({ baseUrl: 'http://tugeel.test', fetch: fetchMock });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders apiClient={apiClient} queryClient={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

describe('web shell', () => {
  it('renders the shell in Mongolian', async () => {
    renderApp('/', () =>
      Promise.resolve(json({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' })),
    );
    expect(await screen.findByText(mn.app.name)).toBeInTheDocument();
    expect(mn.app.name).toMatch(/[Ѐ-ӿ]/u);
    expect(screen.getByRole('link', { name: mn.nav.systemStatus })).toBeInTheDocument();
  });

  it('shows component states from GET /health, including a degraded 503', async () => {
    const fetchMock = vi.fn((_request: Request) =>
      Promise.resolve(json({ status: 'degraded', db: 'up', pgboss: 'down', version: 'test' }, 503)),
    );
    renderApp('/system/status', fetchMock);
    expect(await screen.findByText(mn.systemStatus.state.down)).toBeInTheDocument();
    expect(screen.getByText(mn.systemStatus.state.up)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0].url).toBe('http://tugeel.test/health');
  });

  it('shows the not-found page for unknown routes', async () => {
    renderApp('/no-such-page', () => Promise.resolve(json({}, 404)));
    expect(await screen.findByText(mn.errors.notFound)).toBeInTheDocument();
  });
});
