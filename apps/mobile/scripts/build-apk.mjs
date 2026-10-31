// `pnpm mobile:apk`: builds an app's APK on the owner's PC (ADR-0061 #2, ADR-0085, docs/modules/mobile.md).
//   1. JDK 17 or 21 and the Android SDK packages are found (one-time setup: docs/modules/mobile.md).
//   2. The workspace is mirrored to a short folder without spaces (C:\Android\m) and installed
//      there: the repository's own path holds spaces and is long, which the NDK's CMake and Ninja do
//      not survive, and a drive letter (`subst`) mixes two roots that React Native's codegen refuses.
//   3. `expo prebuild --clean` generates apps/mobile/android in the mirror, then Gradle builds.
//   4. The APK is copied to apps/mobile/build/apk/ in the repository.
// Options: --variant staff|customer (variants.json; the staff app unless named), --debug (a debug
// APK instead of release). Environment: BTO_SERVER (the address the app
// starts with, default http://<this PC's Wi-Fi address>:3300), BTO_ABIS (the native ABIs, default
// arm64-v8a,armeabi-v7a; x86_64 for the Android emulator), BTO_JAVA_HOME, ANDROID_HOME.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  JAVA_MAJORS,
  apkFileName,
  apkOptionsOf,
  MIRROR_SKIP,
  SDK_PACKAGES,
  javaMajor,
  lanAddressOf,
  robocopyFailed,
  versionCodeAt,
} from './apk-env.mjs';
import { EXPO_ENV } from './expo.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(appRoot, '../..');
const { variant: variantName, debug } = apkOptionsOf(process.argv.slice(2));
/** Tools and the build mirror live in a folder without spaces: the NDK refuses paths with spaces. */
const TOOLS = 'C:\\Android';
/** Short on purpose: C++ object paths repeat it (Windows tools stop at 260 characters). */
const MIRROR = path.join(TOOLS, 'm');

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function javaVersionOf(home) {
  const java = path.join(home, 'bin', 'java.exe');
  if (!existsSync(java)) return null;
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
  return javaMajor(`${result.stderr ?? ''}${result.stdout ?? ''}`);
}

function findJavaHome() {
  const candidates = [process.env.BTO_JAVA_HOME, process.env.JAVA_HOME];
  if (existsSync(TOOLS)) {
    for (const entry of readdirSync(TOOLS)) {
      if (/^jdk-?(17|21)/i.test(entry)) candidates.push(path.join(TOOLS, entry));
    }
  }
  for (const home of candidates) {
    if (home && JAVA_MAJORS.includes(javaVersionOf(home) ?? 0)) return home;
  }
  return fail(
    `JDK ${JAVA_MAJORS.join(' or ')} not found (BTO_JAVA_HOME, JAVA_HOME, ${TOOLS}\\jdk-17…). ` +
      'See docs/modules/mobile.md, "One-time setup".',
  );
}

function findAndroidHome() {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(TOOLS, 'Sdk');
  const missing = SDK_PACKAGES.filter((name) => !existsSync(path.join(home, ...name.split('/'))));
  if (missing.length > 0) {
    fail(`Android SDK at ${home} lacks: ${missing.join(', ')}. See docs/modules/mobile.md.`);
  }
  if (/\s/.test(home)) fail(`The Android SDK path must not contain spaces: ${home}`);
  return home;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    fail(`${path.basename(command)} ${args[0] ?? ''} failed (${result.status})`);
  }
}

/** The environment with JAVA_HOME's bin first on the path (Windows names it `Path`). */
function withJava(env, javaHome) {
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  return { ...env, [key]: `${path.join(javaHome, 'bin')}${path.delimiter}${env[key] ?? ''}` };
}

if (process.platform !== 'win32') fail("This script builds on the owner's Windows PC only.");

step('Checking Java and the Android SDK');
const javaHome = findJavaHome();
const androidHome = findAndroidHome();
console.log(`  JDK ${javaVersionOf(javaHome)}: ${javaHome}\n  Android SDK: ${androidHome}`);

const variants = JSON.parse(readFileSync(path.join(appRoot, 'variants.json'), 'utf8'));
const app = variants[variantName];
if (!app) fail(`--variant ${variantName}: not one of ${Object.keys(variants).join(', ')}`);
const { version } = app;
const versionCode = versionCodeAt(new Date());
const lan = lanAddressOf(os.networkInterfaces());
const server = process.env.BTO_SERVER ?? (lan ? `http://${lan}:3300` : '');
console.log(
  `  ${app.name} (${variantName}) ${version} (${versionCode}), server ${server || '(none: typed on the phone)'}`,
);

step(`Mirroring the workspace to ${MIRROR}`);
mkdirSync(MIRROR, { recursive: true });
const copied = spawnSync(
  'robocopy',
  [workspaceRoot, MIRROR, '/MIR', '/XD', ...MIRROR_SKIP, '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
  { stdio: 'inherit' },
);
if (robocopyFailed(copied.status)) fail(`robocopy failed (${copied.status})`);

const env = withJava(
  {
    ...process.env,
    ...EXPO_ENV,
    APP_VARIANT: variantName,
    CI: '1',
    NODE_ENV: 'production',
    BTO_VERSION_CODE: String(versionCode),
    BTO_DEFAULT_SERVER: server,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? path.join(TOOLS, 'gradle'),
  },
  javaHome,
);

step('pnpm install in the mirror (from the shared store: seconds after the first time)');
run('pnpm', ['install', '--frozen-lockfile'], {
  cwd: MIRROR,
  env: { ...env, NODE_ENV: 'development' },
  shell: true,
});

const mirrorApp = path.join(MIRROR, 'apps', 'mobile');
step('expo prebuild (generates apps/mobile/android in the mirror)');
run(
  process.execPath,
  [
    path.join(mirrorApp, 'scripts', 'expo.mjs'),
    'prebuild',
    '--platform',
    'android',
    '--clean',
    '--no-install',
  ],
  {
    cwd: mirrorApp,
    env,
  },
);

const task = debug ? 'assembleDebug' : 'assembleRelease';
step(`Gradle ${task} (the first build downloads Gradle and its libraries: 15–30 minutes)`);
// The full path: cmd does not look in the working folder (NoDefaultCurrentDirectoryInExePath).
run(
  path.join(mirrorApp, 'android', 'gradlew.bat'),
  // No daemons left behind: Gradle's and Kotlin's would keep 3–4 GB of RAM after the build.
  [
    task,
    '--no-daemon',
    '-Pkotlin.compiler.execution.strategy=in-process',
    `-PreactNativeArchitectures=${process.env.BTO_ABIS ?? 'arm64-v8a,armeabi-v7a'}`,
  ],
  { cwd: path.join(mirrorApp, 'android'), env, shell: true },
);

const buildType = debug ? 'debug' : 'release';
const built = path.join(
  mirrorApp,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  buildType,
  `app-${buildType}.apk`,
);
if (!existsSync(built)) fail(`Gradle finished but ${built} is missing`);
const outDir = path.join(appRoot, 'build', 'apk');
mkdirSync(outDir, { recursive: true });
const target = path.join(
  outDir,
  apkFileName({ prefix: app.apkPrefix, version, versionCode, debug }),
);
copyFileSync(built, target);
const megabytes = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ ${target} (${megabytes} MB)\n`);
