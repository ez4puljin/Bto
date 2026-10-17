import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type PosSnapshot,
  quoteContextOf,
  type SnapshotCashier,
  type SnapshotProduct,
  type SnapshotTill,
  type SnapshotUnit,
} from '@tugeel/shared/pos';
import type { QuoteProduct, QuoteProgram } from '@tugeel/shared/pricing';
import { type SearchKeys, searchKeys } from '@tugeel/shared/text';
import { eq } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgeState } from '../db/schema';

/** The snapshot as the edge sells from it: indexes for scans, searches and the price resolver. */
export interface LoadedSnapshot {
  snapshot: PosSnapshot;
  products: ReadonlyMap<number, SnapshotProduct>;
  /** Unit id → its product and unit. */
  units: ReadonlyMap<number, { product: SnapshotProduct; unit: SnapshotUnit }>;
  /** Barcode lookup key → unit id. */
  barcodes: ReadonlyMap<string, number>;
  /** Search keys of every product (name and SKU), in catalogue order. */
  search: readonly { product: SnapshotProduct; keys: SearchKeys }[];
  quote: { products: Map<number, QuoteProduct>; programs: QuoteProgram[] };
  tills: ReadonlyMap<string, SnapshotTill>;
  cashiers: ReadonlyMap<number, SnapshotCashier>;
  vatRates: ReadonlyMap<number, Decimal>;
}

function index(snapshot: PosSnapshot): LoadedSnapshot {
  const products = new Map<number, SnapshotProduct>();
  const units = new Map<number, { product: SnapshotProduct; unit: SnapshotUnit }>();
  const barcodes = new Map<string, number>();
  const search: { product: SnapshotProduct; keys: SearchKeys }[] = [];
  const vatRates = new Map<number, Decimal>();
  for (const product of snapshot.products) {
    products.set(product.id, product);
    vatRates.set(product.id, new Decimal(product.vatRatePct));
    search.push({ product, keys: searchKeys(product.name, [product.sku]) });
    for (const unit of product.units) {
      units.set(unit.unitId, { product, unit });
      for (const code of unit.barcodes) barcodes.set(code, unit.unitId);
    }
  }
  return {
    snapshot,
    products,
    units,
    barcodes,
    search,
    quote: quoteContextOf(snapshot),
    tills: new Map(snapshot.tills.map((till) => [till.code, till])),
    cashiers: new Map(snapshot.cashiers.map((cashier) => [cashier.userId, cashier])),
    vatRates,
  };
}

/**
 * The snapshot in force (ADR-0067): kept in the edge's database so a restart sells at once, held
 * in memory with its indexes. A pull that brings a new version replaces both.
 */
@Injectable()
export class SnapshotStore implements OnModuleInit {
  private loaded: LoadedSnapshot | null = null;
  private pulledAt: Date | null = null;

  constructor(@Inject(EDGE_DB) private readonly db: EdgeDb) {}

  async onModuleInit(): Promise<void> {
    const [row] = await this.db.select().from(edgeState).where(eq(edgeState.id, 1));
    if (row?.snapshot) {
      this.loaded = index(row.snapshot);
      this.pulledAt = row.pulledAt;
    }
  }

  /** The snapshot to sell from; refused until the first pull reached the centre. */
  get(): LoadedSnapshot {
    if (!this.loaded) {
      throw new AppError('POS_SNAPSHOT_MISSING', 'the edge has not pulled its snapshot yet');
    }
    return this.loaded;
  }

  peek(): LoadedSnapshot | null {
    return this.loaded;
  }

  version(): string | null {
    return this.loaded?.snapshot.version ?? null;
  }

  lastPulledAt(): Date | null {
    return this.pulledAt;
  }

  /** Keeps a new snapshot (or only the pull time when the centre said it is unchanged). */
  async apply(snapshot: PosSnapshot | null): Promise<void> {
    const now = new Date();
    if (snapshot) {
      await this.db
        .insert(edgeState)
        .values({
          id: 1,
          snapshot,
          snapshotVersion: snapshot.version,
          pulledAt: now,
          lastContactAt: now,
        })
        .onConflictDoUpdate({
          target: edgeState.id,
          set: {
            snapshot,
            snapshotVersion: snapshot.version,
            pulledAt: now,
            lastContactAt: now,
            updatedAt: now,
          },
        });
      this.loaded = index(snapshot);
    } else {
      await this.db
        .update(edgeState)
        .set({ pulledAt: now, lastContactAt: now, updatedAt: now })
        .where(eq(edgeState.id, 1));
    }
    this.pulledAt = now;
  }
}
