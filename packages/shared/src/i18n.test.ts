import { describe, expect, it } from 'vitest';
import mn from '../i18n/mn.json';
import { AI_ANSWER_STATUSES, AI_FAILURE_REASONS } from './ai';
import { PERMISSIONS, SYSTEM_ROLES } from './auth';
import { ERROR_CODES } from './errors';
import { IMPORT_COLUMNS, IMPORT_KINDS, ROW_ERROR_CODES, ROW_WARNING_CODES } from './imports';
import { ADJUSTMENT_REASON_CODES } from './inventory';
import { PRICE_BASES, PRICE_ROUNDINGS } from './pricing';
import {
  PRODUCT_MISSING,
  SEGMENT_ENTITIES,
  SEGMENT_FIELDS,
  SEGMENT_ISSUES,
  SEGMENT_MATCHES,
  SEGMENT_OPERATORS,
} from './segments';
import { SETTING_KEYS } from './settings';

function lookup(path: string): unknown {
  let node: unknown = mn;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

const message = (path: string) => {
  const value = lookup(path);
  return typeof value === 'string' && value.length > 0 ? value : `missing: ${path}`;
};

describe('mn.json covers every code the clients translate (ADR-0011)', () => {
  it.each(ERROR_CODES.map((code) => `errors.${code}`))('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each(PERMISSIONS.map((code) => `permissions.${code}`))('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each(SYSTEM_ROLES.map((code) => `roles.system.${code}`))('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each(SETTING_KEYS.map((key) => `settings.keys.${key}`))('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each([
    ...AI_ANSWER_STATUSES.map((status) => `ai.statuses.${status}`),
    ...AI_FAILURE_REASONS.map((reason) => `ai.reasons.${reason}`),
  ])('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each(ADJUSTMENT_REASON_CODES.map((code) => `inventory.reasons.${code}`))('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each([
    ...PRICE_ROUNDINGS.map((rounding) => `pricing.roundings.${rounding}`),
    ...PRICE_BASES.map((basis) => `pricing.bases.${basis}`),
  ])('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each([
    ...SEGMENT_ENTITIES.map((entity) => `segments.entities.${entity}`),
    ...SEGMENT_MATCHES.map((match) => `segments.matches.${match}`),
    ...SEGMENT_OPERATORS.map((op) => `segments.operators.${op}`),
    ...PRODUCT_MISSING.map((kind) => `segments.missing.${kind}`),
    ...SEGMENT_ENTITIES.flatMap((entity) =>
      Object.keys(SEGMENT_FIELDS[entity]).map((field) => `segments.fields.${entity}.${field}`),
    ),
    ...SEGMENT_ISSUES.map((issue) => `segments.issues.${issue}`),
  ])('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });

  it.each([
    ...IMPORT_KINDS.map((kind) => `imports.kinds.${kind}`),
    ...IMPORT_KINDS.flatMap((kind) =>
      IMPORT_COLUMNS[kind].map((column) => `imports.columns.${kind}.${column.key}`),
    ),
    ...[...ROW_ERROR_CODES, ...ROW_WARNING_CODES].map((code) => `imports.issues.${code}`),
  ])('%s', (path) => {
    expect(message(path)).not.toMatch(/^missing:/);
  });
});
