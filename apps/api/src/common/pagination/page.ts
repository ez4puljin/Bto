import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AppError } from '../errors/app-error';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Keyset pagination query (ADR-0004 #3): an opaque cursor from the previous page and a limit. */
export class PageQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}

/**
 * A repeated id query parameter (`productIds=1&productIds=2`, as openapi-fetch and supertest send
 * arrays) as numbers: a single value arrives as a plain string. Anything that is not a positive
 * integer is kept as it came, so `@IsInt({ each: true })` refuses it (ADR-0037).
 */
export const queryIds = ({ value }: { value: unknown }): unknown => {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]).map((item: unknown) =>
    typeof item === 'string' && /^[1-9]\d{0,14}$/.test(item) ? Number.parseInt(item, 10) : item,
  );
};

/** Encodes the sort key of the last row of a page. */
export function encodeCursor(key: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/** Decodes a cursor; 422 VALIDATION_FAILED when it was not produced by encodeCursor. */
export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  throw invalidCursor();
}

/** 422 VALIDATION_FAILED at `cursor`: not one of ours, or made for another sort. */
export function invalidCursor(): AppError {
  const message = 'cursor is not valid';
  return new AppError('VALIDATION_FAILED', message, undefined, [
    { path: 'cursor', constraint: 'isCursor', message },
  ]);
}

/** Splits `limit + 1` fetched rows into a page and the cursor of its last row. */
export function toPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => Record<string, string | number>,
): { data: T[]; nextCursor: string | null } {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
}
