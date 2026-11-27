import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
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
  sourceDeductions: [],
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
  'GET /api/v1/payroll/source-deductions': () => json([]),
  'GET /api/v1/payroll/runs': () => json([]),
  'GET /api/v1/payroll/runs/3': () => json(run(scored)),
  'GET /api/v1/payroll/scoring/runs': () =>
    json([{ runId: 3, month: '2026-11', status: 'DRAFT', manualCount: 1, unscoredCount: 1 }]),
  'GET /api/v1/payroll/scoring/runs/3': () => json(SCORING),
  'PUT /api/v1/payroll/scoring/runs/3/scores': () => json(SCORING),
  'POST /api/v1/payroll/runs/3/approve': () => json(run(true)),
});

const payTerms = (changes: Partial<Schemas['PayrollTerms']> = {}): Schemas['PayrollTerms'] => ({
  userId: 5,
  fullName: 'Кассчин Сараа',
  positionId: 2,
  positionSalaryEffectiveMonth: '2026-11',
  position: 'Кассчин',
  divisionId: null,
  divisionName: null,
  left: false,
  hasTerms: true,
  active: true,
  baseSalary: '1000000.00',
  nextBaseSalary: null,
  nextEffectiveMonth: null,
  salarySource: 'POSITION',
  nextSalarySource: null,
  positionBaseSalary: '1000000.00',
  positionNextBaseSalary: null,
  positionNextEffectiveMonth: null,
  paysSocialInsurance: true,
  templateId: null,
  templateName: null,
  items: [],
  kpiTotal: '0.00',
  updatedAt: null,
  ...changes,
});
const termsRoutes = (terms: Schemas['PayrollTerms']) => ({
  'GET /api/v1/payroll/terms': () => json([terms]),
  'GET /api/v1/hr/divisions': () => json([]),
  'GET /api/v1/payroll/templates': () => json([]),
  'PUT /api/v1/payroll/terms/5': () => json(terms),
});

describe('payroll pages (ADR-0235)', () => {
  it('prefills the position salary and saves a changed amount only for this employee', async () => {
    const fetchMock = signedIn(HR, termsRoutes(payTerms()));
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    const salary = dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary });
    expect(salary).toHaveValue('1,000,000');
    expect(salary).toBeEnabled();
    const user = userEvent.setup();
    await user.clear(salary);
    await user.type(salary, '1250000');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0])).toMatchObject({
      baseSalary: '1250000',
    });
    expect(calls(fetchMock, 'PUT', '/api/v1/hr/positions/2')).toHaveLength(0);
  });

  it('does not create an override when the salary is restored to the same decimal amount', async () => {
    const fetchMock = signedIn(HR, termsRoutes(payTerms()));
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    const salary = dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary });
    const user = userEvent.setup();
    await user.clear(salary);
    await user.type(salary, '1000000.00');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0])).not.toHaveProperty(
      'baseSalary',
    );
  });

  it('does not freeze an untouched salary when position pay refreshes while the dialog is open', async () => {
    let current = payTerms();
    const fetchMock = signedIn(HR, {
      ...termsRoutes(current),
      'GET /api/v1/payroll/terms': () => json([current]),
    });
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    const salary = dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary });
    expect(salary).toHaveValue('1,000,000');
    current = payTerms({
      nextBaseSalary: '1200000.00',
      nextEffectiveMonth: '2026-12',
      nextSalarySource: 'POSITION',
      positionNextBaseSalary: '1200000.00',
      positionNextEffectiveMonth: '2026-12',
    });
    try {
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      expect(
        await dialog.findByText(
          mn.payroll.web.terms.positionScheduled
            .replace('{{amount}}', '1,200,000')
            .replace('{{month}}', '2026-12'),
        ),
      ).toBeInTheDocument();
      // A refetch updates the hints while preserving the user's in-progress form draft.
      expect(salary).toHaveValue('1,000,000');
      const user = userEvent.setup();
      await user.click(dialog.getByRole('switch', { name: mn.payroll.web.terms.insured }));
      await user.click(dialog.getByRole('button', { name: mn.common.save }));
      await waitFor(() =>
        expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1),
      );
      const body = await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0]);
      expect(body).toHaveProperty('paysSocialInsurance', false);
      expect(body).not.toHaveProperty('baseSalary');
      expect(body).not.toHaveProperty('usePositionSalary');
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('reopens with the scheduled personal salary while showing the current salary separately', async () => {
    const terms = payTerms({
      nextBaseSalary: '1800000.00',
      nextEffectiveMonth: '2026-12',
      nextSalarySource: 'PERSONAL',
    });
    const fetchMock = signedIn(HR, termsRoutes(terms));
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary })).toHaveValue(
      '1,800,000',
    );
    expect(
      dialog.getByText(mn.payroll.web.terms.currentSalary.replace('{{amount}}', '1,000,000')),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(dialog.getByRole('switch', { name: mn.payroll.web.terms.insured }));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0])).not.toHaveProperty(
      'baseSalary',
    );
  });

  it('restores next-month position inheritance without sending a conflicting salary', async () => {
    const terms = payTerms({
      salarySource: 'PERSONAL',
      baseSalary: '1800000.00',
      positionNextBaseSalary: '1200000.00',
      positionNextEffectiveMonth: '2026-12',
    });
    const fetchMock = signedIn(HR, termsRoutes(terms));
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    const user = userEvent.setup();
    await user.click(dialog.getByRole('button', { name: mn.payroll.web.terms.usePositionSalary }));
    expect(dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary })).toHaveValue(
      '1,200,000',
    );
    expect(dialog.getByText(mn.payroll.web.terms.resetSalaryHint)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1));
    const body = await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0]);
    expect(body).toHaveProperty('usePositionSalary', true);
    expect(body).not.toHaveProperty('baseSalary');
  });

  it('lets editing after a reset select a personal zero salary instead', async () => {
    const fetchMock = signedIn(HR, termsRoutes(payTerms({ salarySource: 'PERSONAL' })));
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    const user = userEvent.setup();
    await user.click(dialog.getByRole('button', { name: mn.payroll.web.terms.usePositionSalary }));
    const salary = dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary });
    await user.clear(salary);
    await user.type(salary, '0');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')).toHaveLength(1));
    const body = await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/terms/5')[0]);
    expect(body).toHaveProperty('baseSalary', '0');
    expect(body).not.toHaveProperty('usePositionSalary');
  });

  it('keeps a scheduled zero visible and disables salary edits for payroll readers', async () => {
    const viewer: Me = { ...HR, permissions: ['hr.payroll.view'] };
    const fetchMock = signedIn(
      viewer,
      termsRoutes(
        payTerms({
          nextBaseSalary: '0.00',
          nextEffectiveMonth: '2026-12',
          nextSalarySource: 'PERSONAL',
        }),
      ),
    );
    renderApp('/hr/payroll/terms?user=5', fetchMock);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary })).toHaveValue('0');
    expect(dialog.getByRole('textbox', { name: mn.payroll.web.terms.salary })).toBeDisabled();
    expect(dialog.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(
      dialog.queryByRole('button', { name: mn.payroll.web.terms.usePositionSalary }),
    ).toBeNull();
  });

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

