import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { isAssignablePermission, PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  getSidebar,
  json,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-01T02:00:00.000Z';
const list = <T,>(data: T[]) => json({ data, nextCursor: null });

const ROLES: Schemas['Role'][] = [
  { id: 1, code: 'ADMIN', name: null, isSystem: true, permissions: [...PERMISSIONS], userCount: 1 },
  { id: 4, code: 'WAREHOUSE', name: null, isSystem: true, permissions: [], userCount: 0 },
  {
    id: 20,
    code: null,
    name: 'Ахлах нярав',
    isSystem: false,
    permissions: ['identity.audit.read'],
    userCount: 0,
  },
];
const CATALOG: Schemas['PermissionInfo'][] = PERMISSIONS.map((code) => ({
  code,
  assignable: isAssignablePermission(code),
}));
const BRANCHES: Schemas['Branch'][] = [
  {
    id: 1,
    code: 'MAIN',
    name: 'Төв салбар',
    branchNo: '001',
    districtCode: null,
    address: null,
    status: 'ACTIVE',
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];
const WAREHOUSES: Schemas['Warehouse'][] = [
  {
    id: 1,
    code: 'TRANSIT',
    name: 'Transit',
    kind: 'TRANSIT',
    branchId: null,
    status: 'ACTIVE',
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 2,
    code: 'WH1',
    name: 'Бөөний агуулах',
    kind: 'WHOLESALE',
    branchId: 1,
    status: 'ACTIVE',
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];
const DORJ: Schemas['UserDetail'] = {
  id: 7,
  username: 'dorj.n',
  fullName: 'Дорж Нямаа',
  status: 'ACTIVE',
  roleIds: [4],
  lastLoginAt: null,
  lockedUntil: null,
  phone: '+97699112233',
  passwordSet: false,
  failedLoginCount: 0,
  scopes: { warehouseIds: [2], branchIds: [] },
  createdAt: STAMP,
  updatedAt: STAMP,
};
const ORG_ROUTES = {
  'GET /api/v1/roles': () => list(ROLES),
  'GET /api/v1/branches': () => list(BRANCHES),
  'GET /api/v1/warehouses': () => list(WAREHOUSES),
};
const ADMIN_MENU = [
  mn.nav.users,
  mn.nav.roles,
  mn.nav.branches,
  mn.nav.warehouses,
  mn.nav.settings,
  mn.nav.audit,
];

const cardOf = (element: HTMLElement) => {
  const card = element.closest<HTMLElement>('[data-slot="card"]');
  if (!card) throw new Error('not inside a card');
  return within(card);
};
const calledWith = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls.some(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

describe('menu and page access', () => {
  it('shows every admin menu to an admin', async () => {
    renderApp('/system/status', signedIn(ADMIN_ME));
    const nav = await findSidebar();
    for (const label of ADMIN_MENU) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('hides the admin menus from a worker and refuses the page without calling the API', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/users', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    // The refusal is a page of its own: the browser tab says so (ADR-0066).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(mn.errors.forbiddenTitle);
    expect(document.title).toBe(`${mn.errors.forbiddenTitle} · ${mn.app.name}`);
    const nav = getSidebar();
    for (const label of ADMIN_MENU) {
      expect(within(nav).queryByRole('link', { name: label })).toBeNull();
    }
    expect(calledWith(fetchMock, 'GET', '/api/v1/users')).toBe(false);
  });
});

describe('users', () => {
  it('creates a user, shows the one-time code once, then opens the user', async () => {
    let created: unknown;
    const fetchMock = signedIn(ADMIN_ME, {
      ...ORG_ROUTES,
      'GET /api/v1/users': () => list([]),
      'POST /api/v1/users': async (request) => {
        created = await request.json();
        return json(DORJ, 201);
      },
      'POST /api/v1/users/7/password-code': () =>
        json({ code: 'ABCDE-FGHJK', expiresAt: '2026-10-10T08:30:00.000Z' }, 201),
      'GET /api/v1/users/7': () => json(DORJ),
      'GET /api/v1/users/7/sessions': () => list([]),
    });
    const { router } = renderApp('/users', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.users.create }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.users.form.username), 'Dorj.N');
    await user.type(dialog.getByLabelText(mn.users.form.fullName), 'Дорж Нямаа');
    await user.type(dialog.getByLabelText(mn.users.form.phone), '9911 2233');
    await user.click(await dialog.findByRole('checkbox', { name: mn.roles.system.WAREHOUSE }));
    await user.click(dialog.getByRole('checkbox', { name: 'WH1 · Бөөний агуулах' }));
    expect(dialog.queryByRole('checkbox', { name: /TRANSIT/ })).toBeNull();
    await user.click(dialog.getByRole('button', { name: mn.common.save }));

    expect(await screen.findByText('ABCDE-FGHJK')).toBeInTheDocument();
    expect(created).toEqual({
      username: 'dorj.n',
      fullName: 'Дорж Нямаа',
      phone: '+97699112233',
      roleIds: [4],
      scopes: { warehouseIds: [2], branchIds: [] },
    });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/users/7'));
    expect(await screen.findByRole('heading', { name: DORJ.fullName })).toBeInTheDocument();
  });

  it('shows the API problem inside the create dialog', async () => {
    renderApp(
      '/users',
      signedIn(ADMIN_ME, {
        ...ORG_ROUTES,
        'GET /api/v1/users': () => list([]),
        'POST /api/v1/users': () =>
          problem('DUPLICATE_VALUE', 409, { constraint: 'users_username_key' }),
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.users.create }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.users.form.username), 'dorj.n');
    await user.type(dialog.getByLabelText(mn.users.form.fullName), 'Дорж');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.errors.DUPLICATE_VALUE)).toBeInTheDocument();
  });

  it('unlocks a locked user and signs one device out', async () => {
    const session: Schemas['Session'] = {
      id: '0192f0a0-0000-7000-8000-000000000001',
      createdAt: STAMP,
      lastUsedAt: STAMP,
      expiresAt: '2026-10-01T14:00:00.000Z',
      userAgent: 'Mozilla/5.0',
      ip: '192.0.2.10',
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...ORG_ROUTES,
      'GET /api/v1/users/7': () =>
        json({ ...DORJ, lockedUntil: '2099-01-01T00:00:00.000Z', failedLoginCount: 20 }),
      'GET /api/v1/users/7/sessions': () => list([session]),
      'POST /api/v1/users/7/unlock': () => json(DORJ),
      [`DELETE /api/v1/users/7/sessions/${session.id}`]: () => new Response(null, { status: 204 }),
    });
    renderApp('/users/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.users.detail.unlock }));
    await waitFor(() => expect(calledWith(fetchMock, 'POST', '/api/v1/users/7/unlock')).toBe(true));
    await user.click(
      await screen.findByRole('button', { name: `${mn.users.detail.revoke}: 192.0.2.10` }),
    );
    // Signing a device out is asked first.
    const confirm = within(await screen.findByRole('dialog'));
    await user.click(confirm.getByRole('button', { name: mn.users.detail.revoke }));
    await waitFor(() =>
      expect(calledWith(fetchMock, 'DELETE', `/api/v1/users/7/sessions/${session.id}`)).toBe(true),
    );
  });
});

describe('roles', () => {
  it('keeps system roles read-only and edits a custom role with assignable permissions', async () => {
    let patched: unknown;
    renderApp(
      '/roles',
      signedIn(ADMIN_ME, {
        'GET /api/v1/roles': () => list(ROLES),
        'GET /api/v1/permissions': () => list(CATALOG),
        'PATCH /api/v1/roles/20': async (request) => {
          patched = await request.json();
          return json(ROLES[2]);
        },
      }),
    );
    const user = userEvent.setup();
    // System roles are only read; the custom one is edited from its row.
    expect(await screen.findAllByText(mn.roles.systemBadge)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: `${mn.common.edit}: Ахлах нярав` }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(
      await dialog.findByRole('checkbox', { name: mn.permissions.identity.settings.read }),
    );
    expect(
      dialog.queryByRole('checkbox', { name: mn.permissions.identity.users.manage }),
    ).toBeNull();
    expect(
      dialog.queryByRole('checkbox', { name: mn.permissions.identity.roles.manage }),
    ).toBeNull();
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(patched).toEqual({
        name: 'Ахлах нярав',
        permissions: ['identity.audit.read', 'identity.settings.read'],
      }),
    );
  });
});

