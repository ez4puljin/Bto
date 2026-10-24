// Public API of the reporting module (docs/modules/reporting.md): only the composition roots import
// it (ESLint keeps every other module out, §3.1 rule 4). Named exports only.
export { ReportingHttpModule, ReportingWorkerModule } from './reporting.module';
