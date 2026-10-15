import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import type { Db, Tx } from '../../../common/db/db.types';
import {
  CatalogImportService,
  ProductLifecycleService,
  UnitConversionService,
} from '../../catalog';
import type { Actor } from '../../identity';
import {
  type ImportProfile,
  PriceProfilesService,
  ProductPricesService,
  SaleReadinessService,
  type TermsInForce,
  type WrittenTerms,
} from '../../pricing';
import type { ImportAction } from '../schema';
import type { TemplateFill } from '../services/import-template';
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
import { decimalCell, keyOf } from './lookups';

/** The highest warehouse price a row may hold: NUMERIC(14,2). */
const PRICE_MAX = new Decimal('999999999999');

/** A row's terms (JSON: the row's plan). */
export interface PricesPlan {
  productId: number;
  /** Whole MNT as text. */
  warehousePrice: string;
  profileId: number;
  wholeUomId: number | null;
  validFrom: string;
  changed: string[];
}

/** What a committed row wrote, kept for the revert. */
interface PricesChanges extends WrittenTerms {
  /** When the import completed the product (ISO), or null. */
  completedAt: string | null;
}

function isPricesChanges(value: unknown): value is PricesChanges {
  return (
    typeof value === 'object' &&
    value !== null &&
    'productId' in value &&
    'rowId' in value &&
    'validFrom' in value &&
    'before' in value
  );
}

const sameTerms = (terms: TermsInForce | undefined, plan: PricesPlan): string[] => [
  ...(terms?.warehousePrice.eq(plan.warehousePrice) ? [] : ['warehousePrice']),
  ...(terms?.profileId === plan.profileId ? [] : ['profile']),
  ...(terms !== undefined && terms.wholeUomId === plan.wholeUomId ? [] : ['wholePack']),
];

/**
 * The price sheet (ADR-0054): a product's warehouse price, price profile and whole pack from a day
 * on (today when empty). Name, base unit and packs are for reading only; an empty price keeps the
 * product's terms. The commit writes through pricing under its table lock and completes waiting
 * products it priced from today; the revert writes the replaced terms forward from the revert day.
 */
@Injectable()
export class PricesImporter implements Importer<PricesPlan> {
  readonly kind = 'PRICES' as const;

  constructor(
    private readonly catalog: CatalogImportService,
    private readonly units: UnitConversionService,
    private readonly lifecycle: ProductLifecycleService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly readiness: SaleReadinessService,
  ) {}

  async validate(rows: readonly SourceRow[], executor: Db | Tx): Promise<CheckedRow<PricesPlan>[]> {
    const today = businessDate();
    const reference = await this.catalog.reference(executor);
    const uomById = new Map(reference.uoms.map((uom) => [uom.id, uom]));
    const profiles = await this.profiles.forImport(executor);
    const live = new Map(profiles.filter((p) => !p.archived).map((p) => [p.nameKey, p]));
    const archived = new Set(profiles.filter((p) => p.archived).map((p) => p.nameKey));

    const entries = rows.map((row) => {
      const check = new RowCheck(row);
      return { check, sku: check.text('sku', true) };
    });
    const products = new Map(
      (
        await this.catalog.productsBySku(
          entries.flatMap((entry) => (entry.sku ? [entry.sku] : [])),
          executor,
        )
      ).map((product) => [product.sku, product]),
    );

    const planned = entries.map(({ check, sku }) => {
      const product = sku ? products.get(sku) : undefined;
      if (sku && !product) check.error('sku', 'NOT_FOUND', { value: sku });
      const priceText = check.text('warehousePrice');
      if (priceText === null || !product) {
        return { check, product, plan: null as PricesPlan | null };
      }
      if (product.status !== 'ACTIVE') check.error('sku', 'NOT_ALLOWED');

      let price: Decimal | null = null;
      const read = decimalCell(priceText, 2, PRICE_MAX);
      if (!read.ok) check.error('warehousePrice', read.code);
      else if (!read.value.isInteger()) check.error('warehousePrice', 'NOT_WHOLE');
      else if (read.value.isZero()) check.error('warehousePrice', 'NOT_POSITIVE');
      else price = read.value;

      const dayText = check.text('validFrom');
      let day: string | null = dayText ?? today;
      if (dayText !== null && !isIsoDate(dayText)) {
        check.error('validFrom', 'FORMAT');
        day = null;
      } else if (dayText !== null && dayText < today) {
        check.error('validFrom', 'PAST_DATE', { today });
        day = null;
      }

      const profileText = check.text('profile', true);
      let profile: ImportProfile | undefined;
      if (profileText !== null) {
        const key = keyOf(profileText);
        profile = live.get(key);
        if (!profile) {
          check.error('profile', archived.has(key) ? 'ARCHIVED' : 'NOT_FOUND', {
            value: profileText,
          });
        } else if (day !== null && (profile.firstFrom === null || profile.firstFrom > day)) {
          check.error('profile', 'NO_PROFILE_VALUES', { value: profile.name });
        }
      }

      const packs = product.units.filter((unit) => !unit.isBase);
      const wholeText = check.text('wholePack');
      let wholeUomId: number | null = null;
      if (packs.length === 0) {
        if (wholeText !== null) check.error('wholePack', 'NO_PACKS');
      } else if (wholeText === null) {
        check.error('wholePack', 'REQUIRED');
      } else {
        const key = keyOf(wholeText);
        const code = wholeText.trim().toUpperCase();
        const pack = packs.find((unit) => {
          const uom = uomById.get(unit.uomId);
          return uom !== undefined && (uom.nameKey === key || uom.code === code);
        });
        if (pack) wholeUomId = pack.uomId;
        else check.error('wholePack', 'NOT_FOUND', { value: wholeText });
      }

      const plan: PricesPlan | null =
        price && profile && day
          ? {
              productId: product.id,
              warehousePrice: price.toFixed(0),
              profileId: profile.id,
              wholeUomId,
              validFrom: day,
              changed: [],
            }
          : null;
      return { check, product, plan };
    });
    markDuplicates(planned, 'sku', (entry) => (entry.product ? [String(entry.product.id)] : []));

    const byDay = new Map<string, number[]>();
    for (const { plan } of planned) {
      if (plan) byDay.set(plan.validFrom, [...(byDay.get(plan.validFrom) ?? []), plan.productId]);
    }
    const inForce = new Map<string, TermsInForce>();
    for (const [day, ids] of byDay) {
      for (const [productId, terms] of await this.prices.inForce(ids, day, executor)) {
        inForce.set(`${day}:${productId}`, terms);
      }
    }
    return planned.map(({ check, product, plan }) => {
      if (!plan) return check.result<PricesPlan>('UNCHANGED', product?.id ?? null, null);
      const terms = inForce.get(`${plan.validFrom}:${plan.productId}`);
      const changed = sameTerms(terms, plan);
      const action: ImportAction = !terms ? 'CREATE' : changed.length > 0 ? 'UPDATE' : 'UNCHANGED';
      return check.result(action, plan.productId, { ...plan, changed: terms ? changed : [] });
    });
  }

