import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth/public.decorator';
import { HealthResponseDto } from './health.dto';
import { HealthService } from './health.service';

/** Liveness and dependency status: public, cheap, outside /api/v1 (docs/architecture.md §11). */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async get(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const report = await this.health.check();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
