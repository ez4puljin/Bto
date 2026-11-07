import mn from '@tugeel/shared/i18n/mn.json';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, problem, renderApp, signedIn } from '@/test/render-app';

const row = (over: Record<string, unknown>) => ({
  supplierId: 1,
  code: '90001',
  name: 'Альфа',
  status: 'ACTIVE',
  registers: '7000001',
  registersDefault: null,
  phone: '',
  phoneDefault: null,
  remark: '',
  sharedRegisters: [],
  employeeUserId: 7,
  employeeName: 'Тестбат',
  ordererName: 'Тестбат',
  employeeAssigned: false,
  employeeMonths: [{ userId: 7, name: 'Тестбат', periods: [202610] }],
  purchaseAmount: '1000.00',
  receiptCount: 1,
  pendingCount: 0,
  ebarimtAmount: '400.00',
  ebarimtCount: 1,
  linkedAmount: '0.00',
  exemptAmount: '100.00',
  diffAmount: '500.00',
  byPeriod: [
    {
      period: 202610,
      purchaseAmount: '1000.00',
      receiptCount: 1,
      pendingCount: 0,
      ebarimtAmount: '400.00',
      ebarimtCount: 1,
      exemptAmount: '100.00',
      note: null,
    },
  ],
  history: [],
  ...over,
});

const REPORT = {
  periods: [202610],
  stamp: 'a',
  noFile: [],
  accountCodes: ['310101'],
  unregistered: [
    { ttd: '7999999', name: 'Танихгүй', amount: '5500.00', count: 1, periods: [202610] },
  ],
  links: [],
  rows: [
    row({}),
    row({
      supplierId: 2,
      code: '90002',
      name: 'Бета',
      registers: '',
      employeeUserId: null,
      employeeName: null,
      ordererName: null,
      employeeMonths: [{ userId: null, name: null, periods: [202610] }],
      purchaseAmount: '0.00',
      receiptCount: 0,
      ebarimtAmount: '0.00',
      ebarimtCount: 0,
      exemptAmount: '0.00',
      diffAmount: '0.00',
    }),
  ],
};

const FILES = {
  latestPeriod: 202610,
  months: [
    { period: 202512, file: null },
    { period: 202610, file: null },
  ],
};

const PAGE = '/finance/ebarimt?period=202610';
const REPORT_ROUTES = {
  'GET /api/v1/ebarimt-check/report': () => json(REPORT),
  'GET /api/v1/ebarimt-check/files': () => json(FILES),
  'GET /api/v1/ebarimt-check/version': () => json({ stamp: 'a' }),
};

