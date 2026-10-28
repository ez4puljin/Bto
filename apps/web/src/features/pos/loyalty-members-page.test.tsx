import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls, list, UUID } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-27T03:00:00.000Z';

const MEMBER: Schemas['PosLoyaltyMember'] = {
  id: 41,
  name: 'Батбаяр Дорж',
  phone: '+97699112233',
  regNo: 'УБ90050112',
  birthDate: '1990-05-01',
  gender: 'MALE',
  note: null,
  status: 'ACTIVE',
  balance: '12345.00',
  lifetimeSpend: '8750000.00',
  tier: { name: 'Мөнгөн', percent: '1.50' },
  nextTier: { name: 'Алтан', percent: '2.00', fromAmount: '20000000.00', left: '11250000.00' },
  pinSetAt: STAMP,
  createdAt: STAMP,
  createdByName: 'Админ Бат',
};

const ENTRY: Schemas['PosLoyaltyEntry'] = {
  id: 501,
  kind: 'EARN',
  points: '400.00',
  spendDelta: '40000.00',
  saleId: 51,
  saleNumber: 'К1-0051',
  percent: '1.00',
  reason: null,
  journalNumber: null,
  createdAt: STAMP,
  createdByName: null,
};

const TO_CHECK: Schemas['PosSaleLoyalty'] = {
  id: 601,
  saleId: 52,
  saleNumber: 'К1-0052',
  soldAt: STAMP,
  kind: 'SALE',
  memberId: 41,
  memberName: 'Батбаяр Дорж',
  earned: '0.00',
  spent: '15000.00',
  givenBack: '0.00',
  clawback: '0.00',
  balanceAfter: '-2655.00',
  issue: 'OVERDRAWN',
  reviewedAt: null,
  reviewNote: null,
};

const routes = (toCheck: Schemas['PosSaleLoyalty'][] = []) => ({
  'GET /api/v1/pos/loyalty-members': () => list([MEMBER]),
  'GET /api/v1/pos/loyalty-members/41': () => json(MEMBER),
  'GET /api/v1/pos/loyalty-members/41/entries': () => list([ENTRY]),
  'GET /api/v1/pos/sale-loyalty': () => json(toCheck),
});

/** Types into a field by pasting: the full run's parallel workers make long typing slow. */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.click(field);
  await user.paste(text);
}

