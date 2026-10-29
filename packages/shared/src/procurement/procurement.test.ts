import { describe, expect, it } from 'vitest';
import { noteAmountMatches } from '../inventory';
import {
  joinBoxes,
  lowestPoStatus,
  nextPoStatus,
  PO_EDITABLE_STATUSES,
  previousPoStatus,
  requiredGroupsFor,
  splitBoxes,
} from './index';

describe('purchase order statuses (ADR-0115, ADR-0118)', () => {
  it('shows the lowest supplier status on the order', () => {
    expect(lowestPoStatus(['RECEIVED', 'SENT', 'ARRIVED'])).toBe('SENT');
    expect(lowestPoStatus(['ACCOUNTING', 'RECEIVED'])).toBe('ACCOUNTING');
    expect(lowestPoStatus(['SHIPPING', 'IN_TRANSIT'])).toBe('SHIPPING');
    expect(lowestPoStatus([])).toBe('PREPARING');
  });

  it('lets people move a supplier through «Ачигдаж» up to «Ирсэн» and back one step before it', () => {
    expect(nextPoStatus('PREPARING')).toBe('SENT');
    expect(nextPoStatus('SENT')).toBe('SHIPPING');
    expect(nextPoStatus('SHIPPING')).toBe('IN_TRANSIT');
    expect(nextPoStatus('IN_TRANSIT')).toBe('ARRIVED');
    expect(nextPoStatus('ARRIVED')).toBeNull();
    expect(nextPoStatus('ACCOUNTING')).toBeNull();
    expect(previousPoStatus('ARRIVED')).toBe('IN_TRANSIT');
    expect(previousPoStatus('IN_TRANSIT')).toBe('SHIPPING');
    expect(previousPoStatus('PREPARING')).toBeNull();
    expect(previousPoStatus('ACCOUNTING')).toBeNull();
  });

  it('keeps the ordered quantities editable until «Ирсэн»', () => {
    expect([...PO_EDITABLE_STATUSES]).toEqual(['PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT']);
  });
});

describe('boxes and pieces (ADR-0118)', () => {
  it('splits a base quantity into boxes and loose pieces and joins it back', () => {
    const split = splitBoxes('50', '12');
    expect(split.boxes.toString()).toBe('4');
    expect(split.pieces.toString()).toBe('2');
    expect(joinBoxes('4', '2', '12').toString()).toBe('50');
    expect(splitBoxes('7', '1').boxes.toString()).toBe('0');
    expect(splitBoxes('7', '1').pieces.toString()).toBe('7');
    expect(splitBoxes('0', '24').pieces.toString()).toBe('0');
  });
});

describe('the column groups a stage requires (ADR-0118)', () => {
  it('locks the groups of the present stages, in the page order', () => {
    expect(requiredGroupsFor(['PREPARING'])).toEqual(['order']);
    expect(requiredGroupsFor(['ARRIVED', 'SHIPPING'])).toEqual(['shipping', 'receiving']);
    expect(requiredGroupsFor(['ACCOUNTING', 'RECEIVED'])).toEqual(['pricing']);
    expect(requiredGroupsFor([])).toEqual([]);
  });
});

describe('the delivery note amount check (ADR-0115)', () => {
  it('accepts a payable within one tugrik of the note, either way', () => {
    expect(noteAmountMatches('60600', '60600.50')).toBe(true);
    expect(noteAmountMatches('60601', '60600')).toBe(true);
    expect(noteAmountMatches('60601.01', '60600')).toBe(false);
    expect(noteAmountMatches('57600', '60600')).toBe(false);
  });
});
