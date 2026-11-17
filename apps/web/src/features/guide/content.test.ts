import { describe, expect, it } from 'vitest';
import mn from '@tugeel/shared/i18n/mn.json';
import { ARTICLES, articlePath, GUIDE_CATEGORIES, type GuideCategory } from './content';

describe('guide content', () => {
  it('registers the 15 categories in order, each with a name', () => {
    expect([...GUIDE_CATEGORIES]).toEqual([
      'start',
      'sales',
      'inventory',
      'procurement',
      'catalog',
      'pricing',
      'partners',
      'finance',
      'reports',
      'pos',
      'hr',
      'apps',
      'ai',
      'system',
      'setup',
    ]);
    for (const key of GUIDE_CATEGORIES) {
      expect(mn.guide.categories[key], key).toBeTruthy();
    }
    expect(Object.keys(mn.guide.categories)).toHaveLength(GUIDE_CATEGORIES.length);
  });

  it('still has the seven first articles, whatever else exists', () => {
    const paths = new Set(ARTICLES.map(articlePath));
    for (const path of [
      '/guide/inventory/receipt-notes',
      '/guide/inventory/scan-note',
      '/guide/catalog/product-ai',
      '/guide/catalog/product-app',
      '/guide/setup/ai-key',
      '/guide/setup/product-picture',
      '/guide/setup/scan-bridge',
    ]) {
      expect(paths.has(path), path).toBe(true);
    }
  });

  it('has one article per file, each in a registered category', () => {
    const files = Object.keys(
      import.meta.glob('./content/**/*.md', { query: '?raw', import: 'default', eager: true }),
    );
    expect(ARTICLES).toHaveLength(files.length);
    for (const file of files) {
      expect(file, file).toMatch(/\/content\/[^/]+\/\d+-[^/]+\.md$/);
    }
  });

  it('gives every article a unique address', () => {
    const paths = ARTICLES.map(articlePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every article a title that is unique within its category', () => {
    const seen = new Set<string>();
    for (const article of ARTICLES) {
      const key = `${article.category}\n${article.title}`;
      expect(seen.has(key), `${articlePath(article)}: «${article.title}» is used twice`).toBe(
        false,
      );
      seen.add(key);
    }
  });

  it('orders articles by category order, then by number', () => {
    const rank = (category: string) => GUIDE_CATEGORIES.findIndex((known) => known === category);
    for (let i = 1; i < ARTICLES.length; i += 1) {
      const a = ARTICLES[i - 1];
      const b = ARTICLES[i];
      if (!a || !b) throw new Error('hole in ARTICLES');
      const label = `${articlePath(a)} before ${articlePath(b)}`;
      expect(rank(a.category), label).toBeLessThanOrEqual(rank(b.category));
      if (a.category === b.category) expect(a.order, label).toBeLessThanOrEqual(b.order);
    }
  });

  it('gives every article a title, a summary and a named category', () => {
    for (const article of ARTICLES) {
      expect(article.title, article.slug).not.toBe('');
      expect(article.summary, article.slug).not.toBe('');
      expect(GUIDE_CATEGORIES as readonly string[], article.slug).toContain(article.category);
      expect(mn.guide.categories[article.category as GuideCategory], article.category).toBeTruthy();
      expect(article.source, article.slug).toMatch(/^\s*# \S/);
    }
  });

  it('links only to articles that exist', () => {
    const paths = new Set(ARTICLES.map(articlePath));
    for (const article of ARTICLES) {
      for (const [, path] of article.source.matchAll(/\]\((\/guide\/[^)\s]*)\)/g)) {
        expect(paths.has(path ?? ''), `${article.slug} → ${path}`).toBe(true);
      }
    }
  });
});
