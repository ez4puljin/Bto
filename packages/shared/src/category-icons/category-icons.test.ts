import { describe, expect, it } from 'vitest';
import mn from '../../i18n/mn.json';
import {
  CATEGORY_ICON_KEYS,
  categoryIconOf,
  categoryIconSvg,
  isCategoryIconKey,
  suggestCategoryIcon,
} from './index';

describe('category icons (ADR-0163)', () => {
  it('reads what a category sells from its name, the particular before the general', () => {
    const cases: [string, string][] = [
      ['101 Дарс виски', 'wine'],
      ['Пиво', 'beer'],
      ['Цэвэр ус, Рашаан', 'water'],
      ['Жүүс & Ундаа', 'juice'],
      ['Ундаа', 'drinks'],
      ['Элсэн чихэр, Давс', 'salt'],
      ['Иштэй чихэр', 'lollipop'],
      ['Цонхтой чихэр, печень (Хайрцагтай)', 'candyBox'],
      ['Чихэр', 'candy'],
      ['Печень, Жигнэмэг', 'cookie'],
      ['Шоколад, Набор', 'chocolate'],
      ['Набор', 'giftBox'],
      ['Гурил, будаа, гоймон', 'wheat'],
      ['Будаа', 'rice'],
      ['Гурилан боов, талх', 'bread'],
      ['Гурил', 'flour'],
      ['Цай Кофе', 'teaCoffee'],
      ['Кофе кофены сүү', 'coffee'],
      ['Сүү', 'milk'],
      ['Сүүн бүтээгдэхүүн', 'dairy'],
      ['Мах махан бүтээгдэхүүн', 'meat'],
      ['Хатаасан мах', 'jerky'],
      ['Тахиа & Гахайн мах', 'chicken'],
      ['Электрон тамхи', 'vape'],
      ['Тамхи', 'cigarette'],
      ['Эдийн саван', 'laundrySoap'],
      ['Саван', 'soap'],
      ['Ахуйн шингэн', 'cleaner'],
      ['Шингэн бүтээгдэхүүн', 'drinks'],
      ['Вок', 'detergent'],
      ['Хүүхдийн нэмэлт хоол', 'babyFood'],
      ['Бэлэн хоол', 'readyMeal'],
      ['Ангилаагүй', 'uncategorized'],
      ['Огт танихгүй нэр', 'bag'],
    ];
    for (const [name, key] of cases) expect([name, suggestCategoryIcon(name)]).toEqual([name, key]);
  });

  it('prefers the one chosen for it, and ignores a key it does not know', () => {
    expect(categoryIconOf({ iconKey: 'toy', name: 'Пиво' })).toBe('toy');
    expect(categoryIconOf({ iconKey: null, name: 'Пиво' })).toBe('beer');
    expect(categoryIconOf({ iconKey: 'noSuchIcon', name: 'Пиво' })).toBe('beer');
  });

  it('has a drawing and a Mongolian name for every key', () => {
    const names = mn.catalog.categories.icons as Record<string, string>;
    expect(Object.keys(names).sort()).toEqual([...CATEGORY_ICON_KEYS].sort());
    for (const key of CATEGORY_ICON_KEYS) {
      expect(isCategoryIconKey(key)).toBe(true);
      expect(categoryIconSvg(key)).toMatch(/^<svg [^>]*viewBox="0 0 64 64">.*<\/svg>$/);
    }
    expect(isCategoryIconKey('noSuchIcon')).toBe(false);
  });
});
