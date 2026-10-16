import { describe, expect, it } from 'vitest';
import { javaMajor, lanAddressOf, MIRROR_SKIP, robocopyFailed, versionCodeAt } from './apk-env.mjs';

describe('the APK build environment', () => {
  it('reads the Java major version', () => {
    expect(javaMajor('openjdk version "17.0.16" 2025-07-15 LTS')).toBe(17);
    expect(javaMajor('openjdk version "25.0.2" 2026-01-20')).toBe(25);
    expect(javaMajor('java version "1.8.0_421"')).toBe(8);
    expect(javaMajor('nothing here')).toBeNull();
  });

  it('gives version codes that only grow', () => {
    const first = versionCodeAt(new Date('2026-10-15T12:00:00Z'));
    expect(first).toBe(414_000); // 287 days and 12 hours after 2026-01-01
    expect(versionCodeAt(new Date('2026-10-15T12:01:00Z'))).toBe(first + 1);
  });

  it('finds the office-network address of a real adapter, Wi-Fi first', () => {
    const v4 = (address) => ({ address, family: 'IPv4', internal: false });
    expect(
      lanAddressOf({
        'vEthernet (WSL)': [v4('172.20.16.1')],
        Tailscale: [v4('100.101.1.2')],
        Ethernet: [v4('192.168.1.20')],
        'Wi-Fi': [v4('192.168.1.10'), { address: 'fe80::1', family: 'IPv6', internal: false }],
        'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      }),
    ).toBe('192.168.1.10');
    expect(lanAddressOf({ Ethernet: [v4('10.0.0.5')] })).toBe('10.0.0.5');
    expect(lanAddressOf({ Tailscale: [v4('100.64.0.1')] })).toBeNull();
  });

  it('mirrors the sources only, and reads robocopy’s exit codes', () => {
    for (const skipped of ['node_modules', '.git', '.claude', 'android', 'tmp']) {
      expect(MIRROR_SKIP).toContain(skipped);
    }
    expect(MIRROR_SKIP).not.toContain('apps');
    expect([0, 1, 3, 7].map(robocopyFailed)).toEqual([false, false, false, false]);
    expect([8, 16, null].map(robocopyFailed)).toEqual([true, true, true]);
  });
});
