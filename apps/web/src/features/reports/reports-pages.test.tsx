import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';
import {
  AGING,
  AGING_ITEMS,
  DASHBOARD,
  DASHBOARD_NO_MARGINS,
  PROFIT,
  REFRESH_STATE,
  SALES_DOCUMENTS,
  STOCK_PAGE_1,
  STOCK_PAGE_2,
  SUPPLIER_ENTRIES,
  SUPPLIERS,
} from './report-fixtures';

const r = mn.reports;

/** A manager who reads the reports but not the costs. */
const VIEWER_ME: Me = {
  ...ADMIN_ME,
  id: 7,
  username: 'menejer',
  permissions: ['reports.view'],
  roles: [{ id: 9, code: 'MANAGER', name: 'Менежер', isSystem: false }],
};

const REFRESH = {
  'GET /api/v1/reports/refresh-state': () => json(REFRESH_STATE),
  'POST /api/v1/reports/refresh': () => json(REFRESH_STATE),
};

const queryOf = (request: Request) => new URL(request.url).searchParams;

describe('management reports (ADR-0108)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the «Тайлан» menu for a holder of both rights', async () => {
    renderApp('/', signedIn(ADMIN_ME, REFRESH));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('button', { name: mn.nav.groups.reports })).toBeInTheDocument();
    for (const [label, to] of [
      [mn.nav.reportsDashboard, '/reports/dashboard'],
      [mn.nav.reportsAging, '/reports/aging'],
      [mn.nav.reportsProfit, '/reports/profit'],
      [mn.nav.reportsStock, '/reports/stock'],
      [mn.nav.reportsSuppliers, '/reports/suppliers'],
    ] as const) {
      expect(sidebar.getByRole('link', { name: label })).toHaveAttribute('href', to);
    }
  });

  it('shows the dashboard tiles with their changes, the alerts and refreshes', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/dashboard': () => json(DASHBOARD),
    });
    renderApp('/reports/dashboard?month=2026-10', fetchMock);

    const sales = within(await screen.findByRole('region', { name: r.dashboard.sales }));
    expect(sales.getByText('1,200,000₮')).toBeInTheDocument();
    expect(sales.getByText('20.0%')).toHaveClass('text-success');
    // Nothing a year earlier: no change to show.
    expect(sales.getAllByText('—').length).toBeGreaterThan(0);
    expect(sales.getByRole('link', { name: r.dashboard.sales })).toHaveAttribute(
      'href',
      '/reports/profit?by=customer&from=2026-10-01&to=2026-10-24',
    );

    const profit = within(screen.getByRole('region', { name: r.dashboard.profit }));
    expect(profit.getByText('180,000₮')).toBeInTheDocument();
    expect(profit.getByText('10.0%')).toHaveClass('text-destructive');
    expect(profit.getByText(r.common.points.replace('{{value}}', '5.0'))).toHaveClass(
      'text-destructive',
    );

    // More receivables is bad news, less is good.
    const receivables = within(screen.getByRole('region', { name: r.dashboard.receivables }));
    expect(receivables.getByText('10.0%')).toHaveClass('text-destructive');
    expect(receivables.getByText('8.3%')).toHaveClass('text-success');
    expect(receivables.getByRole('link', { name: r.dashboard.receivables })).toHaveAttribute(
      'href',
      '/reports/aging',
    );

    const stock = within(screen.getByRole('region', { name: r.dashboard.stock }));
    expect(stock.getByText('3,000,000₮')).toBeInTheDocument();
    expect(stock.getByText('3.4%')).toHaveClass('text-muted-foreground');

    const overdue = within(screen.getByRole('region', { name: r.dashboard.alerts.overdueTitle }));
    expect(overdue.getByRole('link', { name: 'Туршилтын дэлгүүр А' })).toHaveAttribute(
      'href',
      '/partners/customers/21',
    );
    expect(overdue.getByText('80,000₮')).toBeInTheDocument();
    const low = within(screen.getByRole('region', { name: r.dashboard.alerts.lowTitle }));
    expect(low.getByRole('link', { name: r.dashboard.alerts.lowAll })).toHaveAttribute(
      'href',
      '/reports/stock?filter=LOW',
    );
    expect(low.getByText(r.dashboard.alerts.lowCount.replace('{{count}}', '12'))).toBeVisible();
    const falling = within(screen.getByRole('region', { name: r.dashboard.alerts.fallingTitle }));
    expect(falling.getByText('5.0% (өмнөх сар 9.0%)')).toBeInTheDocument();
    const rep = within(screen.getByRole('region', { name: r.dashboard.alerts.topRepTitle }));
    expect(rep.getByText('Төлөөлөгч Бат')).toBeInTheDocument();
    expect(rep.getByText('450,000₮')).toBeInTheDocument();

    // The category chart lists its bars as links to the category's products.
    const chart = within(screen.getByRole('figure', { name: r.dashboard.categories.title }));
    expect(chart.getByRole('link', { name: /Туршилтын гурил/ })).toHaveAttribute(
      'href',
      `/reports/profit?${new URLSearchParams({ by: 'product', from: '2026-10-01', to: '2026-10-24', categoryId: '5', label: 'Туршилтын гурил' }).toString()}`,
    );
    expect(screen.getByRole('figure', { name: r.dashboard.trend.title })).toBeInTheDocument();

    // 06:05 UTC is 14:05 in Ulaanbaatar.
    expect(screen.getByText(/14:05/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: r.common.refresh }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/reports/refresh')).toHaveLength(1),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/reports/dashboard').length).toBeGreaterThan(1),
    );
  });

  it('hides profit, stock value and margins from a user without costs', async () => {
    renderApp(
      '/reports/dashboard',
      signedIn(VIEWER_ME, {
        ...REFRESH,
        'GET /api/v1/reports/dashboard': () => json(DASHBOARD_NO_MARGINS),
      }),
    );
    const sales = await screen.findByRole('region', { name: r.dashboard.sales });
    // The sales tile drills into the profit report, which needs the margins right.
    expect(within(sales).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('region', { name: r.dashboard.profit })).toBeNull();
    expect(screen.queryByRole('region', { name: r.dashboard.stock })).toBeNull();
    expect(screen.queryByRole('region', { name: r.dashboard.alerts.fallingTitle })).toBeNull();
    const turnover = within(screen.getByRole('region', { name: r.dashboard.turnoverTitle }));
    expect(turnover.getByText(r.dashboard.turnoverValue.replace('{{days}}', '42'))).toBeVisible();
    expect(screen.queryByText(/Ашгийн хувь/)).toBeNull();
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.reportsAging })).toBeInTheDocument();
    expect(sidebar.queryByRole('link', { name: mn.nav.reportsProfit })).toBeNull();
    expect(sidebar.queryByRole('link', { name: mn.nav.reportsSuppliers })).toBeNull();
  });

  it('shows the aging by bucket with its totals and opens a customer’s invoices', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/aging': () => json(AGING),
      'GET /api/v1/reports/aging/31/items': () => json(AGING_ITEMS),
    });
    renderApp('/reports/aging?overdue=1', fetchMock);
    const table = (await screen.findByRole('button', { name: 'Туршилтын дэлгүүр А' })).closest(
      'table',
    ) as HTMLElement;
    const rows = within(table).getAllByRole('row');
    const total = within(rows[rows.length - 1] as HTMLElement);
    expect(total.getByText(r.common.total)).toBeInTheDocument();
    expect(total.getByText('204,000')).toBeInTheDocument();
    expect(total.getByText('120,000')).toBeInTheDocument();
    expect(screen.getByText('85,000₮')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: r.aging.overdueOnly })).toBeChecked();
    expect(
      queryOf(calls(fetchMock, 'GET', '/api/v1/reports/aging')[0] as Request).get('overdueOnly'),
    ).toBe('true');

    await user.click(within(table).getByRole('button', { name: 'Туршилтын дэлгүүр А' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByRole('link', { name: 'Н-20260915-0007' })).toHaveAttribute(
      'href',
      '/finance/invoices?invoice=77',
    );
    expect(sheet.getByRole('link', { name: r.aging.items.openCustomer })).toHaveAttribute(
      'href',
      '/partners/customers/21',
    );
  });

  it('marks a margin under the threshold red and opens the documents behind a row', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/profit': () => json(PROFIT),
      'GET /api/v1/reports/sales-documents': () => json(SALES_DOCUMENTS),
    });
    renderApp('/reports/profit?from=2026-10-01&to=2026-10-24', fetchMock);
    const table = (await screen.findByRole('button', { name: 'Туршилтын дэлгүүр А' })).closest(
      'table',
    ) as HTMLElement;
    expect(within(table).getByText('4.0%')).toHaveClass('text-destructive');
    expect(within(table).getByText('20.0%')).not.toHaveClass('text-destructive');
    expect(within(table).getByText(mn.reports.excel.kinds.POS)).toBeInTheDocument();
    // The totals row spans the same columns as the header (each amount under its heading).
    const width = (row: HTMLElement) =>
      Array.from(row.children).reduce(
        (sum, cell) => sum + Number.parseInt(cell.getAttribute('colspan') ?? '1', 10),
        0,
      );
    const rows = within(table).getAllByRole('row');
    const header = rows[0] as HTMLElement;
    const totals = rows[rows.length - 1] as HTMLElement;
    expect(width(totals)).toBe(width(header));
    const first = queryOf(calls(fetchMock, 'GET', '/api/v1/reports/profit')[0] as Request);
    expect([first.get('by'), first.get('from'), first.get('to')]).toEqual([
      'customer',
      '2026-10-01',
      '2026-10-24',
    ]);

    await user.click(within(table).getByRole('button', { name: 'Туршилтын дэлгүүр А' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByRole('link', { name: 'Н-20261010-0003' })).toHaveAttribute(
      'href',
      '/finance/invoices?invoice=88',
    );
    expect(sheet.getByRole('link', { name: '#41' })).toHaveAttribute(
      'href',
      '/sales/boards?order=41',
    );
    const documents = queryOf(
      calls(fetchMock, 'GET', '/api/v1/reports/sales-documents')[0] as Request,
    );
    expect(documents.get('customerId')).toBe('21');

    await user.click(sheet.getByRole('button', { name: r.profit.byProducts }));
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/reports/profit').some((request) => {
          const query = queryOf(request);
          return query.get('by') === 'product' && query.get('customerId') === '21';
        }),
      ).toBe(true),
    );
    expect(
      await screen.findByText(r.common.filter.replace('{{label}}', 'Туршилтын дэлгүүр А')),
    ).toBeInTheDocument();
  });

  it('loads more stock rows with «Цааш үзэх»', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ADMIN_ME, {
      ...REFRESH,
      'GET /api/v1/reports/stock': (request) =>
        json(queryOf(request).get('offset') === '2' ? STOCK_PAGE_2 : STOCK_PAGE_1),
    });
    renderApp('/reports/stock', fetchMock);
    expect(await screen.findByRole('link', { name: 'Туршилтын бараа 1' })).toHaveAttribute(
      'href',
      '/inventory/stock/101',
    );
    expect(screen.getByText('150,000₮')).toBeInTheDocument();
    expect(screen.queryByText('Туршилтын бараа 3')).toBeNull();
    expect(
      queryOf(calls(fetchMock, 'GET', '/api/v1/reports/stock')[0] as Request).get('slowDays'),
    ).toBe('90');
    await user.click(screen.getByRole('button', { name: mn.common.loadMore }));
    expect(await screen.findByRole('link', { name: 'Туршилтын бараа 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.common.loadMore })).toBeNull();
  });

  it('charts the ten largest suppliers and links their entries', async () => {
    const user = userEvent.setup();
    renderApp(
      '/reports/suppliers?from=2026-10-01&to=2026-10-24',
      signedIn(ADMIN_ME, {
        ...REFRESH,
        'GET /api/v1/reports/suppliers': () => json(SUPPLIERS),
        'GET /api/v1/reports/suppliers/201/entries': () => json(SUPPLIER_ENTRIES),
      }),
    );
    const chart = within(await screen.findByRole('figure', { name: r.suppliers.chart }));
    const bars = chart.getAllByRole('listitem');
    expect(bars).toHaveLength(10);
    expect(bars[0]).toHaveTextContent('Туршилтын нийлүүлэгч 1, 1,200,000₮');
    expect(chart.queryByText(/Туршилтын нийлүүлэгч 11/)).toBeNull();

    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Туршилтын нийлүүлэгч 1' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByRole('link', { name: 'О-20261005-0001' })).toHaveAttribute(
      'href',
      '/inventory/receipts/61',
    );
    expect(sheet.getByRole('link', { name: 'Ж-20261012-0004' })).toHaveAttribute(
      'href',
      '/finance/journal?entry=902',
    );
    expect(sheet.getByRole('link', { name: r.suppliers.openSupplier })).toHaveAttribute(
      'href',
      '/partners/suppliers/301',
    );
  });
});

