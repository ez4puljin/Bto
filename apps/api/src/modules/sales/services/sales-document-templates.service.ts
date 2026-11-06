import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  checkDocumentLayout,
  defaultDocumentLayout,
  DOCUMENT_TEMPLATE_LIMITS,
  type DocumentLayout,
  type DocumentTemplateKind,
  type PublishedDocumentTemplate,
} from '@tugeel/shared/sales';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { salesDocumentTemplates, salesDocumentTemplateVersions, salesPipelines } from '../schema';

export interface DocumentTemplatePipeline {
  id: number;
  name: string;
}

export interface DocumentTemplateSummary {
  id: number;
  kind: DocumentTemplateKind;
  name: string;
  isDefault: boolean;
  version: number;
  publishedAt: Date;
  hasDraft: boolean;
  /** The live pipelines that chose it (a default one also serves every pipeline that chose none). */
  pipelines: DocumentTemplatePipeline[];
}

export interface DocumentTemplateVersion {
  version: number;
  publishedAt: Date;
  publishedBy: string | null;
}

export interface DocumentTemplateDetail extends DocumentTemplateSummary {
  layout: DocumentLayout;
  draft: DocumentLayout | null;
  versions: DocumentTemplateVersion[];
}

/** What a print page needs: the published templates and each pipeline's choice. */
export interface DocumentPrintLayouts {
  templates: PublishedDocumentTemplate[];
  pipelines: {
    id: number;
    pickListTemplateId: number | null;
    deliveryNoteTemplateId: number | null;
  }[];
}

const FIRST_TEMPLATES: readonly { kind: DocumentTemplateKind; name: string }[] = [
  { kind: 'PICK_LIST', name: 'Бэлтгэх хуудас' },
  { kind: 'DELIVERY_NOTE', name: 'Падаан' },
];

function layoutOf(raw: unknown, kind: DocumentTemplateKind, path = 'layout'): DocumentLayout {
  const checked = checkDocumentLayout(raw, kind);
  if (!checked.ok) {
    throw invalid(checked.path.replace(/^layout/, path), checked.rule, checked.detail);
  }
  return checked.layout;
}

function nameOf(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > DOCUMENT_TEMPLATE_LIMITS.maxName) {
    throw invalid('name', 'length', `1 to ${DOCUMENT_TEMPLATE_LIMITS.maxName}`);
  }
  return name;
}

/**
 * The wholesale documents' templates (ADR-0143): a pick list's and a delivery note's layout from
 * blocks, a draft published as a new version, one default of each kind, chosen per pipeline. A
 * template a pipeline uses, or the default one, is never deleted.
 */
