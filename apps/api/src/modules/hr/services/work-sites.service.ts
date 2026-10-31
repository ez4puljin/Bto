import { Inject, Injectable } from '@nestjs/common';
import { type Coordinates, isInMongolia } from '@tugeel/shared/geo';
import { HR_LIMITS } from '@tugeel/shared/hr';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, OrgService } from '../../identity';
import { hrWorkSites } from '../schema';

export const ATTENDANCE_MANAGE = 'hr.attendance.manage';
export const ATTENDANCE_VIEW = 'hr.attendance.view';

export interface WorkSite {
  id: number;
  name: string;
  lat: string;
  lng: string;
  radiusM: number;
  branchId: number | null;
  branchName: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface WorkSiteInput {
  name: string;
  lat: string;
  lng: string;
  radiusM: number;
  branchId: number | null;
}

/**
 * The work sites (ADR-0131 #1): named points with a radius, kept by HR. A site is archived, never
 * deleted: the punches made inside it keep pointing at it.
 */
@Injectable()
export class WorkSitesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
  ) {}

  async list(includeArchived = false, executor: Db | Tx = this.db): Promise<WorkSite[]> {
    const rows = await executor
      .select()
      .from(hrWorkSites)
      .where(includeArchived ? undefined : isNull(hrWorkSites.archivedAt))
      .orderBy(asc(hrWorkSites.name), asc(hrWorkSites.id));
    const branches = await this.org.listBranches();
    const names = new Map(branches.map((branch) => [branch.id, branch.name]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: row.lat.toString(),
      lng: row.lng.toString(),
      radiusM: row.radiusM,
      branchId: row.branchId,
      branchName: row.branchId === null ? null : (names.get(row.branchId) ?? null),
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
    }));
  }

  /** The active sites, as coordinates for the geofence. */
  async active(
    executor: Db | Tx = this.db,
  ): Promise<(Coordinates & { id: number; name: string; radiusM: number })[]> {
    const rows = await executor
      .select({
        id: hrWorkSites.id,
        name: hrWorkSites.name,
        lat: hrWorkSites.lat,
        lng: hrWorkSites.lng,
        radiusM: hrWorkSites.radiusM,
      })
      .from(hrWorkSites)
      .where(isNull(hrWorkSites.archivedAt))
      .orderBy(asc(hrWorkSites.name), asc(hrWorkSites.id));
    return rows.map((row) => ({ ...row, lat: row.lat.toString(), lng: row.lng.toString() }));
  }

  async create(ctx: AuthContext, input: WorkSiteInput): Promise<WorkSite> {
    this.assertManage(ctx);
    const values = await this.checked(input);
    return inTransaction(this.db, async (tx) => {
      await this.assertNameFree(tx, values.name, null);
      const [row] = await tx
        .insert(hrWorkSites)
        .values({
          name: values.name,
          lat: new Decimal(values.lat),
          lng: new Decimal(values.lng),
          radiusM: values.radiusM,
          branchId: values.branchId,
        })
        .returning({ id: hrWorkSites.id });
      if (!row) throw new Error('work site insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'hr_work_site',
        entityId: row.id,
        after: values,
      });
      return this.one(tx, row.id);
    });
  }

  async update(ctx: AuthContext, id: number, input: WorkSiteInput): Promise<WorkSite> {
    this.assertManage(ctx);
    const values = await this.checked(input);
    return inTransaction(this.db, async (tx) => {
      const before = await this.one(tx, id);
      await this.assertNameFree(tx, values.name, id);
      await tx
        .update(hrWorkSites)
        .set({
          name: values.name,
          lat: new Decimal(values.lat),
          lng: new Decimal(values.lng),
          radiusM: values.radiusM,
          branchId: values.branchId,
          updatedAt: sql`now()`,
        })
        .where(eq(hrWorkSites.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_work_site',
        entityId: id,
        before: {
          name: before.name,
          lat: before.lat,
          lng: before.lng,
          radiusM: before.radiusM,
          branchId: before.branchId,
        },
        after: values,
      });
      return this.one(tx, id);
    });
  }

  /** Archives (or restores) a site; its punches stay. */
  async setArchived(ctx: AuthContext, id: number, archived: boolean): Promise<WorkSite> {
    this.assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const before = await this.one(tx, id);
      if ((before.archivedAt !== null) === archived) return before;
      if (!archived) await this.assertNameFree(tx, before.name, id);
      await tx
        .update(hrWorkSites)
        .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(hrWorkSites.id, id));
      await this.audit.record(tx, ctx, {
        action: archived ? 'ARCHIVE' : 'RESTORE',
        entity: 'hr_work_site',
        entityId: id,
      });
      return this.one(tx, id);
    });
  }

  private async one(executor: Db | Tx, id: number): Promise<WorkSite> {
    const site = (await this.list(true, executor)).find((row) => row.id === id);
    if (!site) throw notFound('work site', id);
    return site;
  }

  private assertManage(ctx: AuthContext): void {
    if (!ctx.permissions.has(ATTENDANCE_MANAGE)) {
      throw new AppError('FORBIDDEN', `the work sites need ${ATTENDANCE_MANAGE}`, {
        permission: ATTENDANCE_MANAGE,
      });
    }
  }

  private async checked(input: WorkSiteInput): Promise<WorkSiteInput> {
    const name = input.name.trim();
    if (name.length === 0) throw invalid('name', 'isNotEmpty', 'a site needs a name');
    if ([...name].length > HR_LIMITS.maxSiteName) {
      throw invalid(
        'name',
        'maxLength',
        `a site's name has at most ${HR_LIMITS.maxSiteName} characters`,
      );
    }
    const lat = new Decimal(input.lat).toDecimalPlaces(6).toString();
    const lng = new Decimal(input.lng).toDecimalPlaces(6).toString();
    if (!isInMongolia(lat, lng))
      throw invalid('lat', 'inMongolia', 'the point lies outside Mongolia');
    if (
      !Number.isInteger(input.radiusM) ||
      input.radiusM < HR_LIMITS.minRadiusM ||
      input.radiusM > HR_LIMITS.maxRadiusM
    ) {
      throw invalid(
        'radiusM',
        'range',
        `the radius is ${HR_LIMITS.minRadiusM}–${HR_LIMITS.maxRadiusM} m`,
      );
    }
    if (input.branchId !== null) {
      const branches = await this.org.listBranches();
      if (!branches.some((branch) => branch.id === input.branchId)) {
        throw invalid('branchId', 'exists', `branch ${input.branchId} not found`);
      }
    }
    return { name, lat, lng, radiusM: input.radiusM, branchId: input.branchId };
  }

  private async assertNameFree(tx: Tx, name: string, exceptId: number | null): Promise<void> {
    const [taken] = await tx
      .select({ id: hrWorkSites.id })
      .from(hrWorkSites)
      .where(
        and(
          isNull(hrWorkSites.archivedAt),
          sql`lower(${hrWorkSites.name}) = lower(${name})`,
          exceptId === null ? undefined : sql`${hrWorkSites.id} <> ${exceptId}`,
        ),
      )
      .limit(1);
    if (taken) throw invalid('name', 'unique', `a site named ${name} exists`);
  }
}
