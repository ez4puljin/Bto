import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTANT_ME } from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';

type Receipt = components['schemas']['EbarimtReceipt'];
type Detail = components['schemas']['EbarimtReceiptDetail'];

const texts = mn.finance.ebarimtReceipts;

// Synthetic values only: never a real TIN, ДДТД, lottery or QR.
const CONFIRMED: Receipt = {
  id: 1,
  sourceSystem: 'BTO',
  sourceDocType: 'SALES_INVOICE',
  sourceDocId: '11',
  docNumber: 'Н-20261111-0001',
  orderNumber: 'З-0001',
  buyerName: 'Туршилтын иргэн',
  receiptType: 'B2C',
  status: 'CONFIRMED',
  errorCode: null,
  message: null,
  customerTin: null,
  consumerNo: null,
  total: '2000.00',
  vatTotal: '181.82',
  cityTaxTotal: '0.00',
  attempt: 1,
  claimedAt: '2026-11-11T02:00:00.000Z',
  claimedNodeCode: 'SM1',
  ddtd: '000000000000000000000000000000001',
  posapiDate: '2026-11-11 10:00:01',
  issuedAt: '2026-11-11T02:00:01.000Z',
  cancelStatus: null,
  cancelReason: null,
  cancelMessage: null,
  cancelledAt: null,
  printable: true,
  createdAt: '2026-11-11T01:59:00.000Z',
};
const UNANSWERED: Receipt = {
  ...CONFIRMED,
  id: 2,
  sourceDocId: '12',
  docNumber: 'Н-20261111-0002',
  buyerName: 'Туршилт ХХК',
  receiptType: 'B2B',
  customerTin: '10000000001',
  status: 'INDETERMINATE',
  message: 'no answer within 20000 ms',
  ddtd: null,
  posapiDate: null,
  issuedAt: null,
  printable: false,
};
const REFUSED: Receipt = {
  ...UNANSWERED,
  id: 3,
  sourceDocId: '13',
  docNumber: 'Н-20261111-0003',
  status: 'ERROR',
  errorCode: 'TIN_PENDING',
  message: 'the company has no TIN yet',
  customerTin: null,
};
const DETAIL: Detail = {
  ...CONFIRMED,
  printable: false,
  merchantTin: '20000000002',
  merchantName: 'Туршилтын худалдагч',
  lines: [
    {
      name: 'Кола бөөний',
      barCode: null,
      barCodeType: 'UNDEFINED',
      classificationCode: null,
      taxType: 'VAT_ABLE',
      taxProductCode: null,
      measureUnit: 'ш',
      qty: '2.000',
      total: '2000.00',
      vat: '181.82',
      cityTax: '0.00',
    },
  ],
  payments: [{ code: 'CASH', amount: '2000.00' }],
};
const ATTENTION = {
  pending: 0,
  error: 1,
  indeterminate: 1,
  cancelOpen: 0,
  relaySeenAt: '2026-11-11T02:00:05.000Z',
  relayNodeCode: 'SM1',
};

/** «Санхүү → e-Barimt баримт» (ADR-0185): the list's actions and the print with its one lottery. */
describe('wholesale e-Barimt receipts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('lists the receipts with what each one lets the accountant do', async () => {
    const user = userEvent.setup();
    let resolved: unknown = null;
    let retried = 0;
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/ebarimt/receipts': () =>
        json({ data: [REFUSED, UNANSWERED, CONFIRMED], nextCursor: null }),
      'GET /api/v1/ebarimt/receipts/attention': () => json(ATTENTION),
      'POST /api/v1/ebarimt/receipts/2/resolve': async (request) => {
        resolved = await request.json();
        return json({ ...DETAIL, ...UNANSWERED, status: 'CONFIRMED' });
      },
      'POST /api/v1/invoices/13/ebarimt': () => {
        retried += 1;
        return json({ ...REFUSED, status: 'PENDING', errorCode: null, message: null });
      },
    });
    renderApp('/finance/ebarimt-receipts', fetchMock);

    const issued = await screen.findByRole('row', { name: /Н-20261111-0001/ });
    expect(within(issued).getByText(texts.statuses.CONFIRMED)).toBeInTheDocument();
    // The lottery is still in the server's memory: the print says so and opens its own tab.
    expect(within(issued).getByRole('link', { name: texts.printWithLottery })).toHaveAttribute(
      'href',
      '/finance/ebarimt-receipts/1/print',
    );
    expect(screen.getByText(/SM1/)).toBeInTheDocument();

    // A refused one names its reason and is prepared again from its invoice.
    const refused = screen.getByRole('row', { name: /Н-20261111-0003/ });
    expect(within(refused).getByText(new RegExp(texts.errors.TIN_PENDING))).toBeInTheDocument();
    await user.click(within(refused).getByRole('button', { name: texts.retry }));
    await waitFor(() => expect(retried).toBe(1));

    // An unanswered one is decided by a person, with what ebarimt.mn shows.
    const unanswered = screen.getByRole('row', { name: /Н-20261111-0002/ });
    expect(within(unanswered).queryByRole('link', { name: texts.print })).toBeNull();
    await user.click(within(unanswered).getByRole('button', { name: texts.resolve }));
    const dialog = within(await screen.findByRole('dialog', { name: texts.resolveTitle }));
    const submit = dialog.getByRole('button', { name: texts.resolveIssued });
    expect(submit).toBeDisabled();
    await user.click(dialog.getByLabelText(texts.ddtd));
    await user.paste('9'.repeat(33));
    await user.click(dialog.getByLabelText(texts.posapiDate));
    await user.paste('2026-11-11 09:30:00');
    await user.click(submit);
    await waitFor(() =>
      expect(resolved).toEqual({
        outcome: 'ISSUED',
        ddtd: '9'.repeat(33),
        posapiDate: '2026-11-11 09:30:00',
      }),
    );
  });

  it('prints the lottery and the QR code once, and a copy afterwards', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    let asked = 0;
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'POST /api/v1/ebarimt/receipts/1/print': () => {
        asked += 1;
        return asked === 1
          ? json({
              receipt: DETAIL,
              secrets: { lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' },
              copy: false,
            })
          : json({ receipt: DETAIL, secrets: null, copy: true });
      },
    });
    renderApp('/finance/ebarimt-receipts/1/print?format=80mm', fetchMock);
    expect(await screen.findByText('Туршилтын худалдагч')).toBeInTheDocument();
    expect(screen.getByText('20000000002')).toBeInTheDocument();
    expect(screen.getByText(CONFIRMED.ddtd ?? '')).toBeInTheDocument();
    expect(screen.getByText('2026-11-11 10:00:01')).toBeInTheDocument();
    expect(screen.getByText('Кола бөөний')).toBeInTheDocument();
    expect(screen.getByText('181.82')).toBeInTheDocument();
    expect(
      screen.getByText(texts.sheet.lottery.replace('{{lottery}}', 'TEST-LOT-1')),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: texts.sheet.qr })).toBeInTheDocument();
    expect(screen.queryByText(texts.sheet.copy)).toBeNull();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // The page asked once; nothing of the secrets is kept in the browser's storage.
    expect(asked).toBe(1);
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toMatch(
      /TEST-(LOT|QR)/,
    );
    cleanup();

    renderApp('/finance/ebarimt-receipts/1/print?format=a4', fetchMock);
    expect(await screen.findByText(texts.sheet.copy)).toBeInTheDocument();
    expect(screen.getByText(texts.sheet.copyNote)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: texts.sheet.qr })).toBeNull();
    expect(screen.queryByText(/TEST-LOT/)).toBeNull();
  });
});
