import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { addDays, businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls, list, UUID } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-27T03:00:00.000Z';

const BATCH: Schemas['PosVoucherBatch'] = {
  id: 31,
  number: 'В-0031',
  kind: 'PARTNER',
  name: 'Шинэ жилийн бэлэг',
  effect: 'AMOUNT',
  value: '50000.00',
  customerId: 9,
  customerName: 'Номин дэлгүүр',
  validFrom: '2026-11-01',
  validTo: '2026-12-31',
  qty: 20,
  redeemed: 3,
  status: 'ACTIVE',
  note: null,
  createdAt: STAMP,
  createdByName: 'Админ Бат',
  stoppedAt: null,
};

const DETAIL: Schemas['PosVoucherBatchDetail'] = {
  ...BATCH,
  codes: [
    {
      id: 301,
      seq: 1,
      code: '9921234567890124',
      status: 'REDEEMED',
      saleId: 51,
      saleNumber: 'К1-0051',
      redeemedAt: STAMP,
      amount: '42000.00',
    },
    {
      id: 302,
      seq: 2,
      code: '9925555555555553',
      status: 'ISSUED',
      saleId: null,
      saleNumber: null,
      redeemedAt: null,
      amount: null,
    },
  ],
  uses: [
    {
      id: 401,
      saleId: 51,
      saleNumber: 'К1-0051',
      soldAt: STAMP,
      voucherId: 301,
      batchId: 31,
      batchNumber: 'В-0031',
      kind: 'PARTNER',
      code: '9921234567890124',
      face: '50000.00',
      amount: '42000.00',
      issue: 'EXPIRED',
      invoiceId: null,
      invoiceNumber: null,
      reviewedAt: null,
      reviewNote: null,
    },
  ],
};

const CUSTOMER_ROW = {
  id: 9,
  code: '1001',
  kind: 'COMPANY',
  name: 'Номин дэлгүүр',
  regNo: null,
  tin: null,
  phone: null,
  status: 'ACTIVE',
  creditHold: false,
  tinPending: false,
  address: null,
  hasGps: false,
  contact: null,
};

const routes = () => ({
  'GET /api/v1/pos/voucher-batches': () => list([BATCH]),
  'GET /api/v1/pos/voucher-batches/31': () => json(DETAIL),
  'GET /api/v1/customers': () => list([CUSTOMER_ROW]),
  'GET /api/v1/pos/attention': () =>
    json({
      openShifts: 0,
      shiftsToHandOver: 0,
      openShortfalls: 0,
      rejections: 0,
      receiptsToCheck: 0,
      creditToCheck: 0,
      vouchersToCheck: 1,
    }),
});

const panelName = mn.pos.vouchers.panelTitle
  .replace('{{kind}}', mn.pos.vouchers.kinds.PARTNER)
  .replace('{{number}}', 'В-0031');

