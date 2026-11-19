import { Injectable } from '@nestjs/common';
import { prefilterSimilar, type RankedCandidate, searchWordsOf } from '@tugeel/shared/inventory';
import { notFound } from '../../../common/errors/app-error';
import { CatalogService, type ProductSummary } from '../../catalog';

/** Products read per catalogue search for candidates: per word and for the category. */
const SEARCH_LIMIT = 100;
const CATEGORY_LIMIT = 200;

/** A product and the candidates the pre-filter kept for it, best first. */
export interface SimilarCandidates {
  source: ProductSummary;
  ranked: RankedCandidate<ProductSummary>[];
}

/**
 * «Төстэй бараа» (ADR-0231), the database half: the candidates of a product are the active
 * products the catalogue's own search finds for each of its words, and those of its category,
 * through the pre-filter of `@tugeel/shared/inventory` (same kind, same pack size). A few reads
 * whatever the catalogue's size; nothing is written.
 */
@Injectable()
export class SimilarProductsService {
  constructor(private readonly catalog: CatalogService) {}

  async candidates(productId: number): Promise<SimilarCandidates> {
    const [source] = await this.catalog.getMany([productId]);
    if (!source) throw notFound('product', productId);
    const pages = await Promise.all([
      ...searchWordsOf(source.name).map((word) =>
        this.catalog.search({ q: word, status: 'ACTIVE', limit: SEARCH_LIMIT }),
      ),
      this.catalog.search({
        categoryId: source.categoryId,
        status: 'ACTIVE',
        limit: CATEGORY_LIMIT,
      }),
    ]);
    const candidates = pages.flatMap((page) => page.data);
    return { source, ranked: prefilterSimilar(source, candidates) };
  }
}
