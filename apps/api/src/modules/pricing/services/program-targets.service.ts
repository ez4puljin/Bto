import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { ProgramTarget } from '@tugeel/shared/pricing';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import {
  PRODUCT_SET_RESOLVER,
  ProductFiltersService,
  type ProductSetResolver,
} from '../../catalog';
import { ProductSuppliersService } from '../../partners';

/** What a program names; the products behind it are read here. */
export interface TargetedProgram {
  id: number;
  targetKind: ProgramTarget | null;
  targetIds: readonly number[];
  excludeTargetIds: readonly number[];
  excludeProductIds: readonly number[];
}

/** A segment's members are read at most once a minute per process: rules can be costly. */
const SEGMENT_TTL_MS = 60_000;

/**
 * The products a program's targets stand for (ADR-0159 #2): chosen products as they are, a category
 * with its subtree, a supplier's linked products, a live product segment's members, less the
 * excluded targets and products. Read when a quote runs, so a product that joins a supplier or a
 * category counts at once and one that joins a segment within a minute. An archived or removed
 * segment keeps no products, so a plan on it applies to nothing instead of refusing every quote.
 */
@Injectable()
export class ProgramTargetsService implements OnModuleInit {
  private resolver: ProductSetResolver | null = null;
  private readonly segments = new Map<number, { at: number; ids: readonly number[] }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly productFilters: ProductFiltersService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.resolver = this.moduleRef.get<ProductSetResolver>(PRODUCT_SET_RESOLVER, {
        strict: false,
      });
    } catch {
      // The worker and tests that load pricing alone have no segments.
      this.resolver = null;
    }
  }

  /** A program was saved: what it names is read afresh. */
  forget(): void {
    this.segments.clear();
  }

  /** Each program with targets and its products; one read per target among these programs. */
  async productSets(
    programs: readonly TargetedProgram[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, ReadonlySet<number>>> {
    const read = new Map<string, readonly number[]>();
    const expand = async (kind: ProgramTarget, ids: readonly number[]) => {
      const products = new Set<number>();
      for (const id of ids) {
        for (const productId of await this.one(kind, id, read, executor)) products.add(productId);
      }
      return products;
    };
    const result = new Map<number, ReadonlySet<number>>();
    for (const program of programs) {
      if (program.targetKind === null) continue;
      const kept = await expand(program.targetKind, program.targetIds);
      for (const id of await expand(program.targetKind, program.excludeTargetIds)) kept.delete(id);
      for (const id of program.excludeProductIds) kept.delete(id);
      result.set(program.id, kept);
    }
    return result;
  }

  private async one(
    kind: ProgramTarget,
    id: number,
    read: Map<string, readonly number[]>,
    executor: Db | Tx,
  ): Promise<readonly number[]> {
    if (kind === 'PRODUCT') return [id];
    const key = `${kind}:${id}`;
    const known = read.get(key);
    if (known) return known;
    const found = await this.fetch(kind, id, executor);
    read.set(key, found);
    return found;
  }

  private fetch(
    kind: Exclude<ProgramTarget, 'PRODUCT'>,
    id: number,
    executor: Db | Tx,
  ): Promise<readonly number[]> {
    switch (kind) {
      case 'CATEGORY':
        return this.productFilters.idsWhere({ field: 'category', op: 'IN', ids: [id] }, executor);
      case 'SUPPLIER':
        return this.productSuppliers.productIdsWhere(
          { field: 'supplier', op: 'IN', ids: [id] },
          executor,
        );
      case 'SEGMENT':
        return this.segment(id);
    }
  }

  private async segment(id: number): Promise<readonly number[]> {
    const known = this.segments.get(id);
    if (known && Date.now() - known.at < SEGMENT_TTL_MS) return known.ids;
    if (!this.resolver) return [];
    let ids: readonly number[];
    try {
      ids = await this.resolver.productIds({ segmentId: id });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
      ids = [];
    }
    this.segments.set(id, { at: Date.now(), ids });
    return ids;
  }
}
