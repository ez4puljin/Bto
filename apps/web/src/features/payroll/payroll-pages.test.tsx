import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const STAMP = '2026-11-20T02:00:00.000Z';
const HR: Me = {
  ...ADMIN_ME,
  id: 30,
  username: 'hr',
  fullName: 'Хүний нөөц Оюун',
  permissions: ['hr.payroll.view', 'hr.payroll.manage', 'hr.payroll.score'],
  roles: [],
};
const SCORER: Me = { ...HR, id: 31, username: 'scorer', permissions: ['hr.payroll.score'] };

const SETTINGS: Schemas['PayrollSettings'] = {
  latePenaltyPercent: '2',
  employeeSiPercent: '11.5',
  employerSiPercent: '12.5',
  minimumWage: '792000',
  siCapMultiplier: '10',
  pitPercent: '10',
  pitCredits: [{ upTo: null, credit: '0' }],
};
const TOTALS: Schemas['PayrollRunTotals'] = {
  baseSalary: '1000000.00',
  kpiTotal: '273800.00',
  gross: '1273800.00',
  employeeSi: '146487.00',
  employerSi: '159225.00',
  pit: '112731.30',
  advance: '100000.00',
  otherAdditions: '0.00',
  deductions: '0.00',
  net: '914581.70',
  totalCost: '1433025.00',
};
const line = (scored: boolean): Schemas['PayrollLine'] => ({
  id: 7,
  runId: 3,
  month: '2026-11',
  runStatus: 'DRAFT',
  approvedAt: null,
  userId: 5,
  fullName: 'Кассчин Сараа',
  position: 'Кассчин',
  divisionName: 'Супермаркет',
  baseSalary: '1000000.00',
  monthlySalary: '1000000.00',
  salaryDays: 22,
  salaryMonthDays: 22,
  paysSocialInsurance: true,
  attendanceMeasured: true,
  workdays: 22,
  attendedDays: 20,
  lateDays: 2,
  items: [
    {
      id: 11,
      key: 'att',
      name: 'Ирц',
      source: 'ATTENDANCE',
      amount: '200000.00',
      scorePercent: '86.9',
      basePercent: '90.9',
      penaltyPercent: '4',
      earned: '173800.00',
      note: null,
      scoredByName: null,
      scoredAt: null,
    },
    {
      id: 12,
      key: 'work',
      name: 'Үйлчилгээний чанар',
      source: 'MANUAL',
      amount: '100000.00',
      scorePercent: scored ? '100' : null,
      basePercent: null,
      penaltyPercent: null,
      earned: scored ? '100000.00' : '0.00',
      note: null,
      scoredByName: null,
      scoredAt: null,
    },
  ],
  adjustments: [],
  advances: [],
  unscoredCount: scored ? 0 : 1,
  kpiTotal: '273800.00',
  taxableAdditions: '0.00',
  gross: '1273800.00',
  siBase: '1273800.00',
  employeeSi: '146487.00',
  pitCredit: '0.00',
  pit: '112731.30',
  advance: '100000.00',
  otherAdditions: '0.00',
  deductions: '0.00',
  net: '914581.70',
  employerSi: '159225.00',
  totalCost: '1433025.00',
});
const run = (scored: boolean): Schemas['PayrollRunDetail'] => ({
  id: 3,
  month: '2026-11',
  status: 'DRAFT',
  note: null,
  settings: SETTINGS,
  attendanceTo: null,
  computedAt: STAMP,
  createdAt: STAMP,
  createdByName: null,
  approvedAt: null,
  approvedByName: null,
  reopenedAt: null,
  reopenedByName: null,
  reopenReason: null,
  lineCount: 1,
  unscoredCount: scored ? 0 : 1,
  totals: TOTALS,
  lines: [line(scored)],
});
const SCORING: Schemas['PayrollScoring'] = {
  runId: 3,
  month: '2026-11',
  status: 'DRAFT',
  lines: [
    {
      lineId: 7,
      userId: 5,
      fullName: 'Кассчин Сараа',
      position: 'Кассчин',
      divisionName: 'Супермаркет',
      items: [
        {
          itemId: 12,
          name: 'Үйлчилгээний чанар',
          scorePercent: null,
          note: null,
          scoredByName: null,
          scoredAt: null,
        },
      ],
    },
  ],
};