describe('management reports on paper (ADR-0108)', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [
      '/reports/dashboard/print?month=2026-10&format=a4',
      `${r.dashboard.title} 2026-10`,
      '1,200,000',
    ],
    ['/reports/aging/print?format=a4', `${r.aging.title} 2026-10-24`, '204,000'],
    [
      '/reports/profit/print?from=2026-10-01&to=2026-10-24&format=a4',
      `${r.profit.title} · ${r.profit.by.customer}`,
      '800,000',
    ],
    ['/reports/stock/print?format=a4', `${r.stock.title} 2026-10-24`, 'Туршилтын бараа 2'],
    [
      '/reports/suppliers/print?from=2026-10-01&to=2026-10-24&format=a4',
      r.suppliers.title,
      '7,800,000',
    ],
  ])('prints %s', async (path, title, figure) => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(
      path,
      signedIn(ADMIN_ME, {
        'GET /api/v1/reports/dashboard': () => json(DASHBOARD),
        'GET /api/v1/reports/aging': () => json(AGING),
        'GET /api/v1/reports/profit': () => json(PROFIT),
        'GET /api/v1/reports/stock': () => json(STOCK_PAGE_1),
        'GET /api/v1/reports/suppliers': () => json(SUPPLIERS),
      }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(mn.brand.company)).toBeInTheDocument();
    expect(screen.getAllByText(figure).length).toBeGreaterThan(0);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});
