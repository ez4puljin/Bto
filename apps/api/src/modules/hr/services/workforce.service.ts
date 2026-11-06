import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  checkScheduleDays,
  DEFAULT_REQUEST_TYPES,
  type EducationLevel,
  EMPLOYEE_GENDERS,
  type EmployeeGender,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  ENGAGEMENT_LIMITS,
  isEmployeeLeft,
  type JobLevel,
  LEFT_REASON_KINDS,
  type LeftReasonKind,
  type MaritalStatus,
  SCHEDULE_KINDS,
  type ScheduleDay,
  type ScheduleKind,
  WORKFORCE_LIMITS,
} from '@tugeel/shared/hr';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, asc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  type AuditActor,
  type AuthContext,
  actorUserId,
  AuditService,
  StaffAccountsService,
  StorageService,
} from '../../identity';
import {
  hrDivisions,
  hrEmployeeChildren,
  hrEmployees,
  hrRequestTypes,
  hrSchedules,
} from '../schema';
import { HrSettingsService } from './hr-settings.service';
import { ATTENDANCE_MANAGE } from './work-sites.service';

const MANAGE_ACCOUNTS = 'identity.users.manage';

export interface Division {
  id: number;
  name: string;
  sort: number;
  archivedAt: Date | null;
  employeeCount: number;
}

export interface WorkSchedule {
  id: number;
  name: string;
  kind: ScheduleKind;
  color: string;
  days: ScheduleDay[];
  archivedAt: Date | null;
  userIds: number[];
}

/** An employee as «Ажилтан» lists it (ADR-0144). */
export interface EmployeeRow {
  userId: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  roles: string[];
  position: string | null;
  divisionId: number | null;
  divisionName: string | null;
  employmentType: EmploymentType;
  gender: EmployeeGender | null;
  employedOn: string | null;
  leftOn: string | null;
  leftReason: string | null;
  photoUrl: string | null;
  scheduleId: number | null;
  scheduleName: string | null;
  tracked: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  passwordSet: boolean;
  birthDate: string | null;
  education: EducationLevel | null;
  maritalStatus: MaritalStatus | null;
  district: string | null;
  jobLevel: JobLevel | null;
  leftReasonKind: LeftReasonKind | null;
  children: EmployeeChild[];
}

export interface EmployeeChild {
  name?: string | null;
  gender?: EmployeeGender | null;
  birthDate: string;
}

/** What an employee keeps about themselves, from the staff app or through HR (ADR-0146 #4). */
export interface EmployeeProfile {
  birthDate: string | null;
  gender: EmployeeGender | null;
  education: EducationLevel | null;
  maritalStatus: MaritalStatus | null;
  district: string | null;
  children: EmployeeChild[];
}

export interface EmployeeProfileInput {
  birthDate?: string | null;
  gender?: EmployeeGender | null;
  education?: EducationLevel | null;
  maritalStatus?: MaritalStatus | null;
  district?: string | null;
  children: readonly EmployeeChild[];
}

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  phone: string;
  position: string | null;
  divisionId: number | null;
  employmentType: EmploymentType;
  gender: EmployeeGender | null;
  employedOn: string | null;
  scheduleId: number | null;
  /** The first password, only when registering (a new one: `resetPassword`); never echoed. */
  password: string | null;
}

/** One record of an import (timely, ADR-0144). */
export interface ImportedEmployee extends Omit<EmployeeInput, 'divisionId' | 'scheduleId'> {
  externalRef: string;
  division: string | null;
  photo: { contentType: string; bytes: Buffer } | null;
}

type Card = Omit<EmployeeInput, 'phone' | 'password'> & { firstName: string; lastName: string };

const clean = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text === '' ? null : text;
};

/** «Тестийн Болд»: the family name, then the given name, as Mongolian lists read. */
export const employeeFullName = (firstName: string, lastName: string): string =>
  `${lastName} ${firstName}`.trim();

/**
 * HR's records beyond the punch (ADR-0144, after timely.mn): divisions, the employee card — a
 * staff user signing in by phone with a name, position, division, kind of employment, dates and
 * photo — the schedules and who follows which, and the request types. HR (`hr.attendance.manage`)
 * writes; `hr.attendance.view` reads. The account's password and sign-in follow one rule (ADR-0145):
 * whoever lacks `identity.users.manage` gives a password only to an account without roles and
 * touches an admin's sign-in not at all, so HR cannot become anybody with more rights.
 */
