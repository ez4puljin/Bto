import { Module } from '@nestjs/common';
import { JobWorkerService } from './job-worker.service';
import { SystemPingJob } from './system-ping.job';

/** Job handlers; imported only by WorkerModule, so the api process never runs handlers. */
@Module({ providers: [SystemPingJob, JobWorkerService], exports: [JobWorkerService] })
export class JobsWorkerModule {}
