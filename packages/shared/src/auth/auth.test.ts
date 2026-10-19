import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_PERMISSIONS,
  checkPassword,
  isAssignablePermission,
  isPermission,
  isSystemRole,
  normalizeUsername,
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  USERNAME_PATTERN,
} from './index';

describe('permission catalog', () => {
  it('uses lowercase dot paths without duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const code of PERMISSIONS) expect(code).toMatch(/^[a-z]+(\.[a-z][a-z_]*)+$/);
  });

  it('never lets one code be a segment prefix of another (i18n key paths would collide)', () => {
    for (const a of PERMISSIONS) {
      for (const b of PERMISSIONS) {
        if (a !== b) expect(b.startsWith(`${a}.`)).toBe(false);
      }
    }
  });

  it('gives ADMIN every permission and keeps admin-only codes out of custom roles', () => {
    expect([...SYSTEM_ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSIONS].sort());
    for (const code of ADMIN_ONLY_PERMISSIONS) expect(isAssignablePermission(code)).toBe(false);
    expect(isAssignablePermission('identity.audit.read')).toBe(true);
  });

  it('maps every system role to known permissions', () => {
    expect(Object.keys(SYSTEM_ROLE_PERMISSIONS).sort()).toEqual([...SYSTEM_ROLES].sort());
    for (const role of SYSTEM_ROLES) {
      for (const code of SYSTEM_ROLE_PERMISSIONS[role]) expect(isPermission(code)).toBe(true);
    }
    expect(isSystemRole('ADMIN')).toBe(true);
    expect(isSystemRole('admin')).toBe(false);
  });
});

describe('the sales rep (ADR-0061)', () => {
  it('holds the rep app only: no other order, no credit data', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.SALES_REP).toEqual(['sales.orders.rep']);
    for (const role of SYSTEM_ROLES) {
      if (role === 'ADMIN' || role === 'SALES_REP') continue;
      expect(SYSTEM_ROLE_PERMISSIONS[role]).not.toContain('sales.orders.rep');
    }
  });
});

describe('usernames', () => {
  it('normalises and validates login names', () => {
    expect(normalizeUsername('  Bat.Erdene ')).toBe('bat.erdene');
    expect(USERNAME_PATTERN.test('bat.erdene')).toBe(true);
    expect(USERNAME_PATTERN.test('ba')).toBe(false);
    expect(USERNAME_PATTERN.test('.bat')).toBe(false);
    expect(USERNAME_PATTERN.test('бат')).toBe(false);
  });
});

describe('password policy', () => {
  it('requires the minimum length counted in characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(checkPassword('1234567', 'bat')).toBe('TOO_SHORT');
    expect(checkPassword('өөөөөөөө', 'bat')).toBeNull();
    expect(checkPassword('x'.repeat(129), 'bat')).toBe('TOO_LONG');
  });

  it('rejects the username as the password in any case', () => {
    expect(checkPassword('Bat.Erdene', 'bat.erdene')).toBe('SAME_AS_USERNAME');
    expect(checkPassword('bat.erdene1', 'bat.erdene')).toBeNull();
  });

  it('compares in NFC so composed and decomposed input match', () => {
    const decomposed = 'Ё'.normalize('NFD').repeat(8);
    expect(checkPassword(decomposed, 'bat')).toBeNull();
    expect([...decomposed].length).toBe(16);
  });
});
