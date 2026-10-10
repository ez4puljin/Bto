import { describe, expect, it } from 'vitest';
import mn from '../i18n/mn.json';
import { PERMISSIONS, SYSTEM_ROLES } from './auth';
import { ERROR_CODES } from './errors';
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
});
