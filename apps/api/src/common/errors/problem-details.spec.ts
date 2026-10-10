import { DrizzleQueryError } from 'drizzle-orm/errors';
import { NotFoundException, type ValidationError } from '@nestjs/common';
import { AppError } from './app-error';
import { PROBLEM_TYPE_BASE, toProblem, loggableError } from './problem-details';
import { createValidationPipe, flattenValidationErrors } from './validation';

const context = { instance: '/api/v1/things/1', requestId: 'req-12345678' };

describe('toProblem', () => {
  it('keeps the status, code, params and field errors of an AppError', () => {
    const problem = toProblem(
      new AppError('STOCK_INSUFFICIENT', 'bin A-01-03: requested 30.000, available 12.000', {
        binCode: 'A-01-03',
        requested: '30.000',
      }),
      context,
    );
    expect(problem).toEqual({
      type: `${PROBLEM_TYPE_BASE}STOCK_INSUFFICIENT`,
      title: 'Stock insufficient',
      status: 409,
      code: 'STOCK_INSUFFICIENT',
      detail: 'bin A-01-03: requested 30.000, available 12.000',
      instance: '/api/v1/things/1',
      requestId: 'req-12345678',
      params: { binCode: 'A-01-03', requested: '30.000' },
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    const problem = toProblem(new NotFoundException('Cannot GET /x'), context);
    expect(problem).toMatchObject({ status: 404, code: 'NOT_FOUND', detail: 'Cannot GET /x' });
  });

  it('maps body-parser errors (malformed JSON, entity too large)', () => {
    const malformed = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    expect(toProblem(malformed, context)).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      detail: 'Unexpected token',
    });
    expect(
      toProblem({ statusCode: 413, expose: true, message: 'too large' }, context),
    ).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('never leaks the message of an unexpected error', () => {
    const problem = toProblem(new Error('password=secret at db.ts:12'), context);
    expect(problem).toEqual({
      type: `${PROBLEM_TYPE_BASE}INTERNAL_ERROR`,
      title: 'Internal error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'Internal server error',
      instance: '/api/v1/things/1',
      requestId: 'req-12345678',
    });
  });
});

describe('validation', () => {
  it('flattens nested class-validator errors into dotted paths', () => {
    const errors: ValidationError[] = [
      {
        property: 'lines',
        children: [
          {
            property: '0',
            children: [
              {
                property: 'qty',
                constraints: { isPositive: 'qty must be a positive number' },
                children: [],
              },
            ],
          },
        ],
      },
    ];
    expect(flattenValidationErrors(errors)).toEqual([
      { path: 'lines.0.qty', constraint: 'isPositive', message: 'qty must be a positive number' },
    ]);
  });

  it('turns validation failures into 422 VALIDATION_FAILED', () => {
    const pipe = createValidationPipe() as unknown as {
      exceptionFactory: (errors: ValidationError[]) => unknown;
    };
    const error = pipe.exceptionFactory([
      { property: 'name', constraints: { isNotEmpty: 'name should not be empty' }, children: [] },
    ]);
    expect(error).toBeInstanceOf(AppError);
    expect(toProblem(error, {})).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'name', constraint: 'isNotEmpty', message: 'name should not be empty' }],
    });
  });

  describe('database constraint violations', () => {
    const pgError = (code: string, constraint?: string) =>
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        severity: 'ERROR',
        code,
        ...(constraint ? { constraint } : {}),
      });
    const wrapped = (cause: Error) =>
      new DrizzleQueryError('insert into users values ($1)', ['$argon2id$secret-hash'], cause);

    it('maps unique, foreign-key and check violations to stable codes', () => {
      expect(toProblem(wrapped(pgError('23505', 'users_username_key')), {})).toMatchObject({
        status: 409,
        code: 'DUPLICATE_VALUE',
        params: { constraint: 'users_username_key' },
      });
      expect(toProblem(pgError('23503', 'user_roles_role_id_roles_id_fk'), {})).toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      expect(toProblem(wrapped(pgError('23514', 'users_status')), {})).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
      });
    });

    it('keeps other database errors internal and never exposes the bound parameters', () => {
      const problem = toProblem(wrapped(pgError('40P01')), {});
      expect(problem).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(problem)).not.toContain('secret-hash');
      const logged = loggableError(wrapped(pgError('40P01')));
      expect(JSON.stringify(logged)).not.toContain('secret-hash');
      expect(logged.sql).toContain('insert into users');
    });
  });
});
