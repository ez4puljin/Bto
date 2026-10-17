import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type { EdgeShiftCloseRequest } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import { SESSION_STORAGE_KEY } from './edge-client';
import { CASHIER, MILK_BARCODE, SHIFT, fakeEdge, json, storeRoutes } from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;

async function openShiftClose(edge: ReturnType<typeof fakeEdge>) {
  const user = userEvent.setup();
  renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
  await user.click(await screen.findByRole('button', { name: k.menu.label }));
  await user.click(await screen.findByRole('menuitem', { name: k.menu.closeShift }));
  await screen.findByRole('heading', { name: k.shiftClose.title, level: 1 });
  return user;
}

describe('kiosk: closing the shift', () => {
  it('posts the counted cash, shows the variance live and then the Z summary', async () => {
    const edge = fakeEdge(
      storeRoutes({
        'POST /shifts/close': (call) => {
          const body = call.body as EdgeShiftCloseRequest;
          return json({
            ...SHIFT,
            status: 'CLOSED',
            closedAt: '2026-10-17T12:00:00.000Z',
            countedCash: body.countedCash,
            floatKept: body.floatKept,
            variance: '-2000.00',
          });
        },
      }),
    );
    const user = await openShiftClose(edge);

    const expected = screen.getByRole('region', { name: k.shiftClose.expected });
    expect(
      within(expected).getByText(mn.pos.fields.expectedCash).nextElementSibling,
    ).toHaveTextContent('92,000₮');
    expect(screen.getByLabelText(mn.pos.fields.floatKept)).toHaveValue('50000');

    await user.type(screen.getByLabelText(mn.pos.fields.countedCash), '90000');
    expect(screen.getByText('Дутуу 2,000₮')).toBeInTheDocument();
    await user.type(screen.getByLabelText(mn.pos.fields.note), 'Задгай дутсан');
    await user.click(screen.getByRole('button', { name: k.shiftClose.submit }));

    const ask = await screen.findByRole('dialog', { name: k.shiftClose.confirmTitle });
    await user.click(within(ask).getByRole('button', { name: k.shiftClose.submit }));

    expect(await screen.findByRole('heading', { name: k.z.title })).toBeInTheDocument();
    expect(edge.callsTo('POST /shifts/close')[0]?.body).toEqual({
      countedCash: '90000.00',
      floatKept: '50000.00',
      note: 'Задгай дутсан',
    });
    expect(screen.getByText('Дутуу 2,000₮')).toBeInTheDocument();
    expect(screen.getByText(k.z.handover).nextElementSibling).toHaveTextContent('40,000₮');

    await user.click(screen.getByRole('button', { name: k.menu.logout }));
    expect(await screen.findByRole('heading', { name: k.login.title })).toBeInTheDocument();
    expect(edge.callsTo('POST /auth/logout')[0]?.headers.get('authorization')).toBe(
      'Bearer session-1',
    );
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('will not close while the cart still holds a sale', async () => {
    const edge = fakeEdge(storeRoutes());
    const user = userEvent.setup();
    renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
    const scanBox = await screen.findByLabelText(k.sale.scanLabel);
    await waitFor(() => expect(scanBox).toHaveFocus());
    await wedgeScan(MILK_BARCODE);
    await screen.findByText('Сүү 1л');

    await user.click(screen.getByRole('button', { name: k.menu.label }));
    await user.click(await screen.findByRole('menuitem', { name: k.menu.closeShift }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      k.shiftClose.cartNotEmpty.replace('{{count}}', '1'),
    );
    expect(screen.getByRole('button', { name: k.shiftClose.submit })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: mn.common.cancel }));
    expect(await screen.findByText('Сүү 1л')).toBeInTheDocument();
    expect(edge.callsTo('POST /shifts/close')).toHaveLength(0);
  });
});
