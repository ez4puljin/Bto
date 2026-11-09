import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  APP_SETTINGS_LIMITS,
  type CustomerStockDisplay,
  type HomeToggleKind,
  STOCK_APPS,
  type StockApp,
} from '@tugeel/shared/sales';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { ProductQueryService } from '../../catalog';
import { type AuthContext, actorUserId, AuditService, OrgService } from '../../identity';
import { notifyStockResync } from '../../inventory';
import { appSettings, appStockWarehouses } from '../schema';

/** The right that changes the apps' settings: the home's keepers (ADR-0092 #9, ADR-0127 #5). */
export const APP_SETTINGS_MANAGE = 'customer.home.manage';

/** The apps' settings as stored; `homeSections` is a map of the three fixed sections. */
export interface AppSettings {
  /** The PRODUCT segment «Bto300» sells from (ADR-0164 #1); null = every sale-ready product. */
  assortmentSegmentId: number | null;
  homeSections: Record<HomeToggleKind, boolean>;
  /** The customer app refuses an order under this amount; null = none. */
  minOrderAmount: Decimal | null;
  /** The name the apps may show; null = their built-in one. */
  appName: string | null;
  /** The apps' primary colour, `#RRGGBB`; null = their built-in one. */
  appColor: string | null;
  /**
   * The live warehouses whose stock each app counts, ascending (ADR-0173 #1); empty = every
   * warehouse. A product shows only its home warehouse's stock, and none when that is not listed.
   */
  stockWarehouses: Record<StockApp, number[]>;
  /** How «Bto300» shows stock (ADR-0173 #2). */
  customerStockDisplay: CustomerStockDisplay;
  updatedAt: Date | null;
  updatedBy: number | null;
}

/** A save; the stock settings left out stay as they are (an older screen's save keeps them). */
export type AppSettingsInput = Omit<
  AppSettings,
  'updatedAt' | 'updatedBy' | 'stockWarehouses' | 'customerStockDisplay'
> & {
  stockWarehouses?: Record<StockApp, readonly number[]>;
  customerStockDisplay?: CustomerStockDisplay;
};

/** The assortment in force: the live segment, or none (the setting cleared or the segment gone). */
export interface Assortment {
  segmentId: number | null;
  segmentName: string | null;
  /** The setting names a segment that is archived or gone: the apps show everything meanwhile. */
  broken: boolean;
}

const DEFAULTS: AppSettings = {
  assortmentSegmentId: null,
  homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
  minOrderAmount: null,
  appName: null,
  appColor: null,
  stockWarehouses: { CUSTOMER: [], STAFF: [] },
  customerStockDisplay: 'WORDS',
  updatedAt: null,
  updatedBy: null,
};

/**
 * The apps' settings (ADR-0127): which products «Bto300» shows (a product segment, ADR-0127 #1;
 * the staff app has its own settings, ADR-0164), which fixed home sections are on (#3), the customer app's minimum order
 * (#4), the name and colour the apps may show. One row, read by the shop and the home on every
 * request; changed from «Апп» on the web with `customer.home.manage`. The segment is stored
 * without a foreign key (nobody imports segments) and re-checked through catalog's directory.
 * Which warehouses' stock each app counts and how «Bto300» shows it (ADR-0173) live here too: the
 * lists in `app_stock_warehouses`, re-checked through the org directory on every read; a change
 * sends the apps' live stock a `resync` at commit.
 */
