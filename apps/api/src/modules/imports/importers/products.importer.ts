import { Injectable } from '@nestjs/common';
import { classifyBarcode } from '@tugeel/shared/gtin';
import mn from '@tugeel/shared/i18n/mn.json';
import { splitList } from '@tugeel/shared/imports';
import { USER_BIN_TYPES } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { normalizeName } from '@tugeel/shared/text';
import { isExactFactor } from '@tugeel/shared/units';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import {
  BarcodeService,
  type BulkProductInput,
  CatalogImportService,
  type CatalogReference,
  type ImportProduct,
  type ProductPatch,
  UnitsService,
  VAT_TYPES,
  type VatType,
} from '../../catalog';
import { type Actor, OrgService, type Warehouse } from '../../identity';
import {
  BinsService,
  type LocationChange,
  type LocationState,
  ProductLocationsService,
  StockQueryService,
} from '../../inventory';
import { ProductSuppliersService, SuppliersService } from '../../partners';
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
import {
  binFinder,
  byNameKey,
  CategoryIndex,
  decimalCell,
  type Found,
  keyOf,
  warehouseFinder,
} from './lookups';

const SKU = /^[0-9]{1,20}$/;
const NAME_MAX = 200;
/** Above this many units a "box" is not a box: refuse it as a likely typo. */
const BOX_MAX = 100_000;
const WEIGHT_MAX = 99_999_999;

/** What the commit does with one product row (JSON: stored as the row's plan). */
export interface ProductPlan {
  sku: string;
  /** A new product; null when the SKU exists. */
  create: {
    name: string;
    categoryId: number;
    brandId: number | null;
    vatType: VatType;
    weightKg: string | null;
    baseUomId: number;
    baseBarcodes: string[];
    box: { uomId: number; factorToBase: string; barcodes: string[] } | null;
  } | null;
  /** An existing product: the fields that change (status ACTIVE when it was inactive). */
  productId: number | null;
  patch: SerializedPatch;
  before: SerializedPatch;
  baseUnitId: number | null;
  boxUnitId: number | null;
  addBaseBarcodes: string[];
  addBox: { uomId: number; factorToBase: string; barcodes: string[] } | null;
  addBoxBarcodes: string[];
  /** The home warehouse to set, or null for no change. */
  home: number | null;
  /** The fixed shelf to set, or null for no change. */
  fixedBin: { warehouseId: number; binId: number } | null;
  /** A supplier to link, or null. */
  supplierId: number | null;
  /** Names of what changes, for the preview. */
  changed: string[];
}

