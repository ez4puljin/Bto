import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ServerMetricsController } from './server-metrics.controller';
import { ServerMetricsService } from './server-metrics.service';

/** Probes only (api and worker). */
@Module({ providers: [HealthService], exports: [HealthService] })
export class HealthCoreModule {}

/** The public GET /health endpoint and the admin's server panel (api only). */
@Module({
  imports: [HealthCoreModule],
  controllers: [HealthController, ServerMetricsController],
  providers: [ServerMetricsService],
})
export class HealthModule {}
