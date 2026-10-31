import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  json,
  problem,
  renderApp,
  signedIn,
  signedOut,
  TOKENS,
  WORKER_ME,
} from '@/test/render-app';

describe('login', () => {
  it('shows Bto, its owner, the two wholesale centres and the capital beside the form', async () => {
    renderApp('/login', signedOut());
    expect(await screen.findByRole('heading', { name: mn.auth.login.title })).toBeInTheDocument();
    expect(screen.getByText(mn.auth.login.welcome)).toBeInTheDocument();
    expect(screen.getAllByText(mn.app.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(mn.brand.owner).length).toBeGreaterThan(0);
    // The legend under the map says in text what the map shows (owner, 2026-10-13).
    const legend = within(screen.getByRole('list'));
    expect(legend.getAllByRole('listitem')).toHaveLength(3);
    const [main, branch, capital] = legend.getAllByRole('listitem');
    expect(main).toHaveTextContent(mn.brand.centers.orgil);
    expect(main).toHaveTextContent(mn.brand.mainBranch);
    expect(main).toHaveTextContent(mn.brand.places.muron);
    expect(branch).toHaveTextContent(mn.brand.centers.bolomj);
    expect(branch).toHaveTextContent(mn.brand.places.kharkhorin);
    expect(capital).toHaveTextContent(mn.brand.places.ulaanbaatar);
    expect(capital).toHaveTextContent(mn.brand.capital);
    expect(document.title).toBe(`${mn.auth.login.title} · ${mn.app.name}`);
  });

  it('logs in, then shows the requested page with the user name', async () => {
    const fetchMock = signedOut({
      'POST /api/v1/auth/login': () => json({ ...TOKENS, me: ADMIN_ME }),
      'GET /health': () => json({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' }),
    });
    const { router } = renderApp('/login?next=%2Fsystem%2Fstatus', fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.phone), 'admin');
    await user.type(screen.getByLabelText(mn.auth.login.password), 'correct-horse-9');
    await user.click(screen.getByRole('button', { name: mn.auth.login.submit }));
    expect(await screen.findByText(ADMIN_ME.fullName)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/status'));
    const login = fetchMock.mock.calls.find(([request]) => request.url.endsWith('/auth/login'));
    expect(await login?.[0].json()).toEqual({ login: 'admin', password: 'correct-horse-9' });
  });

  it('shows the Mongolian message of the error code', async () => {
    renderApp(
      '/login',
      signedOut({ 'POST /api/v1/auth/login': () => problem('INVALID_CREDENTIALS', 401) }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.phone), 'admin');
    await user.type(screen.getByLabelText(mn.auth.login.password), 'wrong');
    await user.click(screen.getByRole('button', { name: mn.auth.login.submit }));
    expect(await screen.findByText(mn.errors.INVALID_CREDENTIALS)).toBeInTheDocument();
  });

  it('validates empty fields without calling the API', async () => {
    const fetchMock = signedOut();
    renderApp('/login', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.auth.login.submit }));
    expect(await screen.findAllByText(mn.validation.required)).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([request]) => request.url.endsWith('/auth/login'))).toBe(
      false,
    );
  });

  it('never redirects off-site after login', async () => {
    const { router } = renderApp(
      '/login?next=%2F%2Fevil.test',
      signedOut({ 'POST /api/v1/auth/login': () => json({ ...TOKENS, me: ADMIN_ME }) }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.phone), 'admin');
    await user.type(screen.getByLabelText(mn.auth.login.password), 'correct-horse-9');
    await user.click(screen.getByRole('button', { name: mn.auth.login.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('password setup with a one-time code', () => {
  it('checks the policy in the form, then sets the password and signs in', async () => {
    const fetchMock = signedOut({
      'POST /api/v1/auth/password/setup': () => json({ ...TOKENS, me: WORKER_ME }),
    });
    const { router } = renderApp('/set-password', fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.phone), 'worker');
    await user.type(screen.getByLabelText(mn.auth.setPassword.code), '7kq2m-x9d4f');
    await user.type(screen.getByLabelText(mn.auth.setPassword.newPassword), 'short');
    await user.type(screen.getByLabelText(mn.auth.setPassword.confirmPassword), 'other');
    await user.click(screen.getByRole('button', { name: mn.auth.setPassword.submit }));
    expect(await screen.findByText(mn.validation.passwordTooShort)).toBeInTheDocument();
    expect(screen.getByText(mn.validation.passwordsDiffer)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(mn.auth.setPassword.newPassword));
    await user.type(screen.getByLabelText(mn.auth.setPassword.newPassword), 'my-own-password-1');
    await user.clear(screen.getByLabelText(mn.auth.setPassword.confirmPassword));
    await user.type(
      screen.getByLabelText(mn.auth.setPassword.confirmPassword),
      'my-own-password-1',
    );
    await user.click(screen.getByRole('button', { name: mn.auth.setPassword.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByText(WORKER_ME.fullName)).toBeInTheDocument();
  });
});

describe('account and logout', () => {
  it('logs out from the user menu and lands on the login page', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    });
    const { router } = renderApp('/system/status', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: ADMIN_ME.fullName }));
    await user.click(await screen.findByRole('menuitem', { name: mn.auth.logout }));
    expect(await screen.findByText(mn.auth.login.loggedOut)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('changes the password from the account page', async () => {
    renderApp(
      '/account',
      signedIn(ADMIN_ME, {
        'POST /api/v1/auth/password': () => new Response(null, { status: 204 }),
      }),
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(mn.auth.account.currentPassword),
      'old-password-1',
    );
    await user.type(screen.getByLabelText(mn.auth.account.newPassword), 'new-password-123');
    await user.type(screen.getByLabelText(mn.auth.account.confirmPassword), 'new-password-123');
    await user.click(screen.getByRole('button', { name: mn.auth.account.submit }));
    expect(await screen.findByText(mn.auth.account.changed)).toBeInTheDocument();
  });
});
