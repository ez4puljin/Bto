import { Inject, Injectable } from '@nestjs/common';
import { POS_LIMITS, type SnapshotQuickGroup } from '@tugeel/shared/pos';
import { asc } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { CatalogService, UnitConversionService } from '../../catalog';
import { AuditService, type AuthContext } from '../../identity';
import { posQuickButtons, posQuickGroups } from '../schema';

export interface QuickButton {
  productUnitId: number;
  productId: number;
  productSku: string;
  productName: string;
  uomName: string;
  label: string | null;
  /** False once the product is no longer sold at the till: the edge leaves it off the panel. */
  sellable: boolean;
}

export interface QuickGroup {
  id: number;
  name: string;
  buttons: QuickButton[];
}

export interface QuickButtonsInput {
  groups: { name: string; buttons: { productUnitId: number; label: string | null }[] }[];
}

/**
 * The till's F7 panel (ADR-0104): groups of product units the admin chose, the same on every till
 * of the store, carried to the edge in the snapshot. Saved as a whole set.
 */
@Injectable()
export class PosQuickButtonsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
  ) {}

  async list(executor: Db | Tx = this.db): Promise<QuickGroup[]> {
    const groups = await executor.select().from(posQuickGroups).orderBy(asc(posQuickGroups.sort));
    const buttons = await executor
      .select()
      .from(posQuickButtons)
      .orderBy(asc(posQuickButtons.groupId), asc(posQuickButtons.sort));
    const units = await this.units.describe(
      [...new Set(buttons.map((button) => button.productUnitId))],
      executor,
    );
    const products = new Map(
      (
        await this.catalog.getMany(
          [...new Set([...units.values()].map((unit) => unit.productId))],
          executor,
        )
      ).map((product) => [product.id, product]),
    );
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      buttons: buttons.flatMap((button) => {
        if (button.groupId !== group.id) return [];
        const unit = units.get(button.productUnitId);
        const product = unit ? products.get(unit.productId) : undefined;
        if (!unit || !product) return [];
        return [
          {
            productUnitId: button.productUnitId,
            productId: product.id,
            productSku: product.sku,
            productName: product.name,
            uomName: unit.uomName,
            label: button.label,
            sellable: unit.current && product.status === 'ACTIVE' && product.saleReadyAt !== null,
          },
        ];
      }),
    }));
  }

  /** The snapshot's share: sellable buttons only, groups without one left out. */
  async forSnapshot(): Promise<SnapshotQuickGroup[]> {
    return (await this.list()).flatMap((group) => {
      const buttons = group.buttons
        .filter((button) => button.sellable)
        .map((button) => ({
          productId: button.productId,
          unitId: button.productUnitId,
          label: button.label,
        }));
      return buttons.length ? [{ id: group.id, name: group.name, buttons }] : [];
    });
  }

  async replace(ctx: AuthContext, input: QuickButtonsInput): Promise<QuickGroup[]> {
    if (input.groups.length > POS_LIMITS.maxQuickGroups) {
      throw invalid('groups', 'max', `at most ${POS_LIMITS.maxQuickGroups} groups`);
    }
    const unitIds = new Set<number>();
    input.groups.forEach((group, index) => {
      if (group.buttons.length > POS_LIMITS.maxQuickButtons) {
        throw invalid(`groups[${index}].buttons`, 'max', `at most ${POS_LIMITS.maxQuickButtons}`);
      }
      const seen = new Set<number>();
      group.buttons.forEach((button, at) => {
        if (seen.has(button.productUnitId)) {
          throw invalid(`groups[${index}].buttons[${at}]`, 'unique', 'once per group');
        }
        seen.add(button.productUnitId);
        unitIds.add(button.productUnitId);
      });
    });
    return inTransaction(this.db, async (tx) => {
      const units = await this.units.describe([...unitIds], tx);
      input.groups.forEach((group, index) =>
        group.buttons.forEach((button, at) => {
          if (!units.get(button.productUnitId)?.current) {
            throw invalid(
              `groups[${index}].buttons[${at}].productUnitId`,
              'exists',
              'a current unit of a product',
            );
          }
        }),
      );
      const before = await this.list(tx);
      // Buttons go with their groups (ON DELETE CASCADE).
      await tx.delete(posQuickGroups);
      for (const [sort, group] of input.groups.entries()) {
        const [row] = await tx
          .insert(posQuickGroups)
          .values({ name: group.name, sort })
          .returning({ id: posQuickGroups.id });
        if (!row) throw new Error('no quick group row');
        if (group.buttons.length) {
          await tx.insert(posQuickButtons).values(
            group.buttons.map((button, at) => ({
              groupId: row.id,
              productUnitId: button.productUnitId,
              label: button.label,
              sort: at,
            })),
          );
        }
      }
      const after = await this.list(tx);
      const brief = (groups: QuickGroup[]) =>
        groups.map((group) => ({
          name: group.name,
          buttons: group.buttons.map((button) => [button.productUnitId, button.label]),
        }));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_quick_buttons',
        entityId: 1,
        before: { groups: brief(before) },
        after: { groups: brief(after) },
      });
      return after;
    });
  }
}
