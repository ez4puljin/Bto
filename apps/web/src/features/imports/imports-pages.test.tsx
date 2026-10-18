import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-11T02:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
};

const JOB: Schemas['ImportJob'] = {
  id: 5,
  kind: 'PRODUCTS',
  fileName: 'Бараа.xlsx',
  status: 'INVALID',
  phase: null,
  totalRows: 3,
  processedRows: 3,
  errorRows: 1,
  warningRows: 0,
  summary: {
    actions: { CREATE: 1, UPDATE: 1, UNCHANGED: 0 },
    errors: { NOT_FOUND: 1 },
    warnings: {},
  },
  lastError: null,
  receiptOptions: null,
  issueOptions: null,
  canRevert: false,
  createdAt: STAMP,
  validatedAt: STAMP,
  committedAt: null,
  revertedAt: null,
  updatedAt: STAMP,
};
const ROWS: Schemas['ImportRow'][] = [
  {
    rowNo: 3,
    // jsonb keeps shorter keys first, not the template order.
    raw: {
      sku: '1002',
      name: 'Цэвэр ус',
      boxQty: '0',
      category: 'Цай',
      supplier: null,
    },
    errors: [
      { column: 'category', code: 'NOT_FOUND', params: { value: 'Цай' } },
      { column: 'boxQty', code: 'NOT_POSITIVE', params: {} },
    ],
    warnings: [],
    action: null,
    changed: [],
  },
];

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('imports menu', () => {
  it('shows imports to admins only', async () => {
    renderApp('/system/status', signedIn(ADMIN_ME));
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.imports })).toBeInTheDocument();
  });

  it('keeps imports from the warehouse', async () => {
    renderApp('/system/status', signedIn(WAREHOUSE_ME));
    const nav = await findSidebar();
    expect(within(nav).queryByRole('link', { name: mn.nav.imports })).toBeNull();
  });
});

describe('import upload', () => {
  it('uploads an .xlsx sheet as .xlsx whatever the browser says and opens its check', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports': () => json({ data: [], nextCursor: null }),
      'POST /api/v1/files/presign': () =>
        json(
          {
            fileId: 41,
            uploadUrl: '/api/v1/files/local/x.xlsx?exp=1&sig=s',
            method: 'PUT',
            headers: { 'Content-Type': XLSX },
            expiresAt: STAMP,
          },
          201,
        ),
      'PUT /api/v1/files/local/x.xlsx': () => new Response(null, { status: 204 }),
      'POST /api/v1/imports': () => json({ ...JOB, status: 'UPLOADED', totalRows: 0 }, 201),
      'GET /api/v1/imports/5': () => json({ ...JOB, status: 'UPLOADED', totalRows: 0 }),
    });
    // The upload itself is a plain fetch to the signed URL (no token): route it to the mock too.
    const put = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => fetchMock(new Request(input, init)));
    renderApp('/imports', fetchMock);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(
      `${mn.imports.upload}: ${mn.imports.kinds.PRODUCTS}`,
    );
    await user.upload(
      input,
      new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Бараа.xlsx', { type: '' }),
    );
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/imports')).toHaveLength(1));
    const presign = calls(fetchMock, 'POST', '/api/v1/files/presign')[0];
    expect(await presign?.clone().json()).toEqual({
      kind: 'imports.source',
      contentType: XLSX,
      sizeBytes: 4,
    });
    const created = calls(fetchMock, 'POST', '/api/v1/imports')[0];
    expect(await created?.clone().json()).toEqual({
      kind: 'PRODUCTS',
      fileId: 41,
      fileName: 'Бараа.xlsx',
    });
    expect(created?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('heading', { name: 'Бараа.xlsx' })).toBeInTheDocument();
    put.mockRestore();
  });

  it('refuses an old .xls file before uploading', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports': () => json({ data: [], nextCursor: null }),
    });
    renderApp('/imports', fetchMock);
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText(
      `${mn.imports.upload}: ${mn.imports.kinds.CUSTOMERS}`,
    );
    await user.upload(input, new File([new Uint8Array([1])], 'old.xls'));
    expect(await screen.findByText(mn.imports.xlsxOnly)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/files/presign')).toHaveLength(0);
  });
});

