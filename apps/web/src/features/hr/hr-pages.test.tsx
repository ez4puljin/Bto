import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const TODAY = businessDate();
const STAMP = '2026-10-31T02:00:00.000Z';
const SCHEDULE: Schemas['HrSchedule'] = {
  workStart: '09:00',
  workEnd: '18:00',
  graceMinutes: 10,
  workdays: '1111110',
  updatedAt: STAMP,
};
const HR_USER: Me = {
  ...ADMIN_ME,
  id: 20,
  username: 'hr1',
  fullName: 'Хүний нөөц Оюун',
  permissions: ['hr.attendance.view', 'hr.attendance.manage'],
  roles: [{ id: 9, code: 'HR', name: null, isSystem: true }],
};
const VIEWER: Me = {
  ...HR_USER,
  id: 21,
  username: 'viewer',
  permissions: ['hr.attendance.view'],
  roles: [],
};

const SITE: Schemas['WorkSite'] = {
  id: 1,
  name: 'Төв агуулах',
  lat: '49.634500',
  lng: '100.162300',
  radiusM: 150,
  branchId: 1,
  branchName: 'Мөрөн',
  archivedAt: null,
  updatedAt: STAMP,
};
const employee = (fields: Partial<Schemas['HrEmployee']>): Schemas['HrEmployee'] => ({
  userId: 2,
  fullName: 'Нярав Дорж',
  phone: null,
  status: 'ACTIVE',
  roles: ['WAREHOUSE'],
  tracked: true,
  workStart: null,
  workEnd: null,
  graceMinutes: null,
  workdays: null,
  siteIds: [],
  schedule: SCHEDULE,
  ...fields,
});
const DORJ = employee({});
const SARAA = employee({
  userId: 3,
  fullName: 'Нягтлан Сараа',
  roles: ['ACCOUNTANT'],
  workStart: '10:00',
  workEnd: '19:00',
  graceMinutes: 5,
  workdays: '1111100',
  siteIds: [1],
  schedule: {
    ...SCHEDULE,
    workStart: '10:00',
    workEnd: '19:00',
    graceMinutes: 5,
    workdays: '1111100',
  },
});

