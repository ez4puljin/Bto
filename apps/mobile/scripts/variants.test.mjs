import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(import.meta.dirname, '..');
const variants = JSON.parse(readFileSync(path.join(appRoot, 'variants.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

describe('the two apps of apps/mobile (ADR-0084)', () => {
  it('keeps the staff app as it was', () => {
    expect(variants.staff).toEqual({
      name: 'Bto',
      slug: 'bto-staff',
      version: pkg.version,
      package: 'mn.butenorgil.bto.staff',
      assets: './assets',
      apkPrefix: 'bto-staff',
      location: true,
    });
  });

  it('builds «Bto300» without location, with its own package, icons and APK name', () => {
    expect(variants.customer).toMatchObject({
      name: 'Bto300',
      package: 'mn.butenorgil.bto300',
      apkPrefix: 'bto300',
      location: false,
    });
    for (const variant of Object.values(variants)) {
      for (const file of ['icon.png', 'adaptive-icon.png', 'splash-icon.png']) {
        expect(() => readFileSync(path.join(appRoot, variant.assets, file))).not.toThrow();
      }
    }
    const packages = Object.values(variants).map((variant) => variant.package);
    expect(new Set(packages).size).toBe(packages.length);
  });
});