@Injectable()
export class WorkforceService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly accounts: StaffAccountsService,
    private readonly storage: StorageService,
    private readonly settings: HrSettingsService,
  ) {}

  /** A new database gets timely's request types. */
  async onApplicationBootstrap(): Promise<void> {
    const [any] = await this.db.select({ id: hrRequestTypes.id }).from(hrRequestTypes).limit(1);
    if (any) return;
    await this.db
      .insert(hrRequestTypes)
      .values(DEFAULT_REQUEST_TYPES.map((type, sort) => ({ ...type, sort })))
      .onConflictDoNothing();
  }

  // ── divisions ──────────────────────────────────────────────────────────────

  async divisions(includeArchived = false): Promise<Division[]> {
    const rows = await this.db
      .select()
      .from(hrDivisions)
      .where(includeArchived ? undefined : isNull(hrDivisions.archivedAt))
      .orderBy(asc(hrDivisions.sort), asc(hrDivisions.name));
    const counts = await this.db
      .select({ divisionId: hrEmployees.divisionId, count: sql<number>`count(*)::int` })
      .from(hrEmployees)
      .where(isNull(hrEmployees.leftOn))
      .groupBy(hrEmployees.divisionId);
    const countOf = new Map(counts.map((row) => [row.divisionId, row.count]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sort: row.sort,
      archivedAt: row.archivedAt,
      employeeCount: countOf.get(row.id) ?? 0,
    }));
  }

  async saveDivision(
    ctx: AuthContext,
    id: number | null,
    input: { name: string; sort: number },
  ): Promise<Division> {
    this.assertManage(ctx);
    const name = this.name(input.name, 'name', WORKFORCE_LIMITS.maxName);
    const saved = await inTransaction(this.db, async (tx) => {
      await this.assertDivisionNameFree(tx, name, id);
      if (id === null) {
        const [row] = await tx
          .insert(hrDivisions)
          .values({ name, sort: input.sort })
          .returning({ id: hrDivisions.id });
        if (!row) throw new Error('division insert returned no row');
        await this.audit.record(tx, ctx, {
          action: 'CREATE',
          entity: 'hr_division',
          entityId: row.id,
          after: { name },
        });
        return row.id;
      }
      const rows = await tx
        .update(hrDivisions)
        .set({ name, sort: input.sort, updatedAt: sql`now()` })
        .where(eq(hrDivisions.id, id))
        .returning({ id: hrDivisions.id });
      if (rows.length === 0) throw notFound('hr_division', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'hr_division',
        entityId: id,
        after: { name },
      });
      return id;
    });
    return this.division(saved);
  }

  /** Archived only when nobody employed is in it. */
  async archiveDivision(ctx: AuthContext, id: number, archived: boolean): Promise<Division> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      if (archived) {
        const [member] = await tx
          .select({ userId: hrEmployees.userId })
          .from(hrEmployees)
          .where(and(eq(hrEmployees.divisionId, id), isNull(hrEmployees.leftOn)))
          .limit(1);
        if (member) throw new AppError('IN_USE', 'employees are in the division', { id });
      }
      const rows = await tx
        .update(hrDivisions)
        .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(hrDivisions.id, id))
        .returning({ id: hrDivisions.id });
      if (rows.length === 0) throw notFound('hr_division', id);
      await this.audit.record(tx, ctx, {
        action: archived ? 'ARCHIVE' : 'RESTORE',
        entity: 'hr_division',
        entityId: id,
      });
    });
    return this.division(id);
  }

  private async division(id: number): Promise<Division> {
    const found = (await this.divisions(true)).find((row) => row.id === id);
    if (!found) throw notFound('hr_division', id);
    return found;
  }

  // ── employees ──────────────────────────────────────────────────────────────

  /** Every staff record with its card; the ones who left last. */
  async employees(): Promise<EmployeeRow[]> {
    const [people, divisions, schedules, children] = await Promise.all([
      this.settings.employees(),
      this.db.select({ id: hrDivisions.id, name: hrDivisions.name }).from(hrDivisions),
      this.db.select({ id: hrSchedules.id, name: hrSchedules.name }).from(hrSchedules),
      this.db
        .select({
          userId: hrEmployeeChildren.userId,
          name: hrEmployeeChildren.name,
          gender: hrEmployeeChildren.gender,
          birthDate: hrEmployeeChildren.birthDate,
        })
        .from(hrEmployeeChildren),
    ]);
    const childrenOf = new Map<number, EmployeeChild[]>();
    for (const { userId, ...child } of children) {
      childrenOf.set(userId, [...(childrenOf.get(userId) ?? []), child]);
    }
    const photoIds = people.flatMap((person) =>
      person.photoFileId === null ? [] : [person.photoFileId],
    );
    const photos = await this.storage.publicUrls(photoIds);
    const divisionName = new Map(divisions.map((row) => [row.id, row.name]));
    const scheduleName = new Map(schedules.map((row) => [row.id, row.name]));
    return people
      .map((person): EmployeeRow => ({
        userId: person.userId,
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: person.phone,
        status: person.status,
        roles: person.roles,
        position: person.position,
        divisionId: person.divisionId,
        divisionName:
          person.divisionId === null ? null : (divisionName.get(person.divisionId) ?? null),
        employmentType: person.employmentType,
        gender: person.gender,
        employedOn: person.employedOn,
        leftOn: person.leftOn,
        leftReason: person.leftReason,
        photoUrl: person.photoFileId === null ? null : (photos.get(person.photoFileId) ?? null),
        scheduleId: person.scheduleId,
        scheduleName:
          person.scheduleId === null ? null : (scheduleName.get(person.scheduleId) ?? null),
        tracked: person.tracked,
        lastLoginAt: person.lastLoginAt,
        lockedUntil: person.lockedUntil,
        passwordSet: person.passwordSet,
        birthDate: person.birthDate,
        education: person.education,
        maritalStatus: person.maritalStatus,
        district: person.district,
        jobLevel: person.jobLevel,
        leftReasonKind: person.leftReasonKind,
        children: childrenOf.get(person.userId) ?? [],
      }))
      .sort(
        (a, b) =>
          (isEmployeeLeft(a) ? 1 : 0) - (isEmployeeLeft(b) ? 1 : 0) ||
          (a.firstName ?? a.fullName).localeCompare(b.firstName ?? b.fullName, 'mn'),
      );
  }

  async employee(userId: number): Promise<EmployeeRow> {
    const found = (await this.employees()).find((row) => row.userId === userId);
    if (!found) throw notFound('user', userId);
    return found;
  }

  /**
   * Registers an employee: a new staff user signing in by phone and password, and the card. A phone
   * already in the list is refused: the one list holds everybody, nobody is registered twice.
   */
  async create(ctx: AuthContext, input: EmployeeInput): Promise<EmployeeRow> {
    this.assertManage(ctx);
    const card = this.checkedCard(input);
    if (input.password === null)
      throw invalid('password', 'required', 'a first password is needed');
    const userId = await inTransaction(this.db, async (tx) => {
      await this.assertRefs(tx, card.divisionId, card.scheduleId);
      await this.accounts.assertPhoneFree(tx, input.phone);
      const { userId: id } = await this.accounts.ensure(tx, ctx, {
        fullName: employeeFullName(card.firstName, card.lastName),
        phone: input.phone,
        password: input.password,
      });
      await this.writeCard(tx, ctx, id, card, null);
      return id;
    });
    return this.employee(userId);
  }

  async update(ctx: AuthContext, userId: number, input: EmployeeInput): Promise<EmployeeRow> {
    this.assertManage(ctx);
    if (input.password !== null) {
      throw invalid('password', 'notHere', 'a new password goes through resetPassword');
    }
    const card = this.checkedCard(input);
    await inTransaction(this.db, async (tx) => {
      await this.assertRefs(tx, card.divisionId, card.scheduleId);
      await this.accounts.rename(
        tx,
        ctx,
        userId,
        { fullName: employeeFullName(card.firstName, card.lastName), phone: input.phone },
        ctx.permissions.has(MANAGE_ACCOUNTS),
      );
      await this.writeCard(tx, ctx, userId, card, null);
    });
    return this.employee(userId);
  }

  /**
   * The password reset directly (owner 2026-11-05, ADR-0145): the old one stops working, the
   * lock-out is cleared and the account's other sessions end. An account holding roles needs
   * `identity.users.manage`, or HR could sign in as anybody.
   */
  async resetPassword(ctx: AuthContext, userId: number, password: string): Promise<EmployeeRow> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      if (!ctx.permissions.has(MANAGE_ACCOUNTS)) {
        const held = await this.accounts.heldRoles(tx, userId);
        if (held.any) this.refuseAccount();
      }
      await this.accounts.setPassword(tx, ctx, userId, password, ctx.sessionId);
    });
    return this.employee(userId);
  }

  /** «Ажлаас гарсан»: the date and reason; the account is disabled. Coming back clears them. */
  async setLeft(
    ctx: AuthContext,
    userId: number,
    input: { leftOn: string | null; reason: string | null; reasonKind?: LeftReasonKind | null },
  ): Promise<EmployeeRow> {
    this.assertManage(ctx);
    if (input.leftOn !== null && !isIsoDate(input.leftOn)) {
      throw invalid('leftOn', 'isDate', 'YYYY-MM-DD');
    }
    if (userId === ctx.userId) {
      throw new AppError('SELF_EDIT_FORBIDDEN', 'HR cannot mark themselves as left', {
        id: userId,
      });
    }
    const reason = input.leftOn === null ? null : clean(input.reason);
    const reasonKind = input.leftOn === null ? null : (input.reasonKind ?? null);
    if (reasonKind !== null && !LEFT_REASON_KINDS.includes(reasonKind)) {
      throw invalid('reasonKind', 'enum', LEFT_REASON_KINDS.join(', '));
    }
    await inTransaction(this.db, async (tx) => {
      if (!ctx.permissions.has(MANAGE_ACCOUNTS)) {
        const held = await this.accounts.heldRoles(tx, userId);
        if (held.admin) this.refuseAccount();
      }
      await tx
        .insert(hrEmployees)
        .values({ userId, leftOn: input.leftOn, leftReason: reason, leftReasonKind: reasonKind })
        .onConflictDoUpdate({
          target: hrEmployees.userId,
          set: {
            leftOn: input.leftOn,
            leftReason: reason,
            leftReasonKind: reasonKind,
            updatedBy: actorUserId(ctx),
            updatedAt: sql`now()`,
          },
        });
      await this.accounts.setActive(tx, ctx, userId, input.leftOn === null);
      await this.audit.record(tx, ctx, {
        action: input.leftOn ? 'LEFT' : 'RETURNED',
        entity: 'hr_employee',
        entityId: userId,
        after: { leftOn: input.leftOn, reason },
      });
    });
    return this.employee(userId);
  }

  /** An employee's own details (ADR-0146 #4); never rights, the card's names or the phone. */
  async profile(userId: number): Promise<EmployeeProfile> {
    const [card] = await this.db.select().from(hrEmployees).where(eq(hrEmployees.userId, userId));
    const children = await this.db
      .select({
        name: hrEmployeeChildren.name,
        gender: hrEmployeeChildren.gender,
        birthDate: hrEmployeeChildren.birthDate,
      })
      .from(hrEmployeeChildren)
      .where(eq(hrEmployeeChildren.userId, userId))
      .orderBy(asc(hrEmployeeChildren.birthDate));
    return {
      birthDate: card?.birthDate ?? null,
      gender: card?.gender ?? null,
      education: card?.education ?? null,
      maritalStatus: card?.maritalStatus ?? null,
      district: card?.district ?? null,
      children,
    };
  }

  async saveProfile(
    actor: AuthContext,
    userId: number,
    input: EmployeeProfileInput,
  ): Promise<EmployeeProfile> {
    await this.writeDetails(actor, userId, input, {});
    return this.profile(userId);
  }

  /** HR writes the same details, and the level that only HR gives. */
  async saveDetails(
    ctx: AuthContext,
    userId: number,
    input: EmployeeProfileInput & { jobLevel?: JobLevel | null },
  ): Promise<EmployeeRow> {
    this.assertManage(ctx);
    await this.writeDetails(ctx, userId, input, { jobLevel: input.jobLevel ?? null });
    return this.employee(userId);
  }

  private async writeDetails(
    actor: AuthContext,
    userId: number,
    input: EmployeeProfileInput,
    extra: { jobLevel?: JobLevel | null },
  ): Promise<void> {
    const today = businessDate();
    const checkDate = (field: string, value: string | null | undefined) => {
      if (value === null || value === undefined) return;
      if (!isIsoDate(value)) throw invalid(field, 'isDate', 'YYYY-MM-DD');
      if (value > today) throw invalid(field, 'notFuture', 'not in the future');
    };
    checkDate('birthDate', input.birthDate);
    for (const child of input.children) checkDate('children.birthDate', child.birthDate);
    if (input.children.length > ENGAGEMENT_LIMITS.maxChildren) {
      throw invalid('children', 'arrayMaxSize', `at most ${ENGAGEMENT_LIMITS.maxChildren}`);
    }
    const values = {
      birthDate: input.birthDate ?? null,
      gender: input.gender ?? null,
      education: input.education ?? null,
      maritalStatus: input.maritalStatus ?? null,
      district: clean(input.district),
      ...extra,
      updatedBy: actorUserId(actor),
    };
    await inTransaction(this.db, async (tx) => {
      await tx
        .insert(hrEmployees)
        .values({ userId, ...values })
        .onConflictDoUpdate({
          target: hrEmployees.userId,
          set: { ...values, updatedAt: sql`now()` },
        });
      await tx.delete(hrEmployeeChildren).where(eq(hrEmployeeChildren.userId, userId));
      if (input.children.length > 0) {
        await tx.insert(hrEmployeeChildren).values(
          input.children.map((child) => ({
            userId,
            name: clean(child.name),
            gender: child.gender ?? null,
            birthDate: child.birthDate,
          })),
        );
      }
      // The dates of birth stay out of the audit: only that the details were saved.
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'hr_employee',
        entityId: userId,
        after: { details: true, children: input.children.length },
      });
    });
  }

  /** The photo uploaded in the browser (verified before, confirmed inside the transaction). */
  async setPhoto(ctx: AuthContext, userId: number, fileId: number | null): Promise<EmployeeRow> {
    this.assertManage(ctx);
    if (fileId !== null) await this.storage.verifyUploaded(fileId, 'hr.employee_photo');
    await inTransaction(this.db, async (tx) => this.attachPhoto(tx, ctx, userId, fileId));
    return this.employee(userId);
  }

  /**
   * Brings records in from another system (ADR-0144: timely): by `externalRef`, else by phone —
   * the card written over (a schedule HR gave kept), the division made when new, the photo
   * attached when the card has none. Idempotent; returns what it did.
   */
  async importEmployees(
    actor: AuditActor,
    records: readonly ImportedEmployee[],
  ): Promise<{ created: number; updated: number; photos: number; userIds: Map<string, number> }> {
    const result = { created: 0, updated: 0, photos: 0, userIds: new Map<string, number>() };
    for (const record of records) {
      const card = this.checkedCard({ ...record, divisionId: null, scheduleId: null });
      const photo = record.photo
        ? await this.storage.ingest({
            kind: 'hr.employee_photo',
            contentType: record.photo.contentType,
            bytes: record.photo.bytes,
            ownerId: null,
          })
        : null;
      await inTransaction(this.db, async (tx) => {
        const divisionId = record.division ? await this.divisionByName(tx, record.division) : null;
        const [known] = await tx
          .select({ userId: hrEmployees.userId })
          .from(hrEmployees)
          .where(eq(hrEmployees.externalRef, record.externalRef));
        const ensured = known
          ? { userId: known.userId, created: false }
          : await this.accounts.ensure(tx, actor, {
              fullName: employeeFullName(card.firstName, card.lastName),
              phone: record.phone,
              password: record.password,
            });
        await this.writeCard(
          tx,
          actor,
          ensured.userId,
          { ...card, divisionId },
          record.externalRef,
        );
        if (photo) {
          const [current] = await tx
            .select({ photoFileId: hrEmployees.photoFileId })
            .from(hrEmployees)
            .where(eq(hrEmployees.userId, ensured.userId));
          if (current?.photoFileId == null) {
            await this.attachPhoto(tx, actor, ensured.userId, photo.id);
            result.photos += 1;
          }
        }
        result.userIds.set(record.externalRef, ensured.userId);
        if (ensured.created) result.created += 1;
        else result.updated += 1;
      });
    }
    return result;
  }

  /**
   * After an import: a schedule nobody follows that repeats a live one of the same name (« (2)»)
   * with the same days is archived (a second import before ADR-0144's fix made such copies).
   */
  async tidyImportedSchedules(actor: AuditActor): Promise<number> {
    const live = await this.schedules();
    let archived = 0;
    for (const copy of live) {
      const base = copy.name.replace(/ \(\d+\)$/, '');
      if (base === copy.name || copy.userIds.length > 0) continue;
      const kept = live.find(
        (other) =>
          other.id !== copy.id &&
          (other.name === base || other.name.replace(/ \(\d+\)$/, '') === base) &&
          other.userIds.length > 0 &&
          canonicalDays(other.days) === canonicalDays(copy.days),
      );
      if (!kept) continue;
      await inTransaction(this.db, async (tx) => {
        await tx
          .update(hrSchedules)
          .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(hrSchedules.id, copy.id));
        await this.audit.record(tx, actor, {
          action: 'ARCHIVE',
          entity: 'hr_schedule',
          entityId: copy.id,
          after: { reason: 'import copy', keptId: kept.id },
        });
      });
      archived += 1;
    }
    return archived;
  }

  /** The divisions of an import, empty ones too (ADR-0144). */
  async importDivisions(names: readonly string[]): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      for (const name of names) await this.divisionByName(tx, name);
    });
  }

  // ── schedules ──────────────────────────────────────────────────────────────

  async schedules(includeArchived = false): Promise<WorkSchedule[]> {
    const rows = await this.db
      .select()
      .from(hrSchedules)
      .where(includeArchived ? undefined : isNull(hrSchedules.archivedAt))
      .orderBy(asc(hrSchedules.name));
    const members = await this.db
      .select({ userId: hrEmployees.userId, scheduleId: hrEmployees.scheduleId })
      .from(hrEmployees)
      .where(and(sql`${hrEmployees.scheduleId} IS NOT NULL`, isNull(hrEmployees.leftOn)));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      days: row.days,
      archivedAt: row.archivedAt,
      userIds: members
        .filter((member) => member.scheduleId === row.id)
        .map((member) => member.userId),
    }));
  }

  /** Saves a schedule and who follows it (the list replaces the old one). */
  async saveSchedule(
    ctx: AuthContext,
    id: number | null,
    input: {
      name: string;
      kind: ScheduleKind;
      color: string;
      days: ScheduleDay[];
      userIds: number[];
    },
  ): Promise<WorkSchedule> {
    this.assertManage(ctx);
    const name = this.name(input.name, 'name', WORKFORCE_LIMITS.maxScheduleName);
    if (!SCHEDULE_KINDS.includes(input.kind)) {
      throw invalid('kind', 'enum', SCHEDULE_KINDS.join(', '));
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) throw invalid('color', 'pattern', '#rrggbb');
    const checked = checkScheduleDays(input.kind, input.days);
    if (!checked.ok) throw invalid(checked.path, 'schedule', checked.detail);
    const saved = await inTransaction(this.db, async (tx) => {
      const [taken] = await tx
        .select({ id: hrSchedules.id })
        .from(hrSchedules)
        .where(
          and(sql`lower(${hrSchedules.name}) = lower(${name})`, isNull(hrSchedules.archivedAt)),
        );
      if (taken && taken.id !== id) {
        throw new AppError('DUPLICATE_VALUE', 'a schedule of that name exists', { field: 'name' });
      }
      const values = {
        name,
        kind: input.kind,
        color: input.color,
        days: checked.days,
        updatedBy: actorUserId(ctx),
      };
      let scheduleId = id;
      if (scheduleId === null) {
        const [row] = await tx.insert(hrSchedules).values(values).returning({ id: hrSchedules.id });
        if (!row) throw new Error('schedule insert returned no row');
        scheduleId = row.id;
      } else {
        const rows = await tx
          .update(hrSchedules)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(hrSchedules.id, scheduleId))
          .returning({ id: hrSchedules.id });
        if (rows.length === 0) throw notFound('hr_schedule', scheduleId);
      }
      await this.assignInTx(tx, actorUserId(ctx), scheduleId, input.userIds);
      await this.audit.record(tx, ctx, {
        action: id === null ? 'CREATE' : 'UPDATE',
        entity: 'hr_schedule',
        entityId: scheduleId,
        after: { ...values, userIds: input.userIds },
      });
      return scheduleId;
    });
    const found = (await this.schedules(true)).find((row) => row.id === saved);
    if (!found) throw notFound('hr_schedule', saved);
    return found;
  }

  /** Archiving a schedule sends its people back to the company's hours. */
  async archiveSchedule(ctx: AuthContext, id: number): Promise<void> {
    this.assertManage(ctx);
    await inTransaction(this.db, async (tx) => {
      const rows = await tx
        .update(hrSchedules)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(hrSchedules.id, id), isNull(hrSchedules.archivedAt)))
        .returning({ id: hrSchedules.id });
      if (rows.length === 0) throw notFound('hr_schedule', id);
      await tx
        .update(hrEmployees)
        .set({ scheduleId: null, updatedAt: sql`now()` })
        .where(eq(hrEmployees.scheduleId, id));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'hr_schedule',
        entityId: id,
      });
    });
  }

  /** Imports a schedule by name (ADR-0144: timely's) and its people; a name taken gets « (2)». */
  async importSchedule(
    actor: AuditActor,
    input: { name: string; kind: ScheduleKind; days: ScheduleDay[]; userIds: number[] },
  ): Promise<number> {
    const checked = checkScheduleDays(input.kind, input.days);
    if (!checked.ok) throw new Error(`schedule ${input.name}: ${checked.path} ${checked.detail}`);
    return inTransaction(this.db, async (tx) => {
      const base = input.name
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, WORKFORCE_LIMITS.maxScheduleName - 4);
      // The same name with the same days is the same schedule (a second import).
      let name = base;
      let existingId: number | null = null;
      for (let copy = 1; copy < 10; copy += 1) {
        name = copy === 1 ? base : `${base} (${copy})`;
        const [row] = await tx
          .select({ id: hrSchedules.id, days: hrSchedules.days })
          .from(hrSchedules)
          .where(
            and(sql`lower(${hrSchedules.name}) = lower(${name})`, isNull(hrSchedules.archivedAt)),
          );
        if (!row) break;
        if (canonicalDays(row.days) === canonicalDays(checked.days)) {
          existingId = row.id;
          break;
        }
      }
      const values = { name, kind: input.kind, days: checked.days, updatedBy: actorUserId(actor) };
      let id = existingId;
      if (id === null) {
        const [row] = await tx.insert(hrSchedules).values(values).returning({ id: hrSchedules.id });
        if (!row) throw new Error('schedule insert returned no row');
        id = row.id;
      }
      for (const userId of input.userIds) {
        await tx
          .insert(hrEmployees)
          .values({ userId, scheduleId: id })
          .onConflictDoUpdate({
            target: hrEmployees.userId,
            set: { scheduleId: id, updatedAt: sql`now()` },
          });
      }
      await this.audit.record(tx, actor, {
        action: existingId === null ? 'CREATE' : 'UPDATE',
        entity: 'hr_schedule',
        entityId: id,
        after: { ...values, userIds: input.userIds, by: 'import' },
      });
      return id;
    });
  }

  private async assignInTx(
    tx: Tx,
    by: number | null,
    scheduleId: number,
    userIds: readonly number[],
  ): Promise<void> {
    const ids = [...new Set(userIds)];
    await tx
      .update(hrEmployees)
      .set({ scheduleId: null, updatedBy: by, updatedAt: sql`now()` })
      .where(
        ids.length > 0
          ? and(eq(hrEmployees.scheduleId, scheduleId), notInArray(hrEmployees.userId, ids))
          : eq(hrEmployees.scheduleId, scheduleId),
      );
    for (const userId of ids) {
      await tx
        .insert(hrEmployees)
        .values({ userId, scheduleId, updatedBy: by })
        .onConflictDoUpdate({
          target: hrEmployees.userId,
          set: { scheduleId, updatedBy: by, updatedAt: sql`now()` },
        });
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private checkedCard(input: EmployeeInput): Card {
    const firstName = this.name(input.firstName, 'firstName', WORKFORCE_LIMITS.maxName);
    const lastName = this.name(input.lastName, 'lastName', WORKFORCE_LIMITS.maxName);
    const position = clean(input.position);
    if (position !== null && [...position].length > WORKFORCE_LIMITS.maxPosition) {
      throw invalid('position', 'maxLength', `at most ${WORKFORCE_LIMITS.maxPosition}`);
    }
    if (!EMPLOYMENT_TYPES.includes(input.employmentType)) {
      throw invalid('employmentType', 'enum', EMPLOYMENT_TYPES.join(', '));
    }
    if (input.gender !== null && !EMPLOYEE_GENDERS.includes(input.gender)) {
      throw invalid('gender', 'enum', EMPLOYEE_GENDERS.join(', '));
    }
    if (input.employedOn !== null && !isIsoDate(input.employedOn)) {
      throw invalid('employedOn', 'isDate', 'YYYY-MM-DD');
    }
    if (input.employedOn !== null && input.employedOn > businessDate()) {
      throw invalid('employedOn', 'notFuture', 'not in the future');
    }
    return {
      firstName,
      lastName,
      position,
      divisionId: input.divisionId,
      employmentType: input.employmentType,
      gender: input.gender,
      employedOn: input.employedOn,
      scheduleId: input.scheduleId,
    };
  }

  private async writeCard(
    tx: Tx,
    actor: AuditActor,
    userId: number,
    card: Card,
    externalRef: string | null,
  ): Promise<void> {
    const values = {
      firstName: card.firstName,
      lastName: card.lastName,
      position: card.position,
      divisionId: card.divisionId,
      employmentType: card.employmentType,
      gender: card.gender,
      employedOn: card.employedOn,
      ...(externalRef ? { externalRef } : { scheduleId: card.scheduleId }),
      updatedBy: actorUserId(actor),
    };
    await tx
      .insert(hrEmployees)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: hrEmployees.userId,
        set: { ...values, updatedAt: sql`now()` },
      });
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'hr_employee',
      entityId: userId,
      after: values,
    });
  }

  private async attachPhoto(
    tx: Tx,
    actor: AuditActor,
    userId: number,
    fileId: number | null,
  ): Promise<void> {
    const [before] = await tx
      .select({ photoFileId: hrEmployees.photoFileId })
      .from(hrEmployees)
      .where(eq(hrEmployees.userId, userId))
      .for('update');
    if (fileId !== null) await this.storage.confirm(tx, fileId, 'hr.employee_photo');
    await tx
      .insert(hrEmployees)
      .values({ userId, photoFileId: fileId })
      .onConflictDoUpdate({
        target: hrEmployees.userId,
        set: { photoFileId: fileId, updatedAt: sql`now()` },
      });
    if (before?.photoFileId != null && before.photoFileId !== fileId) {
      await this.storage.markDeleted(tx, before.photoFileId);
    }
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'hr_employee',
      entityId: userId,
      after: { photoFileId: fileId },
    });
  }

  private async divisionByName(tx: Tx, raw: string): Promise<number> {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, WORKFORCE_LIMITS.maxName);
    const [found] = await tx
      .select({ id: hrDivisions.id })
      .from(hrDivisions)
      .where(and(sql`lower(${hrDivisions.name}) = lower(${name})`, isNull(hrDivisions.archivedAt)));
    if (found) return found.id;
    const [row] = await tx.insert(hrDivisions).values({ name }).returning({ id: hrDivisions.id });
    if (!row) throw new Error('division insert returned no row');
    return row.id;
  }

  private async assertRefs(tx: Tx, divisionId: number | null, scheduleId: number | null) {
    if (divisionId !== null) {
      const [row] = await tx
        .select({ id: hrDivisions.id })
        .from(hrDivisions)
        .where(and(eq(hrDivisions.id, divisionId), isNull(hrDivisions.archivedAt)));
      if (!row) throw invalid('divisionId', 'exists', 'no such division');
    }
    if (scheduleId !== null) {
      const [row] = await tx
        .select({ id: hrSchedules.id })
        .from(hrSchedules)
        .where(and(eq(hrSchedules.id, scheduleId), isNull(hrSchedules.archivedAt)));
      if (!row) throw invalid('scheduleId', 'exists', 'no such schedule');
    }
  }

  private async assertDivisionNameFree(tx: Tx, name: string, id: number | null) {
    const [taken] = await tx
      .select({ id: hrDivisions.id })
      .from(hrDivisions)
      .where(and(sql`lower(${hrDivisions.name}) = lower(${name})`, isNull(hrDivisions.archivedAt)));
    if (taken && taken.id !== id) {
      throw new AppError('DUPLICATE_VALUE', 'a division of that name exists', { field: 'name' });
    }
  }

  private name(raw: string, path: string, max: number): string {
    const value = clean(raw);
    if (value === null) throw invalid(path, 'isNotEmpty', 'required');
    if ([...value].length > max) throw invalid(path, 'maxLength', `at most ${max}`);
    return value;
  }

  private refuseAccount(): never {
    throw new AppError('FORBIDDEN', `this account needs ${MANAGE_ACCOUNTS}`, {
      permission: MANAGE_ACCOUNTS,
    });
  }

  private assertManage(ctx: AuthContext): void {
    if (!ctx.permissions.has(ATTENDANCE_MANAGE)) {
      throw new AppError('FORBIDDEN', `HR records need ${ATTENDANCE_MANAGE}`, {
        permission: ATTENDANCE_MANAGE,
      });
    }
  }
}

/** A schedule's days compared by value (jsonb does not keep the keys' order). */
function canonicalDays(days: readonly ScheduleDay[]): string {
  return JSON.stringify(
    [...days]
      .sort((a, b) => a.weekday - b.weekday)
      .map((day) => [day.weekday, day.start, day.end, day.breakStart, day.breakEnd, day.minutes]),
  );
}
