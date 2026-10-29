import { describe, expect, it } from 'vitest';
import { noteAmountMatches } from '../inventory';
import { lowestPoStatus, nextPoStatus, previousPoStatus } from './index';

describe('purchase order statuses (ADR-0115)', () => {
  it('shows the lowest supplier status on the order', () => {
    expect(lowestPoStatus(['RECEIVED', 'SENT', 'ARRIVED'])).toBe('SENT');
    expect(lowestPoStatus(['ACCOUNTING', 'RECEIVED'])).toBe('ACCOUNTING');
    expect(lowestPoStatus([])).toBe('PREPARING');
  });

  it('lets people move a supplier only up to «Ирсэн» and back one step before it', () => {
    expect(nextPoStatus('PREPARING')).toBe('SENT');
    expect(nextPoStatus('IN_TRANSIT')).toBe('ARRIVED');
    expect(nextPoStatus('ARRIVED')).toBeNull();
    expect(nextPoStatus('ACCOUNTING')).toBeNull();
    expect(previousPoStatus('ARRIVED')).toBe('IN_TRANSIT');
    expect(previousPoStatus('PREPARING')).toBeNull();
    expect(previousPoStatus('ACCOUNTING')).toBeNull();
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