interface SerializedPatch {
  name?: string;
  categoryId?: number;
  brandId?: number | null;
  vatType?: VatType;
  weightKg?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

/** What the commit did to one row, for the revert. */
interface ProductChanges {
  productId: number;
  created: boolean;
  patch: SerializedPatch;
  before: SerializedPatch;
  barcodeIds: number[];
  unitId: number | null;
  location: {
    before: LocationState;
    home: number | null;
    fixedBin: ProductPlan['fixedBin'];
  } | null;
  linkId: number | null;
}

interface Parsed {
  check: RowCheck;
  sku: string | null;
  name: string | null;
  categoryId: number | null;
  brandId: number | null | undefined;
  baseUom: { id: number; fractional: boolean; name: string } | null | undefined;
  barcodes: string[];
  boxQty: Decimal | null;
  boxBarcodes: string[];
  vatType: VatType | undefined;
  weightKg: Decimal | null | undefined;
  homeWarehouseId: number | null | undefined;
  fixedBinCode: string | null;
  supplierText: string | null;
}

/** Barcode lookup keys of a list of codes (codes that do not classify were reported already). */
const keysOf = (codes: readonly string[]) =>
  codes.flatMap((code) => {
    const classified = classifyBarcode(code);
    return classified.ok ? [classified.value.lookupKey] : [];
  });

/**
 * Products (SPEC §5.5, ADR-0036): keyed on the SKU; categories, brands, units, warehouses, shelves
 * and suppliers must exist. A new product is created with its base unit, an optional box unit and
 * barcodes; an existing one gets only what differs (unit factors never change through an import).
 */
@Injectable()
export class ProductsImporter implements Importer<ProductPlan> {
  readonly kind = 'PRODUCTS' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly units: UnitsService,
    private readonly barcodes: BarcodeService,
    private readonly org: OrgService,
    private readonly bins: BinsService,
    private readonly locations: ProductLocationsService,
    private readonly stock: StockQueryService,
    private readonly suppliers: SuppliersService,
    private readonly links: ProductSuppliersService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
  ): Promise<CheckedRow<ProductPlan>[]> {
    const reference = await this.catalog.reference(executor);
    const categories = new CategoryIndex(reference.categories);
    const findBrand = byNameKey(reference.brands, (brand) => brand.nameKey);
    const uomByKey = byNameKey(reference.uoms, (uom) => uom.nameKey);
    const findUom = (text: string): Found<CatalogReference['uoms'][number]> => {
      const code = text.trim().toUpperCase();
      const byCode = reference.uoms.find((uom) => uom.code === code);
      return byCode ? { ok: true, value: byCode } : uomByKey(text);
    };
    const uomName = (id: number) => reference.uoms.find((uom) => uom.id === id)?.name ?? String(id);
    const pcs = reference.uoms.find((uom) => uom.code === 'PCS');
    const box = reference.uoms.find((uom) => uom.code === 'BOX');
    if (!pcs || !box) throw new Error('the PCS and BOX units of measure are missing');
    const warehouses = await this.org.listWarehouses();
    const findWarehouse = warehouseFinder(warehouses.filter((w) => w.status === 'ACTIVE'));

    const parsed = rows.map((row) =>
      this.parse(new RowCheck(row), {
        categories,
        findBrand,
        findUom,
        findWarehouse,
      }),
    );
    markDuplicates(parsed, 'sku', (entry) => (entry.sku ? [entry.sku] : []));
    markDuplicates(parsed, 'barcodes', (entry) =>
      keysOf([...entry.barcodes, ...entry.boxBarcodes]),
    );

    const skus = parsed.flatMap((entry) => (entry.sku ? [entry.sku] : []));
    const existing = new Map(
      (await this.catalog.productsBySku(skus, executor)).map((product) => [product.sku, product]),
    );
    const owners = await this.catalog.barcodeOwners(
      parsed.flatMap((entry) => keysOf([...entry.barcodes, ...entry.boxBarcodes])),
      executor,
    );
    const existingIds = [...existing.values()].map((product) => product.id);
    const locations = await this.locations.ofProducts(existingIds, executor);
    const homeOf = new Map(
      locations.filter((row) => row.isHome).map((row) => [row.productId, row.warehouseId]),
    );
    const fixedOf = new Map(
      locations.map((row) => [`${row.productId}:${row.warehouseId}`, row.defaultBinId]),
    );
    const binWarehouses = new Set<number>();
    for (const entry of parsed) {
      if (!entry.fixedBinCode) continue;
      const product = entry.sku ? existing.get(entry.sku) : undefined;
      const home = entry.homeWarehouseId ?? (product ? homeOf.get(product.id) : undefined);
      if (home) binWarehouses.add(home);
    }
    const findBin = binFinder(await this.bins.ofWarehouses([...binWarehouses], executor));
    const supplierTexts = parsed.flatMap((entry) =>
      entry.supplierText ? [entry.supplierText] : [],
    );
    const byCode = new Map(
      (await this.suppliers.findByCodes(supplierTexts, executor)).map((s) => [s.code, s]),
    );
    const findSupplierByName = byNameKey(
      await this.suppliers.findByNames(supplierTexts, executor),
      (supplier) => keyOf(supplier.name),
    );
    const linked = new Set(
      (await this.links.linksOfProducts(existingIds, executor)).map(
        (link) => `${link.productId}:${link.supplierId}`,
      ),
    );

    return parsed.map((entry) => {
      const { check } = entry;
      for (const [column, codes] of [
        ['barcodes', entry.barcodes],
        ['boxBarcodes', entry.boxBarcodes],
      ] as const) {
        for (const code of codes) {
          const classified = classifyBarcode(code);
          if (!classified.ok) continue;
          const owner = owners.get(classified.value.lookupKey);
          if (owner && owner.sku !== entry.sku) {
            check.error(column, 'TAKEN', { value: code, owner: owner.sku });
          }
        }
      }
      const product = entry.sku ? existing.get(entry.sku) : undefined;
      const plan = product
        ? this.planUpdate(entry, product, box.id, uomName)
        : this.planCreate(entry, pcs, box.id);
      // Home warehouse, fixed shelf and supplier: the same for new and existing products.
      const currentHome = product ? (homeOf.get(product.id) ?? null) : null;
      if (entry.homeWarehouseId && entry.homeWarehouseId !== currentHome) {
        plan.home = entry.homeWarehouseId;
        plan.changed.push('homeWarehouse');
      }
      if (entry.fixedBinCode) {
        const warehouseId = entry.homeWarehouseId ?? currentHome;
        if (!warehouseId) {
          check.error('homeWarehouse', 'REQUIRED');
        } else {
          const bin = findBin(warehouseId, entry.fixedBinCode);
          if (!bin) {
            check.error('fixedBin', 'NOT_FOUND', { value: entry.fixedBinCode });
          } else if (
            !(USER_BIN_TYPES as readonly string[]).includes(bin.type) ||
            bin.archivedAt !== null
          ) {
            check.error('fixedBin', 'NOT_ALLOWED');
          } else if (!product || fixedOf.get(`${product.id}:${warehouseId}`) !== bin.id) {
            plan.fixedBin = { warehouseId, binId: bin.id };
            plan.changed.push('fixedBin');
          }
        }
      }
      if (entry.supplierText) {
        const found = byCode.get(entry.supplierText.trim()) ?? null;
        const named = found ? null : findSupplierByName(entry.supplierText);
        const supplier = found ?? (named?.ok ? named.value : null);
        if (!supplier) {
          check.error('supplier', named?.ok === false ? named.code : 'NOT_FOUND', {
            value: entry.supplierText,
          });
        } else if (!product || !linked.has(`${product.id}:${supplier.id}`)) {
          plan.supplierId = supplier.id;
          plan.changed.push('supplier');
        }
      }
      const action = !product ? 'CREATE' : plan.changed.length > 0 ? 'UPDATE' : 'UNCHANGED';
      return check.result(action, product?.id ?? null, plan);
    });
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<ProductPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const plans = rows.flatMap((row) => (row.plan ? [{ row, plan: row.plan }] : []));
    const creates = plans.filter(({ plan }) => plan.create !== null);
    const created = await this.catalog.createManyInTx(
      tx,
      actor,
      creates.map(({ plan }) => toBulkInput(plan)),
    );
    await progress(creates.length);
    const changes = new Map<number, ProductChanges>();
    for (const { row, plan } of creates) {
      const ids = created.get(plan.sku);
      if (!ids) throw new Error(`product ${plan.sku} was not created`);
      changes.set(row.rowNo, {
        productId: ids.productId,
        created: true,
        patch: {},
        before: {},
        barcodeIds: [],
        unitId: null,
        location: null,
        linkId: null,
      });
    }
    let done = creates.length;
    for (const { row, plan } of plans) {
      if (plan.create !== null || plan.productId === null) continue;
      const productId = plan.productId;
      const entry: ProductChanges = {
        productId,
        created: false,
        patch: plan.patch,
        before: plan.before,
        barcodeIds: [],
        unitId: null,
        location: null,
        linkId: null,
      };
      if (Object.keys(plan.patch).length > 0) {
        await this.catalog.updateProductInTx(tx, actor, productId, toPatch(plan.patch));
      }
      let boxUnitId = plan.boxUnitId;
      if (plan.addBox) {
        const unit = await this.units.addInTx(tx, actor, productId, {
          uomId: plan.addBox.uomId,
          factorToBase: new Decimal(plan.addBox.factorToBase),
          barcodes: plan.addBox.barcodes,
        });
        entry.unitId = unit.id;
        boxUnitId = unit.id;
      }
      for (const [unitId, codes] of [
        [plan.baseUnitId, plan.addBaseBarcodes],
        [boxUnitId, plan.addBoxBarcodes],
      ] as const) {
        for (const code of codes) {
          if (unitId === null) throw new Error(`product ${plan.sku} has no unit for ${code}`);
          entry.barcodeIds.push((await this.barcodes.addInTx(tx, actor, unitId, code)).id);
        }
      }
      changes.set(row.rowNo, entry);
      done += 1;
      if (done % 250 === 0) await progress(done);
    }

    const productIdOf = (rowNo: number) => changes.get(rowNo)?.productId;
    const locationChanges: LocationChange[] = plans.flatMap(({ row, plan }) => {
      const productId = productIdOf(row.rowNo);
      if (productId === undefined || (plan.home === null && plan.fixedBin === null)) return [];
      return [
        {
          productId,
          ...(plan.home === null ? {} : { homeWarehouseId: plan.home }),
          ...(plan.fixedBin === null ? {} : { fixedBin: plan.fixedBin }),
        },
      ];
    });
    const before = await this.locations.setManyInTx(tx, actor, locationChanges);
    const pairs = plans.flatMap(({ row, plan }) => {
      const productId = productIdOf(row.rowNo);
      return productId === undefined || plan.supplierId === null
        ? []
        : [{ productId, supplierId: plan.supplierId }];
    });
    const added = await this.links.linkManyInTx(tx, actor, pairs);
    for (const { row, plan } of plans) {
      const entry = changes.get(row.rowNo);
      if (!entry) continue;
      const state = before.get(entry.productId);
      if (state && (plan.home !== null || plan.fixedBin !== null)) {
        entry.location = { before: state, home: plan.home, fixedBin: plan.fixedBin };
      }
      if (plan.supplierId !== null) {
        entry.linkId = added.get(`${entry.productId}:${plan.supplierId}`) ?? null;
      }
    }
    await progress(plans.length);
    return rows.map((row) => {
      const entry = changes.get(row.rowNo);
      return {
        rowNo: row.rowNo,
        action: row.action ?? 'UNCHANGED',
        targetId: entry?.productId ?? row.targetId,
        changes: entry ?? null,
      };
    });
  }

