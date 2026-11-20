import { familyHint, PhoneSearchIndex, queryWords, stem } from './phone-search';

const DRINKS = ['Хийжүүлсэн ундаа', 'Жүүс & Ундаа'];
const catalog = new PhoneSearchIndex(
  [
    ['Түмний кола 2л', DRINKS],
    ['Түмний ханборгоцой 2л', DRINKS],
    ['Түмний sprite 2л', DRINKS],
    ['Түмний жүрж 2л', DRINKS],
    ['Бидний кола 1.25л', DRINKS],
    ['Фрутта ундаа 1л', DRINKS],
    ['Sprite 900мл', DRINKS],
    ['Степ шоколад 90гр', ['Шоколад, Набор']],
    ['Нум сум', ['Тоглоом']],
    ['Сайн сүү 1л', ['Сүү']],
    ['Байт нум сум', ['Тоглоом']],
  ].map(([name, categoryNames], index) => ({
    id: index + 1,
    sku: `90${index}`,
    name: name as string,
    categoryNames: categoryNames as string[],
  })),
);
const names = (query: string) => catalog.search(query, 20).map((hit) => hit.name);

describe('the phone’s product search (ADR-0232 #6, the first real call)', () => {
  it('finds a brand with a generic word its names lack, as partial matches', () => {
    const hits = catalog.search('түмний ундаа', 20);
    expect(hits.slice(0, 4).map((hit) => hit.name)).toEqual(
      expect.arrayContaining([
        'Түмний кола 2л',
        'Түмний ханборгоцой 2л',
        'Түмний sprite 2л',
        'Түмний жүрж 2л',
      ]),
    );
    expect(hits.slice(0, 4).every((hit) => !hit.exact)).toBe(true);
    // A generic word alone does not bring another brand.
    expect(names('түмний ундаа')).not.toContain('Бидний кола 1.25л');
  });

  it('keeps a product holding every word on top', () => {
    const hits = catalog.search('түмний кола', 20);
    expect(hits[0]).toMatchObject({ name: 'Түмний кола 2л', exact: true });
    expect(hits.slice(1).every((hit) => !hit.exact)).toBe(true);
    // A word that starts a name's word ranks above one found inside a word.
    expect(names('кола')[0]).not.toBe('Степ шоколад 90гр');
  });

  it('lands a mis-heard brand, a case ending and a Latin brand heard in Cyrillic', () => {
    expect(names('түмэн ундаа')[0]).toMatch(/^Түмний/);
    expect(names('түмны кола')[0]).toBe('Түмний кола 2л');
    expect(names('ундааны')).toContain('Фрутта ундаа 1л');
    expect(names('спрайт').slice(0, 2).sort()).toEqual(['Sprite 900мл', 'Түмний sprite 2л']);
  });

  it('drops filler, and finds nothing for a word nothing is like', () => {
    expect(queryWords('Түмний ундаа байна уу')).toEqual([
      { word: 'түмний', kind: 'brand' },
      { word: 'ундаа', kind: 'generic' },
    ]);
    expect(queryWords('кола 2 л').map((word) => word.kind)).toEqual(['brand', 'size', 'size']);
    expect(names('байхгүйбараа')).toEqual([]);
    expect(names('байна уу')).toEqual([]);
    expect(stem('ундааны')).toBe('ундаа');
    expect(stem('ус')).toBe('ус');
  });

  it('names a family the rows share', () => {
    expect(
      familyHint(['Түмний кола 2л', 'Түмний ханборгоцой 2л', 'Түмний sprite 2л', 'Sprite 900мл']),
    ).toBe('Түмний: кола, ханборгоцой, sprite — 2л');
    expect(familyHint(['Sprite 900мл', 'Түмний кола 2л'])).toBeNull();
  });
});
