import { NotFoundException, type ValidationError } from '@nestjs/common';
import { AppError } from './app-error';
import { PROBLEM_TYPE_BASE, toProblem } from './problem-details';
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
});
