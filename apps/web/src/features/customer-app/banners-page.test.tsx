import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageResize from '@/lib/image-resize';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import {
  ADMIN_ME,
  findSidebar,
  getSidebar,
  json,
  type Me,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

vi.mock('@/lib/image-resize', async (original) => ({
  ...(await original<typeof ImageResize>()),
  cropToJpeg: vi.fn(() => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))),
}));
vi.mock('@/lib/upload', () => ({ uploadFile: vi.fn(() => Promise.resolve(601)) }));

type Schemas = components['schemas'];

const banner = (fields: Partial<Schemas['Banner']>): Schemas['Banner'] => ({
  id: 1,
  title: 'Ундааны долоо хоног',
  imageUrl: '/api/v1/files/public/b1.jpg',
  linkKind: 'NONE',
  linkId: null,
  linkName: null,
  linkBroken: false,
  validFrom: '2026-10-20',
  validTo: null,
  position: 1,
  state: 'RUNNING',
  createdAt: '2026-10-20T03:00:00.000Z',
  ...fields,
});
const DRINKS = banner({
  id: 1,
  linkKind: 'CATEGORY',
  linkId: 4,
  linkName: 'Ус, ундаа',
  validTo: '2026-11-01',
});
const LATER = banner({
  id: 2,
  title: 'Шинэ амт',
  validFrom: '2026-10-25',
  position: 2,
  state: 'SCHEDULED',
});
const GONE = banner({
  id: 3,
  title: 'Хуучин сегмент',
  linkKind: 'SEGMENT',
  linkId: 9,
  linkBroken: true,
  position: 3,
});
const CATEGORIES: Schemas['Category'][] = [
  {
    id: 4,
    parentId: null,
    name: 'Ус, ундаа',
    defaultClassificationCode: null,
    skuFrom: null,
    skuTo: null,
    productCount: 3,
    childCount: 0,
    imageUrl: null,
  },
];
const KEEPER: Me = {
  ...ADMIN_ME,
  id: 8,
  username: 'keeper',
  fullName: 'Нүүр Сараа',
  permissions: ['customer.home.manage'],
  roles: [],
};

const SETTINGS: Schemas['AppSettings'] = {
  assortmentSegmentId: null,
  assortment: { segmentId: null, segmentName: null, broken: false },
  shopProductCount: 120,
  homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
  minOrderAmount: null,
  appName: null,
  appColor: null,
  updatedAt: null,
};

