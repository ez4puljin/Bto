import { Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { AuthContext } from '../../identity';
import { PosCashiersService, PosTillsService, type Till } from '../../pos';
import { labelEscPos } from '../label/escpos';
import { type LabelFace, renderLabel } from '../label/label-render';
import { PrintError } from '../printing.errors';
import { PRINT_LIMITS, type PrintWidth } from '../printing.rules';
import { type PrintJobView, PrintJobsService } from './print-jobs.service';
import { type PrintStation, PrintStationsService } from './print-stations.service';
import { type LabelItem, TillPricesService } from './till-prices.service';

/** The right over the store's tills: its holder prints for every active till (owner 2026-11-20). */
const MANAGE = 'pos.manage';

/** A till a staff member prints labels for. */
export interface LabelTill {
  id: number;
  code: string;
  name: string;
  storeName: string;
  categoryIds: number[];
}

export interface LabelOrder {
  tillId: number;
  items: readonly { productId: number; copies: number }[];
}

/**
 * Price labels from the staff app (ADR-0226 #1, #3): who may print (a staff member a till names
 * as its cashier, or the holder of `pos.manage` at any active till), the till's products at the
 * till's prices, and the labels as ESC/POS bytes — returned to the phone for its Bluetooth
 * printer, or queued for a print station.
 */
@Injectable()
export class PriceLabelsService {
  constructor(
    private readonly tills: PosTillsService,
    private readonly cashiers: PosCashiersService,
    private readonly prices: TillPricesService,
    private readonly stations: PrintStationsService,
    private readonly jobs: PrintJobsService,
  ) {}

  /**
   * The caller's tills: active tills that name them as a cashier, in the till's own list
   * (ADR-0124) or in theirs (owner 2026-11-17), and that both lists admit; every active till for
   * the holder of `pos.manage`, the right over the store's tills (owner 2026-11-20). None:
   * PRINT_NO_TILL.
   */
  async tillsOf(ctx: AuthContext): Promise<LabelTill[]> {
    const all = await this.tills.list();
    if (ctx.permissions.has(MANAGE)) {
      const active = all.filter((till) => till.status === 'ACTIVE');
      if (active.length === 0) {
        throw new PrintError('PRINT_NO_TILL', 'no active till');
      }
      return active.map(labelTill);
    }
    const own = (await this.cashiers.tillsByCashier()).get(ctx.userId) ?? [];
    const mine = all.filter((till) => {
      if (till.status !== 'ACTIVE') return false;
      const namedByTill = till.cashierUserIds.includes(ctx.userId);
      const namedByCashier = own.includes(till.id);
      const tillAdmits = till.cashierUserIds.length === 0 || namedByTill;
      const cashierAdmits = own.length === 0 || namedByCashier;
      return (namedByTill || namedByCashier) && tillAdmits && cashierAdmits;
    });
    if (mine.length === 0) {
      throw new PrintError('PRINT_NO_TILL', `user ${ctx.userId} works no till`);
    }
    return mine.map(labelTill);
  }

  async till(ctx: AuthContext, tillId: number): Promise<LabelTill> {
    const till = (await this.tillsOf(ctx)).find((candidate) => candidate.id === tillId);
    if (!till) {
      throw new PrintError('PRINT_TILL_NOT_YOURS', `till ${tillId} is not the caller's`, {
        tillId,
      });
    }
    return till;
  }

  async search(ctx: AuthContext, tillId: number, q: string): Promise<LabelItem[]> {
    const till = await this.till(ctx, tillId);
    return this.prices.search(till, q.trim());
  }

  async byCode(ctx: AuthContext, tillId: number, code: string): Promise<LabelItem> {
    const till = await this.till(ctx, tillId);
    const item = await this.prices.byCode(till, code.trim());
    if (!item) throw notFound(code);
    return item;
  }

  /** The labels' bytes for the phone's own printer; each label cut after. */
  async escPos(
    ctx: AuthContext,
    order: LabelOrder,
    widthDots: PrintWidth = 576,
  ): Promise<{ data: Buffer; labels: number }> {
    const till = await this.till(ctx, order.tillId);
    return this.bytes(till, order, widthDots);
  }

  /** Printers a staff member with a till (or `pos.manage`) may send labels to: every active one. */
  async stationsFor(ctx: AuthContext): Promise<PrintStation[]> {
    await this.tillsOf(ctx);
    return this.stations.list({ activeOnly: true });
  }

  /** Queues the labels on a station. */
  async print(
    ctx: AuthContext,
    order: LabelOrder & { stationId: number },
  ): Promise<{ job: PrintJobView; labels: number }> {
    const till = await this.till(ctx, order.tillId);
    const station = await this.stations.active(order.stationId);
    const { data, labels } = await this.bytes(till, order, station.widthDots);
    const job = await this.jobs.create(ctx, { station, tillId: till.id, payload: data, labels });
    return { job, labels };
  }

  /** The office's «Туршилтын шошго»: one sample label on a station. */
  async test(ctx: AuthContext, stationId: number): Promise<PrintJobView> {
    const station = await this.stations.active(stationId);
    const face: LabelFace = {
      name: 'Туршилтын шошго — Bto',
      code: '000000',
      date: businessDate(),
      price: '12,345',
      bulkQty: '10',
      bulkPrice: '11,900',
    };
    const payload = labelEscPos(await renderLabel(face, station.widthDots));
    return this.jobs.create(ctx, { station, tillId: null, payload, labels: 1 });
  }

  private async bytes(
    till: LabelTill,
    order: LabelOrder,
    widthDots: PrintWidth,
  ): Promise<{ data: Buffer; labels: number }> {
    const labels = order.items.reduce((sum, item) => sum + item.copies, 0);
    if (labels > PRINT_LIMITS.maxLabels) {
      throw new PrintError('PRINT_TOO_MANY_LABELS', `${labels} labels asked`, {
        count: labels,
        limit: PRINT_LIMITS.maxLabels,
      });
    }
    const items = await this.prices.items(
      till,
      order.items.map((item) => item.productId),
    );
    const date = businessDate();
    const parts: Buffer[] = [];
    for (const [index, item] of items.entries()) {
      const asked = order.items[index];
      if (!asked) continue;
      if (!item) throw notFound(String(asked.productId), asked.productId);
      const one = labelEscPos(await renderLabel(faceOf(item, date), widthDots));
      for (let copy = 0; copy < asked.copies; copy += 1) parts.push(one);
    }
    return { data: Buffer.concat(parts), labels };
  }
}

function labelTill(till: Till): LabelTill {
  return {
    id: till.id,
    code: till.code,
    name: till.name,
    storeName: till.warehouseName ?? '',
    categoryIds: till.categoryIds,
  };
}

function notFound(code: string, productId?: number): PrintError {
  return new PrintError('PRINT_PRODUCT_NOT_FOUND', `product ${code} is not sold at the till`, {
    code,
    productId: productId ?? null,
  });
}

/** 29700 → «29,700»: the old label's thousands, no ₮. */
export function thousands(value: Decimal): string {
  return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function faceOf(item: LabelItem, date: string): LabelFace {
  return {
    name: item.name,
    code: item.code,
    date,
    price: thousands(item.price),
    bulkQty: item.bulkQty ? item.bulkQty.toFixed() : '',
    bulkPrice: item.bulkPrice ? thousands(item.bulkPrice) : '',
  };
}
