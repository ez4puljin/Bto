import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { components } from '@tugeel/api-client';
import { PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';
import { AuthSession } from '@/lib/auth/auth-session';

export type Me = components['schemas']['Me'];
type Handler = (request: Request) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });

export const problem = (code: string, status: number, params?: Record<string, unknown>) =>
  json(
    {
      type: `https://tugeel.local/errors/${code}`,
      title: code,
      status,
      code,
      ...(params ? { params } : {}),
    },
    status,
  );

export const ADMIN_ME: Me = {
  id: 1,
  username: 'admin',
  fullName: 'Админ Бат',
  permissions: [...PERMISSIONS],
  roles: [{ id: 1, code: 'ADMIN', name: null, isSystem: true }],
  writableWarehouseIds: null,
  sessionStartedAt: '2026-10-10T08:00:00.000Z',
  sessionExpiresAt: '2026-10-10T20:00:00.000Z',
};

export const WORKER_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'worker',
  fullName: 'Агуулахын Дорж',
  permissions: [],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
};

export const TOKENS = {
  accessToken: 'access-token-1',
  accessTokenExpiresAt: '2026-10-10T08:15:00.000Z',
  sessionExpiresAt: '2026-10-10T20:00:00.000Z',
};

/** A fetch mock routed by `METHOD /path`; unknown routes answer 404 problem+json. */
export function mockApi(routes: Record<string, Handler>) {
  return vi.fn(async (request: Request): Promise<Response> => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const handler = routes[key];
    return handler ? handler(request) : problem('NOT_FOUND', 404);
  });
}

/** Routes for a browser that already holds a valid refresh cookie for `me`. */
export function signedIn(me: Me = ADMIN_ME, extra: Record<string, Handler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(TOKENS),
    'GET /api/v1/auth/me': () => json(me),
    'GET /health': () => json({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' }),
    ...extra,
  });
}

/** Routes for a browser without a session. */
export function signedOut(extra: Record<string, Handler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => problem('UNAUTHORIZED', 401),
    ...extra,
  });
}

/** The sidebar menu; the breadcrumb trail is a second, separately named navigation landmark. */
export const findSidebar = () => screen.findByRole('navigation', { name: mn.nav.menu });
export const getSidebar = () => screen.getByRole('navigation', { name: mn.nav.menu });

export function renderApp(path: string, fetchMock: (request: Request) => Promise<Response>) {
  const session = new AuthSession({
    baseUrl: 'http://tugeel.test',
    fetch: fetchMock,
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders session={session} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { session, router };
}
