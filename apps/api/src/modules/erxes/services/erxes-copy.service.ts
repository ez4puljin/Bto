import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { defaultDeliveryDate, ORDER_LIMITS } from '@tugeel/shared/sales';
import { normalizeRegNo } from '@tugeel/shared/taxpayer';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { isCodedError } from '../../../common/errors/coded-error';
import { BarcodeService, CatalogImportService, UnitConversionService } from '../../catalog';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  type OrderInput,
  type OrderLineInput,
  SalesAccessService,
  SalesOrdersService,
  SalesPipelinesService,
} from '../../sales';
import { ERXES_JOB_ACTOR, ERXES_READER, orderAuthor } from '../erxes-actors';
import {
  type ErxesDealFacts,
  type ErxesLine,
  type ErxesParty,
  type ErxesPerson,
  personName,
  readDeal,
} from '../erxes-wire';
import {
  type ErxesDealChoices,
  type ErxesDealStatus,
  erxesDeals,
  erxesPipelines,
  erxesUsers,
  type ErxesWaitIssue,
} from '../schema';

type DealRow = typeof erxesDeals.$inferSelect;

export interface CopyOutcome {
  status: ErxesDealStatus;
  orderId: number | null;
  issues: ErxesWaitIssue[];
  /** This call made the order (false when the deal was an order already, or still waits). */
  copiedNow: boolean;
}

