import { Decimal } from '@tugeel/shared/money';
import { AppError } from '../../../common/errors/app-error';

/** 422 VALIDATION_FAILED with one field error, the shape the DTO pipe produces. */
export function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

export function notFound(entity: string, id: number): AppError {
  return new AppError('NOT_FOUND', `${entity} ${id} not found`, { id });
}

/** A LIKE pattern fragment with %, _ and \ taken literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** A decimal string validated by the DTO as a Decimal (never a JS number: ESLint G3). */
export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}
