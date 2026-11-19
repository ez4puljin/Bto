// The erxes module (docs/modules/erxes.md, ADR-0218). The composition roots import its modules;
// erkhet imports only `ErxesFactsModule` and its service (ADR-0223).
export { ErxesFactsModule, ErxesHttpModule, ErxesWorkerModule } from './erxes.module';
export {
  ERXES_FACTS_FAILURES,
  type ErxesFactsAnswer,
  type ErxesFactsFailure,
  type ErxesItemKey,
  type ErxesProductFacts,
  ErxesProductFactsFlowService,
} from './services/erxes-product-facts-flow.service';