describe('settings', () => {
  const vatInForce: Schemas['SettingEntry'] = {
    id: 1,
    key: 'tax.vat_rate_pct',
    value: '10',
    effectiveFrom: '2020-01-01',
    createdBy: 1,
    createdAt: STAMP,
  };
  const vatUpcoming: Schemas['SettingEntry'] = {
    ...vatInForce,
    id: 2,
    value: '12',
    effectiveFrom: '2099-01-01',
  };
  const views: Schemas['SettingView'][] = [
    { key: 'tax.vat_rate_pct', current: '10', entries: [vatUpcoming, vatInForce] },
    { key: 'auth.staff_session_hours', current: 12, entries: [] },
  ];

  it('checks a rate in the form, then adds it from today', async () => {
    let posted: unknown;
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/settings': () => list(views),
      'POST /api/v1/settings': async (request) => {
        posted = await request.json();
        return json({ ...vatInForce, id: 3, effectiveFrom: businessDate() }, 201);
      },
    });
    renderApp('/settings', fetchMock);
    const user = userEvent.setup();
    const card = cardOf(await screen.findByText(mn.settings.keys.tax.vat_rate_pct));
    expect(card.getByText(mn.settings.inForce)).toBeInTheDocument();
    expect(card.getByText(mn.settings.upcoming)).toBeInTheDocument();

    // A new value is typed in a dialog opened from the card.
    await user.click(card.getByRole('button', { name: mn.settings.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.settings.value), '110');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.percent)).toBeInTheDocument();
    expect(posted).toBeUndefined();

    await user.clear(dialog.getByLabelText(mn.settings.value));
    await user.type(dialog.getByLabelText(mn.settings.value), '10');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(posted).toEqual({
        key: 'tax.vat_rate_pct',
        value: '10',
        effectiveFrom: businessDate(),
      }),
    );
  });

  it('names the allowed range of a whole-number setting', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/settings': () =>
        list([{ key: 'credit.payment_term_days', current: null, entries: [] }]),
    });
    renderApp('/settings', fetchMock);
    const user = userEvent.setup();
    const card = cardOf(await screen.findByText(mn.settings.keys.credit.payment_term_days));
    await user.click(card.getByRole('button', { name: mn.settings.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.settings.value), '400');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(
      await dialog.findByText(
        mn.validation.integerRange.replace('{{min}}', '0').replace('{{max}}', '365'),
      ),
    ).toBeInTheDocument();
    expect(calledWith(fetchMock, 'POST', '/api/v1/settings')).toBe(false);
  });

  it('deletes only a value that is not in force yet', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/settings': () => list(views),
      'DELETE /api/v1/settings/2': () => new Response(null, { status: 204 }),
    });
    renderApp('/settings', fetchMock);
    const user = userEvent.setup();
    const card = cardOf(await screen.findByText(mn.settings.keys.tax.vat_rate_pct));
    // Only the upcoming value offers a delete button, and it asks first.
    await user.click(card.getByRole('button', { name: `${mn.common.delete}: 2099-01-01` }));
    expect(card.queryByRole('button', { name: `${mn.common.delete}: 2020-01-01` })).toBeNull();
    const confirm = within(await screen.findByRole('dialog'));
    await user.click(confirm.getByRole('button', { name: mn.common.delete }));
    await waitFor(() => expect(calledWith(fetchMock, 'DELETE', '/api/v1/settings/2')).toBe(true));
  });

  it('shows the company code fixed at installation without a way to change it (ADR-0084 #3)', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/settings': () => list([{ key: 'bto.company_code', current: 'BO', entries: [] }]),
    });
    renderApp('/settings', fetchMock);
    const card = cardOf(await screen.findByText(mn.settings.keys.bto.company_code));
    expect(card.getByText('BO')).toBeInTheDocument();
    expect(card.getByText(mn.settings.locked)).toBeInTheDocument();
    expect(card.queryByRole('button', { name: mn.settings.add })).toBeNull();
  });
});