/** A Bto user as the creator match compares them. */
export interface StaffEntry {
  id: number;
  fullName: string;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

/** Everything an order needs, or why the deal waits. */
interface Plan {
  issues: ErxesWaitIssue[];
  customerId: number | null;
  place: { pipelineId: number; stageId: number } | null;
  lines: OrderLineInput[];
  /** erxes product id → the unit its line takes. */
  matchedUnits: Record<string, number>;
  creatorUserId: number | null;
  creatorName: string | null;
  facts: ErxesDealFacts;
}

/** A person's name as it is compared: its words, lower case, in any order. */
export function personKey(name: string | null): string {
  return (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s.,]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * The Bto user who is this erxes user (ADR-0218 #5): by phone, then by full name, and only when
 * exactly one fits; active users before disabled ones. Bto's users have no email, so an email is
 * matched by a person on the settings page (`erxes_users.bto_user_id`), which is asked first.
 */
export function matchStaff(
  person: ErxesPerson | null,
  staff: readonly StaffEntry[],
): number | null {
  if (!person) return null;
  const one = (found: StaffEntry[]): number | null => {
    const active = found.filter((entry) => entry.status === 'ACTIVE');
    const pool = active.length > 0 ? active : found;
    return pool.length === 1 && pool[0] ? pool[0].id : null;
  };
  const phone = person.phone ? normalizeMnPhone(person.phone) : null;
  if (phone) {
    const byPhone = one(staff.filter((entry) => entry.phone === phone));
    if (byPhone !== null) return byPhone;
  }
  const key = personKey(person.fullName);
  if (key === '') return null;
  return one(staff.filter((entry) => personKey(entry.fullName) === key));
}

const same = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The order's note: the deal's name and description, as much as a note holds. */
export function noteOf(facts: ErxesDealFacts): string | null {
  const text = [facts.name, facts.description].filter(Boolean).join('\n').trim();
  if (text === '') return null;
  return text.length <= ORDER_LIMITS.maxNote ? text : `${text.slice(0, ORDER_LIMITS.maxNote - 1)}…`;
}

/**
 * Turns one seen deal into one draft order (ADR-0218 #4…#7). The deal is matched outside any
 * transaction; the order is then made through `SalesOrdersService.createInTx` in one transaction
 * with the deal's row locked, so two pulls, a retry and a person's press end in one order. The
 * order is a draft: nothing is priced, reserved or submitted here.
 */
@Injectable()
export class ErxesCopyService {
  private readonly logger = new Logger(ErxesCopyService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly customers: CustomersService,
    private readonly products: CatalogImportService,
    private readonly barcodes: BarcodeService,
    private readonly units: UnitConversionService,
    private readonly access: SalesAccessService,
    private readonly pipelines: SalesPipelinesService,
    private readonly orders: SalesOrdersService,
  ) {}

  /**
   * Copies a waiting deal when everything it needs is found; otherwise writes why it waits.
   * `presser` is the person who pressed «Bto руу хуулах», null when the pull tries by itself.
   */
  async tryCopy(dealId: number, presser: AuthContext | null): Promise<CopyOutcome> {
    const [deal] = await this.db.select().from(erxesDeals).where(eq(erxesDeals.id, dealId));
    if (!deal) throw notFound('erxes deal', dealId);
    if (deal.status !== 'WAITING') return outcomeOf(deal);
    const plan = await this.plan(deal);
    if (plan.issues.length > 0 || plan.customerId === null || plan.place === null) {
      return this.wait(deal.id, plan.issues);
    }
    const { facts, place, customerId } = plan;
    const input: OrderInput = {
      customerId,
      pipelineId: place.pipelineId,
      stageId: place.stageId,
      // A deal says neither; the staff set both on the draft before they submit it.
      fulfilment: 'PICKUP',
      paymentMethod: 'CASH',
      deliveryDate: deliveryDateOf(facts),
      addressId: null,
      ...contactOf(facts),
      note: noteOf(facts),
      lines: plan.lines,
    };
    const author = orderAuthor({ userId: plan.creatorUserId, erxesName: plan.creatorName });
    try {
      return await inTransaction(this.db, async (tx) => {
        const [locked] = await tx
          .select()
          .from(erxesDeals)
          .where(eq(erxesDeals.id, deal.id))
          .for('update');
        if (!locked) throw notFound('erxes deal', deal.id);
        if (locked.status !== 'WAITING') return outcomeOf(locked);
        const orderId = await this.orders.createInTx(tx, author, input, {
          channel: 'ADMIN',
          placement: async () => {
            // The pipeline and the stage are locked FOR SHARE, so neither is archived meanwhile.
            const pipelineId = await this.pipelines.lockStage(tx, place.stageId);
            if (pipelineId !== place.pipelineId) {
              throw invalid('stageId', 'ofPipeline', 'the stage left its pipeline');
            }
            return place;
          },
        });
        await tx
          .update(erxesDeals)
          .set({
            status: 'COPIED',
            orderId,
            customerId,
            creatorUserId: plan.creatorUserId,
            creatorName: plan.creatorName,
            matchedUnits: plan.matchedUnits,
            issues: [],
            attempts: sql`${erxesDeals.attempts} + 1`,
            lastTriedAt: sql`now()`,
            copiedAt: sql`now()`,
            copiedBy: presser?.userId ?? null,
            updatedAt: sql`now()`,
          })
          .where(eq(erxesDeals.id, deal.id));
        await this.audit.record(tx, presser ?? ERXES_JOB_ACTOR, {
          action: 'COPY',
          entity: 'erxes_deals',
          entityId: deal.id,
          after: {
            erxesId: deal.erxesId,
            orderId,
            customerId,
            creatorUserId: plan.creatorUserId,
            lines: plan.lines.length,
          },
        });
        return { status: 'COPIED' as const, orderId, issues: [], copiedNow: true };
      });
    } catch (error: unknown) {
      // Bto's own order rules said no (an inactive customer, a product that cannot be sold yet,
      // a quantity that is not whole): nothing was written, and the deal waits with the rule.
      if (!isCodedError(error)) throw error;
      this.logger.warn(`deal ${deal.erxesId} was refused as an order: ${error.code}`);
      return this.wait(deal.id, [{ reason: 'ORDER_REFUSED', errorCode: error.code }]);
    }
  }

  /** What a deal would become, without writing anything. */
  private async plan(deal: DealRow): Promise<Plan> {
    const facts = readDeal(deal.raw, Array.isArray(deal.products) ? deal.products : []);
    if (!facts) throw new Error(`erxes deal ${deal.id} holds no readable answer`);
    const issues: ErxesWaitIssue[] = [];
    const place = await this.placeOf(deal.pipelineErxesId);
    if (!place) issues.push({ reason: 'NO_STAGE' });
    const customer = await this.customerOf(facts.parties, deal.choices);
    if (customer.issue) issues.push(customer.issue);
    const lines: OrderLineInput[] = [];
    const matchedUnits: Record<string, number> = {};
    for (const line of facts.lines) {
      const matched = await this.lineOf(line, deal.choices);
      if ('issue' in matched) {
        issues.push(matched.issue);
      } else {
        lines.push(matched.line);
        if (line.erxesProductId) matchedUnits[line.erxesProductId] = matched.line.productUnitId;
      }
    }
    const creator = await this.creatorOf(facts);
    return { issues, customerId: customer.id, place, lines, matchedUnits, facts, ...creator };
  }

  /** The Bto stage the pipeline's copies land in, when it is live and takes new orders. */
  private async placeOf(pipelineErxesId: string): Promise<Plan['place']> {
    const [pipeline] = await this.db
      .select({ pipelineId: erxesPipelines.btoPipelineId, stageId: erxesPipelines.btoStageId })
      .from(erxesPipelines)
      .where(eq(erxesPipelines.erxesId, pipelineErxesId));
    if (!pipeline || pipeline.pipelineId === null || pipeline.stageId === null) return null;
    const found = (await this.access.load(ERXES_JOB_ACTOR)).stage(pipeline.stageId);
    if (
      !found ||
      found.pipeline.id !== pipeline.pipelineId ||
      found.pipeline.archivedAt !== null ||
      found.stage.archivedAt !== null ||
      found.stage.action !== 'NONE'
    ) {
      return null;
    }
    return { pipelineId: pipeline.pipelineId, stageId: pipeline.stageId };
  }

  /**
   * The Bto customer (ADR-0218 #6): the one a person chose; else the first company or customer of
   * the deal whose code is a Bto customer code; else by register number; else by phone.
   */
  private async customerOf(
    parties: readonly ErxesParty[],
    choices: ErxesDealChoices,
  ): Promise<{ id: number | null; issue: ErxesWaitIssue | null }> {
    if (choices.customerId !== undefined) return { id: choices.customerId, issue: null };
    const first = parties[0];
    if (!first) return { id: null, issue: { reason: 'NO_CUSTOMER' } };
    const codes = parties.flatMap((party) => (party.code ? [party.code] : []));
    const byCode = await this.customers.findByCodes(codes);
    for (const code of codes) {
      const found = byCode.find((row) => row.code === code);
      if (found) return { id: found.id, issue: null };
    }
    const named = {
      ...(first.code ? { code: first.code } : {}),
      ...(first.name ? { name: first.name } : {}),
    };
    const exact = async (
      q: string,
      fits: (row: { regNo: string | null; phone: string | null }) => boolean,
    ) => (await this.customers.list(ERXES_READER, { q, limit: 20 })).data.filter(fits);
    for (const party of parties) {
      if (!party.regNo) continue;
      const regNo = normalizeRegNo(party.regNo);
      const found = await exact(
        party.regNo,
        (row) => row.regNo !== null && normalizeRegNo(row.regNo) === regNo,
      );
      if (found.length === 1 && found[0]) return { id: found[0].id, issue: null };
      if (found.length > 1) return { id: null, issue: { reason: 'CUSTOMER_AMBIGUOUS', ...named } };
    }
    for (const party of parties) {
      for (const typed of party.phones) {
        const phone = normalizeMnPhone(typed);
        if (!phone) continue;
        const found = await exact(typed, (row) => row.phone === phone);
        if (found.length === 1 && found[0]) return { id: found[0].id, issue: null };
        if (found.length > 1)
          return { id: null, issue: { reason: 'CUSTOMER_AMBIGUOUS', ...named } };
      }
    }
    return { id: null, issue: { reason: 'CUSTOMER_NOT_FOUND', ...named } };
  }

  /**
   * A line's Bto unit and quantity (ADR-0218 #6): the unit a person chose; else the product whose
   * code (SKU) is erxes's product code; else the one product holding that code, or one of erxes's
   * barcodes, as a barcode. Its unit is the Bto unit named like the line's; a line in the erxes
   * product's own unit takes Bto's base unit.
   */
  private async lineOf(
    line: ErxesLine,
    choices: ErxesDealChoices,
  ): Promise<{ line: OrderLineInput } | { issue: ErxesWaitIssue }> {
    const named = {
      ...(line.erxesProductId ? { erxesProductId: line.erxesProductId } : {}),
      ...(line.code ? { code: line.code } : {}),
      ...(line.name ? { name: line.name } : {}),
    };
    const qty = line.quantity === null ? null : new Decimal(line.quantity);
    if (qty === null || !qty.gt(0)) return { issue: { reason: 'BAD_QUANTITY', ...named } };
    const chosen = line.erxesProductId ? choices.units?.[line.erxesProductId] : undefined;
    if (chosen !== undefined) {
      const unit = (await this.units.describe([chosen])).get(chosen);
      if (unit?.current) return { line: { productUnitId: chosen, qty } };
    }
    let productId: number | null = null;
    if (line.code) {
      const [bySku] = await this.products.productsBySku([line.code]);
      productId = bySku?.id ?? null;
    }
    if (productId === null) {
      // The erxes code first (the old codes live on as barcodes), then erxes's own barcodes.
      for (const code of [line.code, ...line.barcodes]) {
        if (!code) continue;
        const owners = new Set((await this.barcodes.lookup(code)).map((hit) => hit.productId));
        if (owners.size > 1) return { issue: { reason: 'PRODUCT_AMBIGUOUS', ...named } };
        const [only] = owners;
        if (only !== undefined) {
          productId = only;
          break;
        }
      }
    }
    if (productId === null) return { issue: { reason: 'PRODUCT_NOT_FOUND', ...named } };
    const units = (await this.units.currentUnits([productId])).get(productId) ?? [];
    const namedUnit = units.find(
      (unit) => same(unit.uomName, line.uom) || same(unit.uomCode, line.uom),
    );
    const base = units.find((unit) => unit.isBase);
    const inOwnUnit =
      line.uom === null || line.productUom === null || same(line.uom, line.productUom);
    const unit = namedUnit ?? (inOwnUnit ? base : undefined);
    if (!unit) return { issue: { reason: 'UNIT_NOT_FOUND', ...named } };
    return { line: { productUnitId: unit.unitId, qty } };
  }

  /** The Bto user who created the deal in erxes, and the name erxes knows them by. */
  private async creatorOf(
    facts: ErxesDealFacts,
  ): Promise<{ creatorUserId: number | null; creatorName: string | null }> {
    const [known] = facts.creatorId
      ? await this.db.select().from(erxesUsers).where(eq(erxesUsers.erxesId, facts.creatorId))
      : [];
    const person: ErxesPerson | null =
      facts.creator ??
      (known
        ? {
            erxesId: known.erxesId,
            email: known.email,
            username: known.username,
            fullName: known.fullName,
            phone: known.phone,
          }
        : null);
    const creatorName = personName(person) ?? facts.creatorId;
    if (known?.btoUserId) return { creatorUserId: known.btoUserId, creatorName };
    return { creatorUserId: matchStaff(person, await this.names.allStaff()), creatorName };
  }

  /** Writes why a deal waits, unless it stopped waiting meanwhile. */
  private async wait(dealId: number, issues: ErxesWaitIssue[]): Promise<CopyOutcome> {
    const [row] = await this.db
      .update(erxesDeals)
      .set({
        issues,
        attempts: sql`${erxesDeals.attempts} + 1`,
        lastTriedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(erxesDeals.id, dealId), eq(erxesDeals.status, 'WAITING')))
      .returning();
    if (row) return outcomeOf(row);
    const [now] = await this.db.select().from(erxesDeals).where(eq(erxesDeals.id, dealId));
    if (!now) throw notFound('erxes deal', dealId);
    return outcomeOf(now);
  }

  /** The waiting deals, oldest first: what a pull tries again. */
  async waitingIds(limit: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: erxesDeals.id })
      .from(erxesDeals)
      .where(eq(erxesDeals.status, 'WAITING'))
      .orderBy(asc(erxesDeals.lastTriedAt), asc(erxesDeals.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}

function outcomeOf(deal: DealRow): CopyOutcome {
  return { status: deal.status, orderId: deal.orderId, issues: deal.issues, copiedNow: false };
}

/** The day the goods are wanted: the deal's close date when it is not past, else tomorrow. */
function deliveryDateOf(facts: ErxesDealFacts): string {
  const today = businessDate();
  const wanted = facts.closeDate ? businessDate(facts.closeDate) : null;
  return wanted !== null && wanted >= today ? wanted : defaultDeliveryDate(today);
}

/** The order's contact: the deal's first person, and the first phone that is a Mongolian mobile. */
function contactOf(facts: ErxesDealFacts): {
  contactName: string | null;
  contactPhone: string | null;
} {
  const person = facts.parties.find((party) => party.kind === 'CUSTOMER');
  const phones = [...(person?.phones ?? []), ...facts.parties.flatMap((party) => party.phones)];
  const phone = phones.map((typed) => normalizeMnPhone(typed)).find((value) => value !== null);
  return {
    contactName: person?.name ? person.name.slice(0, ORDER_LIMITS.maxContactName) : null,
    contactPhone: phone ?? null,
  };
}