describe('coupons and partner vouchers (ADR-0110)', () => {
  it('lists a batch under «Купон, ваучер» and opens it in the panel', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, routes());
    renderApp('/pos/vouchers', fetchMock);
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.posVouchers })).toHaveAttribute(
      'href',
      '/pos/vouchers',
    );
    const row = await screen.findByRole('row', { name: /В-0031/ });
    expect(within(row).getByText(mn.pos.vouchers.kinds.PARTNER)).toBeInTheDocument();
    expect(within(row).getByText('50,000₮')).toBeInTheDocument();
    expect(within(row).getByText('Номин дэлгүүр')).toBeInTheDocument();
    expect(within(row).getByText('2026-11-01 – 2026-12-31')).toBeInTheDocument();
    expect(within(row).getByText('3 / 20')).toBeInTheDocument();
    expect(within(row).getByText(mn.pos.vouchers.statuses.ACTIVE)).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'В-0031' });
    expect(link).toHaveAttribute('href', '/pos/vouchers?batch=31');
    await user.click(link);
    const panel = within(await screen.findByRole('dialog', { name: panelName }));
    // The code in the codes table and on the use to check.
    expect(panel.getAllByText('9921 2345 6789 0124')).toHaveLength(2);
    expect(panel.getByText('9925 5555 5555 5553')).toBeInTheDocument();
    expect(panel.getByText(mn.pos.vouchers.issues.EXPIRED)).toBeInTheDocument();
    expect(panel.getByRole('link', { name: mn.pos.vouchers.actions.printUsed })).toHaveAttribute(
      'href',
      '/pos/vouchers/31/print?used=1',
    );
  });

  it('creates a partner batch with the partner, its face value and the default days', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/voucher-batches': () => json(DETAIL, 201),
    });
    renderApp('/pos/vouchers?new=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.pos.vouchers.dialog.title }),
    );
    await user.selectOptions(dialog.getByLabelText(mn.pos.vouchers.fields.kind), 'PARTNER');
    // A partner voucher has no effect to choose: always its face value.
    expect(dialog.queryByLabelText(mn.pos.vouchers.fields.effect)).toBeNull();
    // Pasted, not typed: the full run's parallel workers make long typing slow (no retries).
    await user.click(dialog.getByLabelText(mn.pos.vouchers.fields.name));
    await user.paste('Шинэ жилийн бэлэг');
    await user.type(await dialog.findByPlaceholderText(mn.partners.customerPicker.search), 'номин');
    await user.click(await dialog.findByRole('button', { name: /Номин дэлгүүр/ }));
    await user.click(dialog.getByLabelText(mn.pos.vouchers.fields.faceValue));
    await user.paste('50000');
    await user.clear(dialog.getByLabelText(mn.pos.vouchers.fields.qty));
    await user.click(dialog.getByLabelText(mn.pos.vouchers.fields.qty));
    await user.paste('20');
    await user.click(dialog.getByRole('button', { name: mn.pos.vouchers.dialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/voucher-batches')).toHaveLength(1),
    );
    const [created] = calls(fetchMock, 'POST', '/api/v1/pos/voucher-batches');
    expect(created?.headers.get('Idempotency-Key')).toMatch(UUID);
    const today = businessDate();
    expect(await bodyOf(created)).toEqual({
      kind: 'PARTNER',
      name: 'Шинэ жилийн бэлэг',
      effect: 'AMOUNT',
      value: '50000',
      customerId: 9,
      validFrom: today,
      validTo: addDays(today, 30),
      qty: 20,
      note: null,
    });
    // The new batch opens in the panel.
    expect(
      await screen.findByRole('dialog', { name: panelName }, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it('stops an active batch after asking', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/voucher-batches/31/stop': () =>
        json({ ...BATCH, status: 'STOPPED', stoppedAt: STAMP }),
    });
    renderApp('/pos/vouchers?batch=31', fetchMock);
    const panel = within(await screen.findByRole('dialog', { name: panelName }));
    await user.click(await panel.findByRole('button', { name: mn.pos.vouchers.actions.stop }));
    const confirm = within(await screen.findByRole('dialog', { name: mn.pos.vouchers.stopTitle }));
    await user.click(confirm.getByRole('button', { name: mn.pos.vouchers.actions.stop }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/voucher-batches/31/stop')).toHaveLength(1),
    );
  });

  it('marks a use with an issue as checked', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/sale-vouchers/401/review': () =>
        json({ ...DETAIL.uses[0], reviewedAt: STAMP }),
    });
    renderApp('/pos/vouchers?batch=31', fetchMock);
    const panel = within(await screen.findByRole('dialog', { name: panelName }));
    await user.click(
      await panel.findByRole('button', {
        name: mn.pos.vouchers.reviewLabel.replace('{{code}}', '9921 2345 6789 0124'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/sale-vouchers/401/review')).toHaveLength(1),
    );
    expect(
      await bodyOf(calls(fetchMock, 'POST', '/api/v1/pos/sale-vouchers/401/review')[0]),
    ).toEqual({ note: null });
  });
});
