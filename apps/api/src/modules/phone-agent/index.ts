// Public API of the phone-agent module (docs/modules/phone-agent.md, ADR-0232): its modules for
// the composition roots, the hook contract notifications binds, the reconcile flow for the
// suites that run it without a worker and the product search's index for the suites that add products. No other module imports its services; named exports only
// (ESLint G2).
export {
  PHONE_AGENT_LISTENER,
  type PhoneAgentListener,
  type PhoneCallbackNotice,
  type PhoneOrderNotice,
} from './hooks';
export {
  PhoneAgentHttpModule,
  PhoneAgentModule,
  PhoneAgentWorkerModule,
} from './phone-agent.module';
export { PhoneProductSearchService } from './services/phone-product-search.service';
export {
  PhoneReconcileFlowService,
  type ReconcileResult,
} from './services/phone-reconcile-flow.service';
