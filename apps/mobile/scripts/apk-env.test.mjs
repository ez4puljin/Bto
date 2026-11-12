import { describe, expect, it } from 'vitest';
import {
  hasPhoneCode,
  publishOptionsOf,
  releaseOf,
  apkFileName,
  apkOptionsOf,
  isJdkFolder,
  javaMajor,
  lanAddressOf,
  MIRROR_SKIP,
  mirrorCommandOf,
  mirrorFailed,
  robocopyFailed,
  toolsDirOf,
  versionCodeAt,
} from './apk-env.mjs';

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

  it('finds the office-network address on Linux, past Docker’s bridges (ADR-0187)', () => {
    const v4 = (address) => ({ address, family: 'IPv4', internal: false });
    expect(
      lanAddressOf({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        'br-b89acc760345': [v4('172.18.0.1')],
        docker0: [v4('172.17.0.1')],
        enp7s0: [v4('192.168.1.250')],
      }),
    ).toBe('192.168.1.250');
    expect(lanAddressOf({ enp7s0: [v4('192.168.1.250')], wlp2s0: [v4('192.168.1.77')] })).toBe(
      '192.168.1.77',
    );
    expect(
      lanAddressOf({ 'br-57fe625bc077': [v4('172.19.0.1')], virbr0: [v4('192.168.122.1')] }),
    ).toBeNull();
  });

  it('keeps the tools in a folder without spaces on either system', () => {
    expect(toolsDirOf('win32', 'C:\\Users\\Rog Strix')).toBe('C:\\Android');
    expect(toolsDirOf('linux', '/home/nvme-server')).toBe('/home/nvme-server/Android');
  });

  it('knows a JDK 17 or 21 folder by its name', () => {
    for (const name of [
      'jdk-17',
      'jdk-17.0.16+8',
      'jdk21',
      'java-17-openjdk-amd64',
      'java-1.17.0-openjdk-amd64',
      'java-21-openjdk-amd64',
      'temurin-17-jdk-amd64',
    ]) {
      expect(isJdkFolder(name), name).toBe(true);
    }
    for (const name of ['java-25-openjdk-amd64', 'java-8-openjdk-amd64', 'Sdk', 'default-java']) {
      expect(isJdkFolder(name), name).toBe(false);
    }
  });

  it('mirrors the sources only, and reads robocopy’s exit codes', () => {
    for (const skipped of ['node_modules', '.git', '.claude', 'android', 'tmp']) {
      expect(MIRROR_SKIP).toContain(skipped);
    }
    expect(MIRROR_SKIP).not.toContain('apps');
    expect([0, 1, 3, 7].map(robocopyFailed)).toEqual([false, false, false, false]);
    expect([8, 16, null].map(robocopyFailed)).toEqual([true, true, true]);
  });

  it('mirrors with robocopy on Windows and with rsync on Linux', () => {
    const windows = mirrorCommandOf('win32', 'C:\\repo', 'C:\\Android\\m');
    expect(windows.command).toBe('robocopy');
    expect(windows.args.slice(0, 4)).toEqual(['C:\\repo', 'C:\\Android\\m', '/MIR', '/XD']);
    expect(windows.args).toContain('node_modules');
    expect([0, 3, 8, null].map((status) => mirrorFailed('win32', status))).toEqual([
      false,
      false,
      true,
      true,
    ]);

    const linux = mirrorCommandOf('linux', '/home/a/bto-dev', '/home/a/Android/m');
    expect(linux.command).toBe('rsync');
    expect(linux.args.slice(0, 2)).toEqual(['-a', '--delete']);
    // Skipped folders stay in the mirror (its own node_modules and android): never --delete-excluded.
    expect(linux.args).not.toContain('--delete-excluded');
    expect(linux.args).toContain('--exclude=node_modules/');
    expect(linux.args).toContain('--exclude=.git/');
    // The trailing slashes copy the folder's contents, not the folder into the mirror.
    expect(linux.args.slice(-2)).toEqual(['/home/a/bto-dev/', '/home/a/Android/m/']);
    expect([0, 1, 23, null].map((status) => mirrorFailed('linux', status))).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('reads the variant and the debug flag, with or without pnpm’s --', () => {
    expect(apkOptionsOf([])).toEqual({ variant: 'staff', debug: false });
    expect(apkOptionsOf(['--', '--variant', 'customer'])).toEqual({
      variant: 'customer',
      debug: false,
    });
    expect(apkOptionsOf(['--variant=customer', '--debug'])).toEqual({
      variant: 'customer',
      debug: true,
    });
    expect(apkOptionsOf(['--variant'])).toEqual({ variant: '', debug: false });
  });

  it('names the APK after the variant, its version and the version code', () => {
    expect(
      apkFileName({ prefix: 'bto300', version: '0.1.0', versionCode: 414000, debug: false }),
    ).toBe('bto300-0.1.0-414000.apk');
    expect(
      apkFileName({ prefix: 'bto-staff', version: '0.6.0', versionCode: 7, debug: true }),
    ).toBe('bto-staff-0.6.0-7-debug.apk');
  });

  it('reads what a published APK is from its name (ADR-0166)', () => {
    const variants = { staff: { apkPrefix: 'bto-staff' }, customer: { apkPrefix: 'bto300' } };
    expect(releaseOf('bto300-0.4.0-445441.apk', variants)).toEqual({
      variant: 'customer',
      version: '0.4.0',
      versionCode: 445441,
      fileName: 'bto300-0.4.0-445441.apk',
    });
    expect(releaseOf('bto-staff-0.11.0-7.apk', variants)?.variant).toBe('staff');
    expect(releaseOf('bto300-0.4.0-7-debug.apk', variants)).toBeNull();
    expect(releaseOf('other-0.4.0-7.apk', variants)).toBeNull();
  });

  it('refuses an emulator’s APK for the phones (ADR-0166)', () => {
    expect(hasPhoneCode(Buffer.from('PK lib/arm64-v8a/libreactnative.so'))).toBe(true);
    expect(hasPhoneCode(Buffer.from('PK lib/x86_64/libreactnative.so'))).toBe(false);
  });

  it('reads the publish options (ADR-0166)', () => {
    expect(publishOptionsOf(['--', 'a.apk', '--storage', 'D:/s', '--emulator'])).toEqual({
      apk: 'a.apk',
      storage: 'D:/s',
      emulator: true,
    });
    expect(publishOptionsOf([])).toEqual({ apk: null, storage: null, emulator: false });
  });
});
