import { Inject, Injectable } from '@nestjs/common';
import { expiryUrgency, type ExpiryUrgency } from '@tugeel/shared/expiry';
import { daysBetween } from '@tugeel/shared/finance';
import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { inArray } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { CatalogService } from '../../catalog';
import { OrgService, type RoleBrief, UserNamesService } from '../../identity';
import { ProductLocationsService } from '../../inventory';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import { expiryItemRoles, expiryItems, expiryItemUsers } from '../schema';

export type ExpiryItemRow = typeof expiryItems.$inferSelect;

export interface ExpiryItemView {
  id: number;
  product: { id: number; sku: string; name: string; baseUomName: string; thumbUrl: string | null };
  supplier: { id: number; name: string } | null;
  homeWarehouse: { id: number; name: string } | null;
  expiryDate: string;
  daysLeft: number;
  urgency: ExpiryUrgency;
  qtyFloor: Decimal;
  qtyWarehouse: Decimal;
  qtyTotal: Decimal;
  status: ExpiryItemRow['status'];
  liability: {
    type: ExpiryItemRow['liabilityType'];
    roles: RoleBrief[];
    users: { id: number; fullName: string }[];
    note: string | null;
  };
  note: string | null;
  editVersion: number;
  createdAt: Date;
  createdByName: string;
  updatedAt: Date;
  archivedAt: Date | null;
  archivedByName: string | null;
}

/**
 * A page of records with what their owners know, one batch per page (ADR-0172 #7): the product's
 * name, main supplier and home warehouse are read live and never copied onto a record.
 */
@Injectable()
export class ExpiryViewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly suppliers: SuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
  ) {}

  async views(
    rows: readonly ExpiryItemRow[],
    executor: Db | Tx = this.db,
  ): Promise<ExpiryItemView[]> {
    if (rows.length === 0) return [];
    const today = businessDate();
    const itemIds = rows.map((row) => row.id);
    const productIds = [...new Set(rows.map((row) => row.productId))];

    const products = new Map(
      (await this.catalog.getMany(productIds, executor)).map((product) => [product.id, product]),
    );
    const mainSupplier = await this.productSuppliers.mainSupplierOf(productIds, executor);
    const supplierNames = new Map(
      (await this.suppliers.getMany([...new Set(mainSupplier.values())], executor)).map(
        (supplier) => [supplier.id, supplier.name],
      ),
    );
    const home = await this.locations.homeOf(productIds, executor);
    const warehouseNames = await this.org.warehouseNames([...new Set(home.values())], executor);

    const liableRoles = await executor
      .select()
      .from(expiryItemRoles)
      .where(inArray(expiryItemRoles.itemId, itemIds));
    const liableUsers = await executor
      .select()
      .from(expiryItemUsers)
      .where(inArray(expiryItemUsers.itemId, itemIds));
    const roles = new Map(
      (
        await this.names.rolesBrief(
          liableRoles.map((row) => row.roleId),
          executor,
        )
      ).map((role) => [role.id, role]),
    );
    const userNames = await this.names.namesOf(
      liableUsers.map((row) => row.userId),
      executor,
    );

    return rows.map((row) => {
      const product = products.get(row.productId);
      if (!product) throw new Error(`product ${row.productId} of expiry item ${row.id} is gone`);
      const supplierId = mainSupplier.get(row.productId);
      const warehouseId = home.get(row.productId);
      const daysLeft = daysBetween(today, row.expiryDate);
      return {
        id: row.id,
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          baseUomName: product.baseUnit.uomName,
          thumbUrl: product.thumbUrl,
        },
        supplier:
          supplierId === undefined
            ? null
            : { id: supplierId, name: supplierNames.get(supplierId) ?? '' },
        homeWarehouse:
          warehouseId === undefined
            ? null
            : { id: warehouseId, name: warehouseNames.get(warehouseId) ?? '' },
        expiryDate: row.expiryDate,
        daysLeft,
        urgency: expiryUrgency(daysLeft),
        qtyFloor: row.qtyFloor,
        qtyWarehouse: row.qtyWarehouse,
        qtyTotal: row.qtyFloor.plus(row.qtyWarehouse),
        status: row.status,
        liability: {
          type: row.liabilityType,
          roles: liableRoles.flatMap((link) => {
            const role = link.itemId === row.id ? roles.get(link.roleId) : undefined;
            return role ? [role] : [];
          }),
          users: liableUsers
            .filter((link) => link.itemId === row.id)
            .map((link) => ({ id: link.userId, fullName: userNames.get(link.userId) ?? '' })),
          note: row.liabilityNote,
        },
        note: row.note,
        editVersion: row.editVersion,
        createdAt: row.createdAt,
        createdByName: row.createdByName,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        archivedByName: row.archivedByName,
      };
    });
  }

  /** One record's view. */
  async view(row: ExpiryItemRow, executor: Db | Tx = this.db): Promise<ExpiryItemView> {
    const [view] = await this.views([row], executor);
    if (!view) throw new Error(`no view of expiry item ${row.id}`);
    return view;
  }
}