  /**
   * Takes the import back: created products become inactive and free their barcodes (refused while
   * any holds stock); on updated products, fields still holding the imported value get their old
   * value back, added barcodes, units and supplier links are removed, locations restored.
   */
  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const entries = rows.flatMap((row) =>
      row.changes ? [{ row, changes: row.changes as ProductChanges }] : [],
    );
    const createdIds = entries
      .filter(({ changes }) => changes.created)
      .map(({ changes }) => changes.productId);
    const held = await this.stock.productsWithStock(createdIds, tx);
    if (held.size > 0) {
      const [first] = await this.catalog.productsByIds([...held], tx);
      throw new AppError('IMPORT_REVERT_BLOCKED', 'products of the import hold stock', {
        reason: 'STOCK',
        sku: first?.sku ?? '',
        count: held.size,
      });
    }
    await this.links.unlinkManyInTx(
      tx,
      actor,
      entries.flatMap(({ changes }) => (changes.linkId === null ? [] : [changes.linkId])),
    );
    const restore: LocationChange[] = [];
    for (const { changes } of entries) {
      if (!changes.location) continue;
      const { before, home, fixedBin } = changes.location;
      restore.push({
        productId: changes.productId,
        ...(home === null ? {} : { homeWarehouseId: before.homeWarehouseId }),
        ...(fixedBin === null
          ? {}
          : {
              fixedBin: {
                warehouseId: fixedBin.warehouseId,
                binId:
                  before.fixedBins.find((entry) => entry.warehouseId === fixedBin.warehouseId)
                    ?.binId ?? null,
              },
            }),
      });
    }
    await this.locations.setManyInTx(tx, actor, restore);
    const current = new Map(
      (
        await this.catalog.productsByIds(
          entries.filter(({ changes }) => !changes.created).map(({ changes }) => changes.productId),
          tx,
        )
      ).map((product) => [product.id, product]),
    );
    for (const { changes } of entries) {
      if (changes.created) continue;
      const product = current.get(changes.productId);
      if (!product) continue;
      const back: SerializedPatch = {};
      for (const key of Object.keys(changes.patch) as (keyof SerializedPatch)[]) {
        if (sameValue(currentValue(product, key), changes.patch[key])) {
          Object.assign(back, { [key]: changes.before[key] });
        }
      }
      if (Object.keys(back).length > 0) {
        await this.catalog.updateProductInTx(tx, actor, changes.productId, toPatch(back));
      }
      const present = new Set(
        product.units.flatMap((unit) => unit.barcodes.map((code) => code.id)),
      );
      for (const id of changes.barcodeIds) {
        if (present.has(id)) await this.barcodes.removeInTx(tx, actor, id);
      }
      if (changes.unitId !== null && product.units.some((unit) => unit.id === changes.unitId)) {
        await this.units.retireInTx(tx, actor, changes.unitId);
      }
    }
    await this.catalog.deactivateManyInTx(tx, actor, createdIds);
  }

  // -------------------------------------------------------------------------------------------

  private parse(
    check: RowCheck,
    lookups: {
      categories: CategoryIndex;
      findBrand: (text: string) => Found<CatalogReference['brands'][number]>;
      findUom: (text: string) => Found<CatalogReference['uoms'][number]>;
      findWarehouse: (text: string) => Found<Warehouse>;
    },
  ): Parsed {
    const skuText = check.text('sku', true);
    const sku = skuText !== null && SKU.test(skuText) ? skuText : null;
    if (skuText !== null && sku === null) check.error('sku', 'FORMAT');
    const nameText = check.text('name', true);
    const name = nameText === null ? null : normalizeName(nameText);
    if (name !== null && name.length > NAME_MAX) check.error('name', 'TOO_LONG');
    const categoryText = check.text('category', true);
    let categoryId: number | null = null;
    if (categoryText !== null) {
      const found = lookups.categories.find(categoryText);
      if (found.ok) categoryId = found.value;
      else check.error('category', found.code, { value: categoryText });
    }
    const brandText = check.text('brand');
    let brandId: number | null | undefined;
    if (brandText !== null) {
      const found = lookups.findBrand(brandText);
      if (found.ok) brandId = found.value.id;
      else check.error('brand', found.code, { value: brandText });
    }
    const unitText = check.text('baseUnit');
    let baseUom: Parsed['baseUom'];
    if (unitText !== null) {
      const found = lookups.findUom(unitText);
      if (found.ok) baseUom = found.value;
      else check.error('baseUnit', found.code, { value: unitText });
    }
    const barcodes = splitList(check.text('barcodes'));
    const boxBarcodes = splitList(check.text('boxBarcodes'));
    for (const [column, codes] of [
      ['barcodes', barcodes],
      ['boxBarcodes', boxBarcodes],
    ] as const) {
      const bad = codes.find((code) => !classifyBarcode(code).ok);
      if (bad !== undefined) check.error(column, 'FORMAT', { value: bad });
    }
    const boxText = check.text('boxQty');
    let boxQty: Decimal | null = null;
    if (boxText !== null) {
      const read = decimalCell(boxText, 3, BOX_MAX);
      if (!read.ok) check.error('boxQty', read.code);
      else if (read.value.lte(1)) check.error('boxQty', 'OUT_OF_RANGE');
      else boxQty = read.value;
    }
    const vatText = check.text('vatType');
    let vatType: VatType | undefined;
    if (vatText !== null) {
      vatType = vatTypeOf(vatText);
      if (!vatType) check.error('vatType', 'FORMAT', { value: vatText });
    }
    const weightText = check.text('weightKg');
    let weightKg: Decimal | null | undefined;
    if (weightText !== null) {
      const read = decimalCell(weightText, 4, WEIGHT_MAX);
      if (!read.ok) check.error('weightKg', read.code);
      else if (read.value.isZero()) check.error('weightKg', 'NOT_POSITIVE');
      else weightKg = read.value;
    }
    const homeText = check.text('homeWarehouse');
    let homeWarehouseId: number | null | undefined;
    if (homeText !== null) {
      const found = lookups.findWarehouse(homeText);
      if (!found.ok) check.error('homeWarehouse', found.code, { value: homeText });
      else if (found.value.kind !== 'WHOLESALE') check.error('homeWarehouse', 'NOT_ALLOWED');
      else homeWarehouseId = found.value.id;
    }
    return {
      check,
      sku,
      name,
      categoryId,
      brandId,
      baseUom,
      barcodes,
      boxQty,
      boxBarcodes,
      vatType,
      weightKg,
      homeWarehouseId,
      fixedBinCode: check.text('fixedBin'),
      supplierText: check.text('supplier'),
    };
  }

  private planCreate(
    entry: Parsed,
    pcs: { id: number; fractional: boolean },
    boxUomId: number,
  ): ProductPlan {
    const { check } = entry;
    const base = entry.baseUom ?? pcs;
    if (entry.boxQty && !isExactFactor(entry.boxQty, base.fractional))
      check.error('boxQty', 'INEXACT');
    if (entry.boxBarcodes.length > 0 && !entry.boxQty) check.error('boxQty', 'REQUIRED');
    return {
      ...emptyPlan(entry.sku ?? ''),
      create: {
        name: entry.name ?? '',
        categoryId: entry.categoryId ?? 0,
        brandId: entry.brandId ?? null,
        vatType: entry.vatType ?? 'VAT_ABLE',
        weightKg: entry.weightKg?.toFixed() ?? null,
        baseUomId: base.id,
        baseBarcodes: entry.barcodes,
        box: entry.boxQty
          ? { uomId: boxUomId, factorToBase: entry.boxQty.toFixed(), barcodes: entry.boxBarcodes }
          : null,
      },
    };
  }

  private planUpdate(
    entry: Parsed,
    product: ImportProduct,
    boxUomId: number,
    uomName: (id: number) => string,
  ): ProductPlan {
    const { check } = entry;
    const plan: ProductPlan = { ...emptyPlan(product.sku), productId: product.id };
    const base = product.units.find((unit) => unit.isBase);
    const boxUnit = product.units.find((unit) => !unit.isBase && unit.uomId === boxUomId);
    plan.baseUnitId = base?.id ?? null;
    plan.boxUnitId = boxUnit?.id ?? null;
    if (entry.baseUom && base && entry.baseUom.id !== base.uomId) {
      check.error('baseUnit', 'MISMATCH', { current: uomName(base.uomId) });
    }
    const set = <K extends keyof SerializedPatch>(
      key: K,
      next: SerializedPatch[K],
      current: SerializedPatch[K],
    ) => {
      if (sameValue(next, current)) return;
      plan.patch[key] = next;
      plan.before[key] = current;
      plan.changed.push(key);
    };
    if (entry.name !== null) set('name', entry.name, product.name);
    if (entry.categoryId !== null) set('categoryId', entry.categoryId, product.categoryId);
    if (entry.brandId !== undefined) set('brandId', entry.brandId, product.brandId);
    if (entry.vatType !== undefined) set('vatType', entry.vatType, product.vatType);
    if (entry.weightKg !== undefined) {
      set('weightKg', entry.weightKg?.toFixed() ?? null, product.weightKg?.toFixed() ?? null);
    }
    if (product.status === 'INACTIVE') {
      set('status', 'ACTIVE', 'INACTIVE');
      check.warn(null, 'REACTIVATED');
    }
    const own = new Set(
      product.units.flatMap((unit) => unit.barcodes.map((code) => code.lookupKey)),
    );
    const fresh = (codes: readonly string[]) =>
      codes.filter((code) => {
        const classified = classifyBarcode(code);
        return classified.ok && !own.has(classified.value.lookupKey);
      });
    plan.addBaseBarcodes = fresh(entry.barcodes);
    if (entry.boxQty) {
      if (boxUnit && !boxUnit.factorToBase.eq(entry.boxQty)) {
        check.error('boxQty', 'MISMATCH', { current: boxUnit.factorToBase.toFixed() });
      } else if (!boxUnit) {
        plan.addBox = {
          uomId: boxUomId,
          factorToBase: entry.boxQty.toFixed(),
          barcodes: fresh(entry.boxBarcodes),
        };
      }
    }
    if (entry.boxBarcodes.length > 0 && !boxUnit && !entry.boxQty)
      check.error('boxQty', 'REQUIRED');
    if (boxUnit) plan.addBoxBarcodes = fresh(entry.boxBarcodes);
    if (plan.addBaseBarcodes.length > 0 || plan.addBoxBarcodes.length > 0)
      plan.changed.push('barcodes');
    if (plan.addBox) plan.changed.push('boxQty');
    return plan;
  }
}

