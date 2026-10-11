import { Injectable } from '@nestjs/common';
import { COST_SCALE, normalizeBinCode } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { isValidEnteredQty } from '@tugeel/shared/units';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { CatalogImportService } from '../../catalog';
import { type Actor, OrgService } from '../../identity';
import {
  AdjustmentsService,
  BinsService,
  MAX_MOVEMENTS_PER_POST,
  NO_SHELF_CODE,
  ProductLocationsService,
} from '../../inventory';
import { importDocuments } from '../schema';
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
const COST_MAX = new Decimal('9999999999');
const OPENING_KINDS = ['WHOLESALE', 'STORE'];

/** One line of an opening-stock adjustment (JSON: stored as the row's plan). */
export interface OpeningPlan {
  warehouseId: number;
  productId: number;
  productUnitId: number;
  factor: string;
  qty: string;
  /** null: the warehouse's NOSHELF shelf, created at commit when missing. */
  binId: number | null;
  /** Per base unit; 0 when the sheet had none. */
  unitCost: string;
}

interface OpeningChanges {
  warehouseId: number;
  adjustmentId: number;
}

/**
 * Opening stock (ADR-0036 #5): one OPENING adjustment per warehouse, posted at commit. Shelves and
 * costs are optional: a line without a shelf goes to the product's fixed shelf, else the sales
 * floor at the supermarket, else the warehouse's «Тавиургүй» shelf; without a cost it enters at 0.
 */
