import { describe, expect, it } from 'vitest';
import { ARTICLES, articlePath, GUIDE_CATEGORIES } from './content';

describe('guide content', () => {
  it('has the seven first articles', () => {
    expect(ARTICLES.map(articlePath)).toEqual([
      '/guide/inventory/receipt-notes',
      '/guide/inventory/scan-note',
      '/guide/catalog/product-ai',
      '/guide/catalog/product-app',
      '/guide/setup/ai-key',
      '/guide/setup/product-picture',
      '/guide/setup/scan-bridge',
    ]);
  });

  it('gives every article a title, a summary and a named category', () => {
    for (const article of ARTICLES) {
      expect(article.title, article.slug).not.toBe('');
      expect(article.summary, article.slug).not.toBe('');
      expect(GUIDE_CATEGORIES as readonly string[], article.slug).toContain(article.category);
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
