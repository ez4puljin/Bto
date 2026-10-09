import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import type { JobName, JobPayloads } from '../job-registry';
import { PG_BOSS } from '../pg-boss.provider';
import type { JobHandler } from './job-handler';
import { SystemPingJob } from './system-ping.job';

/** Registers every job handler with pg-boss once all modules are initialised (worker only). */
@Injectable()
export class JobWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('JobWorker');

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly ping: SystemPingJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register(this.ping);
  }

  private async register<N extends JobName>(handler: JobHandler<N>): Promise<void> {
    await this.boss.work<JobPayloads[N]>(handler.name, handler.workOptions, async ([job]) => {
      if (!job) return undefined;
      const output = await handler.handle(job);
      this.logger.log({ job: handler.name, jobId: job.id }, 'job completed');
      return output;
    });
  }
}
