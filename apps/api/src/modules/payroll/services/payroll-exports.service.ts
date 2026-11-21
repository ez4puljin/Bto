import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { PayrollRunsService } from './payroll-runs.service';

const BOOLEANS = { yes: mn.common.yes, no: mn.common.no };

/** A run as Excel (ADR-0235 #12): one row per employee, the columns named as the page names them. */
@Injectable()
export class PayrollExportsService {
  constructor(private readonly runs: PayrollRunsService) {}

  async runWorkbook(id: number): Promise<{ buffer: Buffer; month: string; title: string }> {
    const labels = mn.payroll.excel;
    const run = await this.runs.get(id);
    const columns: ExcelColumn[] = [
      { name: labels.employee, kind: 'text' },
      { name: labels.division, kind: 'text' },
      { name: labels.position, kind: 'text' },
      { name: labels.monthlySalary, kind: 'number' },
      { name: labels.salaryDays, kind: 'number' },
      { name: labels.salaryMonthDays, kind: 'number' },
      { name: labels.baseSalary, kind: 'number' },
      { name: labels.workdays, kind: 'number' },
      { name: labels.attendedDays, kind: 'number' },
      { name: labels.lateDays, kind: 'number' },
      { name: labels.attendancePercent, kind: 'number' },
      { name: labels.attendanceKpi, kind: 'number' },
      { name: labels.workKpi, kind: 'number' },
      { name: labels.taxableAdditions, kind: 'number' },
      { name: labels.gross, kind: 'number' },
      { name: labels.paysSocialInsurance, kind: 'boolean' },
      { name: labels.employeeSi, kind: 'number' },
      { name: labels.pit, kind: 'number' },
      { name: labels.advance, kind: 'number' },
      { name: labels.otherAdditions, kind: 'number' },
      { name: labels.deductions, kind: 'number' },
      { name: labels.net, kind: 'number' },
      { name: labels.employerSi, kind: 'number' },
      { name: labels.totalCost, kind: 'number' },
    ];
    const count = (value: number | null): string | null => (value === null ? null : String(value));
    const rows: ExcelRow[] = run.lines.map((line) => {
      const attendance = line.items.filter((item) => item.source === 'ATTENDANCE');
      const earnedOf = (items: typeof line.items) =>
        items.reduce((total, item) => total.plus(item.earned), new Decimal(0)).toFixed(2);
      return [
        line.fullName,
        line.divisionName,
        line.position,
        line.monthlySalary,
        count(line.salaryDays),
        count(line.salaryMonthDays),
        line.baseSalary,
        count(line.workdays),
        count(line.attendedDays),
        count(line.lateDays),
        attendance[0]?.scorePercent ?? null,
        earnedOf(attendance),
        earnedOf(line.items.filter((item) => item.source !== 'ATTENDANCE')),
        line.taxableAdditions,
        line.gross,
        line.paysSocialInsurance ? 't' : 'f',
        line.employeeSi,
        line.pit,
        line.advance,
        line.otherAdditions,
        line.deductions,
        line.net,
        line.employerSi,
        line.totalCost,
      ];
    });
    const title = labels.sheet.replace('{{month}}', run.month);
    const buffer = await tableWorkbook(title, BOOLEANS, (sheet) =>
      Promise.resolve(sheet.addRows(columns, rows)),
    );
    return { buffer, month: run.month, title };
  }
}
