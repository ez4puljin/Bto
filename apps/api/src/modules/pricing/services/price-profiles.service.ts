import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  MAX_PRICE_PROFILE_NAME,
  type PriceProfileValues,
  type PriceRounding,
  priceProfileIssue,
} from '@tugeel/shared/pricing';
import { nameKey } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, actorUserId, AuditService, UserNamesService } from '../../identity';
import { priceProfiles, priceProfileVersions, productPrices } from '../schema';
import { applied, assertNotPast, inForceOn } from './support';
import { planChange } from './timeline';

type VersionRow = typeof priceProfileVersions.$inferSelect;
type ProfileRow = typeof priceProfiles.$inferSelect;

/** How many ended versions a profile shows. */
const HISTORY = 20;

/** Today's values or the first ones still to come; archived whatever its dates (ADR-0160). */
export const PROFILE_STATUSES = ['ACTIVE', 'SCHEDULED', 'ARCHIVED'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** A list's filter on the supermarket's bulk price today. */
export const PROFILE_BULK_FILTERS = ['WITH', 'WITHOUT'] as const;
export type ProfileBulkFilter = (typeof PROFILE_BULK_FILTERS)[number];

/** A list's filter on whether any product's terms use it today. */
export const PROFILE_USE_FILTERS = ['USED', 'UNUSED'] as const;
export type ProfileUseFilter = (typeof PROFILE_USE_FILTERS)[number];

/** A profile version: its values from `validFrom` up to (not including) `validTo`. */
export interface PriceProfileVersion extends PriceProfileValues {
  id: number;
  validFrom: string;
  validTo: string | null;
}

export interface PriceProfile {
  id: number;
  name: string;
  archivedAt: Date | null;
  status: ProfileStatus;
  /** The version in force today; null when the first one starts later. */
  current: PriceProfileVersion | null;
  /** Versions starting after today, earliest first. */
  scheduled: PriceProfileVersion[];
  /** Ended versions, latest first. */
  history: PriceProfileVersion[];
  /** Products whose price terms in force today use the profile. */
  productsToday: number;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceProfileQuery {
  /** true: archived profiles only; false or absent: live ones. */
  archived?: boolean;
  q?: string;
  /** Narrows further; ARCHIVED is the same as `archived`. */
  status?: ProfileStatus;
  rounding?: PriceRounding;
  bulk?: ProfileBulkFilter;
  used?: ProfileUseFilter;
  cursor?: string;
  limit?: number;
}

export interface NewPriceProfile {
  name: string;
  /** The first version starts this Ulaanbaatar day (today or later). */
  validFrom: string;
  values: PriceProfileValues;
}

/** A profile as the price sheet import reads it (ADR-0054). */
export interface ImportProfile {
  id: number;
  name: string;
  /** `nameKey(name)`: live names never repeat. */
  nameKey: string;
  archived: boolean;
  /** The start of its first version that applied; null without one. */
  firstFrom: string | null;
  /** Its values today; null without. */
  current: PriceProfileValues | null;
}

/** A profile row locked for a product's price terms (ADR-0048 #2). */
export interface LockedProfile {
  id: number;
  archivedAt: Date | null;
  /** The start of its first version that applied; null without one. */
  firstFrom: string | null;
}

/**
 * Price profiles (ADR-0048 #1): named rules that derive a product's loose, supermarket and
 * supermarket bulk prices from its warehouse price. Values live in dated versions changed like
 * prices (from today on, history kept); only admins (`pricing.manage`) change them. A profile in
 * use cannot be archived or deleted, and an archived one cannot be chosen; it can be brought back,
 * and a deleted one leaves every list while old price terms keep its name (ADR-0160).
 */
@Injectable()
export class PriceProfilesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  async list(
    query: PriceProfileQuery,
  ): Promise<{ data: PriceProfile[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const today = businessDate();
    const archived = query.archived === true || query.status === 'ARCHIVED';
    const filters: (SQL | undefined)[] = [
      isNull(priceProfiles.deletedAt),
      archived ? isNotNull(priceProfiles.archivedAt) : isNull(priceProfiles.archivedAt),
    ];
    const name = query.q?.trim();
    if (name) filters.push(ilike(priceProfiles.name, `%${name.replace(/[\\%_]/g, '\\$&')}%`));
    if (query.status === 'ACTIVE') filters.push(versionToday(today));
    if (query.status === 'SCHEDULED') filters.push(sql`NOT ${versionToday(today)}`);
    if (query.rounding) filters.push(versionToday(today, sql`v.rounding = ${query.rounding}`));
    if (query.bulk) {
      filters.push(
        versionToday(
          today,
          query.bulk === 'WITH'
            ? sql`v.retail_bulk_min_qty IS NOT NULL`
            : sql`v.retail_bulk_min_qty IS NULL`,
        ),
      );
    }
    if (query.used) {
      const used = sql`EXISTS (SELECT 1 FROM product_prices x
        WHERE x.profile_id = price_profiles.id AND x.valid_from <= ${today}::date
          AND (x.valid_to IS NULL OR x.valid_to > ${today}::date))`;
      filters.push(query.used === 'USED' ? used : sql`NOT ${used}`);
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(gt(priceProfiles.id, after.id));
    const rows = await this.db
      .select()
      .from(priceProfiles)
      .where(and(...filters))
      .orderBy(asc(priceProfiles.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data, this.db), nextCursor: page.nextCursor };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<PriceProfile> {
    const [row] = await executor
      .select()
      .from(priceProfiles)
      .where(and(eq(priceProfiles.id, id), isNull(priceProfiles.deletedAt)));
    if (!row) throw notFound('price profile', id);
    const [view] = await this.views([row], executor);
    if (!view) throw notFound('price profile', id);
    return view;
  }

  async create(actor: Actor, input: NewPriceProfile): Promise<PriceProfile> {
    const name = checkedName(input.name);
    assertNotPast('validFrom', input.validFrom);
    checkValues(input.values);
    const id = await inTransaction(this.db, async (tx) => {
      const [profile] = await tx
        .insert(priceProfiles)
        .values({ name, nameKey: nameKey(name), createdBy: actorUserId(actor) })
        .returning();
      if (!profile) throw new Error('price profile insert returned no row');
      await tx.insert(priceProfileVersions).values({
        profileId: profile.id,
        ...columnsOf(input.values),
        validFrom: input.validFrom,
        createdBy: actorUserId(actor),
      });
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'price_profiles',
        entityId: profile.id,
        after: { name, validFrom: input.validFrom, values: auditValues(input.values) },
      });
      return profile.id;
    });
    return this.get(id);
  }

  async rename(actor: Actor, id: number, rawName: string): Promise<PriceProfile> {
    const name = checkedName(rawName);
    await inTransaction(this.db, async (tx) => {
      await this.renameInTx(tx, actor, await this.lockForUpdate(tx, id), name);
    });
    return this.get(id);
  }

  /**
   * «Засах» (ADR-0160): its name and new values from a day on, in one transaction. Values equal to
   * those in force that day leave the versions as they are, so a rename alone writes one change.
   */
  async update(
    actor: Actor,
    id: number,
    input: { name: string; validFrom: string; values: PriceProfileValues },
  ): Promise<PriceProfile> {
    const name = checkedName(input.name);
    assertNotPast('validFrom', input.validFrom);
    checkValues(input.values);
    await inTransaction(this.db, async (tx) => {
      const profile = await this.lockForUpdate(tx, id);
      if (profile.archivedAt) throw archivedError(id);
      await this.renameInTx(tx, actor, profile, name);
      await this.setVersionInTx(tx, actor, id, input);
    });
    return this.get(id);
  }

  private async renameInTx(tx: Tx, actor: Actor, profile: ProfileRow, name: string): Promise<void> {
    if (profile.name === name) return;
    await tx
      .update(priceProfiles)
      .set({ name, nameKey: nameKey(name), updatedAt: sql`now()` })
      .where(eq(priceProfiles.id, profile.id));
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'price_profiles',
      entityId: profile.id,
      before: { name: profile.name },
      after: { name },
    });
  }

  /**
   * New values from a day on (today or later) for every product using the profile (ADR-0048 #1):
   * the version in force that day is closed and the new one runs up to the next planned change.
   * Values equal to those in force change nothing.
   */
  async setVersion(
    actor: Actor,
    id: number,
    input: { validFrom: string; values: PriceProfileValues },
  ): Promise<PriceProfile> {
    assertNotPast('validFrom', input.validFrom);
    checkValues(input.values);
    await inTransaction(this.db, async (tx) => {
      const profile = await this.lockForUpdate(tx, id);
      if (profile.archivedAt) throw archivedError(id);
      await this.setVersionInTx(tx, actor, id, input);
    });
    return this.get(id);
  }

  private async setVersionInTx(
    tx: Tx,
    actor: Actor,
    id: number,
    input: { validFrom: string; values: PriceProfileValues },
  ): Promise<void> {
    const rows = await tx
      .select()
      .from(priceProfileVersions)
      .where(eq(priceProfileVersions.profileId, id));
    const plan = planChange(rows, input.validFrom, (row) =>
      sameValues(valuesOf(row), input.values),
    );
    if (!plan) return;
    if (plan.close) {
      await tx
        .update(priceProfileVersions)
        .set({ validTo: input.validFrom })
        .where(eq(priceProfileVersions.id, plan.close.id));
    }
    await tx.insert(priceProfileVersions).values({
      profileId: id,
      ...columnsOf(input.values),
      validFrom: input.validFrom,
      validTo: plan.validTo,
      createdBy: actorUserId(actor),
    });
    await tx
      .update(priceProfiles)
      .set({ updatedAt: sql`now()` })
      .where(eq(priceProfiles.id, id));
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'price_profiles',
      entityId: id,
      before: plan.close ? { values: auditValues(valuesOf(plan.close)) } : null,
      after: { validFrom: input.validFrom, values: auditValues(input.values) },
    });
  }

  /**
   * Hides a profile from the choices (ADR-0048 #1). Refused while any price terms in force today or
   * planned use it (`PRICE_PROFILE_IN_USE`): the row lock keeps a clerk from choosing it meanwhile.
   */
  async archive(actor: Actor, id: number): Promise<PriceProfile> {
    await inTransaction(this.db, async (tx) => {
      const profile = await this.lockForUpdate(tx, id);
      if (profile.archivedAt) return;
      await this.assertNotInUse(tx, id);
      await tx
        .update(priceProfiles)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(priceProfiles.id, id));
      await this.audit.record(tx, actor, {
        action: 'ARCHIVE',
        entity: 'price_profiles',
        entityId: id,
        before: { name: profile.name },
      });
    });
    return this.get(id);
  }

  /** Back among the choices, its values as they were; a live profile of that name refuses it. */
  async restore(actor: Actor, id: number): Promise<PriceProfile> {
    await inTransaction(this.db, async (tx) => {
      const profile = await this.lockForUpdate(tx, id);
      if (!profile.archivedAt) return;
      await tx
        .update(priceProfiles)
        .set({ archivedAt: null, updatedAt: sql`now()` })
        .where(eq(priceProfiles.id, id));
      await this.audit.record(tx, actor, {
        action: 'RESTORE',
        entity: 'price_profiles',
        entityId: id,
        before: { name: profile.name },
      });
    });
    return this.get(id);
  }

  /**
   * Out of every list (ADR-0160), refused while a price uses it as archiving is. The row stays,
   * archived, because earlier price terms point at it and keep its name.
   */
  async remove(actor: Actor, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const profile = await this.lockForUpdate(tx, id);
      await this.assertNotInUse(tx, id);
      await tx
        .update(priceProfiles)
        .set({
          archivedAt: profile.archivedAt ?? sql`now()`,
          deletedAt: sql`now()`,
          deletedBy: actorUserId(actor),
          updatedAt: sql`now()`,
        })
        .where(eq(priceProfiles.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'price_profiles',
        entityId: id,
        before: { name: profile.name },
      });
    });
  }

  /** Terms in force today or planned hold the profile (`PRICE_PROFILE_IN_USE`). */
  private async assertNotInUse(tx: Tx, id: number): Promise<void> {
    const today = businessDate();
    const [usage] = await tx
      .select({ value: count() })
      .from(productPrices)
      .where(
        and(
          eq(productPrices.profileId, id),
          or(isNull(productPrices.validTo), gt(productPrices.validTo, today)),
          or(isNull(productPrices.validTo), gt(productPrices.validTo, productPrices.validFrom)),
        ),
      );
    const inUse = usage?.value ?? 0;
    if (inUse > 0) {
      throw new AppError('PRICE_PROFILE_IN_USE', 'products still use this price profile', {
        count: inUse,
      });
    }
  }

  /** Each profile's values in force on a date (profiles without a version then are left out). */
  async versionsInForce(
    profileIds: readonly number[],
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<Map<number, PriceProfileValues>> {
    if (profileIds.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(priceProfileVersions)
      .where(
        and(
          inArray(priceProfileVersions.profileId, [...new Set(profileIds)]),
          lte(priceProfileVersions.validFrom, date),
          or(
            isNull(priceProfileVersions.validTo),
            gt(priceProfileVersions.validTo, sql`${date}::date`),
          ),
        ),
      );
    return new Map(rows.map((row) => [row.profileId, valuesOf(row)]));
  }

  /**
   * Locks a profile FOR SHARE while a product's price terms take it (ADR-0048 #2): archiving waits,
   * and the terms see whether it is archived and when its first version starts.
   */
  async lockForPricesInTx(tx: Tx, id: number): Promise<LockedProfile> {
    const [profile] = await tx
      .select({ id: priceProfiles.id, archivedAt: priceProfiles.archivedAt })
      .from(priceProfiles)
      .where(eq(priceProfiles.id, id))
      .for('share');
    if (!profile) throw notFound('price profile', id);
    const versions = await tx
      .select({ validFrom: priceProfileVersions.validFrom, validTo: priceProfileVersions.validTo })
      .from(priceProfileVersions)
      .where(eq(priceProfileVersions.profileId, id));
    const starts = versions
      .filter(applied)
      .map((row) => row.validFrom)
      .sort();
    return { ...profile, firstFrom: starts[0] ?? null };
  }

  /**
   * Every profile with its first applied day and its values today, archived ones included: the
   * price sheet import finds profiles by name and lists the live ones in its template (ADR-0054).
   */
  async forImport(executor: Db | Tx = this.db): Promise<ImportProfile[]> {
    const rows = await executor
      .select()
      .from(priceProfiles)
      .where(isNull(priceProfiles.deletedAt))
      .orderBy(asc(priceProfiles.name));
    const versions = (await executor.select().from(priceProfileVersions)).filter(applied);
    const today = businessDate();
    return rows.map((row) => {
      const own = versions.filter((version) => version.profileId === row.id);
      const current = own.find((version) => inForceOn(version, today));
      return {
        id: row.id,
        name: row.name,
        nameKey: row.nameKey,
        archived: row.archivedAt !== null,
        firstFrom:
          own
            .map((version) => version.validFrom)
            .sort()
            .at(0) ?? null,
        current: current ? valuesOf(current) : null,
      };
    });
  }

  /** Names of profiles by id, archived ones included (price terms keep theirs). */
  async namesOf(ids: readonly number[], executor: Db | Tx = this.db): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({ id: priceProfiles.id, name: priceProfiles.name })
      .from(priceProfiles)
      .where(inArray(priceProfiles.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async lockForUpdate(tx: Tx, id: number): Promise<ProfileRow> {
    const [profile] = await tx
      .select()
      .from(priceProfiles)
      .where(and(eq(priceProfiles.id, id), isNull(priceProfiles.deletedAt)))
      .for('update');
    if (!profile) throw notFound('price profile', id);
    return profile;
  }

  private async views(rows: readonly ProfileRow[], executor: Db | Tx): Promise<PriceProfile[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const today = businessDate();
    const versions = (
      await executor
        .select()
        .from(priceProfileVersions)
        .where(inArray(priceProfileVersions.profileId, ids))
        .orderBy(asc(priceProfileVersions.validFrom), asc(priceProfileVersions.id))
    ).filter(applied);
    const usage = await executor
      .select({ profileId: productPrices.profileId, value: count() })
      .from(productPrices)
      .where(
        and(
          inArray(productPrices.profileId, ids),
          lte(productPrices.validFrom, today),
          or(isNull(productPrices.validTo), gt(productPrices.validTo, sql`${today}::date`)),
        ),
      )
      .groupBy(productPrices.profileId);
    const usedBy = new Map(usage.map((row) => [row.profileId, row.value]));
    const authors = await this.names.namesOf(
      [...new Set(rows.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])))],
      executor,
    );
    return rows.map((row) => {
      const own = versions.filter((version) => version.profileId === row.id);
      const current = own.find((version) => inForceOn(version, today));
      return {
        id: row.id,
        name: row.name,
        archivedAt: row.archivedAt,
        status: row.archivedAt ? 'ARCHIVED' : current ? 'ACTIVE' : 'SCHEDULED',
        current: current ? versionOf(current) : null,
        scheduled: own.filter((version) => version.validFrom > today).map(versionOf),
        history: own
          .filter((version) => version.validTo !== null && version.validTo <= today)
          .reverse()
          .slice(0, HISTORY)
          .map(versionOf),
        productsToday: usedBy.get(row.id) ?? 0,
        createdByName: row.createdBy === null ? null : (authors.get(row.createdBy) ?? null),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}

/** A version of the profile in force today, optionally with a condition on it as `v`. */
function versionToday(today: string, also?: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM price_profile_versions v
    WHERE v.profile_id = price_profiles.id AND v.valid_from <= ${today}::date
      AND (v.valid_to IS NULL OR v.valid_to > ${today}::date)
      AND (v.valid_to IS NULL OR v.valid_to > v.valid_from)${also ? sql` AND ${also}` : sql``})`;
}

function checkedName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_PRICE_PROFILE_NAME) {
    throw invalid('name', 'length', `1 to ${MAX_PRICE_PROFILE_NAME} characters`);
  }
  return name;
}

function checkValues(values: PriceProfileValues): void {
  const issue = priceProfileIssue(values);
  if (issue) throw invalid(issue.field, issue.issue, `price profile: ${issue.issue}`);
}

function archivedError(id: number): AppError {
  return new AppError('PRICE_PROFILE_ARCHIVED', 'the price profile is archived', { id });
}

export function assertLive(profile: { id: number; archivedAt: Date | null }): void {
  if (profile.archivedAt) throw archivedError(profile.id);
}

function valuesOf(row: VersionRow): PriceProfileValues {
  return {
    looseMarkupPct: row.looseMarkupPct,
    retailMarkupPct: row.retailMarkupPct,
    retailBulkMinQty: row.retailBulkMinQty,
    retailBulkMarkupPct: row.retailBulkMarkupPct,
    rounding: row.rounding,
  };
}

function versionOf(row: VersionRow): PriceProfileVersion {
  return { id: row.id, validFrom: row.validFrom, validTo: row.validTo, ...valuesOf(row) };
}

function columnsOf(values: PriceProfileValues) {
  return {
    looseMarkupPct: values.looseMarkupPct,
    retailMarkupPct: values.retailMarkupPct,
    retailBulkMinQty: values.retailBulkMinQty,
    retailBulkMarkupPct: values.retailBulkMarkupPct,
    rounding: values.rounding,
  };
}

const sameDecimal = (a: Decimal | null, b: Decimal | null) =>
  a === null || b === null ? a === b : a.eq(b);

function sameValues(a: PriceProfileValues, b: PriceProfileValues): boolean {
  return (
    a.looseMarkupPct.eq(b.looseMarkupPct) &&
    a.retailMarkupPct.eq(b.retailMarkupPct) &&
    sameDecimal(a.retailBulkMinQty, b.retailBulkMinQty) &&
    sameDecimal(a.retailBulkMarkupPct, b.retailBulkMarkupPct) &&
    a.rounding === b.rounding
  );
}

function auditValues(values: PriceProfileValues): Record<string, string | null> {
  return {
    looseMarkupPct: values.looseMarkupPct.toFixed(2),
    retailMarkupPct: values.retailMarkupPct.toFixed(2),
    retailBulkMinQty: values.retailBulkMinQty?.toString() ?? null,
    retailBulkMarkupPct: values.retailBulkMarkupPct?.toFixed(2) ?? null,
    rounding: values.rounding,
  };
}
