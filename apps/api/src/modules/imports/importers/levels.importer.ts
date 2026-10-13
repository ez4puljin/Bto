import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { isValidEnteredQty, toBase } from '@tugeel/shared/units';
import type { Db, Tx } from '../../../common/db/db.types';
import { CatalogImportService } from '../../catalog';
import { type Actor, OrgService } from '../../identity';
import { type LevelRestore, ProductLocationsService } from '../../inventory';
import type { ImportAction } from '../schema';
import {
  type AppliedRow,
  type CheckedRow,
  type CommittedRow,
  type Importer,
  type ImportJobRow,
  markDuplicates,
  type Progress,
  RowCheck,
  type SourceRow,
} from './importer';
import { decimalCell, keyOf, warehouseFinder } from './lookups';

const QTY_MAX = new Decimal('99999999999');
/** Low-stock levels are kept for warehouses with shelves. */
const LEVEL_KINDS = ['WHOLESALE', 'STORE'];

/** A row's levels in base units (JSON: the row's plan); null keeps the stored level. */
export interface LevelsPlan {
  warehouseId: number;
  productId: number;
  minQty: string | null;
  maxQty: string | null;
  changed: string[];
}

type Pair = { minQty: string | null; maxQty: string | null };

/** What a committed row set and what was there before, for the revert. */
interface LevelsChanges {
  warehouseId: number;
  productId: number;
  set: Pair;
  before: Pair;
}

const decimalOrNull = (value: string | null) => (value === null ? null : new Decimal(value));
const pairOf = (pair: Pair) => ({
  minQty: decimalOrNull(pair.minQty),
  maxQty: decimalOrNull(pair.maxQty),
});

function isLevelsChanges(value: unknown): value is LevelsChanges {
  return (
    typeof value === 'object' &&
    value !== null &&
    'warehouseId' in value &&
    'productId' in value &&
    'set' in value &&
    'before' in value
  );
}

/**
 * Low-stock levels (ADR-0039): the minimum and maximum of a product in a wholesale warehouse or the
 * supermarket, in the row's unit (default the base unit). An empty cell keeps the stored level, as
 * everywhere in the imports; the home rule of receipts applies to wholesale warehouses.
 */
