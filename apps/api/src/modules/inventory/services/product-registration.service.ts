import { Inject, Injectable } from '@nestjs/common';
import { USER_BIN_TYPES } from '@tugeel/shared/inventory';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import {
  type CatalogRegistration,
  CatalogRegistrationService,
  type RegisteredProduct,
} from '../../catalog';
import { type AuthContext, OrgService, ScopeService } from '../../identity';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import { type Bin, BinsService } from './bins.service';
import { ProductLocationsService } from './product-locations.service';

export interface RegistrationInput extends CatalogRegistration {
  /** The product's (main) supplier; an active one. */
  supplierId: number;
  /** The product's home: an active WHOLESALE warehouse in the registrar's write scope. */
  homeWarehouseId: number;
  /** The label code of a storage or picking shelf of the home warehouse; null: none. */
  fixedBinCode: string | null;
}

/**
 * Registers a new product in one transaction (ADR-0044 #5): the catalog part (product, units,
 * barcodes, photos), its home warehouse and fixed shelf, and its supplier. It lives in inventory,
 * the lowest module that may call both catalog and partners. Tables are written in one order —
 * products, product_locations, product_suppliers — the order of the product import and of its
 * revert, so that none of them deadlocks with another (architecture §5.3).
 */
@Injectable()
export class ProductRegistrationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogRegistrationService,
    private readonly locations: ProductLocationsService,
    private readonly bins: BinsService,
    private readonly suppliers: SuppliersService,
    private readonly links: ProductSuppliersService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
  ) {}

  async register(ctx: AuthContext, input: RegistrationInput): Promise<RegisteredProduct> {
    this.scope.assertCanWriteWarehouse(ctx, input.homeWarehouseId);
    // Outside the transaction: with the Spaces driver this is an HTTP HEAD (CLAUDE.md NEVER list).
    await this.catalog.verifyImages(input.images);
    return inTransaction(this.db, async (tx) => {
      // Read-only checks first, so that a refused registration has taken no lock.
      await this.suppliers.assertActive(tx, input.supplierId);
      const warehouse = await this.org.getWarehouse(input.homeWarehouseId, tx);
      if (warehouse.status !== 'ACTIVE') {
        throw invalid('homeWarehouseId', 'active', 'an active warehouse');
      }
      if (warehouse.kind !== 'WHOLESALE') {
        throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'a home warehouse is a wholesale one', {
          kind: warehouse.kind,
        });
      }
      const shelf =
        input.fixedBinCode === null ? null : await this.shelf(tx, warehouse.id, input.fixedBinCode);
      const product = await this.catalog.registerInTx(tx, ctx, input);
      await this.locations.setHomeInTx(tx, ctx, product.id, warehouse.id);
      if (shelf) {
        await this.locations.setInTx(tx, ctx, {
          warehouseId: warehouse.id,
          productId: product.id,
          defaultBinId: shelf.id,
        });
      }
      await this.links.linkInTx(tx, ctx, product.id, input.supplierId);
      return product;
    });
  }

  /** The fixed shelf by its label code: a storage or picking shelf of the warehouse, in use. */
  private async shelf(tx: Tx, warehouseId: number, code: string): Promise<Bin> {
    const bin = await this.bins.find(warehouseId, code, tx);
    if (!bin || !(USER_BIN_TYPES as readonly string[]).includes(bin.type)) {
      throw invalid('fixedBinCode', 'shelf', 'a storage or picking shelf of the home warehouse');
    }
    if (bin.archivedAt) {
      throw new AppError('BIN_ARCHIVED', `bin ${bin.id} is archived`, { code: bin.code });
    }
    return bin;
  }
}
