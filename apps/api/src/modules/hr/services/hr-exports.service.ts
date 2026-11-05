import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDateTime } from '@tugeel/shared/time';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { HrReportsService } from './reports.service';
import { WorkforceService } from './workforce.service';

/** Minutes as hours with two decimals («7.50»), the way payroll sheets read them. */
const hours = (minutes: number): string => (minutes / 60).toFixed(2);
/** The Ulaanbaatar wall-clock time of an instant, «08:57». */
const clock = (at: Date | null): string | null => (at ? businessDateTime(at).slice(11) : null);

/**
 * The HR downloads (ADR-0144): the time report's day rows and the employees' list as Excel, the
 * column names from mn.json so the sheet reads like the page.
 */
@Injectable()
export class HrExportsService {
  constructor(
    private readonly reports: HrReportsService,
    private readonly workforce: WorkforceService,
  ) {}

  async reportWorkbook(query: {
    from: string;
    to: string;
    userId?: number;
    divisionId?: number;
  }): Promise<Buffer> {
    const labels = mn.hr.report.excel;
    const report = await this.reports.days(query);
    const columns: ExcelColumn[] = [
      { name: labels.date, kind: 'date' },
      { name: labels.employee, kind: 'text' },
      { name: labels.division, kind: 'text' },
      { name: labels.position, kind: 'text' },
      { name: labels.status, kind: 'text' },
      { name: labels.request, kind: 'text' },
      { name: labels.planStart, kind: 'text' },
      { name: labels.planEnd, kind: 'text' },
      { name: labels.firstIn, kind: 'text' },
      { name: labels.lastOut, kind: 'text' },
      { name: labels.scheduledHours, kind: 'number' },
      { name: labels.workedHours, kind: 'number' },
      { name: labels.lateMinutes, kind: 'number' },
      { name: labels.earlyLeaveMinutes, kind: 'number' },
      { name: labels.overtimeHours, kind: 'number' },
      { name: labels.site, kind: 'text' },
    ];
    const rows: ExcelRow[] = report.rows.map((row) => [
      row.date,
      row.fullName,
      row.divisionName,
      row.position,
      mn.hr.reportStatuses[row.status],
      row.requestName,
      row.planStart,
      row.planEnd,
      clock(row.firstIn),
      clock(row.lastOut),
      hours(row.scheduledMinutes),
      hours(row.workedMinutes),
      String(row.lateMinutes),
      String(row.earlyLeaveMinutes),
      hours(row.overtimeMinutes),
      row.siteName,
    ]);
    return tableWorkbook(`${mn.hr.report.title} ${query.from} – ${query.to}`, BOOLEANS, (sheet) =>
      Promise.resolve(sheet.addRows(columns, rows)),
    );
  }

  async staffWorkbook(): Promise<Buffer> {
    const labels = mn.hr.staff.excel;
    const staff = await this.workforce.employees();
    const columns: ExcelColumn[] = [
      { name: labels.lastName, kind: 'text' },
      { name: labels.firstName, kind: 'text' },
      { name: labels.phone, kind: 'text' },
      { name: labels.division, kind: 'text' },
      { name: labels.position, kind: 'text' },
      { name: labels.employmentType, kind: 'text' },
      { name: labels.gender, kind: 'text' },
      { name: labels.employedOn, kind: 'date' },
      { name: labels.schedule, kind: 'text' },
      { name: labels.birthDate, kind: 'date' },
      { name: labels.education, kind: 'text' },
      { name: labels.maritalStatus, kind: 'text' },
      { name: labels.district, kind: 'text' },
      { name: labels.jobLevel, kind: 'text' },
      { name: labels.children, kind: 'text' },
      { name: labels.leftOn, kind: 'date' },
      { name: labels.leftReason, kind: 'text' },
      { name: labels.active, kind: 'boolean' },
    ];
    const rows: ExcelRow[] = staff.map((row) => [
      row.lastName,
      row.firstName ?? row.fullName,
      row.phone,
      row.divisionName,
      row.position,
      mn.hr.employmentTypes[row.employmentType],
      row.gender ? mn.hr.genders[row.gender] : null,
      row.employedOn,
      row.scheduleName,
      row.birthDate,
      row.education ? mn.hr.staff.educationLevels[row.education] : null,
      row.maritalStatus ? mn.hr.staff.maritalStatuses[row.maritalStatus] : null,
      row.district,
      row.jobLevel ? mn.hr.staff.jobLevels[row.jobLevel] : null,
      String(row.children.length),
      row.leftOn,
      row.leftReason,
      row.status === 'ACTIVE' ? 't' : 'f',
    ]);
    return tableWorkbook(mn.hr.staff.title, BOOLEANS, (sheet) =>
      Promise.resolve(sheet.addRows(columns, rows)),
    );
  }
}

const BOOLEANS = { yes: mn.common.yes, no: mn.common.no };
