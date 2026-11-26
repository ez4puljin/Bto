import { Inject, Injectable } from '@nestjs/common';
import { PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type PositionSalarySchedule, PositionsService } from '../../hr';
import { type AuthContext, AuditService } from '../../identity';
import {
  amountOf,
  checkedItems,
  copiedItems,
  type KpiSheetItem,
  type KpiSheetItemInput,
  storedItems,
} from '../kpi-sheet';
import { assertPayroll, PAYROLL_MANAGE } from '../payroll.rights';
import { payrollKpiTemplates, payrollTerms } from '../schema';
import { PayrollPeopleService, type PayrollPerson } from './payroll-people.service';

export interface KpiTemplate {
  id: number;
  name: string;
  items: KpiSheetItem[];
  /** The sum of the items' amounts: what a full score pays. */
  total: string;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface KpiTemplateInput {
  name: string;
  items: KpiSheetItemInput[];
}

/** The position supplies salary; personal terms keep KPI, insurance and participation settings. */
export interface PayTerms {
  userId: number;
  fullName: string;
  positionId: number | null;
  positionSalaryEffectiveMonth: string | null;
  position: string | null;
  divisionId: number | null;
  divisionName: string | null;
  left: boolean;
  hasTerms: boolean;
  active: boolean;
  baseSalary: string;
  nextBaseSalary: string | null;
  nextEffectiveMonth: string | null;
  paysSocialInsurance: boolean;
  templateId: number | null;
  templateName: string | null;
  items: KpiSheetItem[];
  /** The sum of the KPI items' amounts. */
  kpiTotal: string;
  updatedAt: Date | null;
}

export interface PayTermsInput {
  baseSalary?: string;
  paysSocialInsurance: boolean;
  templateId: number | null;
  items: KpiSheetItemInput[];
  active: boolean;
}

interface ActivePayTerms {
  baseSalary: string;
  position: string | null;
  paysSocialInsurance: boolean;
  items: KpiSheetItem[];
}

const totalOf = (items: readonly KpiSheetItem[]): string =>
  items.reduce((sum, item) => sum.plus(item.amount), amountOf('amount', '0')).toFixed(2);

/**
 * KPI templates and each employee's pay terms (ADR-0235 #5). A template is a reusable list of
 * items; a person's sheet is a copy of one, edited per person afterwards. Changing either changes
 * no existing run: a run holds its own snapshot.
 */
@Injectable()
export class PayrollTermsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly people: PayrollPeopleService,
    private readonly positions: PositionsService,
  ) {}

  // ── templates ─────────────────────────────────────────────────────────────

  async templates(includeArchived = false, executor: Db | Tx = this.db): Promise<KpiTemplate[]> {
    const rows = await executor
      .select()
      .from(payrollKpiTemplates)
      .where(includeArchived ? undefined : isNull(payrollKpiTemplates.archivedAt))
      .orderBy(asc(payrollKpiTemplates.name), asc(payrollKpiTemplates.id));
    return rows.map((row) => {
      const items = storedItems(row.items);
      return {
        id: row.id,
        name: row.name,
        items,
        total: totalOf(items),
        archivedAt: row.archivedAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async saveTemplate(
    ctx: AuthContext,
    id: number | null,
    input: KpiTemplateInput,
  ): Promise<KpiTemplate> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const name = input.name.trim();
    if (name.length === 0) throw invalid('name', 'isNotEmpty', 'a template needs a name');
    if ([...name].length > PAYROLL_LIMITS.maxName) {
      throw invalid('name', 'maxLength', `at most ${PAYROLL_LIMITS.maxName} characters`);
    }
    const items = checkedItems(input.items);
    return inTransaction(this.db, async (tx) => {
      const before = id === null ? null : await this.template(tx, id);
      const [taken] = await tx
        .select({ id: payrollKpiTemplates.id })
        .from(payrollKpiTemplates)
        .where(
          and(
            isNull(payrollKpiTemplates.archivedAt),
            sql`lower(${payrollKpiTemplates.name}) = lower(${name})`,
            id === null ? undefined : sql`${payrollKpiTemplates.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (taken) {
        throw new AppError('DUPLICATE_VALUE', `a template named ${name} exists`, { field: 'name' });
      }
      let savedId = id;
      if (id === null) {
        const [row] = await tx
          .insert(payrollKpiTemplates)
          .values({ name, items, createdBy: ctx.userId })
          .returning({ id: payrollKpiTemplates.id });
        if (!row) throw new Error('template insert returned no row');
        savedId = row.id;
      } else {
        await tx
          .update(payrollKpiTemplates)
          .set({ name, items, updatedAt: sql`now()` })
          .where(eq(payrollKpiTemplates.id, id));
      }
      if (savedId === null) throw new Error('template id missing');
      await this.audit.record(tx, ctx, {
        action: id === null ? 'CREATE' : 'UPDATE',
        entity: 'payroll_kpi_template',
        entityId: savedId,
        before: before ? { name: before.name, items: before.items } : undefined,
        after: { name, items },
      });
      return this.template(tx, savedId);
    });
  }

  async archiveTemplate(ctx: AuthContext, id: number, archived: boolean): Promise<KpiTemplate> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    return inTransaction(this.db, async (tx) => {
      const before = await this.template(tx, id);
      if ((before.archivedAt !== null) === archived) return before;
      if (!archived) {
        const [taken] = await tx
          .select({ id: payrollKpiTemplates.id })
          .from(payrollKpiTemplates)
          .where(
            and(
              isNull(payrollKpiTemplates.archivedAt),
              sql`lower(${payrollKpiTemplates.name}) = lower(${before.name})`,
            ),
          )
          .limit(1);
        if (taken) {
          throw new AppError('DUPLICATE_VALUE', `a template named ${before.name} exists`, {
            field: 'name',
          });
        }
      }
      await tx
        .update(payrollKpiTemplates)
        .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
        .where(eq(payrollKpiTemplates.id, id));
      await this.audit.record(tx, ctx, {
        action: archived ? 'ARCHIVE' : 'RESTORE',
        entity: 'payroll_kpi_template',
        entityId: id,
      });
      return this.template(tx, id);
    });
  }

  /**
   * Copies a template's items onto the sheets of several employees at once, replacing what they
   * had; the salary and the insurance flag stay, and a person without terms gets them with a zero
   * salary for HR to fill in.
   */
  async applyTemplate(
    ctx: AuthContext,
    id: number,
    userIds: readonly number[],
  ): Promise<PayTerms[]> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const unique = [...new Set(userIds)];
    const known = await this.people.byId();
    for (const [index, userId] of unique.entries()) {
      if (!known.has(userId)) {
        throw invalid(`userIds[${index}]`, 'exists', `employee ${userId} not found`);
      }
    }
    await inTransaction(this.db, async (tx) => {
      const template = await this.template(tx, id);
      if (template.archivedAt !== null) {
        throw new AppError('DOC_STATE_INVALID', 'an archived template is not applied', {
          status: 'ARCHIVED',
        });
      }
      const existing = unique.length
        ? await tx.select().from(payrollTerms).where(inArray(payrollTerms.userId, unique))
        : [];
      const had = new Map(existing.map((row) => [row.userId, row]));
      for (const userId of unique) {
        const items = copiedItems(template.items);
        const before = had.get(userId);
        if (before) {
          await tx
            .update(payrollTerms)
            .set({ items, templateId: id, updatedBy: ctx.userId, updatedAt: sql`now()` })
            .where(eq(payrollTerms.userId, userId));
        } else {
          await tx.insert(payrollTerms).values({
            userId,
            baseSalary: amountOf('baseSalary', '0'),
            positionLegacySalary: known.get(userId)?.positionId === null,
            paysSocialInsurance: true,
            templateId: id,
            items,
            active: true,
            updatedBy: ctx.userId,
          });
        }
        await this.audit.record(tx, ctx, {
          action: before ? 'UPDATE' : 'CREATE',
          entity: 'payroll_terms',
          entityId: userId,
          before: before ? { templateId: before.templateId, items: before.items } : undefined,
          after: { templateId: id, items },
        });
      }
    });
    const all = await this.list();
    return all.filter((row) => unique.includes(row.userId));
  }

  private async template(executor: Db | Tx, id: number): Promise<KpiTemplate> {
    const found = (await this.templates(true, executor)).find((row) => row.id === id);
    if (!found) throw notFound('KPI template', id);
    return found;
  }

  // ── terms ─────────────────────────────────────────────────────────────────

  /** Every employee with their terms; those who left appear only while they still hold terms. */
  async list(executor: Db | Tx = this.db): Promise<PayTerms[]> {
    const [people, rows, templates] = await Promise.all([
      this.people.all(),
      executor.select().from(payrollTerms),
      this.templates(true, executor),
    ]);
    const terms = new Map(rows.map((row) => [row.userId, row]));
    const templateName = new Map(templates.map((row) => [row.id, row.name]));
    const salaries = await this.positions.salarySchedulesForUsers(
      executor,
      people.map((person) => person.userId),
      businessDate().slice(0, 7),
    );
    return people
      .filter((person) => !person.left || terms.has(person.userId))
      .map((person) =>
        this.view(
          person,
          terms.get(person.userId) ?? null,
          templateName,
          salaries.get(person.userId),
        ),
      );
  }

  async one(userId: number, executor: Db | Tx = this.db): Promise<PayTerms> {
    const person = (await this.people.byId()).get(userId);
    if (!person) throw notFound('employee', userId);
    const [[row], templates, salaries] = await Promise.all([
      executor.select().from(payrollTerms).where(eq(payrollTerms.userId, userId)),
      this.templates(true, executor),
      this.positions.salarySchedulesForUsers(executor, [userId], businessDate().slice(0, 7)),
    ]);
    return this.view(
      person,
      row ?? null,
      new Map(templates.map((entry) => [entry.id, entry.name])),
      salaries.get(userId),
    );
  }

  async save(ctx: AuthContext, userId: number, input: PayTermsInput): Promise<PayTerms> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const person = (await this.people.byId()).get(userId);
    if (!person) throw notFound('employee', userId);
    const requestedSalary =
      input.baseSalary === undefined ? undefined : amountOf('baseSalary', input.baseSalary);
    const items = checkedItems(input.items);
    await inTransaction(this.db, async (tx) => {
      if (input.templateId !== null) await this.template(tx, input.templateId);
      const [before] = await tx
        .select()
        .from(payrollTerms)
        .where(eq(payrollTerms.userId, userId))
        .for('update');
      const salary = (
        await this.positions.baseSalariesForUsers(tx, [userId], businessDate().slice(0, 7))
      ).get(userId);
      if (person.positionId !== null) {
        const currentSalary =
          salary?.baseSalary ??
          (before && before.positionLegacySalary !== false ? before.baseSalary.toFixed(2) : '0.00');
        if (requestedSalary && !requestedSalary.eq(currentSalary)) {
          throw invalid('baseSalary', 'positionSalary', 'change the base salary on the position');
        }
      } else if (requestedSalary === undefined) {
        throw invalid('baseSalary', 'isDefined', 'a legacy employee needs a base salary');
      }
      // Keep the old personal amount solely as a fallback for months before position rates began.
      const baseSalary =
        person.positionId !== null
          ? (before?.baseSalary ?? amountOf('baseSalary', '0'))
          : requestedSalary;
      if (baseSalary === undefined) throw new Error('base salary missing');
      const values = {
        baseSalary,
        positionLegacySalary:
          person.positionId === null || (before ? before.positionLegacySalary !== false : false),
        paysSocialInsurance: input.paysSocialInsurance,
        templateId: input.templateId,
        items,
        active: input.active,
        updatedBy: ctx.userId,
        updatedAt: sql`now()`,
      };
      if (before) await tx.update(payrollTerms).set(values).where(eq(payrollTerms.userId, userId));
      else await tx.insert(payrollTerms).values({ userId, ...values });
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'payroll_terms',
        entityId: userId,
        before: before
          ? {
              baseSalary: before.baseSalary,
              positionLegacySalary: before.positionLegacySalary,
              paysSocialInsurance: before.paysSocialInsurance,
              templateId: before.templateId,
              items: before.items,
              active: before.active,
            }
          : undefined,
        after: {
          baseSalary,
          positionLegacySalary: values.positionLegacySalary,
          paysSocialInsurance: input.paysSocialInsurance,
          templateId: input.templateId,
          items,
          active: input.active,
        },
      });
    });
    // Read back outside the transaction: the names come from hr over the pool.
    return this.one(userId);
  }

  /** The caller's own active terms (ADR-0235 #10): the sheet a full score pays, nothing else. */
  async mine(userId: number): Promise<{
    hasTerms: boolean;
    positionId: number | null;
    positionSalaryEffectiveMonth: string | null;
    position: string | null;
    baseSalary: string;
    nextBaseSalary: string | null;
    nextEffectiveMonth: string | null;
    paysSocialInsurance: boolean;
    items: KpiSheetItem[];
    kpiTotal: string;
  }> {
    const [[row], salaries, people] = await Promise.all([
      this.db.select().from(payrollTerms).where(eq(payrollTerms.userId, userId)),
      this.positions.salarySchedulesForUsers(this.db, [userId], businessDate().slice(0, 7)),
      this.people.byId(),
    ]);
    const schedule = salaries.get(userId);
    const salary = schedule?.current;
    const person = people.get(userId);
    const active = row?.active ?? salary != null;
    const items = active && row ? storedItems(row.items) : [];
    return {
      hasTerms: active,
      positionId: person?.positionId ?? null,
      positionSalaryEffectiveMonth: person?.positionSalaryEffectiveMonth ?? null,
      position: person?.position ?? null,
      baseSalary: active ? (salary?.baseSalary ?? row?.baseSalary.toFixed(2) ?? '0.00') : '0.00',
      nextBaseSalary: schedule?.next?.baseSalary ?? null,
      nextEffectiveMonth: schedule?.next?.effectiveMonth ?? null,
      paysSocialInsurance: row?.paysSocialInsurance ?? true,
      items,
      kpiTotal: totalOf(items),
    };
  }

  /** The active terms by user, for building a run. */
  async activeByUser(executor: Db | Tx, month: string): Promise<Map<number, ActivePayTerms>> {
    const [people, rows] = await Promise.all([
      this.people.all(),
      executor.select().from(payrollTerms),
    ]);
    const salaries = await this.positions.baseSalariesForUsers(
      executor,
      people.map((person) => person.userId),
      month,
    );
    const terms = new Map(rows.map((row) => [row.userId, row]));
    const result = new Map<number, ActivePayTerms>();
    for (const person of people) {
      const row = terms.get(person.userId);
      const salary = salaries.get(person.userId);
      if (row?.active === false || (!row && !salary)) continue;
      if (!salary && person.positionId !== null && (!row || row.positionLegacySalary === false))
        continue;
      result.set(person.userId, {
        baseSalary: salary?.baseSalary ?? row?.baseSalary.toFixed(2) ?? '0.00',
        position: salary?.position ?? person.position,
        paysSocialInsurance: row?.paysSocialInsurance ?? true,
        items: row ? storedItems(row.items) : [],
      });
    }
    return result;
  }

  private view(
    person: PayrollPerson,
    row: typeof payrollTerms.$inferSelect | null,
    templateName: ReadonlyMap<number, string>,
    schedule: PositionSalarySchedule | undefined,
  ): PayTerms {
    const items = row ? storedItems(row.items) : [];
    const salary = schedule?.current;
    return {
      userId: person.userId,
      fullName: person.fullName,
      positionId: person.positionId,
      positionSalaryEffectiveMonth: person.positionSalaryEffectiveMonth,
      position: person.position,
      divisionId: person.divisionId,
      divisionName: person.divisionName,
      left: person.left,
      hasTerms: row !== null || salary != null,
      active: row?.active ?? salary != null,
      baseSalary: salary?.baseSalary ?? row?.baseSalary.toFixed(2) ?? '0.00',
      nextBaseSalary: schedule?.next?.baseSalary ?? null,
      nextEffectiveMonth: schedule?.next?.effectiveMonth ?? null,
      paysSocialInsurance: row?.paysSocialInsurance ?? true,
      templateId: row?.templateId ?? null,
      templateName: row?.templateId ? (templateName.get(row.templateId) ?? null) : null,
      items,
      kpiTotal: totalOf(items),
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
