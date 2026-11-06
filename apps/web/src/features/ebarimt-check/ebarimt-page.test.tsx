import mn from '@tugeel/shared/i18n/mn.json';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

const row = (over: Record<string, unknown>) => ({
  supplierId: 1,
  code: '50188',
  name: 'Альфа',
  status: 'ACTIVE',
  registers: '7000001',
  registersDefault: null,
  phone: '',
  phoneDefault: null,
  remark: '',
  sharedRegisters: [],
  employeeUserId: 7,
  employeeName: 'Дэнсмаа',
  ordererName: 'Дэнсмаа',
  employeeAssigned: false,
  employeeMonths: [{ userId: 7, name: 'Дэнсмаа', periods: [202610] }],
  purchaseAmount: '1000.00',
  receiptCount: 1,
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
      code: '50474',
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
};

describe('EbarimtPage', () => {
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

    await user.click(screen.getByRole('button', { name: /Дэнсмаа \(1\)/ }));
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
            },
          ],
        }),
    });
    renderApp(PAGE, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Альфа: 1 орлогын баримт/ }));
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
    await user.click(await screen.findByRole('button', { name: 'Альфа: НӨАТ чөлөөлөгдөх дүн' }));
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
    });
  });

  it('says which month has no file and offers the upload', async () => {
    renderApp(
      PAGE,
      signedIn(ADMIN_ME, {
        ...REPORT_ROUTES,
        'GET /api/v1/ebarimt-check/report': () => json({ ...REPORT, noFile: [202610] }),
      }),
    );
    expect(await screen.findByText(/e-Barimt файл оруулаагүй байна/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: mn.ebarimtCheck.uploadNow })).toBeInTheDocument();
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
