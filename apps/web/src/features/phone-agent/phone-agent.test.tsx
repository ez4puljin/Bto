import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import { badDays, draftOf, scheduleOf } from './schedule';

const STAMP = '2026-11-20T02:00:00.000Z';
const WEEK = { '1': [['09:00', '18:00']], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] };
const LINE = {
  id: 3,
  name: 'Захиалгын утас',
  active: false,
  schedule: { week: WEEK, exceptions: [] },
  greeting: null,
  lastSeenAt: STAMP,
  online: true,
  workingHours: false,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const CALL = {
  id: 11,
  lineId: 3,
  lineName: LINE.name,
  callerPhone: '+97699112233',
  callerRaw: '99112233',
  customerId: 5,
  customerName: 'Номин дэлгүүр',
  answered: true,
  declineReason: null,
  startedAt: STAMP,
  endedAt: STAMP,
  endReason: 'COMPLETED',
  durationS: 125,
  outcome: 'ORDERED',
  salesOrderId: 77,
  orderNumber: '20261120_0007',
  costEstimate: null,
  reconciled: true,
};
const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('schedule draft', () => {
  it('round-trips the api shape and keeps what the form does not edit', () => {
    const schedule = {
      week: {
        ...WEEK,
        '2': [
          ['09:00', '12:00'],
          ['14:00', '18:00'],
        ],
      },
      exceptions: [{ date: '2026-12-01', intervals: [] }],
    };
    const draft = draftOf(schedule);
    expect(scheduleOf(draft)).toEqual(schedule);
    expect(
      badDays({ ...draft, days: { ...draft.days, '3': { from: '10:00', to: '09:00' } } }),
    ).toEqual(['3']);
  });
});

describe('phone lines screen', () => {
  it('shows the key once inside the install line after the line is added', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/phone-lines': () => json([]),
      'POST /api/v1/phone-lines': () => json({ line: LINE, key: 'bpl_3_secret' }, 201),
    });
    renderApp('/system/phone-lines?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(mn.phoneAgent.lines.fields.name), LINE.name);
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    const shown = await screen.findByText(/install\.ps1/);
    expect(shown).toHaveTextContent(`-Server ${window.location.origin} -Key bpl_3_secret`);
    expect(screen.getByText(/Түлхүүр зөвхөн одоо харагдана, хадгалаад ав/)).toBeInTheDocument();
  });

  it('saves the working hours and the greeting in the api shape', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/phone-lines': () => json([LINE]),
      'PUT /api/v1/phone-lines/3': () => json(LINE),
    });
    renderApp('/system/phone-lines', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: `${mn.common.edit}: ${LINE.name}` }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(mn.phoneAgent.schedule.hint)).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('switch', {
        name: `${mn.phoneAgent.weekdays['3']}: ${mn.phoneAgent.schedule.works}`,
      }),
    );
    await user.type(
      within(dialog).getByLabelText(mn.phoneAgent.lines.fields.greeting),
      'Сайн байна уу',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/phone-lines/3')).toHaveLength(1));
    const body = (await calls(fetchMock, 'PUT', '/api/v1/phone-lines/3')[0]!.clone().json()) as {
      schedule: { week: Record<string, string[][]> };
      greeting: string;
    };
    expect(body.schedule.week['3']).toEqual([['09:00', '18:00']]);
    expect(body.schedule.week['1']).toEqual([['09:00', '18:00']]);
    expect(body.greeting).toBe('Сайн байна уу');
  });

  it('turns a line on from its switch', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/phone-lines': () => json([LINE]),
      'PUT /api/v1/phone-lines/3': () => json({ ...LINE, active: true }),
    });
    renderApp('/system/phone-lines', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('switch', { name: `${mn.phoneAgent.lines.switch}: ${LINE.name}` }),
    );
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/phone-lines/3')).toHaveLength(1));
    expect(await calls(fetchMock, 'PUT', '/api/v1/phone-lines/3')[0]!.clone().json()).toEqual({
      active: true,
    });
  });

  it('hides the menu items from a user without the rights', async () => {
    renderApp('/', signedIn(WORKER_ME));
    const nav = within(await findSidebar());
    expect(nav.queryByRole('link', { name: mn.nav.phoneLines })).toBeNull();
    expect(nav.queryByRole('link', { name: mn.nav.phoneCalls })).toBeNull();
  });
});

