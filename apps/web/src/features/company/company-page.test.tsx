import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  json,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Company = components['schemas']['Company'];

const COMPANY: Company = {
  code: 'BO',
  legalName: 'Бүтэн-Оргил ХХК',
  registerNo: null,
  tin: null,
  functionalCurrency: 'MNT',
  timezone: 'Asia/Ulaanbaatar',
  fiscalYearStartMonth: 1,
  status: 'ACTIVE',
  taxRegistrations: [
    { taxKind: 'VAT', effectiveFrom: '2026-01-01', registered: true, activityCode: null },
  ],
  branches: [
    {
      code: 'MRN',
      name: 'Оргил Бөөний төв',
      status: 'ACTIVE',
      refs: [{ system: 'BTO', externalId: '1' }],
    },
  ],
};

const EDIT = mn.common.editRecord.replace('{{name}}', mn.company.identity);
const identityCard = async () =>
  within(await screen.findByRole('region', { name: mn.company.identity }));

describe('«Компани» (ADR-0084)', () => {
  it('sits in «Систем» before «Салбар» and shows the company, its taxes and branches', async () => {
    renderApp('/company', signedIn(ADMIN_ME, { 'GET /api/v1/company': () => json(COMPANY) }));
    const card = await identityCard();
    expect(card.getByText('Бүтэн-Оргил ХХК')).toBeInTheDocument();
    expect(card.getByText('BO')).toBeInTheDocument();
    expect(card.getByText(mn.company.fiscalMonth.replace('{{month}}', '1'))).toBeInTheDocument();
    const taxes = within(screen.getByRole('region', { name: mn.company.taxRegistrations }));
    expect(taxes.getByText(mn.company.taxKinds.VAT)).toBeInTheDocument();
    expect(taxes.getByText(mn.company.registered)).toBeInTheDocument();
    const branches = within(screen.getByRole('region', { name: mn.company.branches }));
    expect(branches.getByText('Оргил Бөөний төв')).toBeInTheDocument();

    const links = within(await findSidebar())
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links.indexOf(mn.nav.company)).toBeGreaterThan(-1);
    // «Байгууллагын бүтэц» sits between them since 2026-10-31.
    expect(links.indexOf(mn.nav.company)).toBe(links.indexOf(mn.nav.structure) - 1);
    expect(links.indexOf(mn.nav.structure)).toBe(links.indexOf(mn.nav.branches) - 1);
  });

  it('checks the register number and the TIN, then saves them', async () => {
    let sent: unknown;
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/company': () => json(COMPANY),
      'PATCH /api/v1/company': async (request) => {
        sent = await request.json();
        return json({ ...COMPANY, registerNo: '0000001', tin: '12345678901' });
      },
    });
    renderApp('/company', fetchMock);
    const user = userEvent.setup();
    const card = await identityCard();
    await user.click(card.getByRole('button', { name: EDIT }));
    await user.type(card.getByLabelText(mn.company.fields.registerNo), '123');
    await user.type(card.getByLabelText(mn.company.fields.tin), '1234');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    expect(await card.findByText(mn.validation.regNoCompany)).toBeInTheDocument();
    expect(card.getByText(mn.validation.tinCompany)).toBeInTheDocument();
    expect(sent).toBeUndefined();

    await user.clear(card.getByLabelText(mn.company.fields.registerNo));
    await user.type(card.getByLabelText(mn.company.fields.registerNo), '0000001');
    await user.clear(card.getByLabelText(mn.company.fields.tin));
    await user.type(card.getByLabelText(mn.company.fields.tin), '123 456 789 01');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(sent).toEqual({
        legalName: 'Бүтэн-Оргил ХХК',
        registerNo: '0000001',
        tin: '123 456 789 01',
      }),
    );
    expect(await card.findByText('12345678901')).toBeInTheDocument();
  });

  it('shows the core refusal when the user has no rights in the company', async () => {
    renderApp(
      '/company',
      signedIn(ADMIN_ME, {
        'GET /api/v1/company': () => json(COMPANY),
        'PATCH /api/v1/company': () => problem('FIN_COMPANY_FORBIDDEN', 403, { company: 'BO' }),
      }),
    );
    const user = userEvent.setup();
    const card = await identityCard();
    await user.click(card.getByRole('button', { name: EDIT }));
    await user.click(card.getByRole('button', { name: mn.common.save }));
    expect(await card.findByText(mn.errors.FIN_COMPANY_FORBIDDEN)).toBeInTheDocument();
  });

  it('lets a reader without finance.settings.manage only read', async () => {
    renderApp('/company', signedIn(WORKER_ME, { 'GET /api/v1/company': () => json(COMPANY) }));
    const card = await identityCard();
    expect(card.getByText('Бүтэн-Оргил ХХК')).toBeInTheDocument();
    expect(card.queryByRole('button', { name: EDIT })).toBeNull();
  });
});