describe('the bonus card members (ADR-0112)', () => {
  it('lists a member under «Бонус карт» and opens the member in the panel', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, routes());
    renderApp('/pos/members', fetchMock);
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('link', { name: mn.nav.posMembers })).toHaveAttribute(
      'href',
      '/pos/members',
    );
    const row = await screen.findByRole('row', { name: /Батбаяр Дорж/ }, { timeout: 5_000 });
    expect(within(row).getByText('9911 2233')).toBeInTheDocument();
    expect(within(row).getByText('Мөнгөн · 1.5 %')).toBeInTheDocument();
    expect(within(row).getByText('12,345')).toBeInTheDocument();
    expect(within(row).getByText('8,750,000₮')).toBeInTheDocument();
    expect(within(row).getByText(mn.posLoyalty.statuses.ACTIVE)).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: 'Батбаяр Дорж' }));
    const panel = within(
      await screen.findByRole('dialog', { name: 'Батбаяр Дорж' }, { timeout: 5_000 }),
    );
    expect(panel.getByText('Алтан (2 %): 11,250,000₮ дутуу')).toBeInTheDocument();
    expect(panel.getByText(mn.posLoyalty.genders.MALE)).toBeInTheDocument();
    expect(await panel.findByText('+400', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(panel.getByText(mn.posLoyalty.kinds.EARN)).toBeInTheDocument();
    expect(panel.getByRole('link', { name: 'К1-0051' })).toHaveAttribute(
      'href',
      '/pos/sales?sale=51',
    );
  });

  it('registers a member with the PIN typed twice, refusing two different PINs', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/loyalty-members': () => json(MEMBER, 201),
    });
    renderApp('/pos/members?new=1', fetchMock);
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.posLoyalty.dialog.title }, { timeout: 5_000 }),
    );
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.name), 'Батбаяр Дорж');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.phone), '9911 2233');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pin), '1234');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pinAgain), '1243');
    await user.selectOptions(dialog.getByLabelText(mn.posLoyalty.fields.gender), 'MALE');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.dialog.submit }));
    expect(
      await dialog.findByText(mn.validation.memberPinMismatch, {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members')).toHaveLength(0);

    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pinAgain), '1234');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.dialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members')).toHaveLength(1),
    );
    const [created] = calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members');
    expect(created?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(created)).toEqual({
      name: 'Батбаяр Дорж',
      phone: '+97699112233',
      regNo: null,
      birthDate: null,
      gender: 'MALE',
      note: null,
      pin: '1234',
    });
    // The new member opens in the panel.
    expect(
      await screen.findByRole('dialog', { name: 'Батбаяр Дорж' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });

  it('adjusts the points with a reason', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/loyalty-members/41/adjust': () => json({ ...MEMBER, balance: '11845.00' }),
    });
    renderApp('/pos/members?member=41', fetchMock);
    const panel = within(
      await screen.findByRole('dialog', { name: 'Батбаяр Дорж' }, { timeout: 5_000 }),
    );
    await user.click(await panel.findByRole('button', { name: mn.posLoyalty.actions.adjust }));
    const dialog = within(
      await screen.findByRole('dialog', {
        name: mn.posLoyalty.adjustDialog.title.replace('{{name}}', 'Батбаяр Дорж'),
      }),
    );
    // Zero is refused.
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.points), '0');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.reason), 'Алдаатай оноо');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.adjustDialog.submit }));
    expect(await dialog.findByText(mn.validation.loyaltyPoints)).toBeInTheDocument();
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.points), '-500');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.adjustDialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members/41/adjust')).toHaveLength(1),
    );
    const [adjusted] = calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members/41/adjust');
    expect(adjusted?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(adjusted)).toEqual({ points: '-500', reason: 'Алдаатай оноо' });
  });

  it('changes the PIN', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/loyalty-members/41/pin': () => json(MEMBER),
    });
    renderApp('/pos/members?member=41', fetchMock);
    const panel = within(
      await screen.findByRole('dialog', { name: 'Батбаяр Дорж' }, { timeout: 5_000 }),
    );
    await user.click(await panel.findByRole('button', { name: mn.posLoyalty.actions.pin }));
    const dialog = within(
      await screen.findByRole('dialog', {
        name: mn.posLoyalty.pinDialog.title.replace('{{name}}', 'Батбаяр Дорж'),
      }),
    );
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pin), '12');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pinAgain), '12');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.pinDialog.submit }));
    expect(await dialog.findByText(mn.validation.memberPin)).toBeInTheDocument();
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pin), '4321');
    await fill(user, dialog.getByLabelText(mn.posLoyalty.fields.pinAgain), '4321');
    await user.click(dialog.getByRole('button', { name: mn.posLoyalty.pinDialog.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members/41/pin')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/pos/loyalty-members/41/pin')[0])).toEqual(
      { pin: '4321' },
    );
  });

  it('lists a flagged member sale and marks it checked', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes([TO_CHECK]),
      'POST /api/v1/pos/sale-loyalty/601/review': () => json({ ...TO_CHECK, reviewedAt: STAMP }),
    });
    renderApp('/pos/members', fetchMock);
    const section = within(
      await screen.findByRole('region', { name: mn.posLoyalty.check.title }, { timeout: 5_000 }),
    );
    expect(section.getByText(mn.posLoyalty.check.issues.OVERDRAWN)).toBeInTheDocument();
    await user.click(
      section.getByRole('button', {
        name: mn.posLoyalty.check.reviewLabel.replace('{{number}}', 'К1-0052'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/sale-loyalty/601/review')).toHaveLength(1),
    );
    expect(
      await bodyOf(calls(fetchMock, 'POST', '/api/v1/pos/sale-loyalty/601/review')[0]),
    ).toEqual({ note: null });
  });
});