const routes = (scored: boolean) => ({
  'GET /api/v1/payroll/runs': () => json([]),
  'GET /api/v1/payroll/runs/3': () => json(run(scored)),
  'GET /api/v1/payroll/scoring/runs': () =>
    json([{ runId: 3, month: '2026-11', status: 'DRAFT', manualCount: 1, unscoredCount: 1 }]),
  'GET /api/v1/payroll/scoring/runs/3': () => json(SCORING),
  'PUT /api/v1/payroll/scoring/runs/3/scores': () => json(SCORING),
  'POST /api/v1/payroll/runs/3/approve': () => json(run(true)),
});

describe('payroll pages (ADR-0235)', () => {
  it('shows a scorer only «KPI үнэлгээ» in the menu', async () => {
    renderApp('/hr/payroll/scoring', signedIn(SCORER, routes(false)));
    const sidebar = within(await findSidebar());
    expect(
      await sidebar.findByRole('link', { name: mn.payroll.web.nav.scoring }),
    ).toBeInTheDocument();
    expect(sidebar.queryByRole('link', { name: mn.payroll.web.nav.runs })).toBeNull();
    expect(sidebar.queryByRole('link', { name: mn.payroll.web.nav.settings })).toBeNull();
  });

  it('keeps «Батлах» shut while a manual score is missing, and names who lacks it', async () => {
    renderApp('/hr/payroll/runs/3', signedIn(HR, routes(false)));
    expect(
      await screen.findByText(mn.payroll.web.run.unscoredTitle.replace('{{count}}', '1')),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Кассчин Сараа' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: mn.payroll.web.run.approve })).toBeDisabled();
    // The sheet shows whole tögrög with thousands, and the employer's share in the totals row.
    const table = within(screen.getByRole('table'));
    expect(table.getAllByText('914,582').length).toBeGreaterThan(0);
    expect(table.getAllByText('159,225').length).toBeGreaterThan(0);
  });

  it('shows the workdays under «Тогтмол цалин» only when the salary is split', async () => {
    const joined = run(false);
    joined.lines = [
      { ...line(false), baseSalary: '500000.00', salaryDays: 11, salaryMonthDays: 22 },
      { ...line(false), id: 8, userId: 6, fullName: 'Бүтэн сар' },
    ];
    renderApp(
      '/hr/payroll/runs/3',
      signedIn(HR, { ...routes(false), 'GET /api/v1/payroll/runs/3': () => json(joined) }),
    );
    const table = within(await screen.findByRole('table'));
    const fraction = mn.payroll.salaryDays.replace('{{days}}', '11').replace('{{total}}', '22');
    expect(await table.findAllByText(fraction)).toHaveLength(1);
    expect(table.getAllByText('500,000').length).toBeGreaterThan(0);
    expect(table.queryByText(/22 \/ 22/)).toBeNull();
  });

  it('approves a fully scored run after asking', async () => {
    const fetchMock = signedIn(HR, routes(true));
    renderApp('/hr/payroll/runs/3', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.payroll.web.run.approve }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(
      dialog.getByRole('button', { name: mn.payroll.web.run.confirm.approve.action }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/payroll/runs/3/approve')).toHaveLength(1),
    );
  });

  it('lets a scorer enter a score with no amount on the page', async () => {
    const fetchMock = signedIn(SCORER, routes(false));
    renderApp('/hr/payroll/scoring', fetchMock);
    const user = userEvent.setup();
    const score = await screen.findByRole('textbox', {
      name: mn.payroll.web.scoring.scoreFor
        .replace('{{name}}', 'Кассчин Сараа')
        .replace('{{item}}', 'Үйлчилгээний чанар'),
    });
    expect(screen.queryByText(/₮/)).toBeNull();
    await user.type(score, '50');
    await user.click(screen.getByRole('button', { name: mn.payroll.web.scoring.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/payroll/scoring/runs/3/scores')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'PUT', '/api/v1/payroll/scoring/runs/3/scores')[0];
    expect(await bodyOf(request)).toEqual({
      scores: [{ itemId: 12, scorePercent: '50', note: null }],
    });
  });
});