describe('branches', () => {
  it('validates the e-Barimt branch number and sends an upper-case code', async () => {
    let posted: unknown;
    renderApp(
      '/branches',
      signedIn(ADMIN_ME, {
        'GET /api/v1/branches': () => list(BRANCHES),
        'POST /api/v1/branches': async (request) => {
          posted = await request.json();
          return json({ ...BRANCHES[0], id: 2 }, 201);
        },
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.org.branches.create }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.org.branches.code), 'store-1');
    await user.type(dialog.getByLabelText(mn.org.branches.name), 'Дэлгүүр');
    await user.type(dialog.getByLabelText(mn.org.branches.branchNo), '12');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.branchNo)).toBeInTheDocument();
    expect(posted).toBeUndefined();

    await user.type(dialog.getByLabelText(mn.org.branches.branchNo), '3');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(posted).toEqual({
        code: 'STORE-1',
        name: 'Дэлгүүр',
        branchNo: '123',
        districtCode: null,
        address: null,
      }),
    );
  });
});

describe('audit', () => {
  it('shows entries with Mongolian labels, their details, and filters by entity', async () => {
    const entry: Schemas['AuditEntry'] = {
      id: 11,
      occurredAt: STAMP,
      actorKind: 'STAFF',
      actorId: 1,
      actorUsername: 'admin',
      actorLabel: null,
      action: 'CREATE',
      entity: 'branches',
      entityId: '2',
      before: null,
      after: { name: 'Дэлгүүр' },
      requestId: null,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/audit': (request) =>
        list(new URL(request.url).searchParams.get('entity') === 'roles' ? [] : [entry]),
    });
    const { router } = renderApp('/audit', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.audit.actions.CREATE)).toBeInTheDocument();
    const details = screen.getByRole('button', { name: mn.audit.details });
    await user.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"name": "Дэлгүүр"/)).toBeInTheDocument();

    // The filter lives in the URL; an empty result offers to clear it.
    await user.selectOptions(screen.getByLabelText(mn.audit.entity), 'roles');
    expect(await screen.findByText(mn.audit.empty)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?entity=roles');
    await user.click(screen.getByRole('button', { name: mn.common.clearFilters }));
    expect(await screen.findByText(mn.audit.actions.CREATE)).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });
});
