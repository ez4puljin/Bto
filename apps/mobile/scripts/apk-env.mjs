// Pure helpers of the APK build (ADR-0061 #2), tested in apk-env.test.mjs.

/** The Android SDK packages the build needs (React Native 0.86: SDK 36, NDK 27.1, CMake 3.22.1). */
export const SDK_PACKAGES = [
  'platform-tools',
  'platforms/android-36',
  'build-tools/36.0.0',
  'ndk/27.1.12297006',
  'cmake/3.22.1',
];

/** The major version in `java -version` output (`1.8` counts as 8); null when there is none. */
export function javaMajor(output) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return major === 1 && match[2] ? Number.parseInt(match[2], 10) : major;
}

/** AGP 8.12 and Kotlin 2.1.20 run on JDK 17 or 21 (not the JDK 25 Android Studio bundles). */
export const JAVA_MAJORS = [17, 21];

/** A version code that only grows between builds: minutes since 2026-01-01 UTC. */
export function versionCodeAt(date) {
  return Math.floor((date.getTime() - Date.UTC(2026, 0, 1)) / 60_000);
}

const PRIVATE_V4 = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL =
  /vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tailscale|bluetooth|zerotier/i;
const PREFERRED = [/wi-?fi|wlan|wireless/i, /ethernet/i];

/**
 * The PC's address on the office network from `os.networkInterfaces()`: a private IPv4 address of a
 * real adapter, Wi-Fi first, then Ethernet; null when there is none.
 */
export function lanAddressOf(interfaces) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && PRIVATE_V4.test(entry.address)) {
        candidates.push({ name, address: entry.address });
      }
    }
  }
  const rank = (name) => {
    const index = PREFERRED.findIndex((pattern) => pattern.test(name));
    return index < 0 ? PREFERRED.length : index;
  };
  candidates.sort((a, b) => rank(a.name) - rank(b.name));
  return candidates[0]?.address ?? null;
}

/**
 * Folders the build mirror never takes from the repository: installed or generated ones (installed
 * again or generated in the mirror), the git data, other sessions' worktrees, local data and dumps.
 */
export const MIRROR_SKIP = [
  'node_modules',
  '.git',
  '.claude',
  'android',
  'ios',
  'build',
  'dist',
  'dist-worker',
  'coverage',
  '.expo',
  '.vite',
  '.turbo',
  'tmp',
  '.data',
];

/** robocopy's exit codes 0–7 report what it copied; 8 and up are failures. */
export function robocopyFailed(status) {
  return status === null || status >= 8;
}

/**
 * The options of `pnpm mobile:apk [--] [--variant <name>|--variant=<name>] [--debug]` (pnpm 11 hands
 * the `--` over as it is); the variant is the staff app unless named (ADR-0084).
 */
export function apkOptionsOf(argv) {
  const args = argv.filter((arg) => arg !== '--');
  let variant = 'staff';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--variant') {
      variant = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--variant=')) {
      variant = arg.slice('--variant='.length);
    }
  }
  return { variant, debug: args.includes('--debug') };
}

/** `bto300-0.1.0-414000.apk`: the variant's prefix, its version and the build's version code. */
export function apkFileName({ prefix, version, versionCode, debug }) {
  return `${prefix}-${version}-${versionCode}${debug ? '-debug' : ''}.apk`;
}
