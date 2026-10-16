import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '..');
const versionFrom = (from, name) =>
  createRequire(path.join(from, 'package.json'))(`${name}/package.json`).version;

// React Native runs only with the React it was built for; the web keeps its own (ADR-0061 #3).
describe('two Reacts in one workspace', () => {
  it('gives the app the React its React Native was built for', () => {
    const app = createRequire(path.join(projectRoot, 'package.json'));
    const native = app('react-native/package.json');
    expect(versionFrom(projectRoot, 'react')).toBe('19.2.3');
    expect(native.version).toBe('0.86.3');
    expect(native.peerDependencies.react).toMatch(/19\.2\.3/);
  });

  it('leaves the web on its own React', () => {
    const web = path.resolve(projectRoot, '../web');
    expect(versionFrom(web, 'react')).toBe('19.3.0');
    expect(versionFrom(web, 'react-dom')).toBe('19.3.0');
  });
});
