import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';
import type {
  ProfitBoard,
  ProfitBoardExpenseEntries,
  ProfitBoardExpenseRow,
  ProfitBoardProducts,
  ProfitBoardRow,
} from './api';
import { REFRESH_STATE } from './report-fixtures';

const b = mn.reports.board;

const VIEWER_ME: Me = {
  ...ADMIN_ME,
  id: 7,
  username: 'menejer',
  permissions: ['reports.view'],
  roles: [{ id: 9, code: 'MANAGER', name: 'Менежер', isSystem: false }],
};

const row = (fields: Partial<ProfitBoardRow> & Pick<ProfitBoardRow, 'kind'>): ProfitBoardRow => ({
  id: null,
  name: null,
  sales: '0.00',
  cost: '0.00',
  profit: '0.00',
  margin: null,
  share: null,
  flagged: false,
  discount: null,
  profitWithDiscount: null,
  children: [],
  own: false,
  ...fields,
});

const figures = (sales: string, cost: string, profit: string, margin: string | null) => ({
  sales,
  cost,
  profit,
  margin,
});

const expenseRow = (
  fields: Partial<ProfitBoardExpenseRow> & Pick<ProfitBoardExpenseRow, 'kind' | 'amount'>,
): ProfitBoardExpenseRow => ({
  id: null,
  code: null,
  name: null,
  previous: '0.00',
  lastYear: '0.00',
  share: null,
  children: [],
  ...fields,
});

const result = (
  otherIncome: string,
  expenses: string,
  operating: string,
  tax: string,
  net: string,
) => ({
  otherIncome,
  expenses,
  operatingProfit: operating,
  tax,
  netProfit: net,
});

