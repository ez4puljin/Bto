import { describe, expect, it } from 'vitest';
import { failureReasonOf } from '.';

describe('failureReasonOf (ADR-0045)', () => {
  it('reads a refusal as the guard and a failure by its error code', () => {
    expect(failureReasonOf('REFUSED', 'RELATION')).toBe('GUARD');
    expect(failureReasonOf('FAILED', '57014')).toBe('TIMEOUT');
    expect(failureReasonOf('FAILED', '53200')).toBe('RESOURCES');
    expect(failureReasonOf('FAILED', '54001')).toBe('RESOURCES');
    expect(failureReasonOf('FAILED', 'CONNECTION')).toBe('CONNECTION');
    expect(failureReasonOf('FAILED', '42703')).toBe('DATABASE');
    expect(failureReasonOf('FAILED', null)).toBe('DATABASE');
  });

  it('gives no reason to answered questions', () => {
    expect(failureReasonOf('ANSWERED', null)).toBeNull();
    expect(failureReasonOf('CLARIFY', null)).toBeNull();
    expect(failureReasonOf('UNSUPPORTED', null)).toBeNull();
  });
});
