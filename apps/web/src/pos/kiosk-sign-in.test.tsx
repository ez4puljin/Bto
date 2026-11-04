import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { EDGE_DEVICE_HEADER } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { tillFromAddress } from './address';
import { DEVICE_STORAGE_KEY, SESSION_STORAGE_KEY } from './edge-client';
import {
  CASHIER,
  SESSION,
  SHIFT,
  TILL,
  fakeEdge,
  json,
  problem,
  storeRoutes,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;

describe('kiosk: pairing, PIN and the shift', () => {
  it('pairs on the start page with a code, then goes to the POS’s own page (ADR-0138)', async () => {
    const edge = fakeEdge(
      storeRoutes({ 'POST /pair': () => json({ deviceToken: 'device-1', till: TILL }) }),
    );
    const user = userEvent.setup();
    const { navigate } = renderKiosk(edge);

    await user.type(await screen.findByLabelText(k.pair.tillCode), 'к1');
    await user.type(screen.getByLabelText(k.pair.pairingCode), '123456');
    await user.click(screen.getByRole('button', { name: k.pair.submit }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/K1'));
    expect(edge.callsTo('POST /pair')[0]?.body).toEqual({ tillCode: 'К1', pairingCode: '123456' });
    // Kept for К1's page, not for the start page.
    expect(localStorage.getItem(`${DEVICE_STORAGE_KEY}@К1`)).toBe('device-1');
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull();
  });

  it('moves a device the start page still holds to its POS, then lists the POS (ADR-0138)', async () => {
    const edge = fakeEdge(
      storeRoutes({ 'GET /tills': () => json([{ code: 'К1', name: 'Пос1 - Үндсэн заал' }]) }),
    );
    renderKiosk(edge, { device: 'device-old-root', addressTill: null });
    expect(await screen.findByRole('link', { name: /Пос1 - Үндсэн заал/ })).toBeInTheDocument();
    expect(edge.callsTo('GET /device')[0]?.headers.get(EDGE_DEVICE_HEADER)).toBe('device-old-root');
    expect(localStorage.getItem(`${DEVICE_STORAGE_KEY}@К1`)).toBe('device-old-root');
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull();
  });

  it('links a new edge to its centre with the admin’s code before the till pairs (ADR-0136)', async () => {
    let linked = false;
    const state = () => ({
      linked,
      source: linked ? 'code' : null,
      centralUrl: linked ? 'http://192.168.1.215:3300' : null,
      nodeCode: linked ? 'MRN1' : null,
      nodeName: linked ? 'Мөрөн' : null,
      linkedAt: null,
      rejected: false,
    });
    const edge = fakeEdge(
      storeRoutes({
        'GET /link': () => json(state()),
        'POST /link': (call) => {
          const body = call.body as { linkCode: string };
          if (body.linkCode !== 'abcd-ef23') return problem('EDGE_LINK_INVALID', 422);
          linked = true;
          return json(state());
        },
      }),
    );
    const user = userEvent.setup();
    renderKiosk(edge);

    await user.type(await screen.findByLabelText(k.link.centralUrl), '192.168.1.215:3300');
    await user.type(screen.getByLabelText(k.link.nodeCode), 'mrn1');
    await user.type(screen.getByLabelText(k.link.linkCode), 'abcd-ef2');
    await user.click(screen.getByRole('button', { name: k.link.submit }));
    // Seven characters: refused before the edge is asked.
    expect(screen.getByText(k.link.linkCodeInvalid)).toBeInTheDocument();
    expect(edge.callsTo('POST /link')).toHaveLength(0);
    await user.type(screen.getByLabelText(k.link.linkCode), '3');
    await user.click(screen.getByRole('button', { name: k.link.submit }));
    // Linked: the till's pairing comes next.
    expect(await screen.findByLabelText(k.pair.tillCode)).toBeInTheDocument();
    expect(edge.callsTo('POST /link')[0]?.body).toEqual({
      centralUrl: '192.168.1.215:3300',
      nodeCode: 'MRN1',
      linkCode: 'abcd-ef23',
    });
  });

  it('offers the active POS at the start page, each opening its own address (ADR-0138)', async () => {
    const edge = fakeEdge(
      storeRoutes({
        'GET /tills': () =>
          json([
            { code: 'К1', name: 'Пос1 - Үндсэн заал' },
            { code: 'К2', name: 'Пос2 - Заалны архи' },
          ]),
      }),
    );
    const user = userEvent.setup();
    renderKiosk(edge);
    const first = await screen.findByRole('link', { name: /Пос1 - Үндсэн заал/ });
    expect(first).toHaveAttribute('href', '/K1');
    expect(screen.getByRole('link', { name: /Пос2 - Заалны архи/ })).toHaveAttribute('href', '/K2');
    // The code stays one click away.
    await user.click(screen.getByRole('button', { name: k.choose.withCode }));
    expect(await screen.findByLabelText(k.pair.pairingCode)).toBeInTheDocument();
  });

  it('binds the POS its address names without a code (ADR-0138)', async () => {
    const edge = fakeEdge(
      storeRoutes({ 'POST /open': () => json({ deviceToken: 'device-k1', till: TILL }) }),
    );
    renderKiosk(edge, { addressTill: 'К1' });

    // Straight to the cashiers: no pairing screen.
    expect(await screen.findByRole('button', { name: /Сараа Бат/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(k.pair.pairingCode)).toBeNull();
    expect(edge.callsTo('POST /open')[0]?.body).toEqual({ tillCode: 'К1' });
    // Kept apart from the code-paired device and from another POS's page.
    expect(localStorage.getItem(`${DEVICE_STORAGE_KEY}@К1`)).toBe('device-k1');
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull();
  });

  it('reads the POS from the address (ADR-0138)', () => {
    expect(tillFromAddress({ pathname: '/K1', search: '' })).toBe('К1');
    expect(tillFromAddress({ pathname: '/%D0%9A2/', search: '' })).toBe('К2');
    expect(tillFromAddress({ pathname: '/pos.html', search: '?till=k1' })).toBe('К1');
    expect(tillFromAddress({ pathname: '/', search: '' })).toBeNull();
    expect(tillFromAddress({ pathname: '/pos.html', search: '' })).toBeNull();
    expect(tillFromAddress({ pathname: '/not a till!', search: '' })).toBeNull();
  });

  it('refuses a wrong pairing code with the edge’s message', async () => {
    const edge = fakeEdge(storeRoutes({ 'POST /pair': () => problem('POS_PAIRING_INVALID', 401) }));
    const user = userEvent.setup();
    renderKiosk(edge);

    await user.type(await screen.findByLabelText(k.pair.tillCode), 'К1');
    await user.type(screen.getByLabelText(k.pair.pairingCode), '999999');
    await user.click(screen.getByRole('button', { name: k.pair.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(mn.errors.POS_PAIRING_INVALID);
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull();
  });

  it('shows a wrong PIN and a lockout, and clears the dots', async () => {
    let attempts = 0;
    const edge = fakeEdge(
      storeRoutes({
        'POST /auth/pin': () => {
          attempts += 1;
          return attempts === 1
            ? problem('POS_PIN_INVALID', 401)
            : problem('POS_CASHIER_LOCKED', 423);
        },
      }),
    );
    const user = userEvent.setup();
    renderKiosk(edge, { device: 'device-1' });

    await user.click(await screen.findByRole('button', { name: /Сараа Бат/ }));
    await user.keyboard('123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(mn.errors.POS_PIN_INVALID);
    expect(edge.callsTo('POST /auth/pin')[0]?.body).toEqual({ userId: 7, pin: '123456' });
    expect(screen.getByRole('img', { name: '0 / 6 орон оруулсан' })).toBeInTheDocument();
    expect(sessionStorage.getItem(`${SESSION_STORAGE_KEY}@К1`)).toBeNull();

    await user.keyboard('654321');
    expect(await screen.findByRole('alert')).toHaveTextContent(mn.errors.POS_CASHIER_LOCKED);
  });

  it('signs in on the PIN pad and opens the shift by itself, with no opening cash', async () => {
    let shift: typeof SHIFT | null = null;
    const edge = fakeEdge(
      storeRoutes({
        'POST /auth/pin': () =>
          json({ token: 'session-1', expiresAt: '2026-10-17T13:00:00.000Z', cashier: CASHIER }),
        'GET /session': () => json({ ...SESSION, shift }),
        'POST /shifts/open': () => {
          shift = SHIFT;
          return json(SHIFT);
        },
      }),
    );
    const user = userEvent.setup();
    renderKiosk(edge, { device: 'device-1' });

    await user.click(await screen.findByRole('button', { name: /Сараа Бат/ }));
    for (const digit of ['2', '4', '6', '8', '1', '0']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }

    // No shift screen: the shift opens by itself with no opening cash.
    expect(await screen.findByRole('button', { name: k.sale.pay })).toBeInTheDocument();
    expect(sessionStorage.getItem(`${SESSION_STORAGE_KEY}@К1`)).toBe('session-1');
    expect(edge.callsTo('GET /session')[0]?.headers.get('authorization')).toBe('Bearer session-1');

    expect(edge.callsTo('POST /shifts/open')).toHaveLength(1);
    expect(edge.callsTo('POST /shifts/open')[0]?.body).toEqual({ openingFloat: '0' });
  });

  it('goes back to pairing when the edge no longer knows the device', async () => {
    const edge = fakeEdge(storeRoutes({ 'GET /device': () => problem('POS_DEVICE_UNKNOWN', 401) }));
    renderKiosk(edge, { device: 'device-old', addressTill: null });

    expect(await screen.findByRole('button', { name: k.pair.submit })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(mn.errors.POS_DEVICE_UNKNOWN);
    await waitFor(() => expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull());
  });
});