const row = (
  fields: Partial<Schemas['AttendanceDashboardRow']>,
): Schemas['AttendanceDashboardRow'] => ({
  userId: 2,
  fullName: 'Нярав Дорж',
  roles: ['WAREHOUSE'],
  schedule: SCHEDULE,
  date: TODAY,
  firstIn: `${TODAY}T00:58:00.000Z`,
  lastOut: null,
  workedMinutes: 455,
  lateMinutes: 0,
  openIn: true,
  status: 'PRESENT',
  siteName: 'Төв агуулах',
  state: 'IN',
  ...fields,
});
const DASHBOARD: Schemas['AttendanceDashboard'] = {
  date: TODAY,
  now: `${TODAY}T06:00:00.000Z`,
  counts: { expected: 3, present: 2, inNow: 1, late: 1, absent: 1, openIn: 0, off: 0 },
  rows: [
    row({}),
    row({
      userId: 3,
      fullName: 'Нягтлан Сараа',
      roles: ['ACCOUNTANT'],
      firstIn: `${TODAY}T02:25:00.000Z`,
      lastOut: `${TODAY}T05:00:00.000Z`,
      workedMinutes: 155,
      lateMinutes: 15,
      openIn: false,
      status: 'LATE',
      state: 'OUT',
    }),
    row({
      userId: 4,
      fullName: 'Жолооч Бат',
      roles: ['DRIVER'],
      firstIn: null,
      workedMinutes: 0,
      openIn: false,
      status: 'ABSENT',
      state: null,
      siteName: null,
    }),
  ],
  trend: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-10-${String(18 + i).padStart(2, '0')}`,
    expected: 3,
    present: 2,
    late: i % 2,
  })),
  month: [
    {
      userId: 3,
      fullName: 'Нягтлан Сараа',
      from: '2026-10-01',
      to: TODAY,
      workdays: 22,
      presentDays: 20,
      lateDays: 4,
      lateMinutes: 62,
      workedMinutes: 9000,
      avgArrivalMinutes: 612,
    },
    {
      userId: 2,
      fullName: 'Нярав Дорж',
      from: '2026-10-01',
      to: TODAY,
      workdays: 26,
      presentDays: 26,
      lateDays: 0,
      lateMinutes: 0,
      workedMinutes: 12000,
      avgArrivalMinutes: 535,
    },
  ],
};

const DAY: Schemas['AttendanceDay'] = {
  userId: 3,
  date: '2026-10-30',
  firstIn: '2026-10-30T02:25:00.000Z',
  lastOut: '2026-10-30T10:05:00.000Z',
  workedMinutes: 460,
  lateMinutes: 15,
  openIn: false,
  status: 'LATE',
  siteName: 'Төв агуулах',
  state: 'OUT',
};
const event = (fields: Partial<Schemas['AttendanceEvent']>): Schemas['AttendanceEvent'] => ({
  id: 100,
  userId: 3,
  kind: 'IN',
  at: '2026-10-30T02:25:00.000Z',
  businessDate: '2026-10-30',
  source: 'APP',
  siteId: 1,
  siteName: 'Төв агуулах',
  lat: '49.634510',
  lng: '100.162310',
  accuracyM: 12,
  distanceM: 8,
  note: null,
  deletedAt: null,
  deleteReason: null,
  ...fields,
});
const EVENTS = [
  event({}),
  event({ id: 101, kind: 'OUT', at: '2026-10-30T10:05:00.000Z', distanceM: 20 }),
  event({
    id: 99,
    kind: 'OUT',
    at: '2026-10-30T04:00:00.000Z',
    source: 'OFFICE',
    siteId: null,
    siteName: null,
    lat: null,
    lng: null,
    accuracyM: null,
    distanceM: null,
    note: 'Андуурсан',
    deletedAt: STAMP,
    deleteReason: 'Буруу цаг',
  }),
];

const routes = (
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/hr/attendance/dashboard': () => json(DASHBOARD),
  'GET /api/v1/hr/attendance/days': () => json({ data: [DAY] }),
  'GET /api/v1/hr/attendance/events': () => json({ data: EVENTS }),
  'POST /api/v1/hr/attendance/events': async (request: Request) => {
    const body = (await request.clone().json()) as Schemas['AttendanceEventRequest'];
    return json(event({ id: 102, ...body, source: 'OFFICE', siteId: null, siteName: null }));
  },
  'GET /api/v1/hr/work-sites': () => json([SITE]),
  'POST /api/v1/hr/work-sites': async (request: Request) => {
    const body = (await request.clone().json()) as Schemas['WorkSiteRequest'];
    return json({ ...SITE, ...body, id: 2, branchName: null });
  },
  'GET /api/v1/hr/schedule': () => json(SCHEDULE),
  'PUT /api/v1/hr/schedule': async (request: Request) => {
    const body = (await request.clone().json()) as Schemas['HrScheduleRequest'];
    return json({ ...body, updatedAt: STAMP });
  },
  'GET /api/v1/hr/employees': () => json([DORJ, SARAA]),
  'PUT /api/v1/hr/employees/2': async (request: Request) => {
    const body = (await request.clone().json()) as Schemas['HrEmployeeRequest'];
    return json(employee(body));
  },
  'GET /api/v1/branches': () =>
    json({
      data: [
        {
          id: 1,
          code: 'MR',
          name: 'Мөрөн',
          branchNo: null,
          districtCode: null,
          address: null,
          status: 'ACTIVE',
          createdAt: STAMP,
          updatedAt: STAMP,
        },
      ],
      nextCursor: null,
    }),
  ...extra,
});

const region = async (name: string) => within(await screen.findByRole('region', { name }));

describe('the «Ирц» menu (ADR-0131)', () => {
  it('lists the three pages for an HR user', async () => {
    renderApp('/hr/attendance', signedIn(HR_USER, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.hrDashboard })).toHaveAttribute(
      'href',
      '/hr/attendance',
    );
    expect(sidebar.getByRole('link', { name: mn.nav.hrDays })).toHaveAttribute(
      'href',
      '/hr/attendance/days',
    );
    expect(sidebar.getByRole('link', { name: mn.nav.hrSetup })).toHaveAttribute(
      'href',
      '/hr/setup',
    );
  });

  it('hides the setup from a viewer', async () => {
    renderApp('/hr/attendance', signedIn(VIEWER, routes()));
    const sidebar = within(await findSidebar());
    expect(await sidebar.findByRole('link', { name: mn.nav.hrDashboard })).toBeInTheDocument();
    expect(sidebar.queryByRole('link', { name: mn.nav.hrSetup })).toBeNull();
  });
});

describe('«Ирцийн самбар»', () => {
  it('shows the tiles, the trend and the day’s rows, absent and late first', async () => {
    renderApp('/hr/attendance', signedIn(HR_USER, routes()));
    const present = await screen.findByRole('region', { name: mn.hr.dashboard.tiles.present });
    expect(present).toHaveTextContent('2 / 3');
    expect(screen.getByRole('region', { name: mn.hr.dashboard.tiles.inNow })).toHaveTextContent(
      '1',
    );
    expect(screen.getByRole('region', { name: mn.hr.dashboard.tiles.late })).toHaveTextContent('1');
    expect(screen.getByRole('region', { name: mn.hr.dashboard.tiles.absent })).toHaveTextContent(
      '1',
    );
    // Today: no «Явсан дараагүй» tile.
    expect(screen.queryByRole('region', { name: mn.hr.dashboard.tiles.openIn })).toBeNull();
    expect(screen.getByRole('figure', { name: mn.hr.dashboard.trend.title })).toBeInTheDocument();

    const list = within(screen.getByRole('region', { name: mn.hr.dashboard.list.title }));
    const rows = list.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Жолооч Бат'),
      expect.stringContaining('Нягтлан Сараа'),
      expect.stringContaining('Нярав Дорж'),
    ]);
    expect(rows[0]).toHaveTextContent(mn.hr.statuses.ABSENT);
    expect(rows[1]).toHaveTextContent(mn.hr.statuses.LATE);
    expect(rows[1]).toHaveTextContent('15 мин');
    expect(rows[2]).toHaveTextContent(mn.hr.inNow);
    expect(rows[2]).toHaveTextContent('7 ц 35 мин');
    expect(rows[2]).toHaveTextContent(mn.roles.system.WAREHOUSE);
    expect(
      list.getByRole('link', {
        name: mn.hr.dashboard.list.open.replace('{{name}}', 'Нярав Дорж'),
      }),
    ).toHaveAttribute('href', '/hr/attendance/days?userId=2');

    // The month card: the latest first, the average arrival as a clock time.
    const month = within(screen.getByRole('region', { name: mn.hr.dashboard.month.title }));
    const monthRows = month.getAllByRole('row').slice(1);
    expect(monthRows[0]).toHaveTextContent('Нягтлан Сараа');
    expect(monthRows[0]).toHaveTextContent('20/22');
    expect(monthRows[0]).toHaveTextContent('10:12');
  });

  it('narrows the rows with the segmented filter', async () => {
    renderApp('/hr/attendance', signedIn(HR_USER, routes()));
    const user = userEvent.setup();
    const list = within(await screen.findByRole('region', { name: mn.hr.dashboard.list.title }));
    await user.click(list.getByRole('tab', { name: mn.hr.dashboard.list.filters.LATE }));
    expect(list.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(list.getByRole('row', { name: /Нягтлан Сараа/ })).toBeInTheDocument();
  });
});

describe('«Ирцийн бүртгэл»', () => {
  it('lists the days and posts an OFFICE correction from the events sheet', async () => {
    const fetchMock = signedIn(HR_USER, routes());
    renderApp('/hr/attendance/days?userId=3', fetchMock);
    const user = userEvent.setup();
    const open = await screen.findByRole('button', {
      name: mn.hr.days.rowMenu
        .replace('{{name}}', 'Нягтлан Сараа')
        .replace('{{date}}', '2026-10-30'),
    });
    const dayRow = open.closest('tr') as HTMLElement;
    expect(dayRow).toHaveTextContent('10:25');
    expect(dayRow).toHaveTextContent('18:05');
    expect(dayRow).toHaveTextContent('7 ц 40 мин');
    expect(dayRow).toHaveTextContent(mn.hr.statuses.LATE);

    await user.click(open);
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText('Нягтлан Сараа · 2026-10-30')).toBeInTheDocument();
    const events = sheet.getAllByRole('row').slice(1);
    expect(events).toHaveLength(3);
    // The struck-out one keeps its reason and has no «Хасах».
    expect(events[2]).toHaveTextContent(
      mn.hr.days.sheet.struckReason.replace('{{reason}}', 'Буруу цаг'),
    );
    expect(within(events[2] as HTMLElement).queryByRole('button')).toBeNull();
    expect(
      within(events[0] as HTMLElement).getByRole('button', {
        name: mn.hr.days.sheet.strikeFor
          .replace('{{time}}', '10:25')
          .replace('{{kind}}', mn.hr.kinds.IN),
      }),
    ).toBeInTheDocument();

    await user.click(sheet.getByRole('button', { name: mn.hr.days.sheet.add }));
    const form = within(await screen.findByRole('dialog', { name: mn.hr.days.sheet.add }));
    await user.selectOptions(form.getByLabelText(mn.hr.days.sheet.kind), 'OUT');
    const time = form.getByLabelText(mn.hr.days.sheet.time);
    await user.clear(time);
    await user.type(time, '12:30');
    await user.click(form.getByRole('button', { name: mn.common.create }));
    expect(await form.findByText(mn.validation.required)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/hr/attendance/events')).toHaveLength(0);
    await user.type(form.getByLabelText(mn.hr.days.sheet.note), 'Үдийн цайнд гарсан');
    await user.click(form.getByRole('button', { name: mn.common.create }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/hr/attendance/events')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/attendance/events')[0])).toEqual({
      userId: 3,
      kind: 'OUT',
      at: '2026-10-30T04:30:00.000Z',
      note: 'Үдийн цайнд гарсан',
    });
    // The sheet is modal: the toast outside it is aria-hidden, so it is found by its text.
    expect(await screen.findByText(mn.hr.days.sheet.added)).toBeInTheDocument();
  });

  it('gives a viewer the events without the corrections', async () => {
    renderApp('/hr/attendance/days?userId=3', signedIn(VIEWER, routes()));
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: mn.hr.days.rowMenu
          .replace('{{name}}', 'Нягтлан Сараа')
          .replace('{{date}}', '2026-10-30'),
      }),
    );
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findAllByRole('row')).toHaveLength(4);
    expect(sheet.queryByRole('button', { name: mn.hr.days.sheet.add })).toBeNull();
    expect(sheet.queryByRole('button', { name: /^Хасах:/ })).toBeNull();
  });
});

describe('«Ирцийн тохиргоо»', () => {
  it('saves the schedule with the weekday flags', async () => {
    const fetchMock = signedIn(HR_USER, routes());
    renderApp('/hr/setup', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.hr.setup.schedule.title);
    const save = await card.findByRole('button', { name: mn.common.save });
    expect(save).toBeDisabled();
    const grace = card.getByLabelText(mn.hr.setup.schedule.grace);
    await user.clear(grace);
    await user.type(grace, '15');
    await user.click(card.getByLabelText(mn.hr.weekdays.d5));
    await user.click(save);
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/schedule')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/schedule')[0])).toEqual({
      workStart: '09:00',
      workEnd: '18:00',
      graceMinutes: 15,
      workdays: '1111100',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.hr.setup.schedule.saved);
  });

  it('creates a site from a pasted coordinates pair', async () => {
    const fetchMock = signedIn(HR_USER, routes());
    renderApp('/hr/setup', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.hr.setup.sites.title);
    expect(await card.findByText('Төв агуулах')).toBeInTheDocument();
    expect(card.getByRole('link', { name: '49.634500, 100.162300' })).toHaveAttribute(
      'href',
      expect.stringContaining('49.634500,100.162300'),
    );
    await user.click(card.getByRole('button', { name: mn.hr.setup.sites.create }));
    const dialog = within(await screen.findByRole('dialog', { name: mn.hr.setup.sites.create }));
    await user.type(dialog.getByLabelText(mn.hr.setup.sites.name), 'Боломж бөөний төв');
    await user.type(dialog.getByLabelText(mn.hr.setup.sites.coordinates), 'not a point');
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    expect(await dialog.findByText(mn.validation.gpsFormat)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText(mn.hr.setup.sites.coordinates));
    await user.type(dialog.getByLabelText(mn.hr.setup.sites.coordinates), '49.6345, 100.1623');
    await user.selectOptions(dialog.getByLabelText(mn.hr.setup.sites.branch), '1');
    await user.click(dialog.getByRole('button', { name: mn.common.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/hr/work-sites')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/hr/work-sites')[0])).toEqual({
      name: 'Боломж бөөний төв',
      lat: '49.6345',
      lng: '100.1623',
      radiusM: 150,
      branchId: 1,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.hr.setup.sites.created);
  });

  it('switches an employee’s tracking at once and shows their own hours', async () => {
    const fetchMock = signedIn(HR_USER, routes());
    renderApp('/hr/setup', fetchMock);
    const user = userEvent.setup();
    const card = await region(mn.hr.setup.employees.title);
    await card.findByText('Нягтлан Сараа');
    const rows = card.getAllByRole('row');
    const saraa = rows.find((r) => r.textContent?.includes('Нягтлан Сараа')) as HTMLElement;
    expect(saraa).toHaveTextContent('10:00–19:00');
    expect(saraa).toHaveTextContent('Төв агуулах');
    const dorj = rows.find((r) => r.textContent?.includes('Нярав Дорж')) as HTMLElement;
    expect(dorj).toHaveTextContent(mn.hr.setup.employees.company);
    expect(dorj).toHaveTextContent(mn.hr.anySite);
    await user.click(
      within(dorj).getByRole('switch', {
        name: mn.hr.setup.employees.trackedFor.replace('{{name}}', 'Нярав Дорж'),
      }),
    );
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/hr/employees/2')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/hr/employees/2')[0])).toEqual({
      tracked: false,
      workStart: null,
      workEnd: null,
      graceMinutes: null,
      workdays: null,
      siteIds: [],
    });
  });

  it('reads only to a user with hr.attendance.view', async () => {
    renderApp('/hr/setup', signedIn(VIEWER, routes()));
    const schedule = await region(mn.hr.setup.schedule.title);
    expect(await schedule.findByLabelText(mn.hr.setup.schedule.grace)).toBeDisabled();
    expect(schedule.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(screen.getAllByText(mn.hr.readOnly).length).toBeGreaterThan(0);
    const sites = await region(mn.hr.setup.sites.title);
    expect(sites.queryByRole('button', { name: mn.hr.setup.sites.create })).toBeNull();
    const employees = await region(mn.hr.setup.employees.title);
    expect(
      await employees.findByRole('switch', {
        name: mn.hr.setup.employees.trackedFor.replace('{{name}}', 'Нярав Дорж'),
      }),
    ).toBeDisabled();
    expect(employees.queryByRole('button', { name: /^Засах:/ })).toBeNull();
  });
});
