import { Injectable } from '@nestjs/common';
import { classifyBarcode } from '@tugeel/shared/gtin';
import {
  MAX_RECEIPT_IMPORT_LINES,
  RECEIPT_IMPORT_PAYMENT_METHODS,
  type ReceiptImportOptions,
} from '@tugeel/shared/imports';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { isValidEnteredQty } from '@tugeel/shared/units';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { CatalogImportService, type ImportProduct } from '../../catalog';
import { type Actor, OrgService } from '../../identity';
import { ProductLocationsService, ReceiptsService } from '../../inventory';
import { SuppliersService } from '../../partners';
import {
  type AppliedRow,
  type CheckedRow,
  type CommittedRow,
  type Importer,
  type ImportJobRow,
  type Progress,
  RowCheck,
  type SourceRow,
} from './importer';
import { byNameKey, decimalCell, keyOf } from './lookups';

const QTY_MAX = new Decimal('99999999999');
const PRICE_MAX = new Decimal('999999999999');

/** One line of a draft receipt (JSON: stored as the row's plan). */
export interface ReceiptRowPlan {
  /** The delivery note the row belongs to: date, supplier and note number. */
  note: string;
  date: string;
  supplierId: number;
  docNo: string | null;
  productUnitId: number;
  qty: string;
  /** As printed, per entered unit; null when the sheet had none or prices are not imported. */
  unitPrice: string | null;
}

interface ReceiptChanges {
  receiptId: number;
}

/** The options a receipts job was created with (ADR-0078 #7), with `withPrices` from the rights. */
export interface StoredReceiptOptions extends ReceiptImportOptions {
  withPrices: boolean;
}

export function receiptOptionsOf(job: Pick<ImportJobRow, 'options'>): StoredReceiptOptions {
  const value = job.options as Partial<StoredReceiptOptions> | null;
  if (
    !value ||
    typeof value.warehouseId !== 'number' ||
    !RECEIPT_IMPORT_PAYMENT_METHODS.includes(value.paymentMethod as never)
  ) {
    throw new Error('a receipts import without its options');
  }
  return {
    warehouseId: value.warehouseId,
    paymentMethod: value.paymentMethod as StoredReceiptOptions['paymentMethod'],
    moneyAccountId: value.moneyAccountId ?? null,
    withPrices: value.withPrices === true,
  };
}

/**
 * Delivery notes from a sheet (ADR-0078 #7): rows of one date, supplier and note number make one
 * DRAFT receipt in the warehouse chosen for the import, paid as chosen there. A product by code or
 * barcode (a box barcode counts boxes); its fixed shelf, else the receiving area; the price as
 * printed. Nothing is posted: the warehouse counts and posts each receipt. The revert cancels the
 * drafts while every one of them is untouched.
 */