  async apply(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CheckedRow<PricesPlan>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const changing = rows.flatMap((row) =>
      row.plan && row.action !== null && row.action !== 'UNCHANGED'
        ? [{ row, action: row.action, plan: row.plan }]
        : [],
    );
    const written = await this.prices.setManyInTx(
      tx,
      actor,
      changing.map(({ plan }) => ({
        productId: plan.productId,
        validFrom: plan.validFrom,
        warehousePrice: new Decimal(plan.warehousePrice),
        profileId: plan.profileId,
        wholeUomId: plan.wholeUomId,
      })),
    );
    const { completed, at } = await this.readiness.completeManyInTx(
      tx,
      actor,
      written.map((terms) => terms.productId),
    );
    await progress(rows.length);
    const done = new Set(completed);
    const byProduct = new Map(written.map((terms) => [terms.productId, terms]));
    const applied = new Map<number, AppliedRow>();
    for (const { row, action, plan } of changing) {
      const terms = byProduct.get(plan.productId);
      if (!terms) continue;
      const changes: PricesChanges = {
        ...terms,
        completedAt: at && done.has(plan.productId) ? at.toISOString() : null,
      };
      applied.set(row.rowNo, { rowNo: row.rowNo, action, targetId: plan.productId, changes });
    }
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

  /** Products the commit completed, for the job's summary. */
  appliedNotes(rows: readonly AppliedRow[]): Record<string, number> {
    return {
      COMPLETED: rows.filter((row) => isPricesChanges(row.changes) && row.changes.completedAt)
        .length,
    };
  }

  /**
   * Imported terms that still hold go back from today; products the import completed return to
   * «Үнэ хүлээгдэж буй» when their terms went back and nobody completed them again since.
   */
  async revert(
    tx: Tx,
    actor: Actor,
    _job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const entries = rows.flatMap((row) => (isPricesChanges(row.changes) ? [row.changes] : []));
    const restored = new Set(await this.prices.restoreManyInTx(tx, actor, entries));
    await this.lifecycle.markWaitingInTx(
      tx,
      actor,
      entries.flatMap((entry) =>
        entry.completedAt && restored.has(entry.productId)
          ? [{ id: entry.productId, saleReadyAt: new Date(entry.completedAt) }]
          : [],
      ),
    );
  }

  /**
   * The template's rows (ADR-0054 #2): every active product by code with its terms in force today,
   * and a sheet of the live profiles.
   */
  async template(executor?: Db | Tx): Promise<TemplateFill> {
    const products = await this.catalog.activeProducts(executor);
    const ids = products.map((product) => product.id);
    const units = await this.units.currentUnits(ids, executor);
    const terms = new Map(
      (await this.prices.currentOf(ids, executor)).map((own) => [own.productId, own]),
    );
    const profiles = (await this.profiles.forImport(executor)).filter((p) => !p.archived);
    const labels = mn.imports.template.profileColumns;
    const roundings = mn.pricing.roundings as Record<string, string>;
    return {
      rows: products.map((product) => {
        const own = units.get(product.id) ?? [];
        const base = own.find((unit) => unit.isBase);
        const current = terms.get(product.id);
        return {
          sku: product.sku,
          name: product.name,
          baseUnit: base?.uomName ?? null,
          packs:
            own
              .filter((unit) => !unit.isBase)
              .map((unit) => `${unit.uomName} ${unit.factorToBase.toFixed()}`)
              .join(', ') || null,
          warehousePrice: current ? current.warehousePrice.toNumber() : null,
          profile: current?.profileName ?? null,
          wholePack: current?.wholeUomId
            ? (own.find((unit) => unit.uomId === current.wholeUomId)?.uomName ?? null)
            : null,
          validFrom: null,
        };
      }),
      sheets: [
        {
          name: mn.imports.template.profilesSheet,
          header: [
            labels.name,
            labels.loose,
            labels.retail,
            labels.retailBulk,
            labels.retailBulkMinQty,
            labels.rounding,
          ],
          rows: profiles.map((profile) => [
            profile.name,
            profile.current?.looseMarkupPct.toFixed() ?? null,
            profile.current?.retailMarkupPct.toFixed() ?? null,
            profile.current?.retailBulkMarkupPct?.toFixed() ?? null,
            profile.current?.retailBulkMinQty?.toFixed() ?? null,
            profile.current ? (roundings[profile.current.rounding] ?? null) : null,
          ]),
        },
      ],
    };
  }
}