@Injectable()
export class LevelsImporter implements Importer<LevelsPlan> {
  readonly kind = 'LEVELS' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly org: OrgService,
    private readonly locations: ProductLocationsService,
  ) {}

  async validate(rows: readonly SourceRow[], executor: Db | Tx): Promise<CheckedRow<LevelsPlan>[]> {
    const warehouses = await this.org.listWarehouses();
    const findWarehouse = warehouseFinder(warehouses.filter((w) => w.status === 'ACTIVE'));
    const reference = await this.catalog.reference(executor);
    const uomById = new Map(reference.uoms.map((uom) => [uom.id, uom]));

    const entries = rows.map((row) => {
      const check = new RowCheck(row);
      const warehouseText = check.text('warehouse', true);
      let warehouse: (typeof warehouses)[number] | null = null;
      if (warehouseText !== null) {
        const found = findWarehouse(warehouseText);
        if (!found.ok) check.error('warehouse', found.code, { value: warehouseText });
        else if (!LEVEL_KINDS.includes(found.value.kind)) check.error('warehouse', 'NOT_ALLOWED');
        else warehouse = found.value;
      }
      return { check, warehouse, sku: check.text('sku', true) };
    });
    const products = new Map(
      (
        await this.catalog.productsBySku(
          entries.flatMap((entry) => (entry.sku ? [entry.sku] : [])),
          executor,
        )
      ).map((product) => [product.sku, product]),
    );
    const locations = await this.locations.ofProducts(
      [...products.values()].map((product) => product.id),
      executor,
    );
    const stored = new Map(locations.map((row) => [`${row.warehouseId}:${row.productId}`, row]));
    const homeOf = new Map(
      locations.filter((row) => row.isHome).map((row) => [row.productId, row.warehouseId]),
    );

    const planned = entries.map(({ check, warehouse, sku }) => {
      const product = sku ? products.get(sku) : undefined;
      if (sku && !product) check.error('sku', 'NOT_FOUND', { value: sku });
      if (product && warehouse?.kind === 'WHOLESALE') {
        const home = homeOf.get(product.id);
        if (home !== undefined && home !== warehouse.id) {
          check.error('warehouse', 'NOT_ALLOWED', {
            value: warehouses.find((w) => w.id === home)?.name ?? String(home),
          });
        }
      }
      const unitText = check.text('unit');
      const base = product?.units.find((unit) => unit.isBase);
      let unit = base;
      if (product && unitText !== null) {
        const key = keyOf(unitText);
        const code = unitText.trim().toUpperCase();
        unit = product.units.find((candidate) => {
          const uom = uomById.get(candidate.uomId);
          return uom !== undefined && (uom.nameKey === key || uom.code === code);
        });
        if (!unit) check.error('unit', 'NOT_FOUND', { value: unitText });
      }
      const fractional = base ? (uomById.get(base.uomId)?.fractional ?? false) : false;
      const level = (column: 'minQty' | 'maxQty'): Decimal | null => {
        const text = check.text(column);
        if (text === null) return null;
        const read = decimalCell(text, 3, QTY_MAX);
        if (!read.ok) {
          check.error(column, read.code);
          return null;
        }
        if (!unit) return null;
        if (!read.value.isZero() && !isValidEnteredQty(read.value, unit.factorToBase, fractional)) {
          check.error(column, 'INEXACT');
          return null;
        }
        return toBase(read.value, unit.factorToBase);
      };
      const minQty = level('minQty');
      const maxQty = level('maxQty');
      if (check.text('minQty') === null && check.text('maxQty') === null) {
        check.error('minQty', 'REQUIRED');
      }
      const current =
        warehouse && product ? stored.get(`${warehouse.id}:${product.id}`) : undefined;
      const resultMin = minQty ?? current?.minQty ?? null;
      const resultMax = maxQty ?? current?.maxQty ?? null;
      if (resultMin && resultMax && resultMin.gt(resultMax)) {
        check.error(maxQty ? 'maxQty' : 'minQty', 'MIN_ABOVE_MAX', {
          min: resultMin.toFixed(),
          max: resultMax.toFixed(),
        });
      }
      const changed = [
        ...(minQty && !(current?.minQty?.equals(minQty) ?? false) ? ['minQty'] : []),
        ...(maxQty && !(current?.maxQty?.equals(maxQty) ?? false) ? ['maxQty'] : []),
      ];
      const hadLevels =
        current !== undefined && (current.minQty !== null || current.maxQty !== null);
      const action: ImportAction = !hadLevels
        ? 'CREATE'
        : changed.length > 0
          ? 'UPDATE'
          : 'UNCHANGED';
      return {
        check,
        key: warehouse && product ? `${warehouse.id}:${product.id}` : null,
        action,
        targetId: current?.id ?? null,
        plan:
          warehouse && product && unit
            ? {
                warehouseId: warehouse.id,
                productId: product.id,
                minQty: minQty?.toFixed() ?? null,
                maxQty: maxQty?.toFixed() ?? null,
                changed,
              }
            : null,
      };
    });
    markDuplicates(planned, 'sku', (entry) => (entry.key ? [entry.key] : []));
    return planned.map((entry) => entry.check.result(entry.action, entry.targetId, entry.plan));
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<LevelsPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const changing = rows.flatMap((row) =>
      row.plan && row.action !== null && row.action !== 'UNCHANGED'
        ? [{ row, action: row.action, plan: row.plan }]
        : [],
    );
    const before = await this.locations.setLevelsManyInTx(
      tx,
      actor,
      changing.map(({ plan }) => ({
        warehouseId: plan.warehouseId,
        productId: plan.productId,
        minQty: decimalOrNull(plan.minQty),
        maxQty: decimalOrNull(plan.maxQty),
      })),
    );
    await progress(rows.length);
    const applied = new Map(
      changing.map(({ row, action, plan }): [number, AppliedRow] => {
        const prior = before.get(`${plan.warehouseId}:${plan.productId}`);
        const was: Pair = {
          minQty: prior?.minQty?.toFixed() ?? null,
          maxQty: prior?.maxQty?.toFixed() ?? null,
        };
        const changes: LevelsChanges = {
          warehouseId: plan.warehouseId,
          productId: plan.productId,
          set: { minQty: plan.minQty ?? was.minQty, maxQty: plan.maxQty ?? was.maxQty },
          before: was,
        };
        return [row.rowNo, { rowNo: row.rowNo, action, targetId: row.targetId, changes }];
      }),
    );
    return rows.map(
      (row) =>
        applied.get(row.rowNo) ?? {
          rowNo: row.rowNo,
          action: 'UNCHANGED',
          targetId: row.targetId,
          changes: null,
        },
    );
  }

  /** Levels go back where they still hold what the import set (edited ones stay). */
  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const entries = rows.flatMap((row): LevelRestore[] =>
      isLevelsChanges(row.changes)
        ? [
            {
              warehouseId: row.changes.warehouseId,
              productId: row.changes.productId,
              expected: pairOf(row.changes.set),
              restore: pairOf(row.changes.before),
            },
          ]
        : [],
    );
    await this.locations.restoreLevelsInTx(tx, actor, entries);
  }
}