@Injectable()
export class ReceiptsImporter implements Importer<ReceiptRowPlan> {
  readonly kind = 'RECEIPTS' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly org: OrgService,
    private readonly suppliers: SuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly receipts: ReceiptsService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
    job?: ImportJobRow,
  ): Promise<CheckedRow<ReceiptRowPlan>[]> {
    if (!job) throw new Error('a receipts import is validated with its job');
    const options = receiptOptionsOf(job);
    const warehouses = await this.org.listWarehouses();
    const reference = await this.catalog.reference(executor);
    const uomById = new Map(reference.uoms.map((uom) => [uom.id, uom]));
    const today = businessDate();

    const parsed = rows.map((row) => {
      const check = new RowCheck(row);
      return {
        check,
        date: check.text('date', true),
        supplier: check.text('supplier', true),
        docNo: check.text('docNo'),
        sku: check.text('sku'),
        barcode: check.text('barcode'),
        unit: check.text('unit'),
        qty: check.text('qty', true),
        price: check.text('unitPrice'),
      };
    });

    // Suppliers by code first, then by name (the product sheet's rule).
    const supplierTexts = [
      ...new Set(parsed.flatMap((row) => (row.supplier ? [row.supplier] : []))),
    ];
    const byCode = new Map(
      (await this.suppliers.findByCodes(supplierTexts, executor)).map((s) => [s.code, s]),
    );
    const findByName = byNameKey(await this.suppliers.findByNames(supplierTexts, executor), (s) =>
      keyOf(s.name),
    );

    // Products by code, and by barcode through their owners (a box barcode names the box unit).
    const keyOfBarcode = new Map<string, string>();
    for (const row of parsed) {
      if (!row.barcode) continue;
      const classified = classifyBarcode(row.barcode);
      if (classified.ok) keyOfBarcode.set(row.barcode, classified.value.lookupKey);
    }
    const owners = await this.catalog.barcodeOwners([...keyOfBarcode.values()], executor);
    const products = new Map(
      (
        await this.catalog.productsBySku(
          [
            ...parsed.flatMap((row) => (row.sku ? [row.sku] : [])),
            ...[...owners.values()].map((owner) => owner.sku),
          ],
          executor,
        )
      ).map((product) => [product.sku, product]),
    );
    const homeOf = new Map(
      (
        await this.locations.ofProducts(
          [...products.values()].map((product) => product.id),
          executor,
        )
      )
        .filter((row) => row.isHome)
        .map((row) => [row.productId, row.warehouseId]),
    );

    const planned = parsed.map((row) => {
      const { check } = row;
      let date: string | null = null;
      if (row.date !== null) {
        if (!isIsoDate(row.date)) check.error('date', 'FORMAT');
        else if (row.date > today) check.error('date', 'OUT_OF_RANGE');
        else date = row.date;
      }
      let supplierId: number | null = null;
      if (row.supplier !== null) {
        const coded = byCode.get(row.supplier.trim()) ?? null;
        const named = coded ? null : findByName(row.supplier);
        const supplier = coded ?? (named?.ok ? named.value : null);
        if (!supplier) {
          check.error('supplier', named?.ok === false ? named.code : 'NOT_FOUND', {
            value: row.supplier,
          });
        } else if (supplier.status !== 'ACTIVE') {
          check.error('supplier', 'NOT_ALLOWED');
        } else {
          supplierId = supplier.id;
        }
      }
      if (row.docNo !== null && row.docNo.length > 50) check.error('docNo', 'TOO_LONG');

      // The product: by code, else by barcode; both given must name the same product.
      let product: ImportProduct | undefined;
      let barcodeUnitId: number | undefined;
      if (row.sku !== null) {
        product = products.get(row.sku);
        if (!product) check.error('sku', 'NOT_FOUND', { value: row.sku });
      }
      if (row.barcode !== null) {
        const key = keyOfBarcode.get(row.barcode);
        const owner = key ? owners.get(key) : undefined;
        if (!key) check.error('barcode', 'FORMAT');
        else if (!owner) check.error('barcode', 'NOT_FOUND', { value: row.barcode });
        else {
          const owned = products.get(owner.sku);
          if (product && owned && owned.id !== product.id) check.error('barcode', 'MISMATCH');
          product = product ?? owned;
          barcodeUnitId = owned?.units.find((unit) =>
            unit.barcodes.some((barcode) => barcode.lookupKey === key),
          )?.id;
        }
      }
      if (row.sku === null && row.barcode === null) check.error('sku', 'REQUIRED');
      if (product && product.status !== 'ACTIVE') check.error('sku', 'NOT_ALLOWED');
      if (product) {
        const home = homeOf.get(product.id);
        if (home !== undefined && home !== options.warehouseId) {
          check.error('sku', 'NOT_ALLOWED', {
            value: warehouses.find((w) => w.id === home)?.name ?? String(home),
          });
        }
      }

      // The unit: as written, else the barcode's, else the base unit.
      const base = product?.units.find((unit) => unit.isBase);
      let unit = product?.units.find((candidate) => candidate.id === barcodeUnitId) ?? base;
      if (product && row.unit !== null) {
        const key = keyOf(row.unit);
        const code = row.unit.trim().toUpperCase();
        unit = product.units.find((candidate) => {
          const uom = uomById.get(candidate.uomId);
          return uom !== undefined && (uom.nameKey === key || uom.code === code);
        });
        if (!unit) check.error('unit', 'NOT_FOUND', { value: row.unit });
      }

      let qty: Decimal | null = null;
      if (row.qty !== null) {
        const read = decimalCell(row.qty, 3, QTY_MAX);
        if (!read.ok) check.error('qty', read.code);
        else if (read.value.isZero()) check.error('qty', 'NOT_POSITIVE');
        else qty = read.value;
      }
      if (qty && unit && base) {
        const fractional = uomById.get(base.uomId)?.fractional ?? false;
        if (!isValidEnteredQty(qty, unit.factorToBase, fractional)) check.error('qty', 'INEXACT');
      }

      let unitPrice: string | null = null;
      if (row.price !== null) {
        if (!options.withPrices) {
          check.warn('unitPrice', 'PRICE_IGNORED');
        } else {
          const read = decimalCell(row.price, 2, PRICE_MAX);
          if (!read.ok) check.error('unitPrice', read.code);
          else unitPrice = read.value.toFixed(2);
        }
      }

      const note =
        date !== null && supplierId !== null ? `${date}|${supplierId}|${row.docNo ?? ''}` : null;
      return {
        check,
        note,
        plan:
          note && date && supplierId !== null && unit && qty
            ? {
                note,
                date,
                supplierId,
                docNo: row.docNo,
                productUnitId: unit.id,
                qty: qty.toFixed(),
                unitPrice,
              }
            : null,
      };
    });

    // One draft receipt holds at most MAX_RECEIPT_IMPORT_LINES lines.
    const perNote = new Map<string, number>();
    for (const entry of planned) {
      if (entry.note === null) continue;
      const count = (perNote.get(entry.note) ?? 0) + 1;
      perNote.set(entry.note, count);
      if (count > MAX_RECEIPT_IMPORT_LINES) {
        entry.check.error(null, 'TOO_MANY_LINES', { max: MAX_RECEIPT_IMPORT_LINES });
      }
    }
    return planned.map((entry) => entry.check.result('CREATE', null, entry.plan));
  }

  async apply(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CheckedRow<ReceiptRowPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const options = receiptOptionsOf(job);
    const notes = new Map<string, CheckedRow<ReceiptRowPlan>[]>();
    for (const row of rows) {
      if (!row.plan) continue;
      notes.set(row.plan.note, [...(notes.get(row.plan.note) ?? []), row]);
    }
    const applied: AppliedRow[] = [];
    let done = 0;
    for (const noteRows of notes.values()) {
      const [first] = noteRows;
      if (!first?.plan) continue;
      const receiptId = await this.receipts.createInTx(tx, actor, {
        warehouseId: options.warehouseId,
        supplierId: first.plan.supplierId,
        supplierDocNo: first.plan.docNo,
        supplierDocDate: first.plan.date,
        paymentMethod: options.paymentMethod,
        moneyAccountId: options.moneyAccountId,
        lines: noteRows.flatMap((row) =>
          row.plan
            ? [
                {
                  productUnitId: row.plan.productUnitId,
                  enteredQty: new Decimal(row.plan.qty),
                  docUnitPrice:
                    row.plan.unitPrice === null ? null : new Decimal(row.plan.unitPrice),
                },
              ]
            : [],
        ),
      });
      const changes: ReceiptChanges = { receiptId };
      for (const row of noteRows) {
        applied.push({ rowNo: row.rowNo, action: 'CREATE', targetId: receiptId, changes });
      }
      done += noteRows.length;
      await progress(done);
    }
    return applied;
  }

  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        rows.flatMap((row) => {
          const changes = row.changes as ReceiptChanges | null;
          return changes?.receiptId ? [changes.receiptId] : [];
        }),
      ),
    ];
    const states = await this.receipts.cancelDraftsInTx(tx, actor, ids);
    const blocked = states.find((state) => state.status !== 'DRAFT' || state.touched);
    if (blocked) {
      throw new AppError('IMPORT_REVERT_BLOCKED', 'a receipt of the import was posted or changed', {
        reason: blocked.status === 'DRAFT' ? 'CHANGED' : blocked.status,
        receiptId: blocked.id,
      });
    }
  }

  appliedNotes(rows: readonly AppliedRow[]): Record<string, number> {
    return { receipts: new Set(rows.map((row) => row.targetId)).size };
  }
}
