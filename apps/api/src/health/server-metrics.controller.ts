import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../modules/identity';
import { ServerMetricsDto } from './server-metrics.dto';
import { ServerMetricsService } from './server-metrics.service';

/**
 * What the server itself is doing, for the admin's «Системийн төлөв». Behind the settings right:
 * unlike GET /health it describes the machine, which is nobody else's to see.
 */
@ApiTags('health')
@Controller('system')
export class ServerMetricsController {
  constructor(private readonly metrics: ServerMetricsService) {}

  @Get('server')
  @RequirePermission('identity.settings.manage')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'epoch milliseconds of the newest point the caller holds: only later ones return',
  })
  @ApiOkResponse({ type: ServerMetricsDto })
  server(@Query('since') since?: string): Promise<ServerMetricsDto> {
    const after = since === undefined ? Number.NaN : Number.parseInt(since, 10);
    return this.metrics.snapshot(Number.isSafeInteger(after) && after >= 0 ? after : undefined);
  }
}
