import { describe, expect, it } from 'vitest';
import {
  guessCustomerKind,
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  isImportKind,
  matchHeaders,
  normalizeHeader,
  parseDecimal,
  readCell,
  splitList,
} from './index';

const labels: Record<string, string[]> = {
  sku: ['Код', 'Барааны код', 'SKU'],
  name: ['Нэр'],
  category: ['Ангилал'],
  barcodes: ['Ширхгийн баркод'],
};

describe('import templates', () => {
  it('lists every kind with unique column keys and at least one required column', () => {
    for (const kind of IMPORT_KINDS) {
      const keys = IMPORT_COLUMNS[kind].map((spec) => spec.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(IMPORT_COLUMNS[kind].some((spec) => spec.required)).toBe(true);
    }
    expect(isImportKind('PRODUCTS')).toBe(true);
    expect(isImportKind('PRICES')).toBe(false);
  });

  it('matches header cells to columns whatever their order, marks and case', () => {
    expect(normalizeHeader('  Код *: ')).toBe('код');
    const match = matchHeaders(
      ['№', 'Нэр*', null, 'барааны КОД', 'Ширхгийн  баркод', 'Ангилал'],
      'PRODUCTS',
      (key) => labels[key] ?? [],
    );
    expect(Object.fromEntries(match.columns)).toEqual({
      name: 1,
      sku: 3,
      barcodes: 4,
      category: 5,
    });
    expect(match.missing).toEqual([]);
    const missing = matchHeaders(['Нэр', 'Нэр'], 'PRODUCTS', (key) => labels[key] ?? []);
    expect(missing.missing).toEqual(['sku', 'category']);
    expect(missing.duplicates).toEqual(['name']);
  });
});

describe('cells', () => {
  it('keeps codes as written and warns about codes typed as numbers', () => {
    expect(readCell(' 0012 ', 'code')).toEqual({ text: '0012' });
    expect(readCell(12, 'code')).toEqual({ text: '12', warning: 'NUMERIC_CODE' });
    expect(readCell(4006381333931, 'list')).toEqual({ text: '4006381333931' });
    expect(readCell(12.5, 'code')).toEqual({ text: null, problem: 'FORMAT' });
    expect(readCell(2 ** 60, 'code')).toEqual({ text: null, problem: 'FORMAT' });
  });

  it('reads numbers exactly as Excel shows them', () => {
    expect(readCell(0.1 + 0.2, 'decimal')).toEqual({ text: '0.3' });
    expect(readCell(1250.5, 'decimal')).toEqual({ text: '1250.5' });
    expect(readCell(24, 'decimal')).toEqual({ text: '24' });
  });

  it('reads rich text, formulas, hyperlinks and refuses dates and error values', () => {
    expect(readCell({ richText: [{ text: 'Кока ' }, { text: 'кола' }] }, 'text')).toEqual({
      text: 'Кока кола',
    });
    expect(readCell({ formula: 'A1*2', result: 48 }, 'decimal')).toEqual({ text: '48' });
    expect(readCell({ formula: 'A1*2' }, 'decimal')).toEqual({
      text: null,
      problem: 'FORMULA_WITHOUT_RESULT',
    });
    const maps = 'https://www.google.com/maps/place/@47.9,106.9,17z';
    expect(readCell({ text: 'Дэлгүүр', hyperlink: maps }, 'link')).toEqual({ text: maps });
    expect(readCell({ text: 'Дэлгүүр', hyperlink: maps }, 'text')).toEqual({ text: 'Дэлгүүр' });
    expect(readCell(new Date(2026, 9, 11), 'text')).toEqual({
      text: null,
      problem: 'DATE_IN_CELL',
    });
    expect(readCell({ error: '#N/A' }, 'text')).toEqual({ text: null, problem: 'ERROR_VALUE' });
    expect(readCell('   ', 'text')).toEqual({ text: null });
    expect(readCell('x'.repeat(1_001), 'text')).toEqual({ text: null, problem: 'TOO_LONG' });
  });

  it('splits several barcodes in one cell and reads decimals', () => {
    expect(splitList('4006381333931, 5449000000996;\n4006381333931')).toEqual([
      '4006381333931',
      '5449000000996',
    ]);
    expect(splitList(null)).toEqual([]);
    expect(parseDecimal('1,250.50')?.toFixed()).toBe('1250.5');
    expect(parseDecimal('-1')).toBeNull();
    expect(parseDecimal('12 шт')).toBeNull();
  });
});

describe('customer kind', () => {
  it('reads it from the registration number, else the TIN length, else assumes a company', () => {
    expect(guessCustomerKind('1234567', null)).toEqual({ kind: 'COMPANY', source: 'REG_NO' });
    expect(guessCustomerKind('УБ90010112', null)).toEqual({
      kind: 'INDIVIDUAL',
      source: 'REG_NO',
    });
    expect(guessCustomerKind(null, '12345678901')).toEqual({ kind: 'COMPANY', source: 'TIN' });
    expect(guessCustomerKind('', '123456789012')).toEqual({ kind: 'INDIVIDUAL', source: 'TIN' });
    expect(guessCustomerKind(null, null)).toEqual({ kind: 'COMPANY', source: 'DEFAULT' });
  });
});
