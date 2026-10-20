import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-20T02:00:00.000Z';

const segment = (fields: Partial<Schemas['Segment']>): Schemas['Segment'] => ({
  id: 5,
  entity: 'PRODUCT',
  kind: 'LIST',
  name: 'Автомашины бүтээгдэхүүн',
  description: 'Өвөлдөө бэлдэцгээе',
  definition: null,
  appRank: null,
  appShownCount: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...fields,
});
const READER: Me = {
  ...ADMIN_ME,
  id: 9,
  username: 'reader',
  fullName: 'Уншигч',
  permissions: [],
  roles: [],
};

const routes = (shown: Schemas['Segment']) => ({
  'GET /api/v1/segments/counts': () => json([{ segmentId: 5, count: 12 }]),
  'GET /api/v1/segments/5': () => json(shown),
});
const appCard = async () =>
  within(await screen.findByRole('region', { name: mn.segments.app.title }));

describe('a product segment on «Bto300»’s home (ADR-0092 #2)', () => {
  it('shows it in the app with the switch', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(segment({})),
      'PUT /api/v1/segments/5/app': () => json(segment({ appRank: 2, appShownCount: 2 })),
    });
    renderApp('/segments/5', fetchMock);
    const user = userEvent.setup();
    const card = await appCard();
    await user.click(card.getByRole('switch', { name: mn.segments.app.shown }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/segments/5/app')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/segments/5/app')[0])).toEqual({
      shown: true,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.segments.app.shownToast);
  });

  it('moves a shown segment up, never past the first place or below the last', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes(segment({ appRank: 2, appShownCount: 2 })),
      'POST /api/v1/segments/5/app/move': () => json(segment({ appRank: 1, appShownCount: 2 })),
    });
    renderApp('/segments/5', fetchMock);
    const user = userEvent.setup();
    const card = await appCard();
    expect(
      card.getByText(mn.segments.app.rank.replace('{{count}}', '2').replace('{{rank}}', '2')),
    ).toBeInTheDocument();
    expect(card.getByRole('button', { name: mn.segments.app.down })).toBeDisabled();
    await user.click(card.getByRole('button', { name: mn.segments.app.up }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/segments/5/app/move')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/segments/5/app/move')[0])).toEqual({
      direction: 'UP',
    });
  });

  it('only reads the flag without the right, and offers it on product segments only', async () => {
    renderApp('/segments/5', signedIn(READER, routes(segment({ appRank: 1, appShownCount: 1 }))));
    const card = await appCard();
    expect(card.getByText(mn.segments.app.isShown)).toBeInTheDocument();
    expect(card.queryByRole('switch')).toBeNull();
    expect(card.queryByRole('button')).toBeNull();
  });

  it('has no app card on a customer segment', async () => {
    renderApp(
      '/segments/5',
      signedIn(ADMIN_ME, {
        ...routes(
          segment({
            entity: 'CUSTOMER',
            kind: 'RULES',
            definition: { match: 'ALL', groups: [] },
          }),
        ),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Автомашины бүтээгдэхүүн' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: mn.segments.app.title })).toBeNull();
  });
});
