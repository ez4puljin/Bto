import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const STAMP = '2026-11-01T02:00:00.000Z';
const HR_ONLY: Me = {
  ...ADMIN_ME,
  id: 20,
  username: 'hr1',
  fullName: 'Хүний нөөц Оюун',
  permissions: ['hr.attendance.view', 'hr.attendance.manage'],
  roles: [{ id: 9, code: 'HR', name: null, isSystem: true }],
};
const person = (fields: Partial<Schemas['HrStaff']>): Schemas['HrStaff'] => ({
  userId: 7,
  fullName: 'Дорж Бат',
  firstName: 'Бат',
  lastName: 'Дорж',
  phone: '+97699112233',
  status: 'ACTIVE',
  roles: ['WAREHOUSE'],
  positionId: null,
  positionSalaryEffectiveMonth: null,
  positionBaseSalary: null,
  positionNextBaseSalary: null,
  positionNextEffectiveMonth: null,
  position: 'Нярав',
  divisionId: null,
  divisionName: null,
  employmentType: 'PERMANENT',
  gender: null,
  employedOn: null,
  leftOn: null,
  leftReason: null,
  photoUrl: null,
  scheduleId: null,
  scheduleName: null,
  tracked: true,
  lastLoginAt: null,
  lockedUntil: null,
  passwordSet: true,
  birthDate: null,
  education: null,
  maritalStatus: null,
  district: null,
  jobLevel: null,
  leftReasonKind: null,
  children: [],
  ...fields,
});
const WORKING = person({});
/** Closed on the account with no date from HR: still one who left. */
const CLOSED = person({
  userId: 8,
  fullName: 'Нямаа Сүрэн',
  firstName: 'Сүрэн',
  lastName: 'Нямаа',
  phone: '+97699112244',
  status: 'DISABLED',
  roles: [],
});
const NO_ROLES = person({ userId: 9, fullName: 'Болд Тэмүүлэн', roles: [] });
const ACCOUNT: Schemas['UserDetail'] = {
  id: 7,
  username: 'p99112233',
  fullName: WORKING.fullName,
  status: 'ACTIVE',
  roleIds: [4],
  lastLoginAt: null,
  lockedUntil: null,
  phone: WORKING.phone,
  passwordSet: true,
  failedLoginCount: 0,
  scopes: { warehouseIds: [], branchIds: [] },
  createdAt: STAMP,
  updatedAt: STAMP,
};
const ROLES: Schemas['Role'][] = [
  {
    id: 4,
    code: 'WAREHOUSE',
    name: null,
    isSystem: true,
    permissions: [],
    customized: false,
    userCount: 1,
  },
];
const list = <T,>(data: T[]) => json({ data, nextCursor: null });
const ROUTES = {
  'GET /api/v1/hr/staff': () => json([WORKING, CLOSED, NO_ROLES]),
  'GET /api/v1/hr/divisions': () => json([]),
  'GET /api/v1/hr/positions': () =>
    json([
      {
        id: 1,
        name: 'Warehouse',
        roleIds: [4],
        roles: ROLES,
        baseSalary: '1000000.00',
        nextBaseSalary: null,
        nextEffectiveMonth: null,
        salaryHistory: [],
        archivedAt: null,
        employeeCount: 1,
        grantsAdmin: false,
        canAssign: true,
      },
    ]),
  'GET /api/v1/hr/schedules': () => json([]),
  'GET /api/v1/hr/requests': () => json([]),
  'GET /api/v1/roles': () => list(ROLES),
  'GET /api/v1/branches': () => list([]),
  'GET /api/v1/warehouses': () => list([]),
  'GET /api/v1/users/7': () => json(ACCOUNT),
  'GET /api/v1/users/7/sessions': () => list([]),
};