@Injectable()
export class SalesDocumentTemplatesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  /** No template of a kind (a new database) gets the document as it printed before as its default. */
  async onApplicationBootstrap(): Promise<void> {
    for (const first of FIRST_TEMPLATES) {
      const [any] = await this.db
        .select({ id: salesDocumentTemplates.id })
        .from(salesDocumentTemplates)
        .where(eq(salesDocumentTemplates.kind, first.kind))
        .limit(1);
      if (any) continue;
      await inTransaction(this.db, async (tx) => {
        const layout = defaultDocumentLayout(first.kind);
        const [row] = await tx
          .insert(salesDocumentTemplates)
          .values({ ...first, layout, isDefault: true })
          .onConflictDoNothing()
          .returning({ id: salesDocumentTemplates.id });
        if (row) {
          await tx
            .insert(salesDocumentTemplateVersions)
            .values({ templateId: row.id, version: 1, layout });
        }
      });
    }
  }

  async list(executor: Db | Tx = this.db): Promise<DocumentTemplateSummary[]> {
    const rows = await executor
      .select()
      .from(salesDocumentTemplates)
      .orderBy(
        asc(salesDocumentTemplates.kind),
        desc(salesDocumentTemplates.isDefault),
        asc(salesDocumentTemplates.name),
      );
    const pipelines = await executor
      .select({
        id: salesPipelines.id,
        name: salesPipelines.name,
        pick: salesPipelines.pickListTemplateId,
        note: salesPipelines.deliveryNoteTemplateId,
      })
      .from(salesPipelines)
      .where(isNull(salesPipelines.archivedAt))
      .orderBy(asc(salesPipelines.name));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      isDefault: row.isDefault,
      version: row.version,
      publishedAt: row.publishedAt,
      hasDraft: row.draft !== null,
      pipelines: pipelines
        .filter((pipeline) => (row.kind === 'PICK_LIST' ? pipeline.pick : pipeline.note) === row.id)
        .map(({ id, name }) => ({ id, name })),
    }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<DocumentTemplateDetail> {
    const summary = (await this.list(executor)).find((row) => row.id === id);
    const [row] = await executor
      .select({ layout: salesDocumentTemplates.layout, draft: salesDocumentTemplates.draft })
      .from(salesDocumentTemplates)
      .where(eq(salesDocumentTemplates.id, id));
    if (!summary || !row) throw notFound('sales_document_template', id);
    const versions = await executor
      .select({
        version: salesDocumentTemplateVersions.version,
        publishedAt: salesDocumentTemplateVersions.publishedAt,
        publishedBy: salesDocumentTemplateVersions.publishedBy,
      })
      .from(salesDocumentTemplateVersions)
      .where(eq(salesDocumentTemplateVersions.templateId, id))
      .orderBy(desc(salesDocumentTemplateVersions.version));
    const names = await this.names.namesOf(
      versions.flatMap((entry) => (entry.publishedBy === null ? [] : [entry.publishedBy])),
      executor,
    );
    return {
      ...summary,
      layout: row.layout,
      draft: row.draft ?? null,
      versions: versions.map((entry) => ({
        version: entry.version,
        publishedAt: entry.publishedAt,
        publishedBy: entry.publishedBy === null ? null : (names.get(entry.publishedBy) ?? null),
      })),
    };
  }

  /** The published templates and the choices of these pipelines, for the print pages. */
  async forPrint(pipelineIds: readonly number[]): Promise<DocumentPrintLayouts> {
    const templates = await this.db
      .select({
        id: salesDocumentTemplates.id,
        kind: salesDocumentTemplates.kind,
        isDefault: salesDocumentTemplates.isDefault,
        layout: salesDocumentTemplates.layout,
      })
      .from(salesDocumentTemplates)
      .orderBy(asc(salesDocumentTemplates.id));
    const ids = [...new Set(pipelineIds)].slice(0, 100);
    const pipelines = ids.length
      ? await this.db
          .select({
            id: salesPipelines.id,
            pickListTemplateId: salesPipelines.pickListTemplateId,
            deliveryNoteTemplateId: salesPipelines.deliveryNoteTemplateId,
          })
          .from(salesPipelines)
          .where(inArray(salesPipelines.id, ids))
      : [];
    return { templates, pipelines };
  }

  /** A new template: a copy of another's published layout, or the built-in one; version 1 at once. */
  async create(
    ctx: AuthContext,
    input: { kind: DocumentTemplateKind; name: string; copyFromId: number | null },
  ): Promise<DocumentTemplateDetail> {
    const name = nameOf(input.name);
    const id = await inTransaction(this.db, async (tx) => {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(salesDocumentTemplates);
      if (count >= DOCUMENT_TEMPLATE_LIMITS.maxTemplates) {
        throw invalid(
          'name',
          'count',
          `at most ${DOCUMENT_TEMPLATE_LIMITS.maxTemplates} templates`,
        );
      }
      let layout = defaultDocumentLayout(input.kind);
      if (input.copyFromId !== null) {
        const [from] = await tx
          .select({ kind: salesDocumentTemplates.kind, layout: salesDocumentTemplates.layout })
          .from(salesDocumentTemplates)
          .where(eq(salesDocumentTemplates.id, input.copyFromId));
        if (!from) throw notFound('sales_document_template', input.copyFromId);
        if (from.kind !== input.kind) {
          throw invalid('copyFromId', 'kind', `a ${input.kind} template`);
        }
        layout = from.layout;
      }
      const [{ id: templateId } = { id: 0 }] = await tx
        .insert(salesDocumentTemplates)
        .values({
          kind: input.kind,
          name,
          layout,
          publishedBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: salesDocumentTemplates.id });
      await tx
        .insert(salesDocumentTemplateVersions)
        .values({ templateId, version: 1, layout, publishedBy: ctx.userId });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'sales_document_templates',
        entityId: templateId,
        after: { kind: input.kind, name, copyFromId: input.copyFromId },
      });
      return templateId;
    });
    return this.get(id);
  }

  async saveDraft(
    ctx: AuthContext,
    id: number,
    input: { name: string; layout: unknown },
  ): Promise<DocumentTemplateDetail> {
    const name = nameOf(input.name);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const layout = layoutOf(input.layout, before.kind);
      const same = JSON.stringify(layout) === JSON.stringify(before.layout);
      await tx
        .update(salesDocumentTemplates)
        .set({ name, draft: same ? null : layout, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(salesDocumentTemplates.id, id));
      if (name !== before.name) {
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'sales_document_templates',
          entityId: id,
          before: { name: before.name },
          after: { name },
        });
      }
    });
    return this.get(id);
  }

  async publish(ctx: AuthContext, id: number): Promise<DocumentTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (before.draft === null) throw invalid('draft', 'required', 'nothing to publish');
      const layout = layoutOf(before.draft, before.kind, 'draft');
      const version = before.version + 1;
      await tx
        .update(salesDocumentTemplates)
        .set({
          layout,
          draft: null,
          version,
          publishedBy: ctx.userId,
          publishedAt: sql`now()`,
          updatedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(salesDocumentTemplates.id, id));
      await tx
        .insert(salesDocumentTemplateVersions)
        .values({ templateId: id, version, layout, publishedBy: ctx.userId });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_document_templates',
        entityId: id,
        before: { version: before.version },
        after: { version, published: true },
      });
    });
    return this.get(id);
  }

  async discardDraft(ctx: AuthContext, id: number): Promise<DocumentTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      await this.lock(tx, id);
      await tx
        .update(salesDocumentTemplates)
        .set({ draft: null, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(salesDocumentTemplates.id, id));
    });
    return this.get(id);
  }

  async restore(ctx: AuthContext, id: number, version: number): Promise<DocumentTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      await this.lock(tx, id);
      const [old] = await tx
        .select({ layout: salesDocumentTemplateVersions.layout })
        .from(salesDocumentTemplateVersions)
        .where(
          and(
            eq(salesDocumentTemplateVersions.templateId, id),
            eq(salesDocumentTemplateVersions.version, version),
          ),
        );
      if (!old) throw notFound('sales_document_template_version', version);
      await tx
        .update(salesDocumentTemplates)
        .set({ draft: old.layout, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(salesDocumentTemplates.id, id));
    });
    return this.get(id);
  }

  async makeDefault(ctx: AuthContext, id: number): Promise<DocumentTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      const template = await this.lock(tx, id);
      if (template.isDefault) return;
      await tx
        .update(salesDocumentTemplates)
        .set({ isDefault: false })
        .where(
          and(
            eq(salesDocumentTemplates.kind, template.kind),
            eq(salesDocumentTemplates.isDefault, true),
          ),
        );
      await tx
        .update(salesDocumentTemplates)
        .set({ isDefault: true, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(salesDocumentTemplates.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_document_templates',
        entityId: id,
        after: { isDefault: true },
      });
    });
    return this.get(id);
  }

  async remove(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const template = await this.lock(tx, id);
      const [used] = await tx
        .select({ id: salesPipelines.id })
        .from(salesPipelines)
        .where(
          or(
            eq(salesPipelines.pickListTemplateId, id),
            eq(salesPipelines.deliveryNoteTemplateId, id),
          ),
        )
        .limit(1);
      if (template.isDefault || used) {
        throw new AppError('IN_USE', 'the default template or one a pipeline uses', { id });
      }
      await tx.delete(salesDocumentTemplates).where(eq(salesDocumentTemplates.id, id));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'sales_document_templates',
        entityId: id,
        before: { kind: template.kind, name: template.name, version: template.version },
      });
    });
  }

  /** A pipeline's choice must be a template of that kind; null leaves the default. */
  async assertKind(
    tx: Tx,
    id: number | null | undefined,
    kind: DocumentTemplateKind,
    path: string,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const [row] = await tx
      .select({ kind: salesDocumentTemplates.kind })
      .from(salesDocumentTemplates)
      .where(eq(salesDocumentTemplates.id, id));
    if (!row) throw invalid(path, 'exists', 'no such document template');
    if (row.kind !== kind) throw invalid(path, 'kind', `a ${kind} document template`);
  }

  private async lock(tx: Tx, id: number) {
    const [row] = await tx
      .select()
      .from(salesDocumentTemplates)
      .where(eq(salesDocumentTemplates.id, id))
      .for('update');
    if (!row) throw notFound('sales_document_template', id);
    return row;
  }
}
