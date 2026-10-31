import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_PERMISSIONS,
  checkPassword,
  isAssignablePermission,
  isPermission,
  isSystemRole,
  normalizeUsername,
  parseStaffLogin,
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  usernameFromPhone,
  USERNAME_PATTERN,
} from './index';

describe('permission catalog', () => {
  it('uses lowercase dot paths without duplicates', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const code of PERMISSIONS) expect(code).toMatch(/^[a-z]+(\.[a-z][a-zA-Z_]*)+$/);
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

  it('rejects the staff phone as the password in any written form', () => {
    expect(checkPassword('99112233', 'p99112233', '+97699112233')).toBe('SAME_AS_PHONE');
    expect(checkPassword('+976 9911 2233', 'p99112233', '+97699112233')).toBe('SAME_AS_PHONE');
    expect(checkPassword('99112233x', 'p99112233', '+97699112233')).toBeNull();
    expect(checkPassword('99112233', 'bat', null)).toBeNull();
    // A login name standing in for the phone (the set-password form) is not a phone.
    expect(checkPassword('my-own-password-1', 'worker', 'worker')).toBeNull();
  });

  it('compares in NFC so composed and decomposed input match', () => {
    const decomposed = 'Ё'.normalize('NFD').repeat(8);
    expect(checkPassword(decomposed, 'bat')).toBeNull();
    expect([...decomposed].length).toBe(16);
  });
});
describe('staff login (ADR-0128)', () => {
  it('derives the internal login name from the phone', () => {
    expect(usernameFromPhone('+97699112233')).toBe('p99112233');
    expect(usernameFromPhone('+97699112233', 2)).toBe('p99112233-2');
    expect(USERNAME_PATTERN.test(usernameFromPhone('+97699112233', 2))).toBe(true);
  });

  it('reads a phone in any local form, anything else as a login name', () => {
    expect(parseStaffLogin(' 9911 2233 ')).toEqual({ kind: 'PHONE', value: '+97699112233' });
    expect(parseStaffLogin('+976-99112233')).toEqual({ kind: 'PHONE', value: '+97699112233' });
    expect(parseStaffLogin(' Menejer ')).toEqual({ kind: 'USERNAME', value: 'menejer' });
    expect(parseStaffLogin('9911223')).toEqual({ kind: 'USERNAME', value: '9911223' });
  });
});
