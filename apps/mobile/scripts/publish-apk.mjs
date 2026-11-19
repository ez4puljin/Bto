// `pnpm mobile:publish -- <apk> [--storage <dir>] [--emulator]`: makes a built APK the release a phone
// is offered (ADR-0166). The APK goes to <storage>/releases/<variant>/, then `latest.json` names it
// (written last and renamed into place, so a phone never reads a half-written one), then the older
// APKs go. <storage> is the api's STORAGE_LOCAL_DIR, by default this checkout's .data/storage.
// A file without the phones' code is refused (an emulator's x86_64 build installs on no phone);
// --emulator allows one for a test on the Android emulator. On the Ubuntu PC the job desk publishes
// (ADR-0229: `bash ~/bto-dev/tools/brain/job.sh request apk-staff --publish`): run by hand in
// ~/bto-dev or a task's copy this script refuses, unless --here.
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasPhoneCode, publishOptionsOf, releaseOf } from './apk-env.mjs';
import { deskRefusal } from '../../../tools/brain/jobs/desk.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(appRoot, '../..');
const variants = JSON.parse(readFileSync(path.join(appRoot, 'variants.json'), 'utf8'));

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const { apk, storage, emulator } = publishOptionsOf(process.argv.slice(2));
if (!apk) fail('Name the APK: pnpm mobile:publish -- apps/mobile/build/apk/<file>.apk');
const release = releaseOf(path.basename(apk), variants);
if (!release) fail(`${path.basename(apk)} is not a named release APK of variants.json's apps`);
const refusal = deskRefusal({
  action: 'publish',
  kind: `apk-${release.variant}`,
  root: workspaceRoot,
  home: os.homedir(),
  env: process.env,
  argv: process.argv.slice(2),
});
if (refusal) fail(refusal);

const bytes = readFileSync(apk);
if (!emulator && !hasPhoneCode(bytes)) {
  fail(`${path.basename(apk)} has no arm64-v8a code: an emulator's build installs on no phone`);
}

const folder = path.join(
  path.resolve(storage ?? path.join(workspaceRoot, '.data', 'storage')),
  'releases',
  release.variant,
);
mkdirSync(folder, { recursive: true });
copyFileSync(apk, path.join(folder, release.fileName));
const manifest = {
  version: release.version,
  versionCode: release.versionCode,
  fileName: release.fileName,
  sizeBytes: statSync(apk).size,
};
const temp = path.join(folder, 'latest.json.tmp');
writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
renameSync(temp, path.join(folder, 'latest.json'));
for (const name of readdirSync(folder)) {
  if (name.endsWith('.apk') && name !== release.fileName) rmSync(path.join(folder, name));
}
console.log(
  `\n✔ ${release.variant} ${release.version} (${release.versionCode}) published in ${folder}\n`,
);
