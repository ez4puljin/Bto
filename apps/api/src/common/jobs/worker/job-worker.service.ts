import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { BUSINESS_TZ } from '@tugeel/shared/time';
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

  /**
   * Registers a handler; modules with jobs call it from their worker module at bootstrap. A handler
   * with a cron expression is also scheduled (ADR-0040): in Ulaanbaatar time, and an occurrence
   * missed while no worker ran is sent once when one starts again. Writing the schedule on every
   * start keeps it equal to the code; pg-boss keeps the row's creation time, so a new schedule
   * never owes a run from before it existed.
   */
  async register<N extends JobName>(handler: JobHandler<N>): Promise<void> {
    await this.boss.work<JobPayloads[N]>(handler.name, handler.workOptions, async ([job]) => {
      if (!job) return undefined;
      const output = await handler.handle(job);
      this.logger.log({ job: handler.name, jobId: job.id }, 'job completed');
      return output;
    });
    if (handler.cron) {
      await this.boss.schedule(handler.name, handler.cron, null, {
        tz: BUSINESS_TZ,
        missed: 'once',
      });
    }
  }
}
