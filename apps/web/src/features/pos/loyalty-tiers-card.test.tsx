import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';
import { POS_SETTINGS } from './pos-fixtures';

type Schemas = components['schemas'];

const TIERS: Schemas['PosLoyaltyTier'][] = [
  { id: 2, name: 'Алтан', fromAmount: '20000000.00', percent: '2.00' },
  { id: 1, name: 'Мөнгөн', fromAmount: '0.00', percent: '1.00' },
];

const routes = (tiers: Schemas['PosLoyaltyTier'][]) => ({
  'GET /api/v1/pos/settings': () => json(POS_SETTINGS),
  'GET /api/v1/pos/payment-types': () => json([]),
  'GET /api/v1/pos/loyalty-tiers': () => json(tiers),
});

const title = mn.posLoyalty.tiers.title;

describe('the bonus card tiers on «Кассын тохиргоо» (ADR-0112)', () => {
  it('says nobody earns while no tier is set', async () => {
    renderApp('/pos/settings', signedIn(undefined, routes([])));
    const card = within(await screen.findByRole('region', { name: title }, { timeout: 5_000 }));
    expect(card.getByText(mn.posLoyalty.tiers.empty)).toBeInTheDocument();
  });

  it('shows the tiers by threshold, adds one and saves the list sorted', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(TIERS),
      'PUT /api/v1/pos/loyalty-tiers': () => json(TIERS),
    });
    renderApp('/pos/settings', fetchMock);
    const card = within(await screen.findByRole('region', { name: title }, { timeout: 5_000 }));
    expect(card.getByText('20,000,000₮-өөс 2 %')).toBeInTheDocument();
    expect(card.getByText('0₮-өөс 1 %')).toBeInTheDocument();
    await user.click(
      card.getByRole('button', { name: mn.common.editRecord.replace('{{name}}', title) }),
    );
    await user.click(card.getByRole('button', { name: mn.posLoyalty.tiers.add }));
    const place = (key: string) => key.replace('{{place}}', '3');
    // A threshold already taken is refused.
    await user.click(card.getByLabelText(place(mn.posLoyalty.tiers.name)));
    await user.paste('Хүрэл');
    await user.click(card.getByLabelText(place(mn.posLoyalty.tiers.from)));
    await user.paste('0');
    await user.click(card.getByLabelText(place(mn.posLoyalty.tiers.percent)));
    await user.paste('1.5');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    expect(await card.findByText(mn.validation.tierFromRepeated)).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/pos/loyalty-tiers')).toHaveLength(0);
    await user.clear(card.getByLabelText(place(mn.posLoyalty.tiers.from)));
    await user.click(card.getByLabelText(place(mn.posLoyalty.tiers.from)));
    await user.paste('5000000');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/pos/loyalty-tiers')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/pos/loyalty-tiers')[0])).toEqual({
      tiers: [
        { id: 1, name: 'Мөнгөн', fromAmount: '0', percent: '1' },
        { id: null, name: 'Хүрэл', fromAmount: '5000000', percent: '1.5' },
        { id: 2, name: 'Алтан', fromAmount: '20000000', percent: '2' },
      ],
    });
  });
});
