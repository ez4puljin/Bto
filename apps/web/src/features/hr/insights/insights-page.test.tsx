import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { json, renderApp, signedIn } from '@/test/render-app';
import { clampAttendanceRange, escapeHtml, formatHours } from './insights-format';

type Schemas = components['schemas'];
const text = mn.hr.insights;

const COUNTS = (entries: Record<string, number>) =>
  Object.entries(entries).map(([key, count]) => ({ key, count }));

const WORKFORCE: Schemas['HrWorkforceInsights'] = {
  from: '2026-11-01',
  to: '2026-11-05',
  total: 20,
  totalBefore: 18,
  joined: 3,
  left: 1,
  joinedBefore: 1,
  leftBefore: 1,
  averageAge: '34.5',
  averageAgeBefore: '34.0',
  averageTenure: '2.5',
  averageTenureBefore: null,
  matrix: [
    {
      division: 'Агуулах',
      levels: COUNTS({ EXECUTIVE: 0, MANAGEMENT: 1, SENIOR: 2, MID: 5, ENTRY: 4, UNKNOWN: 0 }),
      total: 12,
    },
    {
      division: 'UNKNOWN',
      levels: COUNTS({ EXECUTIVE: 0, MANAGEMENT: 0, SENIOR: 1, MID: 3, ENTRY: 4, UNKNOWN: 0 }),
      total: 8,
    },
  ],
  tenure: COUNTS({ '0-6m': 4, '6m-1y': 1, '1-2y': 5, '2-3y': 5, '3y+': 5, UNKNOWN: 0 }),
  education: COUNTS({ UNKNOWN: 6, SECONDARY: 4, BACHELOR: 10 }),
  ageGender: [
    { key: '18-25', male: 3, female: 1, unknown: 0 },
    { key: '26-33', male: 5, female: 4, unknown: 1 },
    { key: 'UNKNOWN', male: 0, female: 0, unknown: 0 },
  ],
  genders: COUNTS({ MALE: 12, FEMALE: 7, UNKNOWN: 1 }),
  districts: COUNTS({ Мөрөн: 13, Сүхбаатар: 2, UNKNOWN: 5 }),
  marital: COUNTS({ SINGLE: 5, MARRIED: 11, DIVORCED: 0, WIDOWED: 0, UNKNOWN: 4 }),
  children: [
    { key: '0-2', male: 2, female: 1, unknown: 0 },
    { key: '3-5', male: 0, female: 3, unknown: 0 },
    { key: '6-10', male: 1, female: 0, unknown: 0 },
    { key: '11-15', male: 0, female: 0, unknown: 0 },
    { key: '16+', male: 0, female: 0, unknown: 0 },
  ],
  childrenTotal: 7,
  employmentTypes: COUNTS({ PERMANENT: 20 }),
  movement: Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    joined: index === 10 ? 3 : 0,
    left: index === 10 ? 1 : 0,
  })),
  leftReasons: COUNTS({ PERSONAL: 1 }),
  missing: { birthDate: 4, gender: 1, education: 6, district: 5, level: 0 },
};

const ATTENDANCE: Schemas['HrAttendanceInsights'] = {
  from: '2026-11-01',
  to: '2026-11-05',
  plannedMinutes: 4800,
  workedMinutes: 4200,
  performance: '87.5',
  performanceBefore: null,
  averageArrival: '08:52',
  averageDeparture: '18:03',
  averageLateMinutes: 14,
  averageEarlyMinutes: 9,
  absentDays: 2,
  lateDays: 6,
  divisions: [
    { division: 'Агуулах', plannedMinutes: 2400, workedMinutes: 2300, performance: '95.8' },
    { division: 'UNKNOWN', plannedMinutes: 2400, workedMinutes: 1900, performance: '79.2' },
  ],
  employees: [
    {
      userId: 2,
      fullName: 'Дорж Бат',
      photoUrl: null,
      division: 'Агуулах',
      plannedMinutes: 2400,
      workedMinutes: 2300,
      lateMinutes: 10,
      absentDays: 0,
      performance: '95.8',
    },
    {
      userId: 3,
      fullName: 'Сараа Цэцэг',
      photoUrl: null,
      division: null,
      plannedMinutes: 2400,
      workedMinutes: 1900,
      lateMinutes: 40,
      absentDays: 2,
      performance: '79.2',
    },
  ],
  trend: [
    { month: '2026-10', plannedMinutes: 0, workedMinutes: 0, performance: null },
    { month: '2026-11', plannedMinutes: 4800, workedMinutes: 4200, performance: '87.5' },
  ],
};

