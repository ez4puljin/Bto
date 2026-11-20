import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { PricingModule } from '../pricing';
import { SalesModule } from '../sales';
import { PhoneCallsController, PhoneLinesController } from './controllers/phone-office.controller';
import { PhoneStationController } from './controllers/phone-station.controller';
import { PhoneLineGuard } from './guards/phone-line.guard';
import { PhoneAgentReconcileJob } from './jobs/phone-agent-reconcile.job';
import { PhoneAgentSweepJob } from './jobs/phone-agent-sweep.job';
import { PhoneCallFlowService } from './services/phone-call-flow.service';
import { PhoneCallsService } from './services/phone-calls.service';
import { PhoneLinesService } from './services/phone-lines.service';
import { PhoneProductSearchService } from './services/phone-product-search.service';
import { PhoneReconcileFlowService } from './services/phone-reconcile-flow.service';
import { PhoneToolsService } from './services/phone-tools.service';

/**
 * The phone AI order line (docs/modules/phone-agent.md, ADR-0232): the lines and their station
 * keys, the calls with their transcripts, the agent's tools over the shop, pricing and the order
 * services of sales, and the callback tasks. It writes only its own tables and makes orders only
 * through `SalesOrdersService.createInTx`. Nobody imports its services: notifications binds its
 * `PHONE_AGENT_LISTENER`. `ElevenLabsGateway` comes from the global ElevenLabsIntegrationModule of
 * the composition roots.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, PricingModule, SalesModule],
  providers: [
    PhoneLinesService,
    PhoneCallsService,
    PhoneToolsService,
    PhoneProductSearchService,
    PhoneCallFlowService,
    PhoneReconcileFlowService,
  ],
  exports: [
    PhoneLinesService,
    PhoneCallsService,
    PhoneToolsService,
    PhoneCallFlowService,
    PhoneReconcileFlowService,
  ],
})
export class PhoneAgentModule {}

/** The HTTP side (api only): the station's routes and the office's. */
@Module({
  imports: [PhoneAgentModule],
  controllers: [PhoneStationController, PhoneLinesController, PhoneCallsController],
  providers: [PhoneLineGuard],
})
export class PhoneAgentHttpModule {}

/** Registers the reconcile and the sweep once the worker has started (worker only). */
@Injectable()
export class PhoneAgentJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly reconcile: PhoneAgentReconcileJob,
    private readonly sweep: PhoneAgentSweepJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.reconcile);
    await this.worker.register(this.sweep);
  }
}

/** The worker side: a finished call's transcript against the provider's, and the abandoned calls. */
@Module({
  imports: [PhoneAgentModule, JobsWorkerModule],
  providers: [PhoneAgentReconcileJob, PhoneAgentSweepJob, PhoneAgentJobsBootstrap],
})
export class PhoneAgentWorkerModule {}
