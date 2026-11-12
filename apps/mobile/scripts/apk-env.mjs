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

/**
 * Where the build's tools, its mirror and Gradle's cache live: `C:\Android` on Windows, `~/Android`
 * on Linux (ADR-0187). No spaces in either: the NDK refuses them.
 */
export function toolsDirOf(platform, home) {
  return platform === 'win32' ? 'C:\\Android' : `${home}/Android`;
}

/** Folders where Linux distributions install their JDKs. */
export const LINUX_JVM_DIRS = ['/usr/lib/jvm'];

/**
 * Is a folder named like a JDK 17 or 21 (`jdk-17.0.16+8`, Ubuntu's `java-17-openjdk-amd64`)? The
 * name only picks candidates: `java -version` decides.
 */
export function isJdkFolder(name) {
  return /^jdk-?(17|21)/i.test(name) || /^(java|temurin|zulu|openjdk)-(1\.)?(17|21)\b/i.test(name);
}

/** A version code that only grows between builds: minutes since 2026-01-01 UTC. */
export function versionCodeAt(date) {
  return Math.floor((date.getTime() - Date.UTC(2026, 0, 1)) / 60_000);
}

const PRIVATE_V4 = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL =
  /vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tailscale|bluetooth|zerotier|^(br-|veth|virbr|tun|tap|wg)/i;
const PREFERRED = [/wi-?fi|wlan|wireless|^wl/i, /ethernet|^en|^eth/i];

/**
 * The PC's address on the office network from `os.networkInterfaces()`: a private IPv4 address of a
 * real adapter, Wi-Fi first, then Ethernet; null when there is none. Linux names them `wlp2s0` and
 * `enp7s0`, and Docker's bridges (`br-…`, private addresses too) are never the office network.
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
 * The command that makes `to` a mirror of the workspace `from` without the skipped folders, which
 * stay as they are in the mirror: robocopy on Windows, rsync elsewhere.
 */
export function mirrorCommandOf(platform, from, to) {
  if (platform === 'win32') {
    return {
      command: 'robocopy',
      args: [from, to, '/MIR', '/XD', ...MIRROR_SKIP, '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
    };
  }
  return {
    command: 'rsync',
    args: [
      '-a',
      '--delete',
      ...MIRROR_SKIP.map((name) => `--exclude=${name}/`),
      `${from}/`,
      `${to}/`,
    ],
  };
}

/** Did the mirror command fail? rsync answers 0 or an error; robocopy counts what it copied. */
export function mirrorFailed(platform, status) {
  return platform === 'win32' ? robocopyFailed(status) : status !== 0;
}

/**
 * The options of `pnpm mobile:apk [--] [--variant <name>|--variant=<name>] [--debug]` (pnpm 11 hands
 * the `--` over as it is); the variant is the staff app unless named (ADR-0085).
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

/** The options of `pnpm mobile:publish -- <apk> [--storage <dir>] [--emulator]` (ADR-0166). */
export function publishOptionsOf(argv) {
  const args = argv.filter((arg) => arg !== '--');
  let apk = null;
  let storage = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--storage') {
      storage = args[index + 1] ?? null;
      index += 1;
    } else if (!arg.startsWith('--')) {
      apk = arg;
    }
  }
  return { apk, storage, emulator: args.includes('--emulator') };
}

/**
 * What an APK's name says, by the variants' prefixes: `{ variant, version, versionCode, fileName }`,
 * or null for a debug build or any other name (the reverse of `apkFileName`).
 */
export function releaseOf(fileName, variants) {
  for (const [variant, app] of Object.entries(variants)) {
    if (!fileName.startsWith(`${app.apkPrefix}-`)) continue;
    const match = /^(\d+\.\d+\.\d+)-(\d+)\.apk$/.exec(fileName.slice(app.apkPrefix.length + 1));
    if (match) {
      return { variant, version: match[1], versionCode: Number(match[2]), fileName };
    }
  }
  return null;
}

/** Does the APK hold the native code real phones run? Its zip entries name it in plain text. */
export function hasPhoneCode(bytes) {
  return bytes.includes('lib/arm64-v8a/');
}
