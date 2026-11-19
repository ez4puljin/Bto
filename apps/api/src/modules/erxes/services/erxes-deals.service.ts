import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, UnitConversionService } from '../../catalog';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { SalesOrderQueryService } from '../../sales';
import { attachmentUrl, dealUrl, personName, readDeal } from '../erxes-wire';
import {
  type ErxesDealChoices,
  type ErxesDealStatus,
  erxesDeals,
  erxesPipelines,
  erxesSettings,
  type ErxesWaitIssue,
} from '../schema';
import { ERXES_DEFAULT_URL } from './erxes-settings-flow.service';

type DealRow = typeof erxesDeals.$inferSelect;

/** A Bto unit as the waiting list names it. */
export interface ErxesUnitChoice {
  productUnitId: number;
  productId: number;
  sku: string;
  productName: string;
  unitName: string;
}

export interface ErxesDealLine {
  erxesProductId: string | null;
  code: string | null;
  name: string | null;
  uom: string | null;
  quantity: string | null;
  unitPrice: string | null;
  discount: string | null;
  discountPercent: string | null;
  amount: string | null;
  /** The Bto unit the line became, or the one a person chose for it. */
  unit: ErxesUnitChoice | null;
}

export interface ErxesDealRow {
  id: number;
  erxesId: string;
  status: ErxesDealStatus;
  name: string | null;
  number: string | null;
  pipelineName: string | null;
  creatorName: string | null;
  erxesCreatedAt: Date | null;
  issues: ErxesWaitIssue[];
  orderId: number | null;
  lastTriedAt: Date | null;
  copiedAt: Date | null;
}

/** A deal whole, for the waiting list's dialog and the order panel's «Erxes» section. */
export interface ErxesDealView extends ErxesDealRow {
  /** Where the deal opens in erxes. */
  url: string;
  stageName: string | null;
  description: string | null;
  startDate: Date | null;
  closeDate: Date | null;
  /** The Bto user the creator was matched to; null: only the erxes name is known. */
  creatorUserId: number | null;
  creatorUserName: string | null;
  assigned: string[];
  labels: { name: string; color: string | null }[];
  customFields: { label: string; value: string }[];
  parties: {
    kind: 'COMPANY' | 'CUSTOMER';
    name: string | null;
    code: string | null;
    regNo: string | null;
    phones: string[];
  }[];
  lines: ErxesDealLine[];
  attachments: { name: string | null; url: string }[];
  /** The Bto customer of the order, or the one a person chose. */
  customer: { id: number; code: string; name: string } | null;
  /** The deal exactly as erxes answered. */
  raw: unknown;
}

export interface ErxesChoiceInput {
  /** null takes the choice back. */
  customerId?: number | null;
  units?: { erxesProductId: string; productUnitId: number | null }[];
}

export interface ErxesDealQuery {
  status?: ErxesDealStatus;
  cursor?: string;
  limit?: number;
}

/**
 * The deals a pull has seen (ADR-0218 #4, #6): the list «Erxes-ээс ирсэн», a deal whole for its
 * dialog and for the order panel, and what a person does with a waiting one: choose its customer
 * or a line's product, set it aside, take it back. The copy itself is `ErxesCopyService`.
 */
