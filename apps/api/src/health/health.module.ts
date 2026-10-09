import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/** Probes only (api and worker). */
@Module({ providers: [HealthService], exports: [HealthService] })
export class HealthCoreModule {}

/** The public GET /health endpoint (api only). */
@Module({ imports: [HealthCoreModule], controllers: [HealthController] })
export class HealthModule {}
