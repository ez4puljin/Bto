import { ERROR_CODES, FIN_ERROR_CODES } from '@tugeel/shared/errors';
import { FinError } from '../../finance-core';
import { AppError } from './app-error';
import { CodedError, errorCodeOwner, registerErrorStatuses } from './coded-error';
import { toProblem } from './problem-details';

describe('the error-status registry (ADR-0069 #7)', () => {
  it("keeps Bto's catalog and the Finance Core's apart", () => {
    const fin = new Set<string>(FIN_ERROR_CODES);
    expect(ERROR_CODES.filter((code) => fin.has(code))).toEqual([]);
    expect(errorCodeOwner(new AppError('NOT_FOUND').code)).toBe('bto');
    expect(errorCodeOwner(new FinError('FIN_BUSY').code)).toBe('finance-core');
  });

  it('refuses a code two owners register', () => {
    expect(() => registerErrorStatuses('someone-else', { NOT_FOUND: 404 })).toThrow(
      'error code NOT_FOUND is registered by bto and someone-else',
    );
  });

  it('renders any coded error as problem+json', () => {
    const problem = toProblem(
      new FinError('FIN_PERIOD_CLOSED', 'period 2026-09 is CLOSED', {
        period: '2026-09',
        status: 'CLOSED',
      }),
      { instance: '/api/v1/payments' },
    );
    expect(problem).toEqual({
      type: 'https://tugeel.local/errors/FIN_PERIOD_CLOSED',
      title: 'Fin period closed',
      status: 409,
      code: 'FIN_PERIOD_CLOSED',
      detail: 'period 2026-09 is CLOSED',
      instance: '/api/v1/payments',
      params: { period: '2026-09', status: 'CLOSED' },
    });
    expect(new FinError('FIN_BUSY')).toBeInstanceOf(CodedError);
    expect(new FinError('FIN_BUSY')).not.toBeInstanceOf(AppError);
  });
});
