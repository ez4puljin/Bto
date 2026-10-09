import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppError, type FieldError } from './app-error';

/** DTO validation: unknown properties rejected, 422 VALIDATION_FAILED with field errors, values never echoed. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        undefined,
        flattenValidationErrors(errors),
      ),
  });
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.entries(error.constraints ?? {}).map(([constraint, message]) => ({
        path,
        constraint,
        message,
      })),
      ...flattenValidationErrors(error.children ?? [], path),
    ];
  });
}