const BOARD: ProfitBoard = {
  kind: 'quarter',
  period: '2026-Q4',
  running: true,
  current: { from: '2026-10-01', to: '2026-11-23' },
  previous: { from: '2026-07-01', to: '2026-08-23' },
  lastYear: { from: '2025-10-01', to: '2025-11-23' },
  today: '2026-11-23',
  refreshedAt: '2026-11-23T05:00:00.000Z',
  threshold: '8.0',
  source: 'ALL',
  branchId: null,
  totals: {
    current: figures('1000000.00', '800000.00', '200000.00', '20.0'),
    previous: figures('800000.00', '640000.00', '160000.00', '20.0'),
    lastYear: figures('0.00', '0.00', '0.00', null),
  },
  discounts: { current: '15000.00', previous: '10000.00', lastYear: '0.00' },
  bonus: { lines: 2, qty: '24', value: '36000.00', unvalued: 0 },
  // 200,000 + 15,000 + 5,000 − 120,000 = 100,000 operating; − 10,000 tax = 90,000 net.
  results: {
    current: result('5000.00', '120000.00', '100000.00', '10000.00', '90000.00'),
    previous: result('0.00', '100000.00', '70000.00', '0.00', '70000.00'),
    lastYear: result('0.00', '0.00', '0.00', '0.00', '0.00'),
  },
  expenses: {
    rows: [
      expenseRow({
        kind: 'GROUP',
        id: 45,
        code: '70',
        name: 'Ерөнхий удирдлагын зардал',
        amount: '100000.00',
        previous: '80000.00',
        share: '83.3',
        children: [
          expenseRow({
            kind: 'GROUP',
            id: 48,
            code: '7020',
            name: 'Материалын зардал',
            amount: '100000.00',
            previous: '80000.00',
            share: '83.3',
            children: [
              expenseRow({
                kind: 'ACCOUNT',
                id: 702008,
                code: '702008',
                name: 'Цахилгааны зардал',
                amount: '100000.00',
                previous: '80000.00',
                share: '83.3',
              }),
            ],
          }),
        ],
      }),
      expenseRow({
        kind: 'NONE',
        amount: '20000.00',
        previous: '20000.00',
        share: '16.7',
        children: [
          expenseRow({
            kind: 'ACCOUNT',
            id: 740201,
            code: '740201',
            name: 'Барааны дутагдал, хорогдол',
            amount: '20000.00',
            previous: '20000.00',
            share: '16.7',
          }),
        ],
      }),
    ],
    total: { current: '120000.00', previous: '100000.00', lastYear: '0.00' },
    common: null,
    lines: 4,
  },
  trend: [
    {
      period: '2026-Q3',
      from: '2026-07-01',
      to: '2026-09-30',
      ...figures('900000.00', '700000.00', '200000.00', '22.2'),
      netProfit: '120000.00',
    },
    {
      period: '2026-Q4',
      from: '2026-10-01',
      to: '2026-11-23',
      ...figures('1000000.00', '800000.00', '200000.00', '20.0'),
      netProfit: '90000.00',
    },
  ],
  breakdowns: {
    supplier: {
      rows: [
        row({
          kind: 'SUPPLIER',
          id: 5,
          name: 'Сүүн нийлүүлэгч',
          ...figures('700000.00', '540000.00', '160000.00', '22.9'),
          share: '80.0',
          discount: '15000.00',
          profitWithDiscount: '175000.00',
        }),
        row({
          kind: 'NONE',
          ...figures('300000.00', '260000.00', '40000.00', '13.3'),
          share: '20.0',
          discount: '0.00',
          profitWithDiscount: '40000.00',
        }),
      ],
      others: null,
    },
    category: {
      rows: [
        row({
          kind: 'CATEGORY',
          id: 1,
          name: 'Хүнс',
          ...figures('1000000.00', '800000.00', '200000.00', '20.0'),
          share: '100.0',
          children: [
            row({
              kind: 'CATEGORY',
              id: 2,
              name: 'Сүү',
              ...figures('600000.00', '450000.00', '150000.00', '25.0'),
            }),
            row({
              kind: 'CATEGORY',
              id: 1,
              name: 'Хүнс',
              own: true,
              ...figures('400000.00', '350000.00', '50000.00', '12.5'),
            }),
          ],
        }),
      ],
      others: null,
    },
    location: { rows: [], others: null },
    rep: {
      rows: [
        row({
          kind: 'USER',
          id: 3,
          name: 'Бат',
          ...figures('600000.00', '450000.00', '150000.00', '25.0'),
          share: '75.0',
        }),
        row({
          kind: 'POS',
          ...figures('400000.00', '390000.00', '10000.00', '2.5'),
          share: '5.0',
          flagged: true,
        }),
      ],
      others: {
        ...figures('1000.00', '1000.00', '0.00', '0.0'),
        count: 4,
        share: '0.0',
        discount: null,
        profitWithDiscount: null,
      },
    },
    branch: { rows: [], others: null },
  },
  branches: [
    { id: 1, name: 'Оргил' },
    { id: 2, name: 'Супермаркет' },
  ],
};

const PRODUCTS: ProfitBoardProducts = {
  from: '2026-10-01',
  to: '2026-11-23',
  rows: [
    {
      productId: 11,
      sku: '9001',
      name: 'Сүү 1л',
      unit: 'ш',
      qty: '120',
      ...figures('360000.00', '260000.00', '100000.00', '27.8'),
      flagged: false,
    },
  ],
  others: null,
};

const REFRESH = {
  'GET /api/v1/reports/refresh-state': () => json(REFRESH_STATE),
  'POST /api/v1/reports/refresh': () => json(REFRESH_STATE),
};

const queryOf = (request: Request) => new URL(request.url).searchParams;

/** «Урсгал зардал» names both a tile (a section) and the card below the charts. */
const expenseTile = () =>
  within(
    screen
      .getAllByRole('region', { name: b.tiles.expenses })
      .find((el) => el.tagName === 'SECTION') ?? document.body,
  );
const expenseCard = () =>
  screen
    .queryAllByRole('region', { name: b.expenses.title })
    .find((el) => el.tagName !== 'SECTION');

