import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { type AuthContext, OrgService } from '../../identity';
import { type OrderQuery, SalesOrderQueryService } from './sales-order-query.service';

/** The most orders one sheet holds; the list's filters narrow a larger set. */
export const MAX_EXPORT_ORDERS = 5_000;
const PAGE = 200;
/** The order details are read as the print batch reads them, 100 at a time. */
const BATCH = 100;

const X = mn.sales.export;
const COLUMNS: readonly ExcelColumn[] = [
  { name: X.number, kind: 'text' },
  { name: X.createdOn, kind: 'date' },
  { name: X.deliveryDate, kind: 'date' },
  { name: X.customerCode, kind: 'text' },
  { name: X.customer, kind: 'text' },
  { name: X.board, kind: 'text' },
  { name: X.pipeline, kind: 'text' },
  { name: X.stage, kind: 'text' },
  { name: X.status, kind: 'text' },
  { name: X.warehouse, kind: 'text' },
  { name: X.picker, kind: 'text' },
  { name: X.sku, kind: 'text' },
  { name: X.product, kind: 'text' },
  { name: X.qty, kind: 'number' },
  { name: X.unit, kind: 'text' },
  { name: X.ordered, kind: 'number' },
  { name: X.reserved, kind: 'number' },
  { name: X.picked, kind: 'number' },
  { name: X.short, kind: 'number' },
  { name: X.baseUnit, kind: 'text' },
  { name: X.subtotal, kind: 'number' },
  { name: X.discount, kind: 'number' },
  { name: X.total, kind: 'number' },
];

const text = (value: Decimal | null) => (value === null ? null : value.toFixed());

/**
 * The orders a list shows (its filters: the pipeline, the stage, the status, the archive, the
 * search…) as one sheet, a row per line: what was ordered, reserved, picked and deducted
 * (ADR-0130's «Хасалт», the ordered less the picked) and the amounts. Only the lines of the
 * warehouses the caller sees (ADR-0126 #3), as on the screen.
 */
@Injectable()
export class SalesOrderExportService {
  constructor(
    private readonly queries: SalesOrderQueryService,
    private readonly org: OrgService,
  ) {}

  async workbook(ctx: AuthContext, query: OrderQuery): Promise<Buffer> {
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.queries.list(ctx, { ...query, cursor, limit: PAGE });
      ids.push(...page.data.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && ids.length < MAX_EXPORT_ORDERS);
    const truncated = cursor !== undefined || ids.length > MAX_EXPORT_ORDERS;
    const wanted = ids.slice(0, MAX_EXPORT_ORDERS);
    const rows: ExcelRow[] = [];
    for (let start = 0; start < wanted.length; start += BATCH) {
      const chunk = wanted.slice(start, start + BATCH);
      const details = new Map(
        (await this.queries.batch(ctx, chunk)).map((order) => [order.id, order]),
      );
      const names = await this.org.warehouseNames([
        ...new Set([...details.values()].flatMap((order) => order.lines.map((l) => l.warehouseId))),
      ]);
      for (const id of chunk) {
        const order = details.get(id);
        if (!order) continue;
        const pickers = new Map(order.picks.map((part) => [part.warehouseId, part.pickerName]));
        for (const line of order.lines) {
          const short =
            line.qtyPicked !== null && line.qtyBase.gt(line.qtyPicked)
              ? line.qtyBase.minus(line.qtyPicked)
              : null;
          rows.push([
            order.number,
            businessDate(order.createdAt),
            order.deliveryDate,
            order.customerCode,
            order.customerName,
            order.boardName,
            order.pipelineName,
            order.stageName,
            mn.sales.statuses[order.status],
            names.get(line.warehouseId) ?? String(line.warehouseId),
            pickers.get(line.warehouseId) ?? null,
            line.productSku,
            line.productName,
            line.qty.toFixed(),
            line.unitName,
            line.qtyBase.toFixed(),
            line.qtyApproved.toFixed(),
            text(line.qtyPicked),
            text(short),
            line.baseUnitName,
            text(line.subtotal),
            text(line.discountAmount),
            text(line.total),
          ]);
        }
      }
    }
    return tableWorkbook(X.sheet, { yes: '', no: '' }, (sheet) => {
      sheet.addRows(COLUMNS, rows);
      if (truncated) {
        sheet.addRows(COLUMNS, [
          [
            X.truncated.replace('{{count}}', String(MAX_EXPORT_ORDERS)),
            ...COLUMNS.slice(1).map(() => null),
          ],
        ]);
      }
      return Promise.resolve();
    });
  }
}