@Injectable()
export class AppSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly products: ProductQueryService,
    private readonly org: OrgService,
  ) {}

  /** The settings in force: the row, else the defaults. */
  async current(executor: Db | Tx = this.db): Promise<AppSettings> {
    const [row] = await executor.select().from(appSettings).where(eq(appSettings.id, 1));
    const stockWarehouses = await this.stockWarehouses(executor);
    if (!row) return { ...DEFAULTS, stockWarehouses };
    return {
      assortmentSegmentId: row.assortmentSegmentId,
      homeSections: {
        PROMOTIONS: row.homePromotions,
        DISCOUNTS: row.homeDiscounts,
        NEW: row.homeNew,
      },
      minOrderAmount: row.minOrderAmount,
      appName: row.appName,
      appColor: row.appColor,
      stockWarehouses,
      customerStockDisplay: row.customerStockDisplay === 'NUMBER' ? 'NUMBER' : 'WORDS',
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  /**
   * Each app's warehouse list as it counts today: the stored ids that are still live (ACTIVE, not
   * TRANSIT) warehouses, ascending. An archived or deleted one drops out; when every listed one
   * has, the app counts every warehouse again, as the screen then shows nothing ticked.
   */
  async stockWarehouses(executor: Db | Tx = this.db): Promise<Record<StockApp, number[]>> {
    const rows = await executor
      .select()
      .from(appStockWarehouses)
      .orderBy(asc(appStockWarehouses.app), asc(appStockWarehouses.warehouseId));
    const result: Record<StockApp, number[]> = { CUSTOMER: [], STAFF: [] };
    if (rows.length === 0) return result;
    const live = await this.liveWarehouseIds();
    for (const row of rows) {
      if ((row.app === 'CUSTOMER' || row.app === 'STAFF') && live.has(row.warehouseId)) {
        result[row.app].push(row.warehouseId);
      }
    }
    return result;
  }

  /** How «Bto300» shows stock (ADR-0173 #2), one column read: every card asks. */
  async customerStockDisplay(executor: Db | Tx = this.db): Promise<CustomerStockDisplay> {
    const [row] = await executor
      .select({ display: appSettings.customerStockDisplay })
      .from(appSettings)
      .where(eq(appSettings.id, 1));
    return row?.display === 'NUMBER' ? 'NUMBER' : 'WORDS';
  }

  /** The warehouses an app's stock setting may name: ACTIVE and not TRANSIT. */
  private async liveWarehouseIds(): Promise<Set<number>> {
    return new Set(
      (await this.org.listWarehouses())
        .filter((warehouse) => warehouse.status === 'ACTIVE' && warehouse.kind !== 'TRANSIT')
        .map((warehouse) => warehouse.id),
    );
  }

  /**
   * The assortment segment the shop filters by: the setting's segment while it is a live PRODUCT
   * segment; an archived or deleted one no longer narrows anything (`broken`), so the apps keep
   * selling until the office picks another.
   */
  async assortment(settings?: AppSettings): Promise<Assortment> {
    const id = (settings ?? (await this.current())).assortmentSegmentId;
    if (id === null) return { segmentId: null, segmentName: null, broken: false };
    const [segment] = await this.products.productSegments({ ids: [id] });
    return segment
      ? { segmentId: segment.id, segmentName: segment.name, broken: false }
      : { segmentId: null, segmentName: null, broken: true };
  }

  /** The segment id the shop narrows to today, or null (none set, or the setting is broken). */
  async assortmentSegmentId(): Promise<number | null> {
    return (await this.assortment()).segmentId;
  }

  /** Writes the whole row (every field given) and one audit row with the fields that changed. */
  async update(ctx: AuthContext, input: AppSettingsInput): Promise<AppSettings> {
    if (!ctx.permissions.has(APP_SETTINGS_MANAGE)) {
      throw new AppError('FORBIDDEN', `the apps' settings need ${APP_SETTINGS_MANAGE}`, {
        permission: APP_SETTINGS_MANAGE,
      });
    }
    const appName = input.appName?.trim() || null;
    if (appName !== null && appName.length > APP_SETTINGS_LIMITS.maxAppName) {
      throw invalid('appName', 'maxLength', `at most ${APP_SETTINGS_LIMITS.maxAppName} characters`);
    }
    const appColor = input.appColor?.trim() || null;
    if (appColor !== null && !APP_SETTINGS_LIMITS.colorPattern.test(appColor)) {
      throw invalid('appColor', 'hexColor', 'a colour as #RRGGBB');
    }
    if (input.minOrderAmount !== null && input.minOrderAmount.lt(0)) {
      throw invalid('minOrderAmount', 'min', 'zero or more');
    }
    if (input.assortmentSegmentId !== null) {
      const [segment] = await this.products.productSegments({ ids: [input.assortmentSegmentId] });
      if (!segment) {
        throw invalid('assortmentSegmentId', 'productSegment', 'a live product segment');
      }
    }
    const stockLists = input.stockWarehouses
      ? await this.checkedStockWarehouses(input.stockWarehouses)
      : null;
    const values = {
      assortmentSegmentId: input.assortmentSegmentId,
      homePromotions: input.homeSections.PROMOTIONS,
      homeDiscounts: input.homeSections.DISCOUNTS,
      homeNew: input.homeSections.NEW,
      minOrderAmount: input.minOrderAmount,
      appName,
      appColor,
      ...(input.customerStockDisplay === undefined
        ? {}
        : { customerStockDisplay: input.customerStockDisplay }),
      updatedBy: actorUserId(ctx),
    };
    await inTransaction(this.db, async (tx) => {
      // The row is locked before `before` is read: two saves run one after the other, so the second
      // compares against the first's result and its resync below is never missed.
      await tx
        .insert(appSettings)
        .values({ id: 1, updatedBy: actorUserId(ctx) })
        .onConflictDoNothing({ target: appSettings.id });
      await tx.execute(sql`SELECT id FROM app_settings WHERE id = 1 FOR UPDATE`);
      const before = await this.current(tx);
      await tx
        .insert(appSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { ...values, updatedAt: sql`now()` },
        });
      if (stockLists !== null) {
        await tx.delete(appStockWarehouses);
        const rows = STOCK_APPS.flatMap((app) =>
          stockLists[app].map((warehouseId) => ({ app, warehouseId })),
        );
        if (rows.length > 0) await tx.insert(appStockWarehouses).values(rows);
      }
      const after: AppSettings = {
        ...before,
        assortmentSegmentId: input.assortmentSegmentId,
        homeSections: input.homeSections,
        minOrderAmount: input.minOrderAmount,
        appName,
        appColor,
        stockWarehouses: stockLists ?? before.stockWarehouses,
        customerStockDisplay: input.customerStockDisplay ?? before.customerStockDisplay,
      };
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'app_settings',
        entityId: 1,
        before: auditView(before),
        after: auditView(after),
      });
      // What the apps count or show may have changed: every phone refetches its stock at commit.
      if (stockChanged(before, after)) await notifyStockResync(tx);
    });
    return this.current();
  }

  /**
   * Each list without repeats, ascending, every id a live non-TRANSIT warehouse; an unknown,
   * archived or TRANSIT one is refused with a field error naming the app's list.
   */
  private async checkedStockWarehouses(
    lists: Record<StockApp, readonly number[]>,
  ): Promise<Record<StockApp, number[]>> {
    const live = await this.liveWarehouseIds();
    const result: Record<StockApp, number[]> = { CUSTOMER: [], STAFF: [] };
    for (const app of STOCK_APPS) {
      const path = `stockWarehouses.${app.toLowerCase()}`;
      const ids = [...new Set(lists[app])].sort((a, b) => a - b);
      if (ids.length > APP_SETTINGS_LIMITS.maxStockWarehouses) {
        throw invalid(
          path,
          'arrayMaxSize',
          `at most ${APP_SETTINGS_LIMITS.maxStockWarehouses} warehouses`,
        );
      }
      const unknown = ids.find((id) => !live.has(id));
      if (unknown !== undefined) {
        throw invalid(path, 'warehouse', `warehouse ${unknown} is not a live warehouse`);
      }
      result[app] = ids;
    }
    return result;
  }
}

/**
 * Whether a save changed what the apps count or show: the lists, the display, or «Bto300»'s
 * segment (a product leaving the shop is a stock change to a phone that holds it).
 */
function stockChanged(before: AppSettings, after: AppSettings): boolean {
  return (
    before.customerStockDisplay !== after.customerStockDisplay ||
    before.assortmentSegmentId !== after.assortmentSegmentId ||
    STOCK_APPS.some(
      (app) => before.stockWarehouses[app].join(',') !== after.stockWarehouses[app].join(','),
    )
  );
}

function auditView(settings: AppSettings) {
  return {
    assortmentSegmentId: settings.assortmentSegmentId,
    homeSections: settings.homeSections,
    minOrderAmount: settings.minOrderAmount?.toFixed(2) ?? null,
    appName: settings.appName,
    appColor: settings.appColor,
    stockWarehouses: settings.stockWarehouses,
    customerStockDisplay: settings.customerStockDisplay,
  };
}
