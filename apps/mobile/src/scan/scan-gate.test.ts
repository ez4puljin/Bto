import { describe, expect, it } from 'vitest';
import { ScanGate } from './scan-gate';

const COLA = '5449000000996';

describe('the scan gate', () => {
  it('counts a value read twice in a row, then rests', () => {
    const gate = new ScanGate();
    expect(gate.accept(COLA, 0)).toBeNull();
    expect(gate.accept(COLA, 300)).toBe(COLA);
    expect(gate.accept(COLA, 600)).toBeNull();
    expect(gate.accept(COLA, 2_400)).toBeNull();
    expect(gate.accept(COLA, 2_700)).toBe(COLA);
  });

  it('ignores a misread check digit (stored codes may have one, ADR-0098 #6) and a value read too far apart', () => {
    const gate = new ScanGate();
    expect(gate.accept('5449000000997', 0)).toBeNull();
    expect(gate.accept('5449000000997', 100)).toBeNull();
    expect(gate.accept(COLA, 200)).toBeNull();
    expect(gate.accept(COLA, 2_000)).toBeNull();
    expect(gate.accept(COLA, 2_500)).toBe(COLA);
  });
});
