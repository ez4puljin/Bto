import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ErrorCode, isErrorCode } from './index';

describe('ErrorCode', () => {
  it('maps every key to itself in UPPER_SNAKE_CASE', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
      expect(value).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it('contains the cross-module codes of docs/architecture.md §6', () => {
    for (const code of [
      'IDEMPOTENCY_KEY_REQUIRED',
      'DOC_ALREADY_POSTED',
      'STOCK_INSUFFICIENT',
      'BIN_LOCKED_FOR_COUNT',
      'EBARIMT_ATTRIBUTES_MISSING',
      'PAYMENT_NOT_VERIFIED',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('narrows unknown values', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('not_found')).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });
});
