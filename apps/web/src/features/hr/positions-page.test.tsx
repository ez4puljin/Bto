import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const ROLE: Schemas['Role'] = {
  id: 4,
  code: 'WAREHOUSE',
  name: null,
  isSystem: true,
  permissions: ['inventory.receipts.manage'],
  customized: false,
  userCount: 1,
};
const POSITION: Schemas['HrPosition'] = {
  id: 1,
  name: 'Warehouse',
  roleIds: [4],
  roles: [ROLE],
  baseSalary: '1000000.00',
  nextBaseSalary: '1200000.00',
  nextEffectiveMonth: '2026-12',
  salaryHistory: [
    { effectiveMonth: '2026-11', baseSalary: '1000000.00' },
    { effectiveMonth: '2026-12', baseSalary: '1200000.00' },
  ],
  archivedAt: null,
  employeeCount: 2,
  grantsAdmin: false,
  canAssign: true,
};
const HR: Me = {
  ...ADMIN_ME,
  id: 20,
  roles: [],
  permissions: ['hr.attendance.view', 'hr.attendance.manage'],
};
const routes = {
  'GET /api/v1/hr/positions': () => json([POSITION]),
  'GET /api/v1/roles': () => json({ data: [ROLE], nextCursor: null }),
};

describe('position salary and access catalog', () => {
  it('creates a position with existing roles and archives it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'POST /api/v1/hr/positions': () => json(POSITION, 201),
      'PUT /api/v1/hr/positions/1/archived': () =>
        json({ ...POSITION, archivedAt: '2026-11-22T00:00:00.000Z' }),
    });
    renderApp('/hr/positions?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.hr.positions.name), 'New warehouse');
    await user.type(dialog.getByLabelText(mn.hr.positions.salary), '1000000');
    await user.click(await dialog.findByRole('checkbox', { name: mn.roles.system.WAREHOUSE }));
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/positions')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/positions')[0])).toEqual({
      name: 'New warehouse',
      baseSalary: '1000000',
      roleIds: [4],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(
      screen.getByRole('button', {
        name: mn.hr.positions.archiveFor.replace('{{name}}', POSITION.name),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/hr/positions/1/archived')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/positions/1/archived')[0])).toEqual({
      archived: true,
    });
  });

  it('lets ADMIN reuse role IDs and schedules an edited salary for the next month', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'PUT /api/v1/hr/positions/1': () => json(POSITION),
    });
    renderApp('/hr/positions', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('1,000,000')).toBeInTheDocument();
    expect(screen.getByText('1,200,000')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: mn.hr.positions.editFor.replace('{{name}}', POSITION.name),
      }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(mn.hr.positions.nextSalary)).toHaveValue('1,200,000');
    expect(await dialog.findByRole('checkbox', { name: mn.roles.system.WAREHOUSE })).toBeChecked();
    await user.clear(dialog.getByLabelText(mn.hr.positions.nextSalary));
    await user.type(dialog.getByLabelText(mn.hr.positions.nextSalary), '1300000');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/positions/1')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/positions/1')[0])).toEqual({
      name: POSITION.name,
      baseSalary: '1300000',
      roleIds: [4],
    });
  });

  it('keeps HR readers read-only even when create is requested in the URL', async () => {
    renderApp(
      '/hr/positions?new=1',
      signedIn(HR, {
        ...routes,
        'GET /api/v1/hr/positions': () =>
          json([
            {
              ...POSITION,
              baseSalary: null,
              nextBaseSalary: null,
              nextEffectiveMonth: null,
              salaryHistory: [],
            },
          ]),
      }),
    );
    expect(await screen.findByText(POSITION.name)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.hr.positions.create })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('1,000,000')).toBeNull();
  });

  it('does not expose staff registration to HR even through the create URL', async () => {
    const fetchMock = signedIn(HR, {
      ...routes,
      'GET /api/v1/hr/staff': () => json([]),
      'GET /api/v1/hr/divisions': () => json([]),
      'GET /api/v1/hr/schedules': () => json([]),
      'GET /api/v1/hr/requests': () => json([]),
    });
    renderApp('/hr/staff?new=1', fetchMock);
    await waitFor(() => expect(calls(fetchMock, 'GET', '/api/v1/hr/staff')).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: mn.hr.staff.create })).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/v1/hr/staff')).toHaveLength(0);
  });

  it('requires a position to register and excludes positions the caller cannot assign', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'GET /api/v1/hr/staff': () => json([]),
      'GET /api/v1/hr/divisions': () => json([]),
      'GET /api/v1/hr/schedules': () => json([]),
      'GET /api/v1/hr/requests': () => json([]),
      'GET /api/v1/hr/positions': () =>
        json([
          POSITION,
          { ...POSITION, id: 2, name: 'Admin only', grantsAdmin: true, canAssign: false },
        ]),
    });
    renderApp('/hr/staff?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.lastName), 'Last');
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.firstName), 'First');
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.phone), '99112233');
    await user.type(dialog.getByLabelText(mn.hr.staff.dialog.passwordNew), 'Password-2026');
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    expect(calls(fetchMock, 'POST', '/api/v1/hr/staff')).toHaveLength(0);
    expect(dialog.getByLabelText(mn.hr.staff.dialog.position)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(dialog.queryByRole('option', { name: 'Admin only' })).toBeNull();
    await user.selectOptions(dialog.getByLabelText(mn.hr.staff.dialog.position), '1');
    expect(
      dialog.getByText(mn.hr.positions.currentAmount.replace('{{amount}}', '1,000,000')),
    ).toBeInTheDocument();
  });

  it('makes assigned payroll salary read-only while saving KPI and insurance changes', async () => {
    const terms: Schemas['PayrollTerms'] = {
      userId: 7,
      fullName: 'Assigned employee',
      positionId: 1,
      positionSalaryEffectiveMonth: '2026-11',
      position: POSITION.name,
      divisionId: null,
      divisionName: null,
      left: false,
      hasTerms: true,
      baseSalary: '1000000.00',
      nextBaseSalary: '1200000.00',
      nextEffectiveMonth: '2026-12',
      paysSocialInsurance: true,
      templateId: null,
      templateName: null,
      items: [],
      kpiTotal: '0.00',
      active: true,
      updatedAt: null,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/payroll/terms': () => json([terms]),
      'GET /api/v1/hr/divisions': () => json([]),
      'GET /api/v1/payroll/templates': () => json([]),
      'PUT /api/v1/payroll/terms/7': () => json(terms),
    });
    renderApp('/hr/payroll/terms?user=7', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByRole('textbox', { name: mn.payroll.web.terms.salary })).toBeNull();
    expect(dialog.getByText('1,000,000')).toBeInTheDocument();
    await user.click(dialog.getByRole('switch', { name: mn.payroll.web.terms.insured }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/7')).toHaveLength(1));
    const body = await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/7')[0]);
    expect(body).toMatchObject({ paysSocialInsurance: false, active: true, items: [] });
    expect(body).not.toHaveProperty('baseSalary');
  });
});
