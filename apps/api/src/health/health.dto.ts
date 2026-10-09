import { ApiProperty, ApiSchema } from '@nestjs/swagger';

export type HealthStatus = 'ok' | 'degraded';
export type ComponentState = 'up' | 'down';

/** GET /health. The e-Barimt block is added with the ebarimt module in delivery 3. */
@ApiSchema({ name: 'HealthResponse' })
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], description: 'ok only when every component is up' })
  status: HealthStatus;

  @ApiProperty({ enum: ['up', 'down'] })
  db: ComponentState;

  @ApiProperty({ enum: ['up', 'down'] })
  pgboss: ComponentState;

  @ApiProperty({ example: 'sha-0a1b2c3' })
  version: string;
}