describe('phone calls screens', () => {
  it('lists calls with the order link and opens the conversation as bubbles with a folded tool row', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/phone-calls': () => json({ data: [CALL], nextCursor: null }),
      'GET /api/v1/phone-calls/11': () =>
        json({
          call: CALL,
          messages: [
            { seq: 1, role: 'USER', text: 'Кола байна уу', atMs: 0, meta: {}, createdAt: STAMP },
            {
              seq: 2,
              role: 'TOOL',
              text: 'search_products',
              atMs: 10,
              meta: { tool: 'search_products', no_hit: true },
              createdAt: STAMP,
            },
            { seq: 3, role: 'AGENT', text: 'Олдсонгүй', atMs: 20, meta: {}, createdAt: STAMP },
          ],
        }),
    });
    renderApp('/sales/phone-calls', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: CALL.orderNumber })).toHaveAttribute(
      'href',
      '/sales/orders/77',
    );
    expect(screen.getByText('2:05')).toBeInTheDocument();
    await user.click(screen.getByText(CALL.customerName));
    expect(await screen.findByText('Кола байна уу')).toBeInTheDocument();
    expect(screen.getByText('Олдсонгүй')).toBeInTheDocument();
    const tool = screen.getByText('search_products').closest('details')!;
    expect(tool).not.toHaveAttribute('open');
    expect(within(tool).getByText(mn.phoneAgent.call.noHit)).toBeInTheDocument();
  });

  it('shows the searches nothing was found for', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/phone-searches/no-hits': () =>
        json({
          data: [{ callId: 11, seq: 2, query: 'зэрлэг мөөг', createdAt: STAMP }],
          nextCursor: null,
        }),
    });
    renderApp('/sales/phone-calls?tab=noHits', fetchMock);
    expect(await screen.findByText('зэрлэг мөөг')).toBeInTheDocument();
  });
});

describe('bell: phone kinds', () => {
  it('shows each phone notification with its own text and link', async () => {
    const user = userEvent.setup();
    const base = {
      orderTotal: null,
      invoiceNumber: null,
      read: false,
      createdAt: STAMP,
      phone: null,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/me/notifications/summary': () => json({ unread: 2, notices: [] }),
      'GET /api/v1/me/notifications': () =>
        json({
          data: [
            {
              ...base,
              id: 1,
              kind: 'PHONE_ORDER',
              orderId: 77,
              orderNumber: '20261120_0007',
              customerName: 'Номин дэлгүүр',
              callId: 11,
              callbackId: null,
            },
            {
              ...base,
              id: 2,
              kind: 'PHONE_CALLBACK',
              orderId: null,
              orderNumber: '',
              customerName: '',
              callId: 12,
              callbackId: 4,
              phone: '+97699112233',
            },
          ],
          nextCursor: null,
        }),
      'POST /api/v1/me/notifications/read': () => json({ notices: 0, notifications: 2 }),
    });
    renderApp('/', fetchMock);
    await user.click(
      await screen.findByRole('button', {
        name: mn.shell.notificationsUnread.replace('{{count}}', '2'),
      }),
    );
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByText(mn.notifications.staffKinds.PHONE_ORDER)).toBeInTheDocument();
    expect(menu.getByText('20261120_0007 · Номин дэлгүүр')).toBeInTheDocument();
    expect(menu.getByText(mn.notifications.staffKinds.PHONE_CALLBACK)).toBeInTheDocument();
    expect(menu.getByText('+97699112233')).toBeInTheDocument();
    expect(menu.queryByText(/зарагдлаа/)).toBeNull();
  });
});
