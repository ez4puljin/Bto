import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { ERROR_CODES, type ErrorCode } from '@tugeel/shared';

@ApiSchema({ name: 'ProblemFieldError' })
export class ProblemFieldErrorDto {
  @ApiProperty({ example: 'quantity' })
  path: string;

  @ApiProperty({ example: 'isPositive' })
  constraint: string;

  @ApiProperty({ example: 'quantity must be a positive number' })
  message: string;
}

/** RFC 9457 problem details as documented in OpenAPI (mirrors ProblemDetails). */
@ApiSchema({ name: 'ProblemDetails' })
export class ProblemDetailsDto {
  @ApiProperty({ example: 'https://tugeel.local/errors/NOT_FOUND' })
  type: string;

  @ApiProperty({ example: 'Not found' })
  title: string;

  @ApiProperty({ example: 404 })
  status: number;

  @ApiProperty({ enum: ERROR_CODES, enumName: 'ErrorCode' })
  code: ErrorCode;

  @ApiPropertyOptional({
    description: 'English detail for logs; clients show text chosen by code.',
  })
  detail?: string;

  @ApiPropertyOptional({ example: '/api/v1/bin-moves/4412' })
  instance?: string;

  @ApiPropertyOptional()
  requestId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
  })
  params?: Record<string, string | number | boolean | null>;

  @ApiPropertyOptional({ type: [ProblemFieldErrorDto] })
  errors?: ProblemFieldErrorDto[];
}