const REQUESTS: Schemas['HrRequestInsights'] = {
  year: 2026,
  total: 9,
  minutes: 960,
  types: [
    { typeId: 1, name: 'Чөлөө', color: '#0d9488', count: 6, days: 8 },
    { typeId: 2, name: 'Томилолт', color: '#7c3aed', count: 3, days: 4 },
  ],
  employees: [{ userId: 2, fullName: 'Дорж Бат', photoUrl: null, count: 5 }],
  months: Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    count: index === 10 ? 9 : 0,
  })),
  statuses: COUNTS({ APPROVED: 9, PENDING: 2, REJECTED: 1, CANCELLED: 0 }),
};

const CALENDAR: Schemas['HrCalendarItem'][] = [
  {
    date: '2026-11-12',
    kind: 'BIRTHDAY',
    title: 'Сараа Цэцэг',
    note: null,
    eventId: null,
    toDate: null,
    userId: 3,
    photoUrl: null,
    years: null,
  },
  {
    date: '2026-11-20',
    kind: 'ANNIVERSARY',
    title: 'Дорж Бат',
    note: null,
    eventId: null,
    toDate: null,
    userId: 2,
    photoUrl: null,
    years: 3,
  },
];

const api = (overrides: Partial<Record<string, () => Response>> = {}) => {
  const routes: Record<string, (request: Request) => Response> = {
    'GET /api/v1/hr/insights/workforce': () => json(WORKFORCE),
    'GET /api/v1/hr/insights/attendance': () => json(ATTENDANCE),
    'GET /api/v1/hr/insights/requests': () => json(REQUESTS),
    'GET /api/v1/hr/calendar': () => json(CALENDAR),
  };
  for (const [key, value] of Object.entries(overrides)) if (value) routes[key] = value;
  return signedIn(undefined, routes);
};

