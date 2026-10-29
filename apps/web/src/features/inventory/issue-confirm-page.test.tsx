import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  calls,
  COLA,
  COLA_BOX,
  SHELF,
  STAMP,
  WAREHOUSE_ME,
  WH1,
} from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';
import { LINE, SENT } from '@/test/issue-fixtures';

type Detail = components['schemas']['IssueDetail'];
const confirm = mn.inventory.issues.confirm;
const WH2 = 'Хоёр дахь агуулах';

/** A sent issue of two warehouses: cola in the keeper's, rice in the other. */
const TWO: Detail = {
  ...SENT,
  number: null,
  lines: [
    LINE,
    {
      ...LINE,
      id: 2,
      productId: 11,
      productSku: '11',
      productName: 'Будаа',
      productUnitId: 110,
      unitName: 'ш',
      enteredQty: '5',
      factorSnapshot: '1',
      qtyBase: '5',
      warehouseId: 2,
      warehouseName: WH2,
    },
  ],
  warehouses: [
    { warehouseId: 1, warehouseName: WH1.name, lineCount: 1, checkedCount: 0, confirmed: false },
    { warehouseId: 2, warehouseName: WH2, lineCount: 1, checkedCount: 0, confirmed: false },
  ],
};

/** The keeper of the first warehouse only. */
const KEEPER = { ...WAREHOUSE_ME, writableWarehouseIds: [1] };

describe('the keeper’s confirmation (ADR-0117)', () => {
  it('ticks the scanned line, confirms the keeper’s warehouse and names the shelf a label scanned', async () => {
    let current: Detail = TWO;
    const fetchMock = signedIn(KEEPER, {
      'GET /api/v1/issues/7': () => json(current),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'GET /api/v1/bins/lookup': () => json(SHELF),
      'PATCH /api/v1/issue-lines/1/check': async (request) => {
        const body = (await request.clone().json()) as { checked: boolean };
        current = {
          ...current,
          lines: current.lines.map((line) =>
            line.id === 1 ? { ...line, checkedAt: body.checked ? STAMP : null } : line,
          ),
        };
        return json(current);
      },
      'PATCH /api/v1/issue-lines/1/bin': () => {
        current = {
          ...current,
          lines: current.lines.map((line) =>
            line.id === 1 ? { ...line, binId: SHELF.id, binCode: SHELF.code } : line,
          ),
        };
        return json(current);
      },
      'POST /api/v1/issues/7/confirm': () => {
        current = {
          ...current,
          number: 'GI-2026-000007',
          confirmations: [
            {
              warehouseId: 1,
              warehouseName: WH1.name,
              confirmedBy: 'Нярав Дорж',
              confirmedAt: STAMP,
              unchanged: false,
            },
          ],
        };
        return json(current);
      },
    });
    const { router } = renderApp('/inventory/issues/7/confirm', fetchMock);
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', {
        name: confirm.title.replace('{{number}}', mn.inventory.draftNo.replace('{{id}}', '7')),
      }),
    ).toBeInTheDocument();
    // The keeper's warehouse is preselected: only the cola line is shown.
    const button = screen.getByRole('button', { name: confirm.confirm });
    expect(button).toBeDisabled();
    expect(screen.getByRole('combobox', { name: confirm.warehouseFilter })).toHaveValue('1');
    expect(screen.queryByText('Будаа')).toBeNull();

    // The scan ticks the cola line and puts the cursor on its box.
    await wedgeScan('4006381333931');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1/check')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1/check')[0])).toEqual({
      checked: true,
    });
    const box = await screen.findByRole('checkbox', {
      name: confirm.check.replace('{{product}}', COLA.name).replace('{{unit}}', 'хайрцаг'),
    });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toHaveFocus();
    expect(screen.getByText(/1 хайрцаг тэмдэглэгдлээ/)).toBeInTheDocument();

    // A shelf label after the line names its shelf.
    await wedgeScan('A-01-03');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1/bin')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1/bin')[0])).toEqual({
      binId: SHELF.id,
    });
    expect(await screen.findByText(SHELF.code)).toBeInTheDocument();

    // Every own line ticked: «Батлах» posts the keeper's part and goes to the document.
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: confirm.confirm }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/issues/7/confirm')).toHaveLength(1),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/issues/7'));
    expect(await screen.findByRole('status')).toHaveTextContent(confirm.confirmed);
  }, 20_000);

  it('sends the issue back to the accountant with a note', async () => {
    let current: Detail = TWO;
    const fetchMock = signedIn(KEEPER, {
      'GET /api/v1/issues/7': () => json(current),
      'POST /api/v1/issues/7/return': () => {
        current = {
          ...current,
          status: 'RETURNED',
          returnNote: 'Кола дутуу',
          returnedBy: 'Нярав Дорж',
          returnedAt: STAMP,
        };
        return json(current);
      },
    });
    const { router } = renderApp('/inventory/issues/7/confirm', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: confirm.return }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: confirm.return })).toBeDisabled();
    await user.type(dialog.getByLabelText(confirm.returnNote), 'Кола дутуу');
    await user.click(dialog.getByRole('button', { name: confirm.return }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/issues/7/return')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/issues/7/return')[0])).toEqual({
      note: 'Кола дутуу',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/issues/7'));
  }, 15_000);

  it('says when there is nothing to confirm', async () => {
    renderApp(
      '/inventory/issues/7/confirm',
      signedIn(KEEPER, { 'GET /api/v1/issues/7': () => json({ ...TWO, status: 'POSTED' }) }),
    );
    expect(await screen.findByText(confirm.notSent)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: confirm.document })).toHaveAttribute(
      'href',
      '/inventory/issues/7',
    );
  });
});
