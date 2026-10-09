import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { HttpCoreModule } from './common/errors/http-core.module';
import { JobsModule } from './common/jobs/jobs.module';
import { CoreModule } from './core.module';
import { HealthModule } from './health/health.module';

/** The HTTP API (ROLE=api). Business modules are added here, one per session. */
@Module({
  imports: [CoreModule.forRoot('api'), DbModule, JobsModule, HttpCoreModule, HealthModule],
})
export class AppModule {}
