import { describe, expect, it } from 'vitest';
import {
  BASE_UNIT_ID,
  binOf,
  confirmBody,
  keypadUnitsOfPickLine,
  lineCountState,
  toBaseQty,
  workGroups,
} from './sections';
import type { PickWork } from './types';

const work = (fields: Partial<PickWork>): PickWork => ({
  orderId: 1,
  warehouseId: 2,
  warehouseName: 'Бөөний',
  status: 'OPEN',
  pickerId: null,
  pickerName: null,
  startedAt: null,
  doneAt: null,
  orderNumber: '20261031_0001',
  orderStatus: 'CONFIRMED',
  customerName: 'Номин',
  deliveryDate: '2026-11-01',
  lines: 3,
  ...fields,
});

describe('the work list (ADR-0132)', () => {
  it('sections the parts: to take, mine, others, done today; empty sections left out', () => {
    const rows = [
      work({ orderId: 1 }),
      work({ orderId: 2, status: 'PICKING', pickerId: 7 }),
      work({ orderId: 3, status: 'PICKING', pickerId: 9 }),
      work({ orderId: 4, status: 'DONE', pickerId: 7 }),
      work({ orderId: 5 }),
    ];
    expect(workGroups(rows, 7).map((group) => [group.key, group.data.map((r) => r.orderId)])).toEqual([
      ['take', [1, 5]],
      ['mine', [2]],
      ['others', [3]],
      ['done', [4]],
    ]);
    expect(workGroups([work({ status: 'DONE' })], 7).map((group) => group.key)).toEqual(['done']);
  });
});

describe("a line's count", () => {
  const line = { id: 5, qtyBase: '12', qtyPicked: null };
  it('is uncounted, out, short or full, the typed count before the confirmed one', () => {
    expect(lineCountState(line, {})).toEqual({ kind: 'uncounted' });
    expect(lineCountState(line, { 5: '0' })).toEqual({ kind: 'out' });
    expect(lineCountState(line, { 5: '10' })).toEqual({ kind: 'short', diffBase: '2' });
    expect(lineCountState(line, { 5: '12' })).toEqual({ kind: 'full' });
    expect(lineCountState({ ...line, qtyPicked: '12' }, {})).toEqual({ kind: 'full' });
    expect(lineCountState({ ...line, qtyPicked: '12' }, { 5: '0' })).toEqual({ kind: 'out' });
  });

  it('offers the base unit, the ordered pack and the scanned unit, and counts in base units', () => {
    const pack = { productUnitId: 30, unitName: 'хайрцаг', factorSnapshot: '24', baseUnitName: 'ш' };
    const units = keypadUnitsOfPickLine(pack, null);
    expect(units.map((unit) => [unit.id, unit.uomName, unit.factorToBase, unit.isBase])).toEqual([
      [BASE_UNIT_ID, 'ш', '1', true],
      [30, 'хайрцаг', '24', false],
    ]);
    expect(toBaseQty('2', 30, units)).toBe('48');
    expect(toBaseQty('', BASE_UNIT_ID, units)).toBe('0');
    const scanned = { id: 31, uomName: 'блок', factorToBase: '6', isBase: false };
    expect(keypadUnitsOfPickLine(pack, scanned).map((unit) => unit.id)).toEqual([0, 30, 31]);
    // A scanned base unit adds nothing; a line ordered in pieces has the base unit alone.
    expect(
      keypadUnitsOfPickLine(pack, { id: 32, uomName: 'ш', factorToBase: '1', isBase: true }).length,
    ).toBe(2);
    expect(keypadUnitsOfPickLine({ ...pack, factorSnapshot: '1' }, null).length).toBe(1);
  });
});

describe('the confirmation body', () => {
  const infos = [
    { lineId: 1, proposedBinId: 100, bins: [{ id: 100, code: 'A-01', onHand: '5' }] },
    { lineId: 2, proposedBinId: null, bins: [{ id: 200, code: 'B-01', onHand: '2' }] },
    { lineId: 3, proposedBinId: null, bins: [] },
  ];
  it('takes the typed count, else the reserved one, with the chosen or proposed shelf', () => {
    const body = confirmBody(
      [
        { id: 1, qtyApproved: '5' },
        { id: 2, qtyApproved: '2' },
        { id: 3, qtyApproved: '1' },
      ],
      { 1: '4' },
      infos,
      { 2: 201 },
    );
    expect(body.lines).toEqual([
      { lineId: 1, qty: '4', binId: 100 },
      { lineId: 2, qty: '2', binId: 201 },
      { lineId: 3, qty: '1', binId: 0 },
    ]);
    expect(body.uncounted).toBe(2);
    expect(body.missingBins).toBe(1);
    expect(binOf(infos[1], undefined)).toBe(200);
    expect(binOf(undefined, undefined)).toBeNull();
  });
});
