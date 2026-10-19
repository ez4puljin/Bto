import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { addDays, businessDate } from '@tugeel/shared/time';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageResize from '@/lib/image-resize';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];

// The browser's image decoding and the presigned PUT are outside jsdom: the picture "uploads".
vi.mock('@/lib/image-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageResize>()),
  resizeToJpeg: vi.fn(() => Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }))),
}));
vi.mock('@/lib/upload', () => ({ uploadFile: vi.fn(() => Promise.resolve(501)) }));

const TODAY = businessDate();
const STAMP = '2026-10-16T02:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const list = <T,>(data: T[]) => json({ data, nextCursor: null });

const notice = (fields: Partial<Schemas['AppNotice']> = {}): Schemas['AppNotice'] => ({
  id: 3,
  kind: 'PROMOTION',
  audience: 'SALES_REPS',
  title: 'Кола урамшуулал',
  body: 'Хайрцаг бүрт нэг ширхэг бэлэг.',
  imageUrl: '/api/v1/files/public/a.jpg',
  popup: true,
  validFrom: '2026-10-16',
  validTo: '2026-10-24',
  state: 'RUNNING',
  products: [{ id: 7, sku: '8601', name: 'Кола 1л', thumbUrl: null }],
  recipients: 5,
  reads: 2,
  createdBy: 1,
  createdByName: 'Админ Бат',
  createdAt: STAMP,
  withdrawnAt: null,
  withdrawnByName: null,
  ...fields,
});
const RUNNING = notice();
const ENDED = notice({
  id: 2,
  kind: 'NEWS',
  audience: 'CUSTOMERS',
  title: 'Амралтын өдөр',
  state: 'ENDED',
  validTo: null,
  imageUrl: null,
  products: [],
  popup: false,
});

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
const rowOf = (title: string) => {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`no row: ${title}`);
  return within(row);
};

describe('app notices menu', () => {
  it('shows «Апп мэдэгдэл» under «Систем» to whoever may send notices', async () => {
    renderApp('/system/status', signedIn(ADMIN_ME));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.appNotices }),
    ).toHaveAttribute('href', '/system/app-notices');
  });

  it('keeps the page from a user without notifications.send', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/system/app-notices', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(within(await findSidebar()).queryByRole('link', { name: mn.nav.appNotices })).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/app-notices')).toHaveLength(0);
  });
});