describe('import check', () => {
  it('lists the problems of each row in Mongolian and offers no commit while any remains', async () => {
    renderApp(
      '/imports/5',
      signedIn(ADMIN_ME, {
        'GET /api/v1/imports/5': () => json(JOB),
        'GET /api/v1/imports/5/rows': () => json({ data: ROWS, nextCursor: null }),
      }),
    );
    expect(await screen.findByText('Ангилал: «Цай» олдсонгүй')).toBeInTheDocument();
    expect(
      screen.getByText('Код: 1002 · Нэр: Цэвэр ус · Ангилал: Цай · Хайрцаг дахь тоо: 0'),
    ).toBeInTheDocument();
    expect(screen.getByText(mn.imports.invalidHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.imports.commit })).toBeNull();
  });

  it('says the rows of an old refused import were cleaned up and keeps its counts', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports/5': () =>
        json({ ...JOB, summary: { ...JOB.summary, rowsPruned: true } }),
    });
    renderApp('/imports/5', fetchMock);
    expect(await screen.findByText(mn.imports.rowsPruned)).toBeInTheDocument();
    expect(screen.getByText(/^3 мөр:/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/imports/5/rows')).toHaveLength(0);
  });

  it('commits a checked import once after confirmation', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports/5': () => json({ ...JOB, status: 'VALIDATED', errorRows: 0 }),
      'GET /api/v1/imports/5/rows': () =>
        json({
          data: [
            { ...ROWS[0], errors: [], action: 'UPDATE', changed: ['name', 'categoryId'] },
            { ...ROWS[0], rowNo: 4, errors: [], action: 'CREATE', changed: ['homeWarehouse'] },
          ],
          nextCursor: null,
        }),
      'POST /api/v1/imports/5/commit': () => json({ ...JOB, status: 'COMMITTING', errorRows: 0 }),
    });
    renderApp('/imports/5', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('Өөрчлөгдөх: Нэр, Ангилал')).toBeInTheDocument();
    expect(screen.getByText(mn.imports.actions.CREATE)).toBeInTheDocument();
    expect(screen.queryByText(/Харьяа агуулах/)).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.imports.commit }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.imports.commit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/imports/5/commit')).toHaveLength(1),
    );
    expect(
      calls(fetchMock, 'POST', '/api/v1/imports/5/commit')[0]?.headers.get('Idempotency-Key'),
    ).toMatch(UUID);
  });
});

describe('price sheet (ADR-0054)', () => {
  it('offers the price template and says what a committed price import completed', async () => {
    renderApp(
      '/imports',
      signedIn(ADMIN_ME, { 'GET /api/v1/imports': () => json({ data: [], nextCursor: null }) }),
    );
    expect(await screen.findByText(mn.imports.kindHints.PRICES)).toBeInTheDocument();
    expect(
      screen.getByLabelText(`${mn.imports.upload}: ${mn.imports.kinds.PRICES}`),
    ).toBeInTheDocument();
  });

  it('counts the completed products and explains the revert of prices', async () => {
    const committed: Schemas['ImportJob'] = {
      ...JOB,
      kind: 'PRICES',
      fileName: 'Үнэ.xlsx',
      status: 'COMMITTED',
      errorRows: 0,
      canRevert: true,
      committedAt: STAMP,
      summary: {
        actions: { CREATE: 2, UPDATE: 1, UNCHANGED: 0 },
        applied: { CREATE: 2, UPDATE: 1, UNCHANGED: 0, COMPLETED: 2 },
      },
    };
    renderApp(
      '/imports/5',
      signedIn(ADMIN_ME, {
        'GET /api/v1/imports/5': () => json(committed),
        'GET /api/v1/imports/5/rows': () => json({ data: [], nextCursor: null }),
      }),
    );
    const user = userEvent.setup();
    expect(
      await screen.findByText('2 бараа «Үнэ хүлээгдэж буй»-аас гарч захиалгад орно'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.imports.revert }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(mn.imports.revertPricesDescription)).toBeInTheDocument();
  });
});

