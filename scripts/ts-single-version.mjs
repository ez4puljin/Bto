// ADR-0001 #3: exactly one TypeScript version in the whole workspace, at every depth, and it is 6.0.x.
// Reads pnpm-lock.yaml (`pnpm ls --depth 0` cannot see transitive copies) and every package manifest.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const failures = [];

const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
const versions = new Set(
  [...lock.matchAll(/^ {2}'?typescript@(\d+\.\d+\.\d+[^:'(\s]*)'?:/gm)].map((match) => match[1]),
);
if (versions.size !== 1) {
  failures.push(
    `pnpm-lock.yaml resolves ${versions.size} TypeScript versions: ${[...versions].join(', ') || 'none'}`,
  );
}
for (const version of versions) {
  if (!version.startsWith('6.0.')) failures.push(`TypeScript ${version} is not 6.0.x (ADR-0001)`);
}

// Every workspace manifest that declares typescript must use the catalog pin.
const manifests = ['package.json'];
for (const group of ['apps', 'packages']) {
  const base = join(ROOT, group);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const manifest = join(group, entry.name, 'package.json');
    if (entry.isDirectory() && existsSync(join(ROOT, manifest))) manifests.push(manifest);
  }
}
for (const manifest of manifests) {
  const json = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const specifier = json[field]?.typescript;
    if (specifier !== undefined && specifier !== 'catalog:') {
      failures.push(`${manifest} ${field}.typescript is "${specifier}"; use "catalog:"`);
    }
  }
}

const installed = join(ROOT, 'node_modules', 'typescript', 'package.json');
if (existsSync(installed)) {
  const { version } = JSON.parse(readFileSync(installed, 'utf8'));
  if (!versions.has(version))
    failures.push(
      `node_modules/typescript is ${version}, the lockfile says ${[...versions].join(', ')}`,
    );
}

if (failures.length) {
  console.error(
    `ts:single-version failed:\n- ${failures.join('\n- ')}\nNext step: pnpm why typescript -r`,
  );
  process.exit(1);
}
console.log(`ts:single-version ok (typescript ${[...versions][0]}, ${manifests.length} manifests)`);