@Injectable()
export class OpeningStockImporter implements Importer<OpeningPlan> {
  readonly kind = 'OPENING_STOCK' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly org: OrgService,
    private readonly bins: BinsService,
    private readonly locations: ProductLocationsService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
  ): Promise<CheckedRow<OpeningPlan>[]> {
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
        else if (!OPENING_KINDS.includes(found.value.kind)) check.error('warehouse', 'NOT_ALLOWED');
        else warehouse = found.value;
      }
      return { check, warehouse, sku: check.text('sku', true) };
    });
    const warehouseIds = [
      ...new Set(entries.flatMap((entry) => (entry.warehouse ? [entry.warehouse.id] : []))),
    ];
    const imported = new Set(
      warehouseIds.length === 0
        ? []
        : (
            await executor
              .select({ warehouseId: importDocuments.warehouseId })
              .from(importDocuments)
              .where(
                and(
                  inArray(importDocuments.warehouseId, warehouseIds),
                  eq(importDocuments.active, true),
                ),
              )
          ).map((row) => row.warehouseId),
    );
    const products = new Map(
      (
        await this.catalog.productsBySku(
          entries.flatMap((entry) => (entry.sku ? [entry.sku] : [])),
          executor,
        )
      ).map((product) => [product.sku, product]),
    );
    const productIds = [...products.values()].map((product) => product.id);
    const locations = await this.locations.ofProducts(productIds, executor);
    const fixedOf = new Map(
      locations.flatMap((row) =>
        row.defaultBinId === null
          ? []
          : [[`${row.productId}:${row.warehouseId}`, row.defaultBinId] as const],
      ),
    );
    const homeOf = new Map(
      locations.filter((row) => row.isHome).map((row) => [row.productId, row.warehouseId]),
    );
    const allBins = await this.bins.ofWarehouses(warehouseIds, executor);
    const binByCode = new Map(allBins.map((bin) => [`${bin.warehouseId}:${bin.code}`, bin]));
    const binById = new Map(allBins.map((bin) => [bin.id, bin]));
    const floorOf = new Map(
      allBins
        .filter((bin) => bin.isSystem && bin.type === 'SALESFLOOR')
        .map((bin) => [bin.warehouseId, bin.id]),
    );

    const planned = entries.map(({ check, warehouse, sku }) => {
      if (warehouse && imported.has(warehouse.id)) check.error('warehouse', 'ALREADY_IMPORTED');
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
      const qtyText = check.text('qty', true);
      let qty: Decimal | null = null;
      if (qtyText !== null) {
        const read = decimalCell(qtyText, 3, QTY_MAX);
        if (!read.ok) check.error('qty', read.code);
        else if (read.value.isZero()) check.error('qty', 'NOT_POSITIVE');
        else qty = read.value;
      }
      if (qty && unit && base) {
        const fractional = uomById.get(base.uomId)?.fractional ?? false;
        if (!isValidEnteredQty(qty, unit.factorToBase, fractional)) check.error('qty', 'INEXACT');
      }
      const binText = check.text('bin');
      let binId: number | null = null;
      let binKey = NO_SHELF_CODE;
      if (warehouse && binText !== null) {
        const bin = binByCode.get(`${warehouse.id}:${normalizeBinCode(binText)}`);
        if (!bin) check.error('bin', 'NOT_FOUND', { value: binText });
        else if (bin.archivedAt !== null || bin.type === 'TRANSIT' || bin.type === 'CARGO') {
          check.error('bin', 'NOT_ALLOWED');
        } else {
          binId = bin.id;
          binKey = String(bin.id);
          if (!bin.sellable) check.warn('bin', 'NOT_SELLABLE');
        }
      } else if (warehouse && product) {
        const fixed = fixedOf.get(`${product.id}:${warehouse.id}`);
        const floor = warehouse.kind === 'STORE' ? floorOf.get(warehouse.id) : undefined;
        const noShelf = binByCode.get(`${warehouse.id}:${NO_SHELF_CODE}`);
        binId = fixed ?? floor ?? noShelf?.id ?? null;
        binKey = binId === null ? NO_SHELF_CODE : String(binId);
        if (fixed === undefined && floor === undefined) check.warn('bin', 'NO_SHELF');
        if (binId !== null && binById.get(binId)?.archivedAt) check.error('bin', 'NOT_ALLOWED');
      }
      const costText = check.text('unitCost');
      let unitCost = new Decimal(0);
      if (costText === null) {
        check.warn('unitCost', 'NO_COST');
      } else {
        const read = decimalCell(costText, 4, COST_MAX);
        if (!read.ok) check.error('unitCost', read.code);
        else if (unit)
          unitCost = read.value.dividedBy(unit.factorToBase).toDecimalPlaces(COST_SCALE);
      }
      return {
        check,
        key: warehouse && product ? `${warehouse.id}:${binKey}:${product.id}` : null,
        warehouseId: warehouse?.id ?? null,
        plan:
          warehouse && product && unit && qty
            ? {
                warehouseId: warehouse.id,
                productId: product.id,
                productUnitId: unit.id,
                factor: unit.factorToBase.toFixed(),
                qty: qty.toFixed(),
                binId,
                unitCost: unitCost.toFixed(),
              }
            : null,
      };
    });
    markDuplicates(planned, 'sku', (entry) => (entry.key ? [entry.key] : []));
    const perWarehouse = new Map<number, number>();
    for (const entry of planned) {
      if (entry.warehouseId === null) continue;
      const count = (perWarehouse.get(entry.warehouseId) ?? 0) + 1;
      perWarehouse.set(entry.warehouseId, count);
      if (count > MAX_MOVEMENTS_PER_POST)
        entry.check.error(null, 'OUT_OF_RANGE', { max: MAX_MOVEMENTS_PER_POST });
    }
    return planned.map((entry) => entry.check.result('CREATE', null, entry.plan));
  }

  async apply(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CheckedRow<OpeningPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const byWarehouse = new Map<number, { row: CheckedRow<OpeningPlan>; plan: OpeningPlan }[]>();
    for (const row of rows) {
      if (!row.plan) continue;
      byWarehouse.set(row.plan.warehouseId, [
        ...(byWarehouse.get(row.plan.warehouseId) ?? []),
        { row, plan: row.plan },
      ]);
    }
    const applied = new Map<number, AppliedRow>();
    let done = 0;
    for (const [warehouseId, lines] of [...byWarehouse].sort(([a], [b]) => a - b)) {
      const noShelf = lines.some(({ plan }) => plan.binId === null)
        ? (await this.bins.ensureNoShelfInTx(tx, actor, warehouseId)).id
        : null;
      const adjustment = await this.adjustments.postSystemInTx(tx, actor, {
        warehouseId,
        reason: 'OPENING',
        note: `${job.fileName} (#${job.id})`.slice(0, 500),
        lines: lines.map(({ plan }) => ({
          productId: plan.productId,
          productUnitId: plan.productUnitId,
          enteredQty: new Decimal(plan.qty),
          factorSnapshot: new Decimal(plan.factor),
          binId: plan.binId ?? noShelf ?? 0,
          unitCost: new Decimal(plan.unitCost),
        })),
      });
      await tx
        .insert(importDocuments)
        .values({ jobId: job.id, warehouseId, adjustmentId: adjustment.id });
      for (const { row } of lines) {
        const changes: OpeningChanges = { warehouseId, adjustmentId: adjustment.id };
        applied.set(row.rowNo, {
          rowNo: row.rowNo,
          action: 'CREATE',
          targetId: adjustment.id,
          changes,
        });
      }
      done += lines.length;
      await progress(done);
    }
    return rows.map(
      (row) =>
        applied.get(row.rowNo) ?? {
          rowNo: row.rowNo,
          action: 'UNCHANGED',
          targetId: null,
          changes: null,
        },
    );
  }

  /** Each opening adjustment of the import is taken back by an OPENING_REVERSAL (never twice). */
  async revert(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    _rows: readonly CommittedRow[],
  ): Promise<void> {
    const documents = await tx
      .select()
      .from(importDocuments)
      .where(and(eq(importDocuments.jobId, job.id), eq(importDocuments.active, true)))
      .orderBy(importDocuments.warehouseId)
      .for('update');
    for (const document of documents) {
      const reversal = await this.adjustments.reverseOpeningInTx(tx, actor, document.adjustmentId);
      await tx
        .update(importDocuments)
        .set({ active: false, reversalAdjustmentId: reversal.id })
        .where(eq(importDocuments.id, document.id));
    }
  }
}