describe('receipts import (ADR-0078)', () => {
  it('names the warehouse and the payment before the sheet and sends them with it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports': () => json({ data: [], nextCursor: null }),
      'GET /api/v1/warehouses': () =>
        json({
          data: [
            {
              id: 1,
              code: 'WH1',
              name: 'Төв агуулах',
              kind: 'WHOLESALE',
              branchId: 1,
              status: 'ACTIVE',
              createdAt: STAMP,
              updatedAt: STAMP,
            },
          ],
        }),
      'GET /api/v1/receipts/payment-accounts': () =>
        json([
          { id: 7, code: 'CASH-1', name: 'Касс', kind: 'CASH' },
          { id: 8, code: 'KHAN', name: 'Хаан банк', kind: 'BANK' },
        ]),
      'POST /api/v1/files/presign': () =>
        json(
          {
            fileId: 42,
            uploadUrl: '/api/v1/files/local/r.xlsx?exp=1&sig=s',
            method: 'PUT',
            headers: { 'Content-Type': XLSX },
            expiresAt: STAMP,
          },
          201,
        ),
      'PUT /api/v1/files/local/r.xlsx': () => new Response(null, { status: 204 }),
      'POST /api/v1/imports': () => json({ ...JOB, kind: 'RECEIPTS', status: 'UPLOADED' }, 201),
      'GET /api/v1/imports/5': () => json({ ...JOB, kind: 'RECEIPTS', status: 'UPLOADED' }),
    });
    const put = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => fetchMock(new Request(input, init)));
    renderApp('/imports', fetchMock);
    const user = userEvent.setup();
    const warehouse = await screen.findByRole('combobox', {
      name: mn.imports.receiptOptions.warehouse,
    });
    const upload = screen.getAllByRole('button', { name: mn.imports.upload });
    expect(upload.some((button) => button.hasAttribute('disabled'))).toBe(true);
    await within(warehouse).findByRole('option', { name: 'Төв агуулах' });
    await user.selectOptions(warehouse, 'Төв агуулах');
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.imports.receiptOptions.payment }),
      mn.imports.receiptOptions.methods.CASH,
    );
    await user.selectOptions(
      await screen.findByRole('combobox', { name: mn.imports.receiptOptions.account }),
      'Касс',
    );
    expect(screen.queryByRole('option', { name: 'Хаан банк' })).not.toBeInTheDocument();
    await user.upload(
      screen.getByLabelText(`${mn.imports.upload}: ${mn.imports.kinds.RECEIPTS}`),
      new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Падаан.xlsx'),
    );
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/imports')).toHaveLength(1));
    expect(await calls(fetchMock, 'POST', '/api/v1/imports')[0]?.clone().json()).toEqual({
      kind: 'RECEIPTS',
      fileId: 42,
      fileName: 'Падаан.xlsx',
      receiptOptions: { warehouseId: 1, paymentMethod: 'CASH', moneyAccountId: 7 },
    });
    put.mockRestore();
  });
});

describe('issues import (ADR-0081)', () => {
  it('names the warehouse before the sheet and sends it with it', async () => {
    const warehouse = (id: number, name: string, kind: Schemas['WarehouseKind']) => ({
      id,
      code: `WH${id}`,
      name,
      kind,
      branchId: 1,
      status: 'ACTIVE',
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/imports': () => json({ data: [], nextCursor: null }),
      'GET /api/v1/warehouses': () =>
        json({
          data: [
            warehouse(1, 'Төв агуулах', 'WHOLESALE'),
            warehouse(2, 'Супермаркет', 'STORE'),
            warehouse(3, 'Машин 1', 'VEHICLE'),
          ],
          nextCursor: null,
        }),
      'POST /api/v1/files/presign': () =>
        json(
          {
            fileId: 43,
            uploadUrl: '/api/v1/files/local/i.xlsx?exp=1&sig=s',
            method: 'PUT',
            headers: { 'Content-Type': XLSX },
            expiresAt: STAMP,
          },
          201,
        ),
      'PUT /api/v1/files/local/i.xlsx': () => new Response(null, { status: 204 }),
      'POST /api/v1/imports': () => json({ ...JOB, kind: 'ISSUES', status: 'UPLOADED' }, 201),
      'GET /api/v1/imports/5': () => json({ ...JOB, kind: 'ISSUES', status: 'UPLOADED' }),
    });
    const put = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => fetchMock(new Request(input, init)));
    renderApp('/imports', fetchMock);
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: mn.imports.issueOptions.warehouse });
    const input = screen.getByLabelText(`${mn.imports.upload}: ${mn.imports.kinds.ISSUES}`);
    const upload = input.parentElement!.querySelector('button')!;
    expect(upload).toBeDisabled();
    // Goods leave a warehouse or the store, never a van.
    expect(await within(select).findByRole('option', { name: 'Супермаркет' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Машин 1' })).toBeNull();
    await user.selectOptions(select, 'Супермаркет');
    expect(upload).toBeEnabled();
    await user.upload(input, new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Зарлага.xlsx'));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/imports')).toHaveLength(1));
    expect(await calls(fetchMock, 'POST', '/api/v1/imports')[0]?.clone().json()).toEqual({
      kind: 'ISSUES',
      fileId: 43,
      fileName: 'Зарлага.xlsx',
      issueOptions: { warehouseId: 2 },
    });
    put.mockRestore();
  });
});