describe('app notices list', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists each notice with its period, state and reads, and withdraws a running one', async () => {
    let withdrawn = false;
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/app-notices': () =>
        list([withdrawn ? { ...RUNNING, state: 'WITHDRAWN' } : RUNNING, ENDED]),
      'POST /api/v1/app-notices/3/withdraw': () => {
        withdrawn = true;
        return json({ ...RUNNING, state: 'WITHDRAWN', withdrawnAt: STAMP });
      },
    });
    renderApp('/system/app-notices', fetchMock);
    const user = userEvent.setup();

    expect(await screen.findByText(RUNNING.title)).toBeInTheDocument();
    const running = rowOf(RUNNING.title);
    for (const text of [
      mn.notifications.kinds.PROMOTION,
      mn.notifications.audiences.SALES_REPS,
      '2026-10-16 – 2026-10-23',
      mn.notifications.states.RUNNING,
      '2/5',
      mn.notifications.popupBadge,
      mn.notifications.withImage,
      'Админ Бат',
    ]) {
      expect(running.getByText(text)).toBeInTheDocument();
    }
    const ended = rowOf(ENDED.title);
    expect(ended.getByText('2026-10-16-с хойш')).toBeInTheDocument();
    expect(ended.getByText(mn.notifications.audiences.CUSTOMERS)).toBeInTheDocument();
    expect(ended.queryByRole('button', { name: mn.notifications.withdraw })).toBeNull();

    await user.click(running.getByRole('button', { name: mn.notifications.withdraw }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(`«${RUNNING.title}» мэдэгдлийг буцаах уу?`),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: mn.notifications.withdraw }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock, 'POST', '/api/v1/app-notices/3/withdraw')).toHaveLength(1);
    expect(await screen.findByText(mn.notifications.withdrawn)).toBeInTheDocument();
    expect(await screen.findByText(mn.notifications.states.WITHDRAWN)).toBeInTheDocument();
  });

  it('sends a notice with a picture, products and a last day, previewed as the phone shows it', async () => {
    const lastDay = addDays(TODAY, 6);
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/app-notices': () => list([]),
      'GET /api/v1/products': (request) =>
        new URL(request.url).searchParams.get('saleReady') === 'true'
          ? list([{ id: 7, sku: '8601', name: 'Кола 1л', status: 'ACTIVE' }])
          : list([]),
      'POST /api/v1/app-notices': async (request) =>
        json({ ...notice(), ...((await request.clone().json()) as object), id: 9 }, 201),
    });
    const { router } = renderApp('/system/app-notices?new=1', fetchMock);
    const user = userEvent.setup();

    const dialog = await screen.findByRole('dialog');
    const preview = within(
      within(dialog).getByRole('region', { name: mn.notifications.preview.title }),
    );
    expect(preview.getByText(mn.notifications.preview.placeholderTitle)).toBeInTheDocument();

    // Sales reps by default; this one goes to the stores' «Bto300» (ADR-0079 #8).
    const audience = within(dialog).getByLabelText(mn.notifications.form.audience);
    expect(audience).toHaveValue('SALES_REPS');
    expect(
      within(audience)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([mn.notifications.audiences.SALES_REPS, mn.notifications.audiences.CUSTOMERS]);
    await user.selectOptions(audience, 'CUSTOMERS');
    await user.selectOptions(
      within(dialog).getByLabelText(mn.notifications.form.kind),
      'PRICE_DROP',
    );
    await user.type(within(dialog).getByLabelText(mn.notifications.form.title), 'Кола хямдарлаа');
    await user.type(within(dialog).getByLabelText(mn.notifications.form.body), 'Кола 10% хямд.');
    expect(preview.getByText('Кола хямдарлаа')).toBeInTheDocument();
    expect(preview.getByText(mn.notifications.kinds.PRICE_DROP)).toBeInTheDocument();
    expect(within(dialog).getByText('14/80')).toBeInTheDocument();

    await user.upload(
      within(dialog).getByLabelText(mn.notifications.form.image),
      new File(['photo'], 'cola.jpg', { type: 'image/jpeg' }),
    );
    expect(
      await within(dialog).findByRole('button', { name: mn.notifications.form.replaceImage }),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(mn.notifications.form.products), 'кола');
    // The matches open in a popover outside the dialog (ProductSearch, ADR-0066).
    await user.click(await screen.findByRole('button', { name: /Кола 1л/ }));
    expect(preview.getByText('Бараа харах (1)')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(mn.notifications.form.lastDay), lastDay);
    await user.click(within(dialog).getByRole('button', { name: mn.notifications.send }));

    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/app-notices')).toHaveLength(1));
    const [sent] = calls(fetchMock, 'POST', '/api/v1/app-notices');
    expect(sent?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await sent?.clone().json()).toEqual({
      audience: 'CUSTOMERS',
      kind: 'PRICE_DROP',
      title: 'Кола хямдарлаа',
      body: 'Кола 10% хямд.',
      imageFileId: 501,
      productIds: [7],
      validFrom: TODAY,
      validTo: addDays(lastDay, 1),
      popup: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(mn.notifications.sent)).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('checks the form before sending', async () => {
    const fetchMock = signedIn(ADMIN_ME, { 'GET /api/v1/app-notices': () => list([]) });
    renderApp('/system/app-notices?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');

    const lastDay = within(dialog).getByLabelText(mn.notifications.form.lastDay);
    await user.type(lastDay, addDays(TODAY, -1));
    await user.click(within(dialog).getByRole('button', { name: mn.notifications.send }));
    expect(await within(dialog).findAllByText(mn.validation.required)).toHaveLength(2);
    expect(within(dialog).getByText(mn.validation.lastDayBeforeStart)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/app-notices')).toHaveLength(0);
  });
});
