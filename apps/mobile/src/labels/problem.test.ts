import { describe, expect, it } from 'vitest';
import mn from '@tugeel/shared/i18n/mn.json';
import { hasErrorText, isPrintCode, PRINT_CODES } from './problem';

describe('the printing codes on «Үнийн шошго»', () => {
  it('each has its own text in mn.json', () => {
    const errors = mn.errors as Record<string, unknown>;
    for (const code of PRINT_CODES) expect(typeof errors[code]).toBe('string');
    expect(errors.PRINT_NO_TILL).toBe('Танд Пос тохируулаагүй байна');
  });

  it('knows the printing codes beside Bto’s own and nothing else', () => {
    expect(isPrintCode('PRINT_NO_TILL')).toBe(true);
    expect(isPrintCode('NOT_FOUND')).toBe(false);
    expect(hasErrorText('PRINT_NO_TILL')).toBe(true);
    expect(hasErrorText('NOT_FOUND')).toBe(true);
    expect(hasErrorText('SOMETHING_NEW')).toBe(false);
    expect(hasErrorText(403)).toBe(false);
  });
});
