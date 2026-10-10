import { describe, expect, it } from 'vitest';
import {
  matchesQuery,
  matchesStrictly,
  nameKey,
  normalizeName,
  queryTerms,
  searchKeys,
  tokenize,
} from './index';

const finds = (name: string, query: string) => matchesQuery(searchKeys(name), queryTerms(query));

describe('search keys (ADR-0011 #4, ADR-0028)', () => {
  it('finds the same product for Кока, Coca, кока and COCA in either script (SPEC §5.2)', () => {
    for (const name of ['Кока кола 0.5л', 'Coca-Cola 0.5L']) {
      for (const query of ['Кока', 'Coca', 'кока', 'COCA', 'кока кола', 'cola 0,5']) {
        expect(finds(name, query), `${name} / ${query}`).toBe(true);
      }
    }
  });

  it('gives cross-script spellings of one name the same phonetic key', () => {
    expect(searchKeys('Coca-Cola 0.5L').phonetic).toBe(' koka kola 0.5 l');
    expect(searchKeys('Кока кола 0,5л').phonetic).toBe(' koka kola 0.5 l');
    expect(searchKeys('Bonaqua').phonetic).toBe(searchKeys('Бонаква').phonetic);
    expect(searchKeys('Khaan').phonetic).toBe(searchKeys('Хаан').phonetic);
  });

  it('tolerates ө and ү typed as о and у, and ё typed as е', () => {
    expect(finds('Өндөг 10ш', 'ондог')).toBe(true);
    expect(finds('Ондог', 'өндөг')).toBe(true);
    expect(finds('Сүү 1л', 'суу')).toBe(true);
    expect(finds('Ёгурт', 'егурт')).toBe(true);
  });

  it('keeps ө/ү distinct in the strict key, so strict matches can rank first', () => {
    expect(searchKeys('ус').strict).not.toBe(searchKeys('үс').strict);
    expect(matchesStrictly(searchKeys('Ус 1л'), queryTerms('ус'))).toBe(true);
    expect(matchesStrictly(searchKeys('Үс угаагч'), queryTerms('ус'))).toBe(false);
    expect(matchesStrictly(searchKeys('Coca-Cola'), queryTerms('кока'))).toBe(false);
  });

  it('folds Latin look-alike letters inside Cyrillic words', () => {
    expect(nameKey('Ундаa')).toBe(nameKey('Ундаа'));
    expect(nameKey('HOT ДОГ')).toBe(nameKey('НОТ ДОГ'));
    expect(nameKey('  Ус   ')).toBe('ус');
  });

  it('matches short terms only at the start of a word', () => {
    expect(finds('Ус 1л', 'ус')).toBe(true);
    expect(finds('Мусор уут', 'ус')).toBe(false);
    expect(finds('Мусор уут', 'усо')).toBe(true);
  });

  it('requires every term', () => {
    expect(finds('Кока кола 0.5л', 'кола 1.5')).toBe(false);
    expect(finds('Кока кола 1.5л', 'кола 1.5')).toBe(true);
  });

  it('reads sizes and NFKC forms the same way', () => {
    expect(tokenize('0,5л')).toEqual(['0.5', 'л']);
    expect(tokenize('Coca-Cola 330ml')).toEqual(['coca', 'cola', '330', 'ml']);
    expect(searchKeys('ＣＯＣＡ').strict).toBe(searchKeys('coca').strict);
    const decomposedYo = String.fromCharCode(0x415, 0x308);
    expect(searchKeys(decomposedYo).strict).toBe(searchKeys('Е').strict);
  });

  it('romanises every Mongolian letter to plain Latin', () => {
    const alphabet = 'АБВГДЕЁЖЗИЙКЛМНОӨПРСТУҮФХЦЧШЩЪЫЬЭЮЯ';
    expect([...alphabet]).toHaveLength(35);
    for (const letter of [...alphabet, ...alphabet.toLowerCase()]) {
      expect(searchKeys(`${letter}а`).phonetic, letter).toMatch(/^ [a-z]+$/);
    }
  });

  it('adds extra words such as the SKU and ignores empty queries', () => {
    expect(finds('Кока кола', '10023')).toBe(false);
    expect(matchesQuery(searchKeys('Кока кола', ['10023']), queryTerms('10023'))).toBe(true);
    expect(queryTerms('  -- ')).toEqual([]);
    expect(searchKeys('')).toMatchObject({ strict: '', phonetic: '' });
  });

  it('normalises display names', () => {
    expect(normalizeName('  Кока   кола  ')).toBe('Кока кола');
    expect(normalizeName(String.fromCharCode(0x415, 0x308))).toBe('Ё');
  });
});
