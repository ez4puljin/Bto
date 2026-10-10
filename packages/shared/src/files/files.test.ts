import { describe, expect, it } from 'vitest';
import { isPermission } from '../auth';
import {
  extensionFor,
  FILE_KIND_PATTERN,
  FILE_KINDS,
  isFileKind,
  matchesMagicBytes,
} from './index';

describe('file kinds (ADR-0029)', () => {
  it('names every kind <module>.<kind> with a real permission and an extension per type', () => {
    for (const [kind, definition] of Object.entries(FILE_KINDS)) {
      expect(kind).toMatch(FILE_KIND_PATTERN);
      expect(isPermission(definition.permission)).toBe(true);
      expect(definition.maxBytes).toBeGreaterThan(0);
      for (const type of definition.contentTypes) expect(extensionFor(type)).toMatch(/^[a-z]+$/);
    }
    expect(isFileKind('catalog.product_image')).toBe(true);
    expect(isFileKind('catalog.unknown')).toBe(false);
    expect(isFileKind('toString')).toBe(false);
  });

  it('recognises image signatures', () => {
    expect(matchesMagicBytes('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(matchesMagicBytes('image/png', png)).toBe(true);
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(matchesMagicBytes('image/webp', webp)).toBe(true);
    expect(matchesMagicBytes('image/jpeg', png)).toBe(false);
    expect(matchesMagicBytes('image/gif', png)).toBe(false);
    expect(() => extensionFor('image/gif')).toThrow(RangeError);
  });
});