@Injectable()
export class ErxesDealsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly customers: CustomersService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly orders: SalesOrderQueryService,
  ) {}

  async list(query: ErxesDealQuery): Promise<{ data: ErxesDealRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const rows = await this.db
      .select({ deal: erxesDeals, pipelineName: erxesPipelines.name })
      .from(erxesDeals)
      .leftJoin(erxesPipelines, eq(erxesPipelines.erxesId, erxesDeals.pipelineErxesId))
      .where(
        and(
          eq(erxesDeals.status, query.status ?? 'WAITING'),
          typeof after?.id === 'number' ? lt(erxesDeals.id, after.id) : undefined,
        ),
      )
      .orderBy(desc(erxesDeals.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.deal.id }));
    return {
      data: page.data.map((row) => rowOf(row.deal, row.pipelineName)),
      nextCursor: page.nextCursor,
    };
  }

  async get(id: number): Promise<ErxesDealView> {
    const [deal] = await this.db.select().from(erxesDeals).where(eq(erxesDeals.id, id));
    if (!deal) throw notFound('erxes deal', id);
    return this.view(deal);
  }

  /**
   * The deal an order was copied from, for the order panel; null for an order made in Bto. The
   * caller must see the order itself (404 otherwise, as the order's own route answers).
   */
  async ofOrder(ctx: AuthContext, orderId: number): Promise<ErxesDealView | null> {
    const [deal] = await this.db.select().from(erxesDeals).where(eq(erxesDeals.orderId, orderId));
    if (!deal) return null;
    await this.orders.detail(ctx, orderId);
    return this.view(deal);
  }

  /** A person's choice of the customer, or of the Bto unit of a line's product, for a waiting deal. */
  async choose(ctx: AuthContext, id: number, input: ErxesChoiceInput): Promise<ErxesDealView> {
    if (typeof input.customerId === 'number') await this.customers.get(input.customerId);
    const unitIds = (input.units ?? []).flatMap((entry) =>
      entry.productUnitId === null ? [] : [entry.productUnitId],
    );
    const known = await this.units.describe(unitIds);
    for (const unitId of unitIds) {
      if (!known.get(unitId)?.current) throw invalid('units', 'current', 'a current product unit');
    }
    await inTransaction(this.db, async (tx) => {
      const deal = await lockWaiting(tx, id);
      const choices: ErxesDealChoices = { ...deal.choices, units: { ...deal.choices.units } };
      if (input.customerId === null) delete choices.customerId;
      else if (input.customerId !== undefined) choices.customerId = input.customerId;
      for (const entry of input.units ?? []) {
        if (entry.productUnitId === null) delete choices.units?.[entry.erxesProductId];
        else if (choices.units) choices.units[entry.erxesProductId] = entry.productUnitId;
      }
      await tx
        .update(erxesDeals)
        .set({ choices, updatedAt: sql`now()` })
        .where(eq(erxesDeals.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'erxes_deals',
        entityId: id,
        before: { choices: deal.choices },
        after: { choices },
      });
    });
    return this.get(id);
  }

  /** Sets a waiting deal aside: it is tried no more, and stays in the list of set-aside ones. */
  async dismiss(ctx: AuthContext, id: number): Promise<ErxesDealView> {
    await inTransaction(this.db, async (tx) => {
      await lockWaiting(tx, id);
      await tx
        .update(erxesDeals)
        .set({
          status: 'DISMISSED',
          dismissedAt: sql`now()`,
          dismissedBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(erxesDeals.id, id));
      await this.audit.record(tx, ctx, { action: 'DISMISS', entity: 'erxes_deals', entityId: id });
    });
    return this.get(id);
  }

  /** Takes a set-aside deal back among the waiting ones. */
  async restore(ctx: AuthContext, id: number): Promise<ErxesDealView> {
    await inTransaction(this.db, async (tx) => {
      const [deal] = await tx.select().from(erxesDeals).where(eq(erxesDeals.id, id)).for('update');
      if (!deal) throw notFound('erxes deal', id);
      if (deal.status !== 'DISMISSED') throw notWaiting(deal);
      await tx
        .update(erxesDeals)
        .set({ status: 'WAITING', dismissedAt: null, dismissedBy: null, updatedAt: sql`now()` })
        .where(eq(erxesDeals.id, id));
      await this.audit.record(tx, ctx, { action: 'RESTORE', entity: 'erxes_deals', entityId: id });
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------------------------------------

  private async view(deal: DealRow): Promise<ErxesDealView> {
    const facts = readDeal(deal.raw, Array.isArray(deal.products) ? deal.products : []);
    if (!facts) throw new Error(`erxes deal ${deal.id} holds no readable answer`);
    const [settings] = await this.db
      .select({ baseUrl: erxesSettings.baseUrl })
      .from(erxesSettings)
      .where(eq(erxesSettings.id, 1));
    const baseUrl = settings?.baseUrl ?? ERXES_DEFAULT_URL;
    const [pipeline] = await this.db
      .select({ name: erxesPipelines.name })
      .from(erxesPipelines)
      .where(eq(erxesPipelines.erxesId, deal.pipelineErxesId));
    const unitOf = { ...deal.choices.units, ...deal.matchedUnits };
    const unitIds = [...new Set(Object.values(unitOf))];
    const described = await this.units.describe(unitIds);
    const products = await this.catalog.getMany([
      ...new Set([...described.values()].map((unit) => unit.productId)),
    ]);
    const productOf = new Map(products.map((product) => [product.id, product]));
    const choiceOf = (erxesProductId: string | null): ErxesUnitChoice | null => {
      const unitId = erxesProductId === null ? undefined : unitOf[erxesProductId];
      const unit = unitId === undefined ? undefined : described.get(unitId);
      const product = unit ? productOf.get(unit.productId) : undefined;
      if (!unit || !product) return null;
      return {
        productUnitId: unit.unitId,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unitName: unit.uomName,
      };
    };
    const customerId = deal.customerId ?? deal.choices.customerId ?? null;
    const [customer] = customerId === null ? [] : await this.customers.getMany([customerId]);
    const creatorUserName =
      deal.creatorUserId === null
        ? null
        : ((await this.names.namesOf([deal.creatorUserId])).get(deal.creatorUserId) ?? null);
    const labels = deal.fieldLabels ?? {};
    return {
      ...rowOf(deal, pipeline?.name ?? facts.pipelineName),
      url: dealUrl(baseUrl, facts),
      stageName: facts.stageName,
      description: facts.description,
      startDate: facts.startDate,
      closeDate: facts.closeDate,
      creatorUserId: deal.creatorUserId,
      creatorUserName,
      assigned: facts.assigned.flatMap((person) => personName(person) ?? []),
      labels: facts.labels,
      customFields: facts.customFields.map((field) => ({
        label: labels[field.fieldId] ?? field.fieldId,
        value: field.value,
      })),
      parties: facts.parties.map(({ kind, name, code, regNo, phones }) => ({
        kind,
        name,
        code,
        regNo,
        phones,
      })),
      lines: facts.lines.map((line) => ({
        erxesProductId: line.erxesProductId,
        code: line.code,
        name: line.name,
        uom: line.uom,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        discountPercent: line.discountPercent,
        amount: line.amount,
        unit: choiceOf(line.erxesProductId),
      })),
      attachments: facts.attachments.map((file) => ({
        name: file.name,
        url: attachmentUrl(baseUrl, file.url),
      })),
      customer: customer ? { id: customer.id, code: customer.code, name: customer.name } : null,
      raw: deal.raw,
    };
  }
}

function rowOf(deal: DealRow, pipelineName: string | null): ErxesDealRow {
  return {
    id: deal.id,
    erxesId: deal.erxesId,
    status: deal.status,
    name: deal.name,
    number: deal.number,
    pipelineName,
    creatorName: deal.creatorName,
    erxesCreatedAt: deal.erxesCreatedAt,
    issues: deal.issues,
    orderId: deal.orderId,
    lastTriedAt: deal.lastTriedAt,
    copiedAt: deal.copiedAt,
  };
}

function notWaiting(deal: DealRow): AppError {
  return new AppError('DOC_STATE_INVALID', `the deal is ${deal.status}`, { status: deal.status });
}

async function lockWaiting(tx: Tx, id: number) {
  const [deal] = await tx.select().from(erxesDeals).where(eq(erxesDeals.id, id)).for('update');
  if (!deal) throw notFound('erxes deal', id);
  if (deal.status !== 'WAITING') throw notWaiting(deal);
  return deal;
}