describe('EbarimtPage', () => {
  beforeEach(() => sessionStorage.clear());

  it('lists every supplier with the month’s figures from the system, and filters them', async () => {
    renderApp(PAGE, signedIn(ADMIN_ME, REPORT_ROUTES));
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Альфа' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Бета' })).toBeInTheDocument();
    // Short of e-Barimt by 500.
    const alpha = screen.getByRole('link', { name: 'Альфа' }).closest('tr') as HTMLElement;
    expect(within(alpha).getByText('500')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Дутуутай \(1\)/ }));
    expect(screen.queryByRole('link', { name: 'Бета' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Дутуутай \(1\)/ }));

    await user.click(screen.getByRole('button', { name: /Тестбат \(1\)/ }));
    expect(screen.queryByRole('link', { name: 'Бета' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ажилтангүй \(1\)/ }));
    expect(await screen.findByRole('link', { name: 'Бета' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Альфа' })).not.toBeInTheDocument();
  });

  it('opens a month’s receipts in brief, each leading to the receipt itself', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'GET /api/v1/ebarimt-check/receipts': () =>
        json({
          data: [
            {
              id: 42,
              number: 'GR-2026-000042',
              period: 202610,
              day: '2026-10-09',
              supplierDocNo: 'П-1',
              accountCode: '310101',
              accountName: 'Өглөг',
              counted: true,
              pricePending: false,
              lineCount: 3,
              warehouses: 'Бөөний',
              note: null,
              amount: '1000.00',
              createdByName: 'Нярав',
            },
          ],
        }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: орлого 1,000, 1 баримт/ }));
    const dialog = await screen.findByRole('dialog');
    const link = await within(dialog).findByRole('link', { name: /GR-2026-000042/ });
    expect(link).toHaveAttribute('href', '/inventory/receipts/42');
    expect(
      within(dialog).getByText(mn.ebarimtCheck.receipts.title, { exact: false }),
    ).toBeInTheDocument();
  });

  it('saves the exempt amount of one cell alone', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'PUT /api/v1/ebarimt-check/month-values': () => new Response(null, { status: 204 }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн: 100' }),
    );
    const input = screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' });
    await user.clear(input);
    await user.type(input, '2,500{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')[0])).toEqual({
      period: 202610,
      supplierId: 1,
      exemptAmount: '2500',
      previousExemptAmount: '100.00',
    });
  });

  it('shows a saved amount and its difference at once, before the server answers', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      // The answer never comes: only the page's own arithmetic can show the new figures.
      'PUT /api/v1/ebarimt-check/month-values': () => new Promise<Response>(() => undefined),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    const input = screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' });
    await user.clear(input);
    await user.type(input, '250{Enter}');
    expect(
      await screen.findByRole('button', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн: 250' }),
    ).toBeInTheDocument();
    const alpha = screen.getByRole('link', { name: 'Альфа' }).closest('tr') as HTMLElement;
    expect(within(alpha).getByText('350')).toBeInTheDocument();
  });

  it('says when a colleague changed the cell first, and shows what they wrote', async () => {
    let refused = false;
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'GET /api/v1/ebarimt-check/report': () =>
        json(
          refused
            ? { ...REPORT, rows: [row({ exemptAmount: '300.00', diffAmount: '300.00' })] }
            : REPORT,
        ),
      'PUT /api/v1/ebarimt-check/month-values': () => {
        refused = true;
        return problem('EBARIMT_CELL_CONFLICT', 409, { value: '300.00' });
      },
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    const input = screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' });
    await user.clear(input);
    await user.type(input, '250{Enter}');
    expect(await screen.findByText(/өөр хэрэглэгч түрүүлж/)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн: 300' }),
    ).toBeInTheDocument();
  });

  it('refuses a minus rather than saving the opposite amount', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'PUT /api/v1/ebarimt-check/month-values': () => new Response(null, { status: 204 }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    const input = screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' });
    await user.clear(input);
    await user.type(input, '-500{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(0);
    await user.clear(input);
    await user.type(input, '500{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(1),
    );
  });

  it('stands the brief open again when its address names it, as back from a receipt', async () => {
    const { router } = renderApp(
      `${PAGE}&receipts=1`,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/receipts': () => json({ data: [] }),
      }),
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText(mn.ebarimtCheck.receipts.empty)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).not.toContain('receipts'));
  });

  it('reads once when months are chosen one after another, the rows staying', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'GET /api/v1/ebarimt-check/report': () =>
        json({ ...REPORT, periods: [202512, 202609, 202610] }),
      'GET /api/v1/ebarimt-check/files': () =>
        json({
          latestPeriod: 202610,
          months: [
            { period: 202512, file: { id: 1 } },
            { period: 202609, file: { id: 2 } },
            { period: 202610, file: { id: 3 } },
          ],
        }),
    });
    renderApp(`${PAGE}&mode=range`, fetchMock);
    await screen.findByRole('link', { name: 'Альфа' });
    const reads = () => calls(fetchMock, 'GET', '/api/v1/ebarimt-check/report');
    expect(reads()).toHaveLength(1);
    const months = screen.getByRole('group', { name: mn.ebarimtCheck.monthsTitle });
    // In one go: no timer can fire between these, whatever the machine's load.
    fireEvent.click(within(months).getByRole('button', { name: '9' }));
    fireEvent.click(within(months).getByRole('button', { name: '9' }));
    fireEvent.click(within(months).getByRole('button', { name: '10' }));
    expect(screen.getByRole('link', { name: 'Альфа' })).toBeInTheDocument();
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(new URL(reads()[1]?.url ?? 'http://x').searchParams.get('periods')).toBe(
      '202512,202609',
    );
    expect(screen.getByRole('link', { name: 'Альфа' })).toBeInTheDocument();
  });

  it('holds a row on the list while a cell of it is open, and saves only when asked', async () => {
    let answer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let saved = false;
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      // The register typed makes the row even, and «Дутуутай» drops it.
      'GET /api/v1/ebarimt-check/report': () =>
        json(saved ? { ...REPORT, rows: [row({ diffAmount: '0.00' })] } : REPORT),
      'PUT /api/v1/ebarimt-check/suppliers/1/profile': async () => {
        await gate;
        saved = true;
        return new Response(null, { status: 204 });
      },
      'PUT /api/v1/ebarimt-check/month-values': () => new Response(null, { status: 204 }),
    });
    renderApp(`${PAGE}&missing=1`, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: регистр/ }));
    await user.type(screen.getByRole('textbox', { name: 'Альфа: регистр' }), '5{Enter}');
    await user.click(screen.getByRole('button', { name: /Альфа: тайлбар/i }));
    await user.type(screen.getByRole('textbox', { name: /Альфа: тайлбар/i }), 'Ярьсан');
    answer();
    // The report has made the row even: «Дутуутай» would drop it, but a half-typed text stays open.
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/ebarimt-check/report').length).toBe(2),
    );
    expect(screen.getByRole('link', { name: 'Альфа' })).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Альфа' })).toBeNull());
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')[0])).toEqual({
      period: 202610,
      supplierId: 1,
      note: 'Ярьсан',
      previousNote: null,
    });
  });

  it('keeps a month’s ticks through a receipt and back, and no other month’s', async () => {
    const key = `tugeel.ebarimt.ticks.v1:${ADMIN_ME.id}`;
    sessionStorage.setItem(key, JSON.stringify({ period: 202610, ids: [1] }));
    const first = renderApp(PAGE, signedIn(ADMIN_ME, REPORT_ROUTES));
    expect(await screen.findByRole('checkbox', { name: 'Альфа: сонгох' })).toBeChecked();
    first.router.dispose();
    cleanup();

    sessionStorage.setItem(key, JSON.stringify({ period: 202609, ids: [1] }));
    renderApp(PAGE, signedIn(ADMIN_ME, REPORT_ROUTES));
    expect(await screen.findByRole('checkbox', { name: 'Альфа: сонгох' })).not.toBeChecked();
  });

  it('finds the ticks of the month it settles on when opened through the menu', async () => {
    sessionStorage.setItem(
      `tugeel.ebarimt.ticks.v1:${ADMIN_ME.id}`,
      JSON.stringify({ period: 202610, ids: [1] }),
    );
    const { router } = renderApp('/finance/ebarimt', signedIn(ADMIN_ME, REPORT_ROUTES));
    expect(await screen.findByRole('checkbox', { name: 'Альфа: сонгох' })).toBeChecked();
    expect(router.state.location.search).toContain('period=202610');
  });

  it('clears nothing when the tab already chosen is clicked', async () => {
    const { router } = renderApp(`${PAGE}&q=Бета`, signedIn(ADMIN_ME, REPORT_ROUTES));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Бета' });
    await user.click(screen.getByRole('tab', { name: mn.ebarimtCheck.modes.month }));
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('Бета');
    expect(screen.getByRole('searchbox', { name: mn.ebarimtCheck.filters.search })).toHaveValue(
      'Бета',
    );
  });

  it('shows last December chosen alone', async () => {
    renderApp(`${PAGE}&mode=range&months=202512`, signedIn(ADMIN_ME, REPORT_ROUTES));
    expect(await screen.findByRole('link', { name: 'Альфа' })).toBeInTheDocument();
  });

  it('keeps a refused cell said by name while another cell saves', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'PUT /api/v1/ebarimt-check/month-values': async (request) => {
        const body = (await request.clone().json()) as { supplierId: number };
        return body.supplierId === 1
          ? problem('EBARIMT_CELL_CONFLICT', 409, { value: '300.00' })
          : new Response(null, { status: 204 });
      },
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' }),
      '{Control>}a{/Control}250{Enter}',
    );
    const alert = await screen.findByText(/өөр хэрэглэгч түрүүлж/);
    await user.click(screen.getByRole('button', { name: /Бета: НӨАТ чөлөөлөгдөх дүн/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Бета: НӨАТ чөлөөлөгдөх дүн' }),
      '75{Enter}',
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(2),
    );
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Альфа: НӨАТ чөлөөлөгдөх дүн')).toBeInTheDocument();
  });

  it('takes pasted text only when it is plainly an amount', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'PUT /api/v1/ebarimt-check/month-values': () => new Response(null, { status: 204 }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    const input = screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' });
    await user.clear(input);
    for (const text of ['(1,234)', '\u20135000', '1234,56', '1.234']) {
      await user.paste(text);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveValue('');
    }
    // The refused sign is cleared by emptying the cell: it is empty, so leaving it closes it.
    await user.keyboard('{Escape}');
    expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(0);
  });

  it('closes a cell holding only a refused minus, and lets the browser’s shortcuts through', async () => {
    const fetchMock = signedIn(ADMIN_ME, REPORT_ROUTES);
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    // Бета's exempt amount is zero, so the cell opens empty.
    await user.click(await screen.findByRole('button', { name: /Бета: НӨАТ чөлөөлөгдөх дүн/ }));
    const input = screen.getByRole('textbox', { name: 'Бета: НӨАТ чөлөөлөгдөх дүн' });
    await user.click(input);
    await user.keyboard('{Control>}-{/Control}');
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.keyboard('-');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Бета: НӨАТ чөлөөлөгдөх дүн' })).toBeNull();
  });

  it('offers a reload when a colleague has changed something, moving no row', async () => {
    let stamp = 'a';
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'GET /api/v1/ebarimt-check/report': () => json({ ...REPORT, stamp }),
      'GET /api/v1/ebarimt-check/version': () => json({ stamp }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    const mark = () =>
      screen.queryByRole('button', { name: new RegExp(mn.ebarimtCheck.staleTitle) });
    await screen.findByRole('link', { name: 'Альфа' });
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/ebarimt-check/version').length).toBe(1),
    );
    expect(mark()).toBeNull();
    const reads = calls(fetchMock, 'GET', '/api/v1/ebarimt-check/report').length;

    // The poll is newer than the rows; a stamp read in the same instant counts as well.
    await new Promise((resolve) => setTimeout(resolve, 5));
    stamp = 'b';
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(mark()).toBeInTheDocument());
    expect(calls(fetchMock, 'GET', '/api/v1/ebarimt-check/report')).toHaveLength(reads);

    await user.click(mark() as HTMLElement);
    await waitFor(() => expect(mark()).toBeNull());
    expect(calls(fetchMock, 'GET', '/api/v1/ebarimt-check/report').length).toBeGreaterThan(reads);
    focusManager.setFocused(undefined);
  });

  it('says no tick is hidden while the rows are still to come', async () => {
    sessionStorage.setItem(
      `tugeel.ebarimt.ticks.v1:${ADMIN_ME.id}`,
      JSON.stringify({ period: 202610, ids: [1] }),
    );
    renderApp(
      PAGE,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/report': () => new Promise<Response>(() => undefined),
      }),
    );
    expect(await screen.findByRole('heading', { name: mn.ebarimtCheck.title })).toBeInTheDocument();
    expect(screen.queryByText(/шүүлтээс гадуур/)).toBeNull();
  });

  it('lists a negative total under «zero or less», not «> 0»', async () => {
    renderApp(
      `${PAGE}&c_ebarimt=positive`,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/report': () =>
          json({ ...REPORT, rows: [row({ ebarimtAmount: '-400.00', diffAmount: '1400.00' })] }),
      }),
    );
    expect(await screen.findByText(mn.ebarimtCheck.emptySearch)).toBeInTheDocument();
  });

  it('says a cell left with changes was not saved, and saves nothing', async () => {
    const fetchMock = signedIn(ADMIN_ME, REPORT_ROUTES);
    const { router } = renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: НӨАТ чөлөөлөгдөх дүн/ }));
    await user.type(screen.getByRole('textbox', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' }), '25');
    await act(async () => {
      await router.navigate('/finance/customers');
    });
    expect(
      await screen.findByText(/Альфа: НӨАТ чөлөөлөгдөх дүн: хадгалагдаагүй/),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/month-values')).toHaveLength(0);
  });

  it('marks a purchase still waiting for its price check', async () => {
    renderApp(
      PAGE,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/report': () =>
          json({ ...REPORT, rows: [row({ pendingCount: 2 })] }),
      }),
    );
    const button = await screen.findByRole('button', { name: /Альфа: орлого/ });
    expect(button).toHaveAttribute('title', expect.stringContaining('2 баримтын үнэ шалгаагүй'));
  });

  it('counts the ticks a filter hides, and leaves them out of nothing', async () => {
    renderApp(PAGE, signedIn(ADMIN_ME, REPORT_ROUTES));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Альфа: сонгох' }));
    expect(screen.queryByText(/шүүлтээс гадуур/)).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('searchbox', { name: mn.ebarimtCheck.filters.search }),
      'Бета',
    );
    expect(await screen.findByText('1 нь шүүлтээс гадуур')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Альфа' })).not.toBeInTheDocument();
  });

  it('opens with the filters its address holds, as when coming back from a receipt', async () => {
    renderApp(`${PAGE}&c_supplier=Бета`, signedIn(ADMIN_ME, REPORT_ROUTES));
    expect(await screen.findByRole('link', { name: 'Бета' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Альфа' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('textbox', {
        name: mn.ebarimtCheck.filters.column.replace(
          '{{column}}',
          mn.ebarimtCheck.columns.supplier,
        ),
      }),
    ).toHaveValue('Бета');
  });

  it('keeps what is searched in the address', async () => {
    const { router } = renderApp(PAGE, signedIn(ADMIN_ME, REPORT_ROUTES));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Альфа' });
    await user.type(screen.getByRole('searchbox', { name: mn.ebarimtCheck.filters.search }), 'Бе');
    await user.click(screen.getByRole('button', { name: /Дутуутай \(1\)/ }));
    await waitFor(() => expect(router.state.location.search).toContain('missing=1'));
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('Бе');
  });

  it('says which month has no file and offers the upload', async () => {
    renderApp(
      PAGE,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/report': () => json({ ...REPORT, noFile: [202610] }),
      }),
    );
    expect(
      await screen.findByRole('button', { name: /e-Barimt файл оруулаагүй байна.*Файл оруулах/ }),
    ).toHaveTextContent(mn.ebarimtCheck.noFileShort);
  });

  it('asks which accounts count, inside the page', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...REPORT_ROUTES,
      'GET /api/v1/ebarimt-check/settings': () =>
        json({
          accounts: [
            { code: '310101', name: 'Өглөг', isDefault: true, counted: true },
            { code: '313011', name: 'Тооллого', isDefault: false, counted: false },
          ],
        }),
      'PUT /api/v1/ebarimt-check/settings': () => json({ accounts: [] }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.ebarimtCheck.actions.settings }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('checkbox', { name: /313011/ }));
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/settings')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/ebarimt-check/settings')[0])).toEqual({
      accountCodes: ['310101', '313011'],
    });
  });
});
