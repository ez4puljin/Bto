import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  checkReceiptLayout,
  defaultReceiptLayout,
  RECEIPT_TEMPLATE_LIMITS,
  type ReceiptLayout,
  type ReceiptTemplateKind,
  type SnapshotReceiptTemplate,
} from '@tugeel/shared/pos';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { posReceiptTemplates, posReceiptTemplateVersions, posTills } from '../schema';

export interface ReceiptTemplateTill {
  id: number;
  code: string;
  name: string;
}

export interface ReceiptTemplateSummary {
  id: number;
  kind: ReceiptTemplateKind;
  name: string;
  isDefault: boolean;
  version: number;
  publishedAt: Date;
  hasDraft: boolean;
  /** The POS that chose this template (a default one also serves every POS that chose none). */
  tills: ReceiptTemplateTill[];
}

export interface ReceiptTemplateVersion {
  version: number;
  publishedAt: Date;
  publishedBy: string | null;
}

export interface ReceiptTemplateDetail extends ReceiptTemplateSummary {
  layout: ReceiptLayout;
  draft: ReceiptLayout | null;
  versions: ReceiptTemplateVersion[];
}

/** The first templates of a new database: the receipts as they printed before ADR-0141. */
const FIRST_TEMPLATES: readonly { kind: ReceiptTemplateKind; name: string }[] = [
  { kind: 'SALE', name: 'Борлуулалтын баримт' },
  { kind: 'RETURN', name: 'Буцаалтын баримт' },
];

function layoutOf(raw: unknown, path = 'layout'): ReceiptLayout {
  const checked = checkReceiptLayout(raw);
  if (!checked.ok) {
    throw invalid(checked.path.replace(/^layout/, path), checked.rule, checked.detail);
  }
  return checked.layout;
}

function nameOf(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > RECEIPT_TEMPLATE_LIMITS.maxName) {
    throw invalid('name', 'length', `1 to ${RECEIPT_TEMPLATE_LIMITS.maxName}`);
  }
  return name;
}

/**
 * The receipt templates (ADR-0141): laid out by the admin from blocks, a draft published as a new
 * version, one default of each kind, chosen per POS; the published layouts go to the edge in the
 * snapshot. A template a POS uses or the default one is never deleted.
 */
