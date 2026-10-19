import { screen, waitFor } from '@testing-library/react';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNTANT_ME } from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';
import { INVOICE, PAYMENT } from './finance-fixtures';

/** The invoice and the voucher on paper (ADR-0060 #11): rendered without the shell, printed once. */
describe('finance print pages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('prints an invoice with its lines and totals on A4', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(
      '/finance/invoices/11/print?format=a4',
      signedIn(ACCOUNTANT_ME, { 'GET /api/v1/invoices/11': () => json(INVOICE) }),
    );
    expect(
      await screen.findByRole('heading', { name: mn.finance.print.invoice }),
    ).toBeInTheDocument();
    expect(screen.getByText('Н-20261016-0001')).toBeInTheDocument();
    expect(screen.getByText('Кока кола')).toBeInTheDocument();
    expect(screen.getAllByText('150,000').length).toBeGreaterThan(0);
    expect(screen.getByText('13,636.36')).toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: mn.sales.print.formats.A4 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.title).toContain('Н-20261016-0001');
  });

  it('heads the paper with the legal name from «Компани» (ADR-0084)', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(
      '/finance/invoices/11/print?format=a4',
      signedIn(ACCOUNTANT_ME, {
        'GET /api/v1/invoices/11': () => json(INVOICE),
        'GET /api/v1/company': () =>
          json({
            code: 'BO',
            legalName: 'Туршилтын шинэ нэр ХХК',
            registerNo: null,
            tin: null,
            functionalCurrency: 'MNT',
            timezone: 'Asia/Ulaanbaatar',
            fiscalYearStartMonth: 1,
            status: 'ACTIVE',
            taxRegistrations: [],
            branches: [],
          }),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Туршилтын шинэ нэр ХХК' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(mn.brand.company)).toBeNull();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it('prints a voucher on the 80 mm roll with the payer and the settled invoices', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(
      '/finance/payments/21/print?format=80mm',
      signedIn(ACCOUNTANT_ME, { 'GET /api/v1/payments/21': () => json(PAYMENT) }),
    );
    expect(
      await screen.findByRole('heading', { name: new RegExp(mn.finance.print.voucherIn) }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Номин дэлгүүр/)).toBeInTheDocument();
    expect(screen.getAllByText(/50,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Н-20261016-0001')).toBeInTheDocument();
    expect(screen.getByText(/Жолооч Дорж/)).toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: mn.sales.print.formats.MM80 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
