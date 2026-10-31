// Public API of the hr module (docs/modules/hr.md, ADR-0131). Other modules import only this
// file; named exports only (ESLint G2 rejects `export *`). Nobody imports hr today: the composition
// roots mount its HTTP module.
export { HrHttpModule, HrModule } from './hr.module';
export {
  type AttendanceEvent,
  AttendanceService,
  type Dashboard,
  type DayRow,
  type MyAttendance,
  type PunchInput,
} from './services/attendance.service';
export {
  type CompanySchedule,
  type Employee,
  type EmployeeTerms,
  HrSettingsService,
} from './services/hr-settings.service';
export {
  ATTENDANCE_MANAGE,
  ATTENDANCE_VIEW,
  type WorkSite,
  type WorkSiteInput,
  WorkSitesService,
} from './services/work-sites.service';
