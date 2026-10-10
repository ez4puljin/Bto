import { screen, waitFor } from '@testing-library/react';
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
  it('logs in, then shows the requested page with the user name', async () => {
    const fetchMock = signedOut({
      'POST /api/v1/auth/login': () => json({ ...TOKENS, me: ADMIN_ME }),
      'GET /health': () => json({ status: 'ok', db: 'up', pgboss: 'up', version: 'test' }),
    });
    const { router } = renderApp('/login?next=%2Fsystem%2Fstatus', fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.username), 'admin');
    await user.type(screen.getByLabelText(mn.auth.login.password), 'correct-horse-9');
    await user.click(screen.getByRole('button', { name: mn.auth.login.submit }));
    expect(await screen.findByText(ADMIN_ME.fullName)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/status'));
    const login = fetchMock.mock.calls.find(([request]) => request.url.endsWith('/auth/login'));
    expect(await login?.[0].json()).toEqual({ username: 'admin', password: 'correct-horse-9' });
  });

  it('shows the Mongolian message of the error code', async () => {
    renderApp(
      '/login',
      signedOut({ 'POST /api/v1/auth/login': () => problem('INVALID_CREDENTIALS', 401) }),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.username), 'admin');
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
    await user.type(await screen.findByLabelText(mn.auth.login.username), 'admin');
    await user.type(screen.getByLabelText(mn.auth.login.password), 'correct-horse-9');
    await user.click(screen.getByRole('button', { name: mn.auth.login.submit }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/status'));
  });
});

describe('password setup with a one-time code', () => {
  it('checks the policy in the form, then sets the password and signs in', async () => {
    const fetchMock = signedOut({
      'POST /api/v1/auth/password/setup': () => json({ ...TOKENS, me: WORKER_ME }),
    });
    const { router } = renderApp('/set-password', fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(mn.auth.login.username), 'worker');
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
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/status'));
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