const routes = (
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/customer/banners': () => json({ data: [DRINKS, LATER, GONE], nextCursor: null }),
  'GET /api/v1/categories': () => json({ data: CATEGORIES, nextCursor: null }),
  'GET /api/v1/app-settings': () => json(SETTINGS),
  'GET /api/v1/segments': () => json({ data: [], nextCursor: null }),
  ...extra,
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('banners (ADR-0092 #5)', () => {
  it('lists the banners in order with their link, period and state', async () => {
    renderApp('/app/home/banners', signedIn(ADMIN_ME, routes()));
    await screen.findByText('Ундааны долоо хоног');
    const rows = screen.getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(mn.customerApp.banners.columns.title),
      expect.stringContaining('Ундааны долоо хоног'),
      expect.stringContaining('Шинэ амт'),
      expect.stringContaining('Хуучин сегмент'),
    ]);
    const first = within(rows[1] as HTMLElement);
    expect(
      first.getByText(`${mn.customerApp.banners.links.CATEGORY}: Ус, ундаа`),
    ).toBeInTheDocument();
    expect(first.getByText('2026-10-20 – 2026-10-31')).toBeInTheDocument();
    expect(first.getByText(mn.customerApp.banners.states.RUNNING)).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(mn.customerApp.banners.states.SCHEDULED),
    ).toBeInTheDocument();
    expect(
      within(rows[3] as HTMLElement).getByText(mn.customerApp.banners.linkBroken),
    ).toBeInTheDocument();
    // The first cannot move up, the last cannot move down.
    expect(
      first.queryByRole('button', { name: `${mn.customerApp.banners.up}: Ундааны долоо хоног` }),
    ).toBeNull();
    expect(
      within(rows[3] as HTMLElement).queryByRole('button', {
        name: `${mn.customerApp.banners.down}: Хуучин сегмент`,
      }),
    ).toBeNull();
  });

  it('moves a banner and archives one after asking', async () => {
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'POST /api/v1/customer/banners/2/move': () => json({ ...LATER, position: 1 }),
        'POST /api/v1/customer/banners/3/archive': () => new Response(null, { status: 204 }),
      }),
    );
    renderApp('/app/home/banners', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `${mn.customerApp.banners.up}: Шинэ амт` }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/customer/banners/2/move')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/customer/banners/2/move')[0])).toEqual({
      direction: 'UP',
    });
    await user.click(
      screen.getByRole('button', { name: `${mn.customerApp.banners.archive}: Хуучин сегмент` }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        mn.customerApp.banners.archiveTitle.replace('{{title}}', 'Хуучин сегмент'),
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: mn.customerApp.banners.archive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/customer/banners/3/archive')).toHaveLength(1),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(mn.customerApp.banners.archived);
  });

  it('adds a banner with its picture, a category link and its days', async () => {
    const fetchMock = signedIn(
      ADMIN_ME,
      routes({
        'POST /api/v1/customer/banners': () => json(banner({ id: 7, title: 'Ус' }), 201),
      }),
    );
    renderApp('/app/home/banners?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    // Nothing is sent without a picture and a title.
    await user.click(dialog.getByRole('button', { name: mn.customerApp.banners.form.submit }));
    expect(await dialog.findAllByText(mn.validation.required)).toHaveLength(2);
    await user.upload(
      dialog.getByLabelText(mn.customerApp.banners.form.picture),
      new File(['x'], 'banner.jpg', { type: 'image/jpeg' }),
    );
    expect(
      await dialog.findByRole('img', { name: mn.customerApp.banners.form.picture }),
    ).toHaveAttribute('src', 'blob:preview');
    await user.type(dialog.getByLabelText(mn.customerApp.banners.form.title), 'Ус');
    await user.selectOptions(
      dialog.getByLabelText(mn.customerApp.banners.form.linkKind),
      mn.customerApp.banners.links.CATEGORY,
    );
    await user.selectOptions(
      await dialog.findByLabelText(mn.customerApp.banners.links.CATEGORY),
      'Ус, ундаа',
    );
    await user.type(dialog.getByLabelText(mn.customerApp.banners.form.lastDay), '2099-12-31');
    await user.click(dialog.getByRole('button', { name: mn.customerApp.banners.form.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/customer/banners')).toHaveLength(1),
    );
    const sent = calls(fetchMock, 'POST', '/api/v1/customer/banners')[0];
    expect(sent?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await bodyOf(sent)).toEqual({
      imageFileId: 601,
      title: 'Ус',
      linkKind: 'CATEGORY',
      linkId: 4,
      validFrom: businessDate(),
      validTo: '2100-01-01',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.customerApp.banners.created);
  }, 15_000);

  it('opens «Аппын нүүр» and its banners to the home’s keeper alone (ADR-0127)', async () => {
    const fetchMock = signedIn(KEEPER, routes());
    renderApp('/app/home', fetchMock);
    expect(within(await findSidebar()).getByRole('link', { name: mn.nav.appHome })).toHaveAttribute(
      'href',
      '/app/home',
    );
    const card = within(await screen.findByRole('region', { name: mn.customerApp.banners.title }));
    expect(
      await card.findByText(mn.customerApp.banners.runningCount.replace('{{n}}', '2')),
    ).toBeInTheDocument();
    expect(card.getByRole('link', { name: mn.customerApp.banners.manage })).toHaveAttribute(
      'href',
      '/app/home/banners',
    );
    // The contact list is identity.settings.read's, on its own page.
    expect(screen.queryByRole('region', { name: mn.customerApp.contacts.title })).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/customer/contacts')).toHaveLength(0);
    expect(within(getSidebar()).queryByRole('link', { name: mn.nav.appContacts })).toBeNull();
  });

  it('sends the old «Систем» addresses to the «Апп» pages', async () => {
    const { router } = renderApp('/system/customer-app', signedIn(ADMIN_ME, routes()));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/home'));
  });

  it('sends the old banners address to the new one', async () => {
    const { router } = renderApp('/system/customer-app/banners', signedIn(ADMIN_ME, routes()));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/home/banners'));
  });

  it('keeps the banners from a user without the right', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/app/home/banners', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/customer/banners')).toHaveLength(0);
  });
});
