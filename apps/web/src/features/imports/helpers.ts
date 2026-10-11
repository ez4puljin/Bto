import mn from '@tugeel/shared/i18n/mn.json';
import {
  type ImportKind,
  ROW_ERROR_CODES,
  ROW_WARNING_CODES,
  type RowErrorCode,
  type RowWarningCode,
} from '@tugeel/shared/imports';
import type { TFunction } from 'i18next';

type IssueCode = RowErrorCode | RowWarningCode;
const ISSUE_CODES: readonly string[] = [...ROW_ERROR_CODES, ...ROW_WARNING_CODES];

const isIssueCode = (code: string): code is IssueCode => ISSUE_CODES.includes(code);

/** The template label of a column, or the name of a changed field (mn.json). */
export function columnName(kind: ImportKind, column: string): string {
  const columns = mn.imports.columns[kind] as Record<string, string>;
  const fields = mn.imports.fields as Record<string, string>;
  return columns[column] ?? fields[column] ?? column;
}

/** The changed fields of an UPDATE row, by their labels. */
export function fieldNames(kind: ImportKind, keys: readonly string[]): string {
  return keys.map((key) => columnName(kind, key)).join(', ');
}

/** «Column: message» for a row problem, the message alone for the whole row. */
export function issueText(
  t: TFunction,
  kind: ImportKind,
  issue: { column: string | null; code: string; params?: Record<string, unknown> },
): string {
  const message = isIssueCode(issue.code)
    ? t(`imports.issues.${issue.code}`, issue.params ?? {})
    : issue.code;
  return issue.column === null
    ? message
    : t('imports.issue', { column: columnName(kind, issue.column), message });
}