@Injectable()
export class PosReceiptTemplatesService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  /** No template of a kind (a new database) gets the built-in layout as its default at boot. */
  async onApplicationBootstrap(): Promise<void> {
    for (const first of FIRST_TEMPLATES) {
      const [any] = await this.db
        .select({ id: posReceiptTemplates.id })
        .from(posReceiptTemplates)
        .where(eq(posReceiptTemplates.kind, first.kind))
        .limit(1);
      if (any) continue;
      await inTransaction(this.db, async (tx) => {
        const layout = defaultReceiptLayout();
        const [row] = await tx
          .insert(posReceiptTemplates)
          .values({ ...first, layout, isDefault: true })
          .onConflictDoNothing()
          .returning({ id: posReceiptTemplates.id });
        if (row) {
          await tx
            .insert(posReceiptTemplateVersions)
            .values({ templateId: row.id, version: 1, layout });
        }
      });
    }
  }

  async list(executor: Db | Tx = this.db): Promise<ReceiptTemplateSummary[]> {
    const rows = await executor
      .select()
      .from(posReceiptTemplates)
      .orderBy(
        asc(posReceiptTemplates.kind),
        desc(posReceiptTemplates.isDefault),
        asc(posReceiptTemplates.name),
      );
    const tills = await executor
      .select({
        id: posTills.id,
        code: posTills.code,
        name: posTills.name,
        sale: posTills.saleTemplateId,
        ret: posTills.returnTemplateId,
      })
      .from(posTills)
      .orderBy(asc(posTills.code));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      isDefault: row.isDefault,
      version: row.version,
      publishedAt: row.publishedAt,
      hasDraft: row.draft !== null,
      tills: tills
        .filter((till) => (row.kind === 'SALE' ? till.sale : till.ret) === row.id)
        .map(({ id, code, name }) => ({ id, code, name })),
    }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ReceiptTemplateDetail> {
    const summary = (await this.list(executor)).find((row) => row.id === id);
    const [row] = await executor
      .select({ layout: posReceiptTemplates.layout, draft: posReceiptTemplates.draft })
      .from(posReceiptTemplates)
      .where(eq(posReceiptTemplates.id, id));
    if (!summary || !row) throw notFound('pos_receipt_template', id);
    const versions = await executor
      .select({
        version: posReceiptTemplateVersions.version,
        publishedAt: posReceiptTemplateVersions.publishedAt,
        publishedBy: posReceiptTemplateVersions.publishedBy,
      })
      .from(posReceiptTemplateVersions)
      .where(eq(posReceiptTemplateVersions.templateId, id))
      .orderBy(desc(posReceiptTemplateVersions.version));
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

  /** The published templates for the edge, in a stable order (the snapshot's version is a hash). */
  async forSnapshot(executor: Db | Tx = this.db): Promise<SnapshotReceiptTemplate[]> {
    const rows = await executor
      .select({
        id: posReceiptTemplates.id,
        kind: posReceiptTemplates.kind,
        isDefault: posReceiptTemplates.isDefault,
        version: posReceiptTemplates.version,
        layout: posReceiptTemplates.layout,
      })
      .from(posReceiptTemplates)
      .orderBy(asc(posReceiptTemplates.id));
    return rows;
  }

  /** A new template: a copy of another one's published layout, or the built-in one; published at once as version 1. */
  async create(
    ctx: AuthContext,
    input: { kind: ReceiptTemplateKind; name: string; copyFromId: number | null },
  ): Promise<ReceiptTemplateDetail> {
    const name = nameOf(input.name);
    const id = await inTransaction(this.db, async (tx) => {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(posReceiptTemplates);
      if (count >= RECEIPT_TEMPLATE_LIMITS.maxTemplates) {
        throw invalid('name', 'count', `at most ${RECEIPT_TEMPLATE_LIMITS.maxTemplates} templates`);
      }
      let layout = defaultReceiptLayout();
      if (input.copyFromId !== null) {
        const [from] = await tx
          .select({ kind: posReceiptTemplates.kind, layout: posReceiptTemplates.layout })
          .from(posReceiptTemplates)
          .where(eq(posReceiptTemplates.id, input.copyFromId));
        if (!from) throw notFound('pos_receipt_template', input.copyFromId);
        layout = from.layout;
      }
      const [{ id: templateId } = { id: 0 }] = await tx
        .insert(posReceiptTemplates)
        .values({
          kind: input.kind,
          name,
          layout,
          publishedBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: posReceiptTemplates.id });
      await tx
        .insert(posReceiptTemplateVersions)
        .values({ templateId, version: 1, layout, publishedBy: ctx.userId });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'pos_receipt_templates',
        entityId: templateId,
        after: { kind: input.kind, name, copyFromId: input.copyFromId },
      });
      return templateId;
    });
    return this.get(id);
  }

  /** The admin's edits, kept as the draft (the POS still print the published layout). */
  async saveDraft(
    ctx: AuthContext,
    id: number,
    input: { name: string; layout: unknown },
  ): Promise<ReceiptTemplateDetail> {
    const name = nameOf(input.name);
    const layout = layoutOf(input.layout);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const same = JSON.stringify(layout) === JSON.stringify(before.layout);
      await tx
        .update(posReceiptTemplates)
        .set({ name, draft: same ? null : layout, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(posReceiptTemplates.id, id));
      if (name !== before.name) {
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'pos_receipt_templates',
          entityId: id,
          before: { name: before.name },
          after: { name },
        });
      }
    });
    return this.get(id);
  }

  /** The draft becomes the layout in force, as the next version; the edge takes it on its next pull. */
  async publish(ctx: AuthContext, id: number): Promise<ReceiptTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (before.draft === null) throw invalid('draft', 'required', 'nothing to publish');
      const layout = layoutOf(before.draft, 'draft');
      const version = before.version + 1;
      await tx
        .update(posReceiptTemplates)
        .set({
          layout,
          draft: null,
          version,
          publishedBy: ctx.userId,
          publishedAt: sql`now()`,
          updatedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(posReceiptTemplates.id, id));
      await tx
        .insert(posReceiptTemplateVersions)
        .values({ templateId: id, version, layout, publishedBy: ctx.userId });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_receipt_templates',
        entityId: id,
        before: { version: before.version },
        after: { version, published: true },
      });
    });
    return this.get(id);
  }

  async discardDraft(ctx: AuthContext, id: number): Promise<ReceiptTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      await this.lock(tx, id);
      await tx
        .update(posReceiptTemplates)
        .set({ draft: null, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(posReceiptTemplates.id, id));
    });
    return this.get(id);
  }

  /** An earlier version's layout becomes the draft, to be published again. */
  async restore(ctx: AuthContext, id: number, version: number): Promise<ReceiptTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      await this.lock(tx, id);
      const [old] = await tx
        .select({ layout: posReceiptTemplateVersions.layout })
        .from(posReceiptTemplateVersions)
        .where(
          and(
            eq(posReceiptTemplateVersions.templateId, id),
            eq(posReceiptTemplateVersions.version, version),
          ),
        );
      if (!old) throw notFound('pos_receipt_template_version', version);
      await tx
        .update(posReceiptTemplates)
        .set({ draft: old.layout, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(posReceiptTemplates.id, id));
    });
    return this.get(id);
  }

  /** The default of its kind: every POS that chose none prints with it. */
  async makeDefault(ctx: AuthContext, id: number): Promise<ReceiptTemplateDetail> {
    await inTransaction(this.db, async (tx) => {
      const template = await this.lock(tx, id);
      if (template.isDefault) return;
      await tx
        .update(posReceiptTemplates)
        .set({ isDefault: false })
        .where(
          and(eq(posReceiptTemplates.kind, template.kind), eq(posReceiptTemplates.isDefault, true)),
        );
      await tx
        .update(posReceiptTemplates)
        .set({ isDefault: true, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(posReceiptTemplates.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_receipt_templates',
        entityId: id,
        after: { isDefault: true },
      });
    });
    return this.get(id);
  }

  /** Only a template no POS uses and not the default; its versions go with it. */
  async remove(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const template = await this.lock(tx, id);
      const [used] = await tx
        .select({ id: posTills.id })
        .from(posTills)
        .where(or(eq(posTills.saleTemplateId, id), eq(posTills.returnTemplateId, id)))
        .limit(1);
      if (template.isDefault || used) {
        throw new AppError('IN_USE', 'the default template or one a POS uses', { id });
      }
      await tx.delete(posReceiptTemplates).where(eq(posReceiptTemplates.id, id));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'pos_receipt_templates',
        entityId: id,
        before: { kind: template.kind, name: template.name, version: template.version },
      });
    });
  }

  /** A POS's choice must be a template of that kind; null leaves the default. */
  async assertKind(
    tx: Tx,
    id: number | null | undefined,
    kind: ReceiptTemplateKind,
    path: string,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const [row] = await tx
      .select({ kind: posReceiptTemplates.kind })
      .from(posReceiptTemplates)
      .where(eq(posReceiptTemplates.id, id));
    if (!row) throw invalid(path, 'exists', 'no such receipt template');
    if (row.kind !== kind) throw invalid(path, 'kind', `a ${kind} receipt template`);
  }

  private async lock(tx: Tx, id: number) {
    const [row] = await tx
      .select()
      .from(posReceiptTemplates)
      .where(eq(posReceiptTemplates.id, id))
      .for('update');
    if (!row) throw notFound('pos_receipt_template', id);
    return row;
  }
}