const card = (name: string) => screen.findByRole('region', { name });
const rowOf = (region: HTMLElement, first: string) => {
  const cell = within(region).getByRole('cell', { name: first });
  return within(cell.closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((node) => node.textContent);
};

describe('the HR dashboard', () => {
  it('shows the workforce: tiles, the matrix, bars, rings and what is unfilled', async () => {
    renderApp('/hr/insights', api());

    const total = await screen.findByRole('region', { name: text.tiles.total });
    expect(total).toHaveTextContent('20');
    expect(total).toHaveTextContent(text.delta.up.replace('{{value}}', '2'));
    expect(screen.getByRole('region', { name: text.tiles.averageAge })).toHaveTextContent('34.5');
    expect(screen.getByRole('region', { name: text.tiles.averageTenure })).toHaveTextContent(
      text.delta.none,
    );

    const matrix = await card(text.matrix.title);
    expect(rowOf(matrix, 'Агуулах')).toEqual(['Агуулах', '0', '1', '2', '5', '4', '12']);
    expect(rowOf(matrix, text.unknown)).toEqual([text.unknown, '0', '0', '1', '3', '4', '8']);
    expect(matrix).toHaveTextContent(
      text.matrix.finding
        .replace('{{division}}', 'Агуулах')
        .replace('{{count}}', '12')
        .replace('{{percent}}', '60'),
    );

    const tenure = await card(text.tenure.title);
    expect(rowOf(tenure, text.tenure['0-6m'])).toEqual([text.tenure['0-6m'], '4', '20%']);
    expect(tenure).toHaveTextContent(text.tenure.finding.replace('{{percent}}', '25'));
    expect(tenure).toHaveTextContent(text.totalPeople.replace('{{total}}', '20'));

    const education = await card(text.education.title);
    expect(rowOf(education, text.education.BACHELOR)).toEqual([
      text.education.BACHELOR,
      '10',
      '50%',
    ]);
    expect(within(education).getByRole('cell', { name: text.unknown })).toBeInTheDocument();

    const ages = await card(text.ageGender.title);
    expect(rowOf(ages, text.ageBands['26-33'])).toEqual([text.ageBands['26-33'], '5', '4', '1']);

    const genders = await card(text.genders.title);
    expect(rowOf(genders, text.genders.MALE)).toEqual([text.genders.MALE, '12', '60%']);

    const districts = await card(text.districts.title);
    expect(rowOf(districts, 'Мөрөн')).toEqual(['Мөрөн', '13', '65%']);

    const marital = await card(text.marital.title);
    expect(rowOf(marital, text.marital.MARRIED)).toEqual([text.marital.MARRIED, '11', '55%']);
    expect(within(marital).queryByRole('cell', { name: text.marital.WIDOWED })).toBeNull();

    const children = await card(text.children.title);
    expect(rowOf(children, text.childBands['3-5'])).toEqual([text.childBands['3-5'], '0', '3']);

    const movement = await card(text.movement.title);
    expect(rowOf(movement, '11-р сар')).toEqual(['11-р сар', '3', '1']);

    const reasons = await card(text.leftReasons.title);
    expect(rowOf(reasons, text.leftReasons.PERSONAL)).toEqual([
      text.leftReasons.PERSONAL,
      '1',
      '100%',
    ]);

    const missing = await card(text.missing.title);
    expect(missing).toHaveTextContent(text.missing.education);
    expect(missing).not.toHaveTextContent(text.missing.level);
    expect(within(missing).getByRole('link', { name: text.missing.open })).toHaveAttribute(
      'href',
      '/hr/staff',
    );

    const birthdays = await card(text.birthdays.title);
    expect(await within(birthdays).findByText('Сараа Цэцэг')).toBeInTheDocument();
    expect(within(birthdays).queryByText('Дорж Бат')).toBeNull();
    const anniversaries = await card(text.anniversaries.title);
    expect(await within(anniversaries).findByText('Дорж Бат')).toBeInTheDocument();
    expect(anniversaries).toHaveTextContent(text.anniversaries.line.replace('{{years}}', '3'));
  });

  it('shows an empty state instead of a blank chart', async () => {
    renderApp(
      '/hr/insights',
      api({
        'GET /api/v1/hr/insights/workforce': () =>
          json({ ...WORKFORCE, leftReasons: [], childrenTotal: 0 }),
      }),
    );
    expect(await card(text.leftReasons.title)).toHaveTextContent(text.leftReasons.empty);
    expect(await card(text.children.title)).toHaveTextContent(text.empty.children);
  });

  it('moves between the tabs in the URL and reads each once it opens', async () => {
    const user = userEvent.setup();
    const fetchMock = api();
    const { router } = renderApp('/hr/insights', fetchMock);
    await card(text.matrix.title);
    const opened = () => fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname);
    expect(opened()).not.toContain('/api/v1/hr/insights/attendance');

    await user.click(screen.getByRole('tab', { name: text.tabs.attendance }));
    await card(text.attendance.performance);
    expect(router.state.location.search).toContain('tab=attendance');
    expect(opened()).toContain('/api/v1/hr/insights/attendance');

    await user.click(screen.getByRole('tab', { name: text.tabs.requests }));
    await card(text.requests.types);
    expect(router.state.location.search).toContain('tab=requests');
  });

  it('shows attendance: performance, tiles, leaders, the list with its search, the trend', async () => {
    const user = userEvent.setup();
    renderApp('/hr/insights?tab=attendance', api());

    const gauge = await card(text.attendance.performance);
    expect(within(gauge).getByRole('cell', { name: '87.5%' })).toBeInTheDocument();
    expect(within(gauge).getByRole('cell', { name: '70' })).toBeInTheDocument();
    expect(within(gauge).getByRole('cell', { name: '80' })).toBeInTheDocument();
    expect(screen.getByText(/2026-11-04/)).toBeInTheDocument();

    expect(screen.getByRole('region', { name: text.attendance.arrival })).toHaveTextContent(
      '08:52',
    );
    expect(screen.getByRole('region', { name: text.attendance.late })).toHaveTextContent('14');

    const divisions = await card(text.attendance.divisions);
    expect(rowOf(divisions, 'Агуулах')[1]).toBe('95.8%');
    expect(rowOf(divisions, text.unknown)[1]).toBe('79.2%');

    const best = await card(text.attendance.best);
    expect(within(best).getByText('Дорж Бат')).toBeInTheDocument();
    const watch = await card(text.attendance.watch);
    expect(within(watch).queryByText('Дорж Бат')).toBeNull();

    const list = await card(text.attendance.employees);
    expect(
      within(list).getByRole('progressbar', {
        name: text.attendance.barOf.replace('{{name}}', 'Дорж Бат'),
      }),
    ).toHaveAttribute('aria-valuenow', '96');
    await user.type(within(list).getByRole('searchbox', { name: text.attendance.search }), 'сараа');
    await waitFor(() => expect(within(list).queryByText('Дорж Бат')).toBeNull());
    expect(within(list).getByText('Сараа Цэцэг')).toBeInTheDocument();

    const trend = await card(text.attendance.trend);
    expect(rowOf(trend, '11-р сар')).toEqual(['11-р сар', '87.5%']);
  });

  it('asks attendance for at most 62 days', async () => {
    const fetchMock = api();
    renderApp('/hr/insights?tab=attendance&from=2026-01-01&to=2026-11-01', fetchMock);
    await card(text.attendance.performance);
    const request = fetchMock.mock.calls
      .map(([call]) => new URL(call.url))
      .find((url) => url.pathname === '/api/v1/hr/insights/attendance');
    expect(request?.searchParams.get('from')).toBe('2026-09-01');
    expect(request?.searchParams.get('to')).toBe('2026-11-01');
  });

  it('shows the requests: tiles, types, people, months and statuses', async () => {
    renderApp('/hr/insights?tab=requests', api());

    const types = await card(text.requests.types);
    expect(rowOf(types, 'Чөлөө')).toEqual(['Чөлөө', '6', '67%']);
    expect(screen.getByRole('region', { name: text.requests.total })).toHaveTextContent('9');
    expect(screen.getByRole('region', { name: text.requests.hours })).toHaveTextContent('16');
    expect(screen.getByRole('region', { name: text.requests.topType })).toHaveTextContent('Чөлөө');
    expect(screen.getByRole('region', { name: text.requests.topSender })).toHaveTextContent(
      'Дорж Бат',
    );

    const people = await card(text.requests.employees);
    expect(within(people).getByText('Дорж Бат')).toBeInTheDocument();

    const months = await card(text.requests.months);
    expect(rowOf(months, '11-р сар')).toEqual(['11-р сар', '9']);

    const statuses = await card(text.requests.statuses);
    expect(rowOf(statuses, text.requestStatuses.PENDING)).toEqual([
      text.requestStatuses.PENDING,
      '2',
      '17%',
    ]);
    expect(
      within(statuses).queryByRole('cell', { name: text.requestStatuses.CANCELLED }),
    ).toBeNull();
  });

  it('downloads the staff list as Excel', async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    const original = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return 'blob:staff';
    };
    URL.revokeObjectURL = () => undefined;
    try {
      renderApp(
        '/hr/insights',
        api({
          'GET /api/v1/hr/staff.xlsx': () => new Response(new Blob(['xlsx']), { status: 200 }),
        }),
      );
      await user.click(await screen.findByRole('button', { name: text.excel }));
      await waitFor(() => expect(created).toHaveLength(1));
    } finally {
      URL.createObjectURL = original;
      URL.revokeObjectURL = revoke;
    }
  });
});

describe('the dashboard sums', () => {
  it('clamps an attendance range to 62 days and to today', () => {
    expect(clampAttendanceRange('2026-11-01', '2026-11-05', '2026-11-05')).toEqual({
      from: '2026-11-01',
      to: '2026-11-05',
      clamped: false,
    });
    expect(clampAttendanceRange('2026-01-01', '2026-11-01', '2026-11-05')).toEqual({
      from: '2026-09-01',
      to: '2026-11-01',
      clamped: true,
    });
    expect(clampAttendanceRange('2026-11-01', '2026-12-31', '2026-11-05')).toEqual({
      from: '2026-11-01',
      to: '2026-11-05',
      clamped: true,
    });
  });

  it('reads minutes as hours and keeps typed names out of the tooltip HTML', () => {
    expect(formatHours(4200)).toBe('70');
    expect(formatHours(90)).toBe('1.5');
    expect(formatHours(600_000)).toBe('10,000');
    expect(escapeHtml('<b>"x"&')).toBe('&lt;b&gt;&quot;x&quot;&amp;');
  });
});
