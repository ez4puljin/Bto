// Public API of the payroll module (docs/modules/payroll.md, ADR-0235). Other modules import only
// this file; named exports only. The composition root mounts its HTTP module; nobody else imports it.
export { PayrollHttpModule, PayrollModule } from './payroll.module';
export { PAYROLL_MANAGE, PAYROLL_SCORE, PAYROLL_VIEW } from './payroll.rights';
export {
  PayrollSourceDeductionsService,
  type PayrollSourceDeductionInput,
  type PayrollSourceDeductionView,
  type PayrollSourceKind,
} from './services/payroll-source-deductions.service';
