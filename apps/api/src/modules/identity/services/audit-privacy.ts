import type { AuditRow } from './audit-query.service';

const POSITION_SALARY_KEYS = new Set([
  'baseSalary',
  'nextBaseSalary',
  'positionBaseSalary',
  'positionNextBaseSalary',
  'salaryHistory',
]);

function positionSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(positionSnapshot);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !POSITION_SALARY_KEYS.has(key))
      .map(([key, child]) => [key, positionSnapshot(child)]),
  );
}

/** Generic audit permission does not grant access to salary/payroll snapshots, including old rows. */
export function auditForReader(row: AuditRow, canReadPayroll: boolean): AuditRow {
  if (canReadPayroll) return row;
  if (row.entity.startsWith('payroll_')) return { ...row, before: null, after: null };
  if (row.entity !== 'hr_position') return row;
  return { ...row, before: positionSnapshot(row.before), after: positionSnapshot(row.after) };
}