function emptyPlan(sku: string): ProductPlan {
  return {
    sku,
    create: null,
    productId: null,
    patch: {},
    before: {},
    baseUnitId: null,
    boxUnitId: null,
    addBaseBarcodes: [],
    addBox: null,
    addBoxBarcodes: [],
    home: null,
    fixedBin: null,
    supplierId: null,
    changed: [],
  };
}

/** A VAT type from its code or its Mongolian label. */
function vatTypeOf(text: string): VatType | undefined {
  const value = text.trim().toUpperCase();
  const byCode = VAT_TYPES.find((type) => type === value);
  if (byCode) return byCode;
  const key = keyOf(text);
  return VAT_TYPES.find((type) => keyOf(mn.catalog.product.vatTypes[type]) === key);
}

function toBulkInput(plan: ProductPlan): BulkProductInput {
  const create = plan.create;
  if (!create) throw new Error(`product ${plan.sku} has nothing to create`);
  return {
    sku: plan.sku,
    name: create.name,
    categoryId: create.categoryId,
    brandId: create.brandId,
    vatType: create.vatType,
    weightKg: create.weightKg === null ? null : new Decimal(create.weightKg),
    baseUomId: create.baseUomId,
    baseBarcodes: create.baseBarcodes,
    box: create.box
      ? {
          uomId: create.box.uomId,
          factorToBase: new Decimal(create.box.factorToBase),
          barcodes: create.box.barcodes,
        }
      : null,
  };
}

function toPatch(patch: SerializedPatch): ProductPatch {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
    ...(patch.brandId === undefined ? {} : { brandId: patch.brandId }),
    ...(patch.vatType === undefined ? {} : { vatType: patch.vatType }),
    ...(patch.weightKg === undefined
      ? {}
      : { weightKg: patch.weightKg === null ? null : new Decimal(patch.weightKg) }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
  };
}

function currentValue(product: ImportProduct, key: keyof SerializedPatch): unknown {
  switch (key) {
    case 'weightKg':
      return product.weightKg?.toFixed() ?? null;
    default:
      return product[key];
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && /^\d/.test(a) && /^\d/.test(b)) {
    try {
      return new Decimal(a).eq(b);
    } catch {
      return a === b;
    }
  }
  return a === b;
}
