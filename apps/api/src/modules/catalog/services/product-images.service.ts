import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, max } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { type Actor, AuditService, StorageService } from '../../identity';
import { productImages } from '../schema';
import type { ImageView } from './products.service';
import { touchProduct, invalid, notFound } from './support';

/** At most this many photos per product. */
export const MAX_PRODUCT_IMAGES = 10;

type ProductImage = typeof productImages.$inferSelect;

/** A photo and its thumbnail, uploaded through identity's storage. */
export interface ImageFiles {
  imageFileId: number;
  thumbFileId: number;
}

/**
 * Product photos (ADR-0030): the web uploads a full image and a thumbnail through identity's
 * storage, then attaches both here. The first photo becomes the primary one.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async attach(actor: Actor, productId: number, files: ImageFiles): Promise<ImageView> {
    await this.verify([files]);
    const [row] = await inTransaction(this.db, (tx) =>
      this.attachManyInTx(tx, actor, productId, [files]),
    );
    if (!row) throw new Error('image insert returned no row');
    return this.view(row);
  }

  /**
   * Checks, before the attaching transaction, that every photo and thumbnail arrived: with the
   * Spaces driver this is an HTTP HEAD (CLAUDE.md NEVER list).
   */
  async verify(files: readonly ImageFiles[]): Promise<void> {
    for (const pair of files) {
      await this.storage.verifyUploaded(pair.imageFileId, 'catalog.product_image');
      await this.storage.verifyUploaded(pair.thumbFileId, 'catalog.product_thumb');
    }
  }

  /**
   * Attaches verified photos in the caller's transaction (a registration, ADR-0044 #5), in order
   * after the product's existing ones; the first becomes primary when the product has none.
   */
  async attachManyInTx(
    tx: Tx,
    actor: Actor,
    productId: number,
    files: readonly ImageFiles[],
  ): Promise<ProductImage[]> {
    if (files.length === 0) return [];
    // Locks the product and marks it changed (ADR-0049 #2).
    if (!(await touchProduct(tx, productId))) throw notFound('product', productId);
    const [stats] = await tx
      .select({ total: count(productImages.id), last: max(productImages.sortOrder) })
      .from(productImages)
      .where(eq(productImages.productId, productId));
    const total = stats?.total ?? 0;
    if (total + files.length > MAX_PRODUCT_IMAGES) {
      throw invalid('images', 'max', `a product has at most ${MAX_PRODUCT_IMAGES} images`);
    }
    for (const pair of files) {
      await this.storage.confirm(tx, pair.imageFileId, 'catalog.product_image');
      await this.storage.confirm(tx, pair.thumbFileId, 'catalog.product_thumb');
    }
    const first = (stats?.last ?? -1) + 1;
    const rows = await tx
      .insert(productImages)
      .values(
        files.map((pair, index) => ({
          productId,
          imageFileId: pair.imageFileId,
          thumbFileId: pair.thumbFileId,
          sortOrder: first + index,
          isPrimary: total === 0 && index === 0,
        })),
      )
      .returning();
    await this.audit.recordMany(
      tx,
      actor,
      rows.map((row) => ({
        action: 'CREATE',
        entity: 'product_images',
        entityId: row.id,
        after: row,
      })),
    );
    return rows;
  }

  /** Makes a photo the one lists show (old primary cleared first). */
  setPrimary(actor: Actor, imageId: number): Promise<ImageView> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(tx, imageId);
      await tx
        .update(productImages)
        .set({ isPrimary: false })
        .where(
          and(eq(productImages.productId, before.productId), eq(productImages.isPrimary, true)),
        );
      const [row] = await tx
        .update(productImages)
        .set({ isPrimary: true })
        .where(eq(productImages.id, imageId))
        .returning();
      if (!row) throw notFound('product image', imageId);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'product_images',
        entityId: imageId,
        before,
        after: row,
      });
      return this.view(row, tx);
    });
  }

  /** Removes a photo; its files are marked DELETED and the next photo becomes primary. */
  remove(actor: Actor, imageId: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(tx, imageId);
      await tx.delete(productImages).where(eq(productImages.id, imageId));
      await this.storage.markDeleted(tx, before.imageFileId);
      await this.storage.markDeleted(tx, before.thumbFileId);
      if (before.isPrimary) {
        const [next] = await tx
          .select({ id: productImages.id })
          .from(productImages)
          .where(eq(productImages.productId, before.productId))
          .orderBy(asc(productImages.sortOrder), asc(productImages.id))
          .limit(1);
        if (next)
          await tx
            .update(productImages)
            .set({ isPrimary: true })
            .where(eq(productImages.id, next.id));
      }
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'product_images',
        entityId: imageId,
        before,
      });
    });
  }

  private async get(tx: Tx, imageId: number): Promise<ProductImage> {
    const [row] = await tx.select().from(productImages).where(eq(productImages.id, imageId));
    if (!row) throw notFound('product image', imageId);
    // Locks the product and marks it changed (ADR-0049 #2).
    await touchProduct(tx, row.productId);
    return row;
  }

  private async view(row: ProductImage, executor: Db | Tx = this.db): Promise<ImageView> {
    const urls = await this.storage.publicUrls([row.imageFileId, row.thumbFileId], executor);
    return {
      id: row.id,
      url: urls.get(row.imageFileId) ?? null,
      thumbUrl: urls.get(row.thumbFileId) ?? null,
      isPrimary: row.isPrimary,
      sortOrder: row.sortOrder,
    };
  }
}