describe('«Ашгийн самбар» (ADR-0237)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stands in the menu right after «Захирлын самбар», only with reports.margins.view', async () => {
    renderApp('/', signedIn(ADMIN_ME, REFRESH));
    const sidebar = within(await findSidebar());
    const links = sidebar.getAllByRole('link').map((link) => link.getAttribute('href'));
    const at = links.indexOf('/reports/dashboard');
    expect(links[at + 1]).toBe('/reports/profit-board');
    expect(sidebar.getByRole('link', { name: mn.nav.reportsProfitBoard })).toBeInTheDocument();
  });

  it('hides the menu entry without reports.margins.view', async () => {
    renderApp('/', signedIn(VIEWER_ME, REFRESH));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.reportsDashboard })).toBeInTheDocument();
    expect(sidebar.queryByRole('link', { name: mn.nav.reportsProfitBoard })).toBeNull();
  });

  it('shows the tiles, the charts and the supplier breakdown with its discounts', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () => json(BOARD),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4', fetchMock);

    const sales = within(await screen.findByRole('region', { name: b.tiles.sales }));
    expect(sales.getByText('1,000,000₮')).toBeInTheDocument();
    expect(sales.getByText(b.vsPrevious)).toBeInTheDocument();
    expect(sales.getByText('25.0%')).toHaveClass('text-success');
    const discounts = within(screen.getByRole('region', { name: b.tiles.discounts }));
    expect(discounts.getByText('15,000₮')).toBeInTheDocument();
    expect(discounts.getByText(b.tiles.discountsHint)).toBeInTheDocument();
    const withDiscounts = within(screen.getByRole('region', { name: b.tiles.profitWithDiscounts }));
    expect(withDiscounts.getByText('215,000₮')).toBeInTheDocument();
    const bonus = within(screen.getByRole('region', { name: b.tiles.bonus }));
    expect(bonus.getByText(b.tiles.bonusHint)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: b.trend })).toBeInTheDocument();
    const waterfall = within(screen.getByRole('region', { name: b.waterfall }));
    // The structure runs on to the net profit: every step in the figures' table.
    for (const [label, amount] of [
      [b.tiles.discounts, '15,000₮'],
      [b.steps.otherIncome, '5,000₮'],
      [b.tiles.expenses, '-120,000₮'],
      [b.tiles.operatingProfit, '100,000₮'],
      [b.steps.tax, '-10,000₮'],
      [b.tiles.netProfit, '90,000₮'],
    ] as const) {
      const cell = waterfall.getByRole('cell', { name: label });
      expect(within(cell.closest('tr') as HTMLElement).getByText(amount)).toBeInTheDocument();
    }
    expect(waterfall.queryByRole('cell', { name: b.tiles.profitWithDiscounts })).toBeNull();
    const trend = within(screen.getByRole('region', { name: b.trend }));
    expect(trend.getByRole('columnheader', { name: b.columns.netProfit })).toBeInTheDocument();
    expect(trend.getByText('90,000₮')).toBeInTheDocument();

    const breakdown = within(screen.getByRole('region', { name: b.breakdown }));
    expect(breakdown.getByRole('tab', { name: b.tabs.supplier })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      breakdown.getByRole('columnheader', { name: b.columns.profitWithDiscount }),
    ).toBeInTheDocument();
    expect(breakdown.getByRole('button', { name: b.rows.noSupplier })).toBeInTheDocument();
    expect(breakdown.getAllByText('175,000').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: b.period })).toHaveValue('2026-Q4');
    expect(
      within(screen.getByRole('combobox', { name: b.period })).getByRole('option', {
        name: b.quarterOf.replace('{{year}}', '2026').replace('{{quarter}}', '4'),
      }),
    ).toBeInTheDocument();
  });

  it('moves the period, filters by branch and source, and asks again', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () => json(BOARD),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4', fetchMock);
    await screen.findByRole('region', { name: b.tiles.sales });
    const asked = () =>
      fetchMock.mock.calls
        .map(([input]) => input)
        .filter((request) => new URL(request.url).pathname === '/api/v1/reports/profit-board')
        .map(queryOf);

    await user.click(screen.getByRole('button', { name: b.previous }));
    await waitFor(() => expect(asked().at(-1)?.get('period')).toBe('2026-Q3'));
    await user.selectOptions(screen.getByRole('combobox', { name: b.branch }), '2');
    await waitFor(() => expect(asked().at(-1)?.get('branchId')).toBe('2'));
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.reports.profit.sources.label }),
      'POS',
    );
    await waitFor(() => expect(asked().at(-1)?.get('source')).toBe('POS'));
    await user.click(screen.getByRole('tab', { name: b.kinds.year }));
    await waitFor(() => expect(asked().at(-1)?.get('kind')).toBe('year'));
  });

  it('opens a row’s products, expands a category and flags a low margin', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () => json(BOARD),
      'GET /api/v1/reports/profit-board/products': () => json(PRODUCTS),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4&tab=rep', fetchMock);
    const breakdown = within(await screen.findByRole('region', { name: b.breakdown }));
    // The supermarket's row reads as itself and its 2.5% margin is under the threshold.
    expect(breakdown.getByRole('button', { name: mn.reports.excel.kinds.POS })).toBeInTheDocument();
    expect(breakdown.getByText('2.5%')).toHaveClass('text-destructive');
    expect(breakdown.getByText(b.rows.othersCount.replace('{{count}}', '4'))).toBeInTheDocument();

    await user.click(breakdown.getByRole('button', { name: 'Бат' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByText('Сүү 1л')).toBeInTheDocument();
    expect(sheet.getByText('120 ш')).toBeInTheDocument();
    const request = fetchMock.mock.calls
      .map(([input]) => input)
      .find((entry) => new URL(entry.url).pathname === '/api/v1/reports/profit-board/products');
    expect(request && Object.fromEntries(queryOf(request))).toMatchObject({
      kind: 'quarter',
      period: '2026-Q4',
      dimension: 'rep',
      rowKind: 'USER',
      id: '3',
    });
    await user.keyboard('{Escape}');

    await user.click(breakdown.getByRole('tab', { name: b.tabs.category }));
    const expand = await breakdown.findByRole('button', { name: `${b.expand}: Хүнс` });
    await user.click(expand);
    expect(
      breakdown.getByRole('button', { name: b.rows.own.replace('{{name}}', 'Хүнс') }),
    ).toBeInTheDocument();
    expect(breakdown.getByRole('button', { name: 'Сүү' })).toBeInTheDocument();
  });

  it('says when a period has no sales', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () =>
        json({ ...BOARD, kind: 'quarter', period: '2026-Q4' }),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4&tab=location', fetchMock);
    const breakdown = within(await screen.findByRole('region', { name: b.breakdown }));
    expect(breakdown.getByText(b.empty)).toBeInTheDocument();
  });

  it('shows the expenses, operating and net profit from the books, and the entries of a row', async () => {
    const user = userEvent.setup();
    const ENTRIES: ProfitBoardExpenseEntries = {
      from: '2026-10-01',
      to: '2026-11-23',
      rows: [
        {
          lineId: 1,
          entryId: 9,
          date: '2026-11-05',
          number: 'Ж-20261105-0001',
          source: null,
          description: 'Цахилгааны төлбөр',
          accountId: 702008,
          accountCode: '702008',
          accountName: 'Цахилгааны зардал',
          partyName: 'Эрчим хүч ХК',
          branchId: null,
          branchName: null,
          amount: '100000.00',
        },
      ],
      more: false,
      total: '100000.00',
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () => json(BOARD),
      'GET /api/v1/reports/profit-board/expense-entries': () => json(ENTRIES),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4', fetchMock);
    await screen.findAllByRole('region', { name: b.tiles.expenses });
    const tile = expenseTile();
    expect(tile.getByText('120,000₮')).toBeInTheDocument();
    expect(tile.queryByText(b.tiles.expensesNone)).toBeNull();
    const operating = within(screen.getByRole('region', { name: b.tiles.operatingProfit }));
    expect(operating.getByText('100,000₮')).toBeInTheDocument();
    expect(
      operating.getByText(b.tiles.otherIncomeLine.replace('{{amount}}', '5,000₮')),
    ).toBeInTheDocument();
    // 90,000 against 70,000 before: up 28.6%.
    const net = within(screen.getByRole('region', { name: b.tiles.netProfit }));
    expect(net.getByText('90,000₮')).toBeInTheDocument();
    expect(net.getByText('28.6%')).toHaveClass('text-success');
    expect(net.getByText(b.tiles.taxLine.replace('{{amount}}', '10,000₮'))).toBeInTheDocument();

    const card = within(expenseCard() ?? document.body);
    expect(card.getAllByRole('columnheader', { name: b.expenses.columns.name })).not.toHaveLength(
      0,
    );
    expect(card.getByRole('columnheader', { name: b.expenses.columns.change })).toBeInTheDocument();
    expect(card.getByRole('button', { name: b.expenses.noGroup })).toBeInTheDocument();
    expect(card.queryByText(b.expenses.common)).toBeNull();
    // Group → sub-group → account.
    await user.click(
      card.getByRole('button', { name: `${b.expenses.expand}: Ерөнхий удирдлагын зардал` }),
    );
    await user.click(card.getByRole('button', { name: `${b.expenses.expand}: Материалын зардал` }));
    await user.click(card.getByRole('button', { name: '702008 Цахилгааны зардал' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByText('Цахилгааны төлбөр')).toBeInTheDocument();
    expect(sheet.getByText('Эрчим хүч ХК')).toBeInTheDocument();
    expect(
      sheet.getByRole('columnheader', { name: b.expenses.entries.description }),
    ).toBeInTheDocument();
    const request = fetchMock.mock.calls
      .map(([input]) => input)
      .find(
        (entry) => new URL(entry.url).pathname === '/api/v1/reports/profit-board/expense-entries',
      );
    expect(request && Object.fromEntries(queryOf(request))).toMatchObject({
      kind: 'quarter',
      period: '2026-Q4',
      rowKind: 'ACCOUNT',
      id: '702008',
    });
  });

  it('shows the branch-less expenses apart under a branch, and says when none are recorded', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () =>
        json({
          ...BOARD,
          branchId: 2,
          expenses: {
            rows: [],
            total: { current: '0.00', previous: '0.00', lastYear: '0.00' },
            common: { current: '45000.00', previous: '0.00', lastYear: '0.00' },
            lines: 0,
          },
        }),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4&branch=2', fetchMock);
    await screen.findAllByRole('region', { name: b.expenses.title });
    const card = within(expenseCard() ?? document.body);
    expect(card.getByText(b.expenses.empty)).toBeInTheDocument();
    expect(card.getByRole('button', { name: b.expenses.common })).toBeInTheDocument();
    expect(card.getByText(b.expenses.commonHint)).toBeInTheDocument();
    expect(card.getByText('45,000₮')).toBeInTheDocument();
    expect(expenseTile().getByText(b.tiles.expensesNone)).toBeInTheDocument();
  });

  it('hides the books under a source filter', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit-board': () =>
        json({
          ...BOARD,
          source: 'POS',
          discounts: null,
          bonus: null,
          results: null,
          expenses: null,
          trend: BOARD.trend.map((point) => ({ ...point, netProfit: null })),
        }),
    });
    renderApp('/reports/profit-board?kind=quarter&period=2026-Q4&source=POS', fetchMock);
    const net = within(await screen.findByRole('region', { name: b.tiles.netProfit }));
    expect(net.getByText(b.tiles.bySource)).toBeInTheDocument();
    expect(expenseCard()).toBeUndefined();
    const waterfall = within(screen.getByRole('region', { name: b.waterfall }));
    expect(waterfall.queryByRole('cell', { name: b.tiles.netProfit })).toBeNull();
  });
});
