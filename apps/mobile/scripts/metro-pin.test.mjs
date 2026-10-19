import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { pinToApp } = require('./metro-pin.cjs');

const projectRoot = path.resolve(import.meta.dirname, '..');
const elsewhere = path.resolve(projectRoot, '../../node_modules/react-native/index.js');

/** The origin each request was resolved from, through a fake Metro resolver. */
function originOf(moduleName) {
  let origin = '';
  const resolve = pinToApp(projectRoot, (context) => {
    origin = context.originModulePath;
    return { type: 'empty' };
  });
  resolve({ originModulePath: elsewhere }, moduleName, 'android');
  return origin;
}

describe('the Metro pin (ADR-0061 #3)', () => {
  it('resolves react and react-native from apps/mobile, whoever asks', () => {
    for (const name of ['react', 'react/jsx-runtime', 'react-native', 'react-native/Libraries/x']) {
      expect(originOf(name)).toBe(path.join(projectRoot, 'package.json'));
    }
  });

  it('leaves every other package where it was asked from', () => {
    for (const name of ['react-native-svg', 'react-dom', 'react-i18next', 'reactive', 'expo']) {
      expect(originOf(name)).toBe(elsewhere);
    }
  });
});
