import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { EDGE_DEVICE_HEADER } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
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
  it('pairs the till, keeps the device token and lists its cashiers', async () => {
    const edge = fakeEdge(
      storeRoutes({ 'POST /pair': () => json({ deviceToken: 'device-1', till: TILL }) }),
    );
    const user = userEvent.setup();
    renderKiosk(edge);

    await user.type(screen.getByLabelText(k.pair.tillCode), 'к1');
    await user.type(screen.getByLabelText(k.pair.pairingCode), '123456');
    await user.click(screen.getByRole('button', { name: k.pair.submit }));

    expect(await screen.findByRole('button', { name: /Сараа Бат/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Болд Дорж/ })).toBeInTheDocument();
    expect(edge.callsTo('POST /pair')[0]?.body).toEqual({ tillCode: 'К1', pairingCode: '123456' });
    expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBe('device-1');
    expect(edge.callsTo('GET /device')[0]?.headers.get(EDGE_DEVICE_HEADER)).toBe('device-1');
  });

  it('refuses a wrong pairing code with the edge’s message', async () => {
    const edge = fakeEdge(storeRoutes({ 'POST /pair': () => problem('POS_PAIRING_INVALID', 401) }));
    const user = userEvent.setup();
    renderKiosk(edge);

    await user.type(screen.getByLabelText(k.pair.tillCode), 'К1');
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
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    await user.keyboard('654321');
    expect(await screen.findByRole('alert')).toHaveTextContent(mn.errors.POS_CASHIER_LOCKED);
  });

  it('signs in on the PIN pad and opens a shift when none is open', async () => {
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

    expect(await screen.findByRole('heading', { name: k.shiftOpen.title })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe('session-1');
    expect(edge.callsTo('GET /session')[0]?.headers.get('authorization')).toBe('Bearer session-1');

    await user.type(screen.getByLabelText(mn.pos.fields.openingFloat), '50000');
    await user.click(screen.getByRole('button', { name: k.shiftOpen.submit }));

    expect(await screen.findByRole('button', { name: k.sale.pay })).toBeInTheDocument();
    expect(edge.callsTo('POST /shifts/open')[0]?.body).toEqual({ openingFloat: '50000.00' });
  });

  it('goes back to pairing when the edge no longer knows the device', async () => {
    const edge = fakeEdge(storeRoutes({ 'GET /device': () => problem('POS_DEVICE_UNKNOWN', 401) }));
    renderKiosk(edge, { device: 'device-old' });

    expect(await screen.findByRole('button', { name: k.pair.submit })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(mn.errors.POS_DEVICE_UNKNOWN);
    await waitFor(() => expect(localStorage.getItem(DEVICE_STORAGE_KEY)).toBeNull());
  });
});
