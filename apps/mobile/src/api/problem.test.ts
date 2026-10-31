import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { creditMessage, problemOf } from './problem';

describe('the credit refusal', () => {
  it('names the reason with its amounts, as the web does', () => {
    const problem = problemOf(
      {
        code: 'CREDIT_BLOCKED',
        params: {
          reason: 'LIMIT',
          exposure: '1250000',
          limit: '1000000',
          excess: '250000',
          overdueAmount: '0',
          oldestDueDate: null,
        },
      },
      409,
    );
    expect(creditMessage(problem)).toEqual({
      key: 'errors.CREDIT_BLOCKED_LIMIT',
      params: {
        exposure: '1,250,000',
        limit: '1,000,000',
        excess: '250,000',
        overdueAmount: '0',
        oldestDueDate: '',
      },
    });
    expect(
      creditMessage({
        code: 'CREDIT_BLOCKED',
        status: 409,
        params: { reason: 'OVERDUE', overdueAmount: '80000', oldestDueDate: '2026-09-15' },
      }),
    ).toMatchObject({
      key: 'errors.CREDIT_BLOCKED_OVERDUE',
      params: { overdueAmount: '80,000', oldestDueDate: '2026-09-15' },
    });
  });

  it('leaves other problems to their error code', () => {
    expect(creditMessage({ code: 'CREDIT_BLOCKED', status: 409 })).toBeNull();
    expect(
      creditMessage({ code: 'CREDIT_BLOCKED', status: 409, params: { reason: 'OTHER' } }),
    ).toBeNull();
    expect(creditMessage({ code: 'VALIDATION_FAILED', status: 422 })).toBeNull();
  });

  it('has a Mongolian message for every reason', () => {
    // `errors.fields` nests the refused fields' texts (2026-10-31); the codes themselves are strings.
    const errors: Record<string, unknown> = mn.errors;
    for (const reason of ['HOLD', 'OVERDUE', 'LIMIT']) {
      const message = creditMessage({ code: 'CREDIT_BLOCKED', status: 409, params: { reason } });
      expect(message && errors[message.key.slice('errors.'.length)]).toEqual(expect.any(String));
    }
  });
});