it('shows pending sale losses and return credits and explicitly assigns a payroll month', async () => {
  const source = {
    id: 8,
    name: mn.payroll.web.sourceDeductions.title,
    sourceKind: 'EXPIRY_SALE',
    sourceKey: 'expiry:POS:sale:line:7',
    sourceReference: 'expiry:1/markdown:7',
    userId: 5,
    amount: '1200.00',
    requestedMonth: null,
    assignedMonth: null,
    reversesId: null,
    state: 'NEEDS_MONTH',
    createdAt: STAMP,
    settlements: [],
  };
  const refund = {
    ...source,
    id: 9,
    sourceKind: 'EXPIRY_RETURN',
    amount: '-300.00',
    reversesId: 8,
  };
  const fetchMock = signedIn(HR, {
    ...routes(true),
    'GET /api/v1/payroll/terms': () => json([payTerms()]),
    'GET /api/v1/payroll/source-deductions': () => json([source, refund]),
    'PUT /api/v1/payroll/source-deductions/8/month': () => json([source, refund]),
  });
  renderApp('/hr/payroll/runs', fetchMock);
  await screen.findByText(mn.payroll.web.sourceDeductions.refund);
  expect(screen.getAllByText(mn.payroll.web.sourceDeductions.states.NEEDS_MONTH)).toHaveLength(2);
  expect(
    screen.getAllByRole('link', {
      name: mn.payroll.web.sourceDeductions.sourceLabel
        .replace('{{item}}', '1')
        .replace('{{markdown}}', '7'),
    })[0],
  ).toHaveAttribute('href', '/inventory/expiry?item=1');
  const user = userEvent.setup();
  await user.click(
    screen.getAllByRole('button', { name: mn.payroll.web.sourceDeductions.assign })[0]!,
  );
  const dialog = within(await screen.findByRole('dialog'));
  const month = dialog.getByLabelText<HTMLInputElement>(mn.payroll.web.sourceDeductions.month);
  await user.clear(month);
  await user.type(month, '2026-01');
  const chosen = month.value;
  await user.click(dialog.getByRole('button', { name: mn.common.save }));
  await waitFor(() =>
    expect(calls(fetchMock, 'PUT', '/api/v1/payroll/source-deductions/8/month')).toHaveLength(1),
  );
  expect(
    await bodyOf(calls(fetchMock, 'PUT', '/api/v1/payroll/source-deductions/8/month')[0]),
  ).toEqual({ month: chosen });
});
