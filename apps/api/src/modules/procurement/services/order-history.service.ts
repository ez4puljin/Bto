import { Inject, Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { PO_HISTORY_PAGE, type PoHistoryKind } from '@tugeel/shared/procurement';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { CatalogService, UnitConversionService } from '../../catalog';
import { type AuditRow, AuditQueryService, OrgService, UserNamesService } from '../../identity';
import { ReceiptsService } from '../../inventory';
import { SuppliersService } from '../../partners';
import { purchaseOrders, purchaseOrderSuppliers } from '../schema';

export interface HistoryQuery {
  userId?: number;
  supplierId?: number;
  productId?: number;
  cursor?: string;
  limit?: number;
}

/** One change of the order as the history screen shows it (ADR-0118 #6). */
export interface HistoryRow {
  id: number;
  at: Date;
  userId: number | null;
  userName: string | null;
  kind: PoHistoryKind;
  supplierId: number | null;
  supplierName: string | null;
  productId: number | null;
  productSku: string | null;
  productName: string | null;
  /** The value before and after, as text (a status code for STATUS, else quantities with units). */
  from: string | null;
  to: string | null;
  /** What else the change says: a note, a receipt number, warehouse names, a version. */
  detail: string | null;
}

/** A history row before the names are filled in. */
interface Draft {
  audit: AuditRow;
  kind: PoHistoryKind;
  supplierId: number | null;
  productId: number | null;
  from: { qty: string; unitId: number | null } | string | null;
  to: { qty: string; unitId: number | null } | string | null;
  detail: string | null;
  warehouseIds?: number[];
  supplierIds?: number[];
}

const L = mn.procurement.history;
/** Most rows one Excel takes (the audit rows of one order are far fewer). */
const EXCEL_CAP = 5000;

/**
 * The order's history (ADR-0118 #6): every audited change of the order — its creation, suppliers,
 * moves, each cell before → after, the shipped and arrived quantities, the keeper's notes, the
 * receipt's confirmations and posting, the accountant's prices, archiving — read from the audit
 * rows procurement and inventory write (`purchase_orders`, `purchase_order_suppliers`, the
 * suppliers' `goods_receipts`), newest first, with filters by user, supplier and product, and as
 * an Excel. Nothing is stored twice: the screen is a view over the audit log.
 */
@Injectable()
export class OrderHistoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditQueryService,
    private readonly userNames: UserNamesService,
    private readonly suppliers: SuppliersService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly org: OrgService,
    private readonly receipts: ReceiptsService,
  ) {}

  async list(
    orderId: number,
    query: HistoryQuery,
  ): Promise<{ data: HistoryRow[]; nextCursor: string | null }> {
    const [order] = await this.db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    if (!order) throw notFound('purchase order', orderId);
    const rows = await this.db
      .select()
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, orderId));
    const chosen =
      query.supplierId === undefined
        ? rows
        : rows.filter((row) => row.supplierId === query.supplierId);
    const supplierOfRow = new Map(rows.map((row) => [String(row.id), row.supplierId]));
    const supplierOfReceipt = new Map(
      rows.flatMap((row) =>
        row.receiptId === null ? [] : [[String(row.receiptId), row.supplierId] as const],
      ),
    );
    const page = await this.audit.entriesOf({
      targets: [
        { entity: 'purchase_orders', ids: query.supplierId === undefined ? [orderId] : [] },
        { entity: 'purchase_order_suppliers', ids: chosen.map((row) => row.id) },
        {
          entity: 'goods_receipts',
          ids: chosen.flatMap((row) => (row.receiptId === null ? [] : [row.receiptId])),
        },
      ],
      ...(query.userId === undefined ? {} : { actorId: query.userId }),
      ...(query.productId === undefined ? {} : { productId: query.productId }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: Math.min(query.limit ?? PO_HISTORY_PAGE, PO_HISTORY_PAGE),
    });
    const drafts: Draft[] = [];
    for (const audit of page.data) {
      drafts.push(...(await this.explain(audit, supplierOfRow, supplierOfReceipt)));
    }
    const kept =
      query.productId === undefined
        ? drafts
        : drafts.filter((draft) => draft.productId === query.productId);
    return { data: await this.resolve(kept), nextCursor: page.nextCursor };
  }

  /** The history as one sheet (ADR-0118 #6), every page until the end or the cap. */
  async workbook(orderId: number, query: HistoryQuery): Promise<Buffer> {
    const [order] = await this.db
      .select({ number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    if (!order) throw notFound('purchase order', orderId);
    const columns: ExcelColumn[] = [
      { name: L.excel.at, kind: 'datetime' },
      { name: L.excel.user, kind: 'text' },
      { name: L.excel.kind, kind: 'text' },
      { name: L.excel.supplier, kind: 'text' },
      { name: L.excel.sku, kind: 'text' },
      { name: L.excel.product, kind: 'text' },
      { name: L.excel.from, kind: 'text' },
      { name: L.excel.to, kind: 'text' },
      { name: L.excel.detail, kind: 'text' },
    ];
    const kinds = L.kind as Record<string, string>;
    return tableWorkbook(`${L.title} ${order.number}`, { yes: '', no: '' }, async (sheet) => {
      let cursor: string | undefined;
      let count = 0;
      do {
        const page = await this.list(orderId, { ...query, cursor, limit: PO_HISTORY_PAGE });
        const rows: ExcelRow[] = page.data.map((row) => [
          row.at.toISOString(),
          row.userName,
          kinds[row.kind] ?? row.kind,
          row.supplierName,
          row.productSku,
          row.productName,
          row.from,
          row.to,
          row.detail,
        ]);
        sheet.addRows(columns, rows);
        count += rows.length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined && count < EXCEL_CAP);
    });
  }

  // -------------------------------------------------------------------------------------------

  /** What one audit row says, as zero or more history rows. */
  private async explain(
    audit: AuditRow,
    supplierOfRow: Map<string, number>,
    supplierOfReceipt: Map<string, number>,
  ): Promise<Draft[]> {
    const before = record(audit.before);
    const after = record(audit.after);
    const base = { audit, supplierId: null, productId: null, from: null, to: null, detail: null };
    if (audit.entity === 'purchase_orders') {
      if (audit.action === 'CREATE') return [{ ...base, kind: 'CREATED', to: text(after.number) }];
      if (audit.action === 'ARCHIVE') return [{ ...base, kind: 'ARCHIVED' }];
      if (audit.action === 'UNARCHIVE') return [{ ...base, kind: 'UNARCHIVED' }];
      if (audit.action === 'LOAD_ADD') {
        return [
          { ...base, kind: 'LOAD_ADDED', to: text(after.truckName), detail: text(after.note) },
        ];
      }
      if (audit.action === 'LOAD_REMOVE') {
        return [{ ...base, kind: 'LOAD_REMOVED', from: text(before.truckName) }];
      }
      if ('note' in after) {
        return [{ ...base, kind: 'NOTE', from: text(before.note), to: text(after.note) }];
      }
      if (Array.isArray(after.addedSupplierIds)) {
        return [{ ...base, kind: 'SUPPLIERS_ADDED', supplierIds: after.addedSupplierIds.map(int) }];
      }
      if (before.removedSupplierId !== undefined) {
        return [{ ...base, kind: 'SUPPLIER_REMOVED', supplierId: int(before.removedSupplierId) }];
      }
      return [];
    }
    if (audit.entity === 'purchase_order_suppliers') {
      const supplierId = supplierOfRow.get(audit.entityId) ?? null;
      const productId = numberOrNull(after.productId);
      if ('line' in after) {
        const line = record(after.line);
        return [
          {
            ...base,
            kind: 'ORDER_QTY',
            supplierId,
            productId,
            from: qtyOf(before.qty, before.productUnitId),
            to: after.line === null ? null : qtyOf(line.qty, line.productUnitId),
          },
        ];
      }
      if ('shipped' in after) {
        const shipped = record(after.shipped);
        return [
          {
            ...base,
            kind: 'SHIPPED_QTY',
            supplierId,
            productId,
            from: qtyOf(before.shippedQty, before.productUnitId),
            to: qtyOf(shipped.qty, before.productUnitId),
          },
        ];
      }
      if (audit.action === 'LOAD_ASSIGN') {
        return [
          {
            ...base,
            kind: 'LOADED',
            supplierId,
            to: after.loadId === null ? null : text(after.truckName),
            detail: after.loadId === null ? L.kind.LOADED_OFF : null,
          },
        ];
      }
      if (audit.action === 'LOAD_LINE') {
        const loaded = record(after.loaded);
        return [
          {
            ...base,
            kind: 'LOADED',
            supplierId,
            productId,
            from: text(before.loaded),
            to: text(loaded.qty),
            detail: text(loaded.truckName),
          },
        ];
      }
      if (audit.action === 'INVOICE_CHECK') {
        return [
          {
            ...base,
            kind: 'INVOICE_CHECKED',
            supplierId,
            to: text(after.invoiceTotal),
            detail: text(after.summary),
          },
        ];
      }
      if (typeof after.status === 'string') {
        return [
          {
            ...base,
            kind: 'STATUS',
            supplierId,
            from: text(before.status),
            to: text(after.status),
          },
        ];
      }
      return [];
    }
    if (audit.entity === 'goods_receipts') {
      const supplierId = supplierOfReceipt.get(audit.entityId) ?? null;
      switch (audit.action) {
        case 'CONFIRM':
          return [
            {
              ...base,
              kind: 'RECEIPT_CONFIRMED',
              supplierId,
              warehouseIds: Array.isArray(after.warehouseIds) ? after.warehouseIds.map(int) : [],
            },
          ];
        case 'WITHDRAW':
          return [
            {
              ...base,
              kind: 'RECEIPT_WITHDRAWN',
              supplierId,
              warehouseIds: before.warehouseId === undefined ? [] : [int(before.warehouseId)],
            },
          ];
        case 'POST':
          return [{ ...base, kind: 'RECEIPT_POSTED', supplierId, detail: text(after.number) }];
        case 'CANCEL':
          return [{ ...base, kind: 'RECEIPT_CANCELLED', supplierId }];
        case 'COUNT': {
          const drafts: Draft[] = [];
          const counted =
            after.checkedAt != null &&
            (before.checkedAt == null || !same(before.qtyBase, after.qtyBase));
          if (counted) {
            drafts.push({
              ...base,
              kind: 'ARRIVED_QTY',
              supplierId,
              productId: numberOrNull(after.productId),
              from: before.checkedAt == null ? null : qtyOf(before.qtyBase, null),
              to: qtyOf(after.qtyBase, null),
            });
          }
          if (!same(before.note, after.note)) {
            drafts.push({
              ...base,
              kind: 'LINE_NOTE',
              supplierId,
              productId: numberOrNull(after.productId),
              from: text(before.note),
              to: text(after.note),
            });
          }
          return drafts;
        }
        case 'LINE_ADD':
          return [
            {
              ...base,
              kind: 'LINE_ADDED',
              supplierId,
              productId: numberOrNull(after.productId),
              to: qtyOf(after.qtyBase, null),
            },
          ];
        case 'LINE_REMOVE':
          return [
            {
              ...base,
              kind: 'LINE_REMOVED',
              supplierId,
              productId: numberOrNull(before.productId),
              from: qtyOf(before.qtyBase, null),
            },
          ];
        case 'COST': {
          const lines = Array.isArray(after.lines) ? after.lines.map(record) : [];
          const version = text(after.version);
          if (lines.length === 0) {
            return [{ ...base, kind: 'PRICES', supplierId, detail: version }];
          }
          // Older rows name the line only: its product comes from the receipt.
          const productOfLine = lines.some((line) => line.productId === undefined)
            ? await this.productOfLines(int(audit.entityId))
            : new Map<number, number>();
          return lines.map((line) => ({
            ...base,
            kind: 'PRICES' as const,
            supplierId,
            productId: numberOrNull(line.productId) ?? productOfLine.get(int(line.lineId)) ?? null,
            to: text(line.docAmount),
            detail: version,
          }));
        }
        default:
          return [];
      }
    }
    return [];
  }

  private async productOfLines(receiptId: number): Promise<Map<number, number>> {
    try {
      const detail = await this.receipts.get(receiptId);
      return new Map(detail.lines.map((line) => [line.id, line.productId]));
    } catch {
      return new Map();
    }
  }

  /** Fills in the users', suppliers', products', units' and warehouses' names. */
  private async resolve(drafts: readonly Draft[]): Promise<HistoryRow[]> {
    const userIds = new Set<number>();
    const supplierIds = new Set<number>();
    const productIds = new Set<number>();
    const unitIds = new Set<number>();
    const warehouseIds = new Set<number>();
    for (const draft of drafts) {
      if (draft.audit.actorKind === 'STAFF' && draft.audit.actorId !== null) {
        userIds.add(draft.audit.actorId);
      }
      if (draft.supplierId !== null) supplierIds.add(draft.supplierId);
      for (const id of draft.supplierIds ?? []) supplierIds.add(id);
      if (draft.productId !== null) productIds.add(draft.productId);
      for (const side of [draft.from, draft.to]) {
        if (side !== null && typeof side === 'object' && side.unitId !== null)
          unitIds.add(side.unitId);
      }
      for (const id of draft.warehouseIds ?? []) warehouseIds.add(id);
    }
    const users = await this.userNames.namesOf([...userIds]);
    const suppliers = new Map(
      (await this.suppliers.getMany([...supplierIds])).map((supplier) => [supplier.id, supplier]),
    );
    const products = new Map(
      (await this.catalog.getMany([...productIds])).map((product) => [product.id, product]),
    );
    const units = await this.units.describe([...unitIds]);
    const warehouses = new Map<number, string>();
    for (const id of warehouseIds) {
      try {
        warehouses.set(id, (await this.org.getWarehouse(id)).name);
      } catch {
        warehouses.set(id, String(id));
      }
    }
    const side = (value: Draft['from']): string | null => {
      if (value === null || typeof value === 'string') return value;
      const unit = value.unitId === null ? null : units.get(value.unitId);
      return unit ? `${value.qty} ${unit.uomName}` : value.qty;
    };
    return drafts.map((draft) => {
      const product = draft.productId === null ? undefined : products.get(draft.productId);
      const named = draft.supplierIds
        ?.map((id) => suppliers.get(id)?.name ?? String(id))
        .join(', ');
      const places = draft.warehouseIds?.map((id) => warehouses.get(id) ?? String(id)).join(', ');
      const actorId =
        draft.audit.actorKind === 'STAFF' && draft.audit.actorId !== null
          ? draft.audit.actorId
          : null;
      return {
        id: draft.audit.id,
        at: draft.audit.occurredAt,
        userId: actorId,
        userName:
          actorId === null
            ? draft.audit.actorLabel
            : (users.get(actorId) ?? draft.audit.actorUsername ?? draft.audit.actorLabel),
        kind: draft.kind,
        supplierId: draft.supplierId,
        supplierName:
          draft.supplierId === null ? null : (suppliers.get(draft.supplierId)?.name ?? null),
        productId: draft.productId,
        productSku: product?.sku ?? null,
        productName: product?.name ?? null,
        from: side(draft.from),
        to: side(draft.to),
        detail: draft.detail ?? named ?? places ?? null,
      };
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A scalar the audit serialised, as text; objects give null. */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** An id the audit serialised as a number or a digit string. */
function int(value: unknown): number {
  return typeof value === 'number' ? value : Number.parseInt(text(value) ?? '0', 10);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

/** A quantity as the audit serialised it (a Decimal's string), with its unit for the names pass. */
function qtyOf(value: unknown, unitId: unknown): { qty: string; unitId: number | null } | null {
  const qty = text(value);
  if (qty === null) return null;
  return { qty: new Decimal(qty).toFixed(), unitId: numberOrNull(unitId) };
}

function same(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  return text(a) === text(b);
}
