import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { APP_SETTINGS_LIMITS, type HomeToggleKind } from '@tugeel/shared/sales';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { ProductQueryService } from '../../catalog';
import { type AuthContext, actorUserId, AuditService } from '../../identity';
import { appSettings } from '../schema';

/** The right that changes the apps' settings: the home's keepers (ADR-0092 #9, ADR-0127 #5). */
export const APP_SETTINGS_MANAGE = 'customer.home.manage';

/** The apps' settings as stored; `homeSections` is a map of the three fixed sections. */
export interface AppSettings {
  /** The PRODUCT segment both apps sell from; null = every sale-ready product. */
  assortmentSegmentId: number | null;
  homeSections: Record<HomeToggleKind, boolean>;
  /** The customer app refuses an order under this amount; null = none. */
  minOrderAmount: Decimal | null;
  /** The name the apps may show; null = their built-in one. */
  appName: string | null;
  /** The apps' primary colour, `#RRGGBB`; null = their built-in one. */
  appColor: string | null;
  updatedAt: Date | null;
  updatedBy: number | null;
}

export type AppSettingsInput = Omit<AppSettings, 'updatedAt' | 'updatedBy'>;

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
  updatedAt: null,
  updatedBy: null,
};

/**
 * The apps' settings (ADR-0127): which products «Bto300» and the staff app show (a product
 * segment, ADR-0127 #1), which fixed home sections are on (#3), the customer app's minimum order
 * (#4), the name and colour the apps may show. One row, read by the shop and the home on every
 * request; changed from «Апп» on the web with `customer.home.manage`. The segment is stored
 * without a foreign key (nobody imports segments) and re-checked through catalog's directory.
 */
@Injectable()
export class AppSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly products: ProductQueryService,
  ) {}

  /** The settings in force: the row, else the defaults. */
  async current(executor: Db | Tx = this.db): Promise<AppSettings> {
    const [row] = await executor.select().from(appSettings).where(eq(appSettings.id, 1));
    if (!row) return DEFAULTS;
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
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
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
    const values = {
      assortmentSegmentId: input.assortmentSegmentId,
      homePromotions: input.homeSections.PROMOTIONS,
      homeDiscounts: input.homeSections.DISCOUNTS,
      homeNew: input.homeSections.NEW,
      minOrderAmount: input.minOrderAmount,
      appName,
      appColor,
      updatedBy: actorUserId(ctx),
    };
    await inTransaction(this.db, async (tx) => {
      const before = await this.current(tx);
      await tx
        .insert(appSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { ...values, updatedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'app_settings',
        entityId: 1,
        before: auditView(before),
        after: auditView({ ...before, ...input, appName, appColor }),
      });
    });
    return this.current();
  }
}

function auditView(settings: AppSettings) {
  return {
    assortmentSegmentId: settings.assortmentSegmentId,
    homeSections: settings.homeSections,
    minOrderAmount: settings.minOrderAmount?.toFixed(2) ?? null,
    appName: settings.appName,
    appColor: settings.appColor,
  };
}
