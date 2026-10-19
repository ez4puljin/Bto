import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// One React for the whole workspace, the one the Expo SDK pins (ADR-0061 #3): React Native runs
// only with the React it was built for, react-dom refuses any other, and a second copy hoisted
// beside a shared package (react-i18next, Radix, vaul…) breaks the web with «Invalid hook call».
const REACT = '19.2.3';
const projectRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '../..');
const versionFrom = (from, name) =>
  createRequire(path.join(from, 'package.json'))(`${name}/package.json`).version;

/** Every installed react or react-dom except the root's: nested ones and per-app ones. */
function extraCopies() {
  const found = [];
  const check = (dir) => {
    for (const name of ['react', 'react-dom']) {
      const manifest = path.join(dir, 'node_modules', name, 'package.json');
      if (existsSync(manifest)) {
        const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
        found.push(`${path.relative(workspaceRoot, path.dirname(manifest))} ${version}`);
      }
    }
  };
  const modules = path.join(workspaceRoot, 'node_modules');
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(modules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory()) check(path.join(full, scoped.name));
      }
    } else {
      check(full);
    }
  }
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(path.join(workspaceRoot, group), { withFileTypes: true })) {
      if (entry.isDirectory()) check(path.join(workspaceRoot, group, entry.name));
    }
  }
  return found;
}

describe('one React in the workspace', () => {
  it('gives the app and the web the React that React Native was built for', () => {
    const native = createRequire(path.join(projectRoot, 'package.json'))(
      'react-native/package.json',
    );
    expect(native.peerDependencies.react).toMatch(/19\.2\.3/);
    expect(versionFrom(projectRoot, 'react')).toBe(REACT);
    const web = path.resolve(projectRoot, '../web');
    expect(versionFrom(web, 'react')).toBe(REACT);
    expect(versionFrom(web, 'react-dom')).toBe(REACT);
  });

  it('installs no second copy of react or react-dom anywhere', () => {
    expect(extraCopies()).toEqual([]);
  });
});