describe('«Ажилтны бүртгэл», the one staff list (ADR-0145)', () => {
  it('keeps assigned roles derived while allowing per-user scopes to be saved', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'GET /api/v1/hr/staff': () => json([person({ positionId: 1, position: 'Warehouse' })]),
      'PATCH /api/v1/users/7': () => json(ACCOUNT),
    });
    renderApp('/hr/staff/7', fetchMock);
    const user = userEvent.setup();
    const editLabel = mn.common.editRecord.replace('{{name}}', mn.users.detail.access);
    await screen.findByRole('button', { name: editLabel });
    const access = within(screen.getByRole('region', { name: mn.users.detail.access }));
    expect(access.getByRole('link', { name: mn.hr.positions.title })).toHaveAttribute(
      'href',
      '/hr/positions',
    );
    await user.click(access.getByRole('button', { name: editLabel }));
    expect(access.getByText(mn.hr.positions.rolesLocked)).toBeInTheDocument();
    expect(access.queryByRole('checkbox', { name: mn.roles.system.WAREHOUSE })).toBeNull();
    await user.click(access.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/users/7')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/users/7')[0])).toEqual({
      scopes: { warehouseIds: [], branchIds: [] },
    });
  });

  it('moves a closed account to those who left, whatever closed it', async () => {
    const user = userEvent.setup();
    renderApp('/hr/staff', signedIn(ADMIN_ME, ROUTES));
    expect(await screen.findByText('Дорж Бат')).toBeInTheDocument();
    expect(screen.queryByText('Нямаа Сүрэн')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: mn.hr.staff.showLeft }));
    expect(await screen.findByText('Нямаа Сүрэн')).toBeInTheDocument();
    expect(screen.queryByText('Дорж Бат')).toBeNull();
  });

  it('leads the old addresses to the list and the employee', async () => {
    const { router } = renderApp('/users/7', signedIn(ADMIN_ME, ROUTES));
    await waitFor(() => expect(router.state.location.pathname).toBe('/hr/staff/7'));
    // Poll the heading text directly: computing accessible names across the full sidebar
    // on every retry can starve the redirected page's fetch/render on a busy runner.
    const heading = await screen.findByText('Дорж Бат', { selector: 'h1' });
    expect(heading).toHaveRole('heading');
    expect(heading).toBeVisible();
    expect(heading).toHaveAccessibleName('Дорж Бат');
  });

  it('asks a first password when registering, then opens the employee', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'POST /api/v1/hr/staff': () => json(WORKING, 201),
    });
    const { router } = renderApp('/hr/staff?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.lastName), 'Дорж');
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.firstName), 'Бат');
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.phone), '99112233');
    await user.selectOptions(dialog.getByLabelText(mn.hr.staff.dialog.position), '1');
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    expect(calls(fetchMock, 'POST', '/api/v1/hr/staff')).toHaveLength(0);
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.passwordNew), 'Tsagaan-2026');
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/hr/staff/7'));
    const [post] = calls(fetchMock, 'POST', '/api/v1/hr/staff');
    expect(await bodyOf(post)).toMatchObject({
      phone: '99112233',
      password: 'Tsagaan-2026',
      positionId: 1,
    });
  });

  it('resets a password directly and keeps the rights on one page', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...ROUTES,
      'PUT /api/v1/hr/staff/7/password': () => json(WORKING),
    });
    renderApp('/hr/staff/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Дорж Бат' })).toBeInTheDocument();
    // The rights, read from the account, on the employee's own page.
    expect(await screen.findByText(mn.roles.system.WAREHOUSE)).toBeInTheDocument();
    expect(screen.getByText(mn.users.detail.sessions)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.hr.staff.reset.button }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.hr.staff.reset.password), 'short');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/password')).toHaveLength(0);
    await user.clear(dialog.getByLabelText(mn.hr.staff.reset.password));
    await user.type(dialog.getByLabelText(mn.hr.staff.reset.password), 'Shine-nuuts-2026');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/password')).toHaveLength(1),
    );
    const [put] = calls(fetchMock, 'PUT', '/api/v1/hr/staff/7/password');
    expect(await bodyOf(put)).toEqual({ password: 'Shine-nuuts-2026' });
  });

  it.each([HR_ONLY, { ...ADMIN_ME, id: 7 }])(
    'keeps position disabled for HR and ADMIN self edits',
    async (actor) => {
      const staff = person({ positionId: 1, position: 'Warehouse' });
      const fetchMock = signedIn(actor, {
        ...ROUTES,
        'GET /api/v1/hr/staff': () => json([staff]),
        'PUT /api/v1/hr/staff/7': () => json(staff),
      });
      renderApp('/hr/staff/7', fetchMock);
      const user = userEvent.setup();
      const editLabel = mn.common.editRecord.replace('{{name}}', mn.hr.staff.dialog.editTitle);
      await user.click(await screen.findByRole('button', { name: editLabel }));
      const card = within(screen.getByRole('region', { name: mn.hr.staff.dialog.editTitle }));
      expect(card.getByLabelText(mn.hr.staff.dialog.position)).toBeDisabled();
      await user.click(card.getByRole('button', { name: mn.common.save }));
      await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7')).toHaveLength(1));
      expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/staff/7')[0])).not.toHaveProperty(
        'positionId',
      );
    },
  );

  it('lets HR reset only an account without roles and read the roles without the users API', async () => {
    const fetchMock = signedIn(HR_ONLY, ROUTES);
    renderApp('/hr/staff/7', fetchMock);
    expect(await screen.findByRole('heading', { name: 'Дорж Бат' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.hr.staff.reset.button })).toBeNull();
    expect(screen.getByText(mn.roles.system.WAREHOUSE)).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/users/7')).toHaveLength(0);

    renderApp('/hr/staff/9', signedIn(HR_ONLY, ROUTES));
    expect(
      await screen.findByRole('button', { name: mn.hr.staff.reset.button }),
    ).toBeInTheDocument();
  });
});
