import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  LLM_CLIENT,
  type LlmClient,
  type LlmContentPart,
  LlmError,
} from '../../../integrations/llm';
import { CatalogService, UnitConversionService } from '../../catalog';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  StorageService,
  UserNamesService,
} from '../../identity';
import { ReceiptsService } from '../../inventory';
import { SuppliersService } from '../../partners';
import {
  type PoInvoiceCheckStatus,
  purchaseOrderInvoiceChecks,
  purchaseOrderLines,
  purchaseOrders,
  purchaseOrderSuppliers,
} from '../schema';
import { COSTS, EDIT, MANAGE, ordererOf, PRICES, READ } from './support';

/** The file kind of a supplier's invoice photo (ADR-0122), private. */
export const INVOICE_IMAGE = 'procurement.invoice_image';

export const INVOICE_LINE_STATUSES = [
  'MATCH',
  'QTY_DIFF',
  'PRICE_DIFF',
  'NOT_ORDERED',
  'MISSING',
  'UNREADABLE',
] as const;
export type InvoiceLineStatus = (typeof INVOICE_LINE_STATUSES)[number];

/** One line of the comparison, as the model wrote it against the ordered lines it was given. */
export interface InvoiceCheckLine {
  /** The ordered product this invoice line was matched to, or null (not ordered). */
  productId: number | null;
  sku: string | null;
  /** The name as printed on the invoice (empty for an ordered line the invoice lacks). */
  invoiceName: string;
  invoiceQty: string | null;
  invoiceUnitPrice: string | null;
  invoiceAmount: string | null;
  /** The ordered quantity in the line's unit, with the unit's name. */
  orderedQty: string | null;
  orderedUnit: string | null;
  status: InvoiceLineStatus;
  note: string;
}

export interface InvoiceCheckResult {
  invoiceTotal: string | null;
  invoiceLineCount: number | null;
  totalsMatch: boolean;
  lines: InvoiceCheckLine[];
  /** The model's explanation of the differences, in Mongolian. */
  summary: string;
}

export interface InvoiceCheckView {
  id: number;
  orderId: number;
  supplierId: number;
  status: PoInvoiceCheckStatus;
  model: string | null;
  invoiceTotal: Decimal | null;
  orderedTotal: Decimal | null;
  result: InvoiceCheckResult | null;
  errorReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

const RESULT_SCHEMA = {
  name: 'invoice_check',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['invoiceTotal', 'invoiceLineCount', 'totalsMatch', 'lines', 'summary'],
    properties: {
      invoiceTotal: {
        type: ['string', 'null'],
        description: 'The invoice total in MNT, digits only',
      },
      invoiceLineCount: { type: ['integer', 'null'] },
      totalsMatch: { type: 'boolean' },
      summary: { type: 'string' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'productId',
            'invoiceName',
            'invoiceQty',
            'invoiceUnitPrice',
            'invoiceAmount',
            'status',
            'note',
          ],
          properties: {
            productId: { type: ['integer', 'null'] },
            invoiceName: { type: 'string' },
            invoiceQty: { type: ['string', 'null'] },
            invoiceUnitPrice: { type: ['string', 'null'] },
            invoiceAmount: { type: ['string', 'null'] },
            status: { type: 'string', enum: [...INVOICE_LINE_STATUSES] },
            note: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

const ModelAnswer = z.object({
  invoiceTotal: z.string().nullable(),
  invoiceLineCount: z.number().int().nullable(),
  totalsMatch: z.boolean(),
  summary: z.string(),
  lines: z.array(
    z.object({
      productId: z.number().int().nullable(),
      invoiceName: z.string(),
      invoiceQty: z.string().nullable(),
      invoiceUnitPrice: z.string().nullable(),
      invoiceAmount: z.string().nullable(),
      status: z.enum(INVOICE_LINE_STATUSES),
      note: z.string(),
    }),
  ),
});

const ANSWER_TOKENS = 8_000;
/** Lines the prompt lists at most; longer orders are checked against their first lines. */
const MAX_PROMPT_LINES = 400;
/** The summary kept in the audit row. */
const SUMMARY_IN_AUDIT = 300;
/** Checks kept per supplier of an order on screen. */
const CHECKS_SHOWN = 10;

const INSTRUCTIONS = `You read a supplier's invoice (падаан) photographed by a Mongolian wholesaler and compare it with
what the wholesaler ordered from that supplier. You receive the ordered lines as JSON (product id,
code, name, ordered quantity with its unit, the estimated unit price in MNT when known) and the
photo. Read every line of the invoice: name, quantity, unit price, amount, and the invoice total.
Match each invoice line to an ordered line by name (brands, sizes and packaging may be written
differently; quantities may be in boxes or pieces — compare carefully). Report one line per invoice
line (status MATCH, QTY_DIFF, PRICE_DIFF or NOT_ORDERED) and one line per ordered product the
invoice lacks (status MISSING, invoice fields null). Use UNREADABLE when a line cannot be read.
Numbers are decimal strings with a dot, no thousands separators, no currency. totalsMatch is true
when the invoice total equals the sum of the invoice lines you read and no line differs.
Write the summary in Mongolian: what matches, every difference with both sides' figures, and what
you could not read. Never invent figures: when unsure, say so in the note.`;

/**
 * The AI's check of a supplier's final invoice against the order (owner 2026-10-30, ADR-0122): the
 * orderer photographs the invoice, the model reads it and compares the lines and the total with
 * the ordered lines, and the page shows both sides of every difference with the model's
 * explanation. The photo is a private file; the call runs between the two transactions (ADR-0045);
 * the prompt and the raw answer are never stored or logged.
 */
@Injectable()
export class InvoiceCheckFlowService {
  private readonly logger = new Logger(InvoiceCheckFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly suppliers: SuppliersService,
    private readonly receipts: ReceiptsService,
    private readonly userNames: UserNamesService,
  ) {}

  /** Whether a check can run now (a model is configured). */
  get configured(): boolean {
    return this.llm !== null;
  }

  /** The checks of a supplier on an order, newest first. */
  async list(ctx: AuthContext, orderId: number, supplierId: number): Promise<InvoiceCheckView[]> {
    this.assertReader(ctx);
    const supplier = await this.orderSupplier(orderId, supplierId);
    const rows = await this.db
      .select()
      .from(purchaseOrderInvoiceChecks)
      .where(eq(purchaseOrderInvoiceChecks.orderSupplierId, supplier.id))
      .orderBy(desc(purchaseOrderInvoiceChecks.id))
      .limit(CHECKS_SHOWN);
    const names = await this.userNames.namesOf(
      rows.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
    );
    return rows.map((row) => viewOf(row, orderId, supplierId, names));
  }

  /** The photo of a check, for the page. */
  async image(ctx: AuthContext, checkId: number) {
    this.assertReader(ctx);
    const [row] = await this.db
      .select({ fileId: purchaseOrderInvoiceChecks.fileId })
      .from(purchaseOrderInvoiceChecks)
      .where(eq(purchaseOrderInvoiceChecks.id, checkId));
    if (!row) throw notFound('invoice check', checkId);
    return this.storage.openPrivate(row.fileId, INVOICE_IMAGE);
  }

  /**
   * Runs one check: the uploaded photo is attached (first transaction), read by the model (no
   * transaction open), and the comparison stored (second transaction). A provider failure leaves
   * the check FAILED with its reason; the photo stays.
   */
  async run(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    fileId: number,
  ): Promise<InvoiceCheckView> {
    await this.assertRunner(ctx, supplierId);
    const llm = this.llm;
    if (llm === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'no model is configured for the invoice check');
    }
    const supplier = await this.orderSupplier(orderId, supplierId);
    const file = await this.storage.verifyUploaded(fileId, INVOICE_IMAGE);
    const mediaType = file.contentType;
    if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `an invoice photo is not ${mediaType}`);
    }

    const ordered = await this.orderedLines(ctx, supplier.id);
    const checkId = await inTransaction(this.db, async (tx) => {
      await this.storage.confirm(tx, fileId, INVOICE_IMAGE);
      const [row] = await tx
        .insert(purchaseOrderInvoiceChecks)
        .values({
          orderSupplierId: supplier.id,
          fileId,
          orderedTotal: ordered.total,
          createdBy: actorUserId(ctx),
        })
        .returning({ id: purchaseOrderInvoiceChecks.id });
      if (!row) throw new Error('invoice check insert returned nothing');
      return row.id;
    });

    const { body } = await this.storage.openPrivate(fileId, INVOICE_IMAGE);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    const image: LlmContentPart = {
      type: 'image',
      mediaType,
      data: Buffer.concat(chunks).toString('base64'),
    };
    const supplierName = (await this.suppliers.getMany([supplierId]))[0]?.name ?? '';
    const prompt: LlmContentPart = {
      type: 'text',
      text: JSON.stringify({
        supplier: supplierName,
        date: businessDate(),
        orderedLines: ordered.lines,
        ...(ordered.total === null ? {} : { estimatedTotal: ordered.total.toFixed(2) }),
      }),
    };

    let outcome:
      | { status: 'DONE'; model: string; result: InvoiceCheckResult }
      | { status: 'FAILED'; model: string | null; reason: string };
    try {
      const answer = await llm.complete({
        instructions: INSTRUCTIONS,
        messages: [{ role: 'user', content: [prompt, image] }],
        output: RESULT_SCHEMA,
        maxOutputTokens: ANSWER_TOKENS,
      });
      const parsed = ModelAnswer.safeParse(parseJson(answer.text));
      if (!parsed.success) {
        throw new LlmError('INVALID_RESPONSE', 'the answer does not match the schema');
      }
      outcome = {
        status: 'DONE',
        model: answer.model,
        result: resultOf(parsed.data, ordered.lines),
      };
    } catch (error: unknown) {
      if (!(error instanceof LlmError)) throw error;
      this.logger.warn(
        { reason: error.reason, status: error.status, providerCode: error.providerCode },
        'invoice check failed at the provider',
      );
      outcome = { status: 'FAILED', model: null, reason: error.reason };
    }

    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .update(purchaseOrderInvoiceChecks)
        .set(
          outcome.status === 'DONE'
            ? {
                status: 'DONE',
                model: outcome.model,
                invoiceTotal: moneyOf(outcome.result.invoiceTotal),
                result: outcome.result,
                finishedAt: new Date(),
              }
            : { status: 'FAILED', errorReason: outcome.reason, finishedAt: new Date() },
        )
        .where(eq(purchaseOrderInvoiceChecks.id, checkId))
        .returning();
      if (!row) throw notFound('invoice check', checkId);
      await this.audit.record(tx, ctx, {
        action: 'INVOICE_CHECK',
        entity: 'purchase_order_suppliers',
        entityId: supplier.id,
        after: {
          checkId,
          status: row.status,
          invoiceTotal: row.invoiceTotal?.toFixed(2) ?? null,
          orderedTotal: row.orderedTotal?.toFixed(2) ?? null,
          summary:
            outcome.status === 'DONE' ? outcome.result.summary.slice(0, SUMMARY_IN_AUDIT) : null,
          errorReason: row.errorReason,
        },
      });
      const names = await this.userNames.namesOf(row.createdBy === null ? [] : [row.createdBy], tx);
      return viewOf(row, orderId, supplierId, names);
    });
  }

  /** The supplier's ordered lines as the prompt lists them, and the order's estimate for the supplier. */
  private async orderedLines(ctx: AuthContext, orderSupplierId: number) {
    const lines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderSupplierId, orderSupplierId))
      .orderBy(purchaseOrderLines.id);
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.describe([...new Set(lines.map((line) => line.productUnitId))]);
    const withPrices = ctx.permissions.has(PRICES) || ctx.permissions.has(COSTS);
    const prices = withPrices
      ? new Map(
          (await this.receipts.lastPrices(productIds)).map((price) => [
            price.productId,
            price.basePrice,
          ]),
        )
      : new Map<number, Decimal>();
    let total: Decimal | null = withPrices ? new Decimal(0) : null;
    const listed = lines.slice(0, MAX_PROMPT_LINES).map((line) => {
      const product = products.get(line.productId);
      const unit = units.get(line.productUnitId);
      const basePrice = prices.get(line.productId);
      const unitPrice = basePrice ? basePrice.times(line.factorSnapshot) : null;
      if (total && basePrice) total = total.plus(basePrice.times(line.qtyBase));
      return {
        productId: line.productId,
        sku: product?.sku ?? '',
        name: product?.name ?? '',
        orderedQty: line.qty.toFixed(),
        unit: unit?.uomName ?? '',
        piecesPerUnit: line.factorSnapshot.toFixed(),
        ...(unitPrice ? { estimatedUnitPrice: unitPrice.toDecimalPlaces(2).toFixed() } : {}),
      };
    });
    return { lines: listed, total: total ? total.toDecimalPlaces(2) : null };
  }

  private async orderSupplier(orderId: number, supplierId: number) {
    const [row] = await this.db
      .select({ supplier: purchaseOrderSuppliers, archivedAt: purchaseOrders.archivedAt })
      .from(purchaseOrderSuppliers)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderSuppliers.orderId))
      .where(
        and(
          eq(purchaseOrderSuppliers.orderId, orderId),
          eq(purchaseOrderSuppliers.supplierId, supplierId),
        ),
      );
    if (!row) throw notFound('purchase order supplier', supplierId);
    return row.supplier;
  }

  /** Order readers, price readers and cost holders read the checks. */
  private assertReader(ctx: AuthContext): void {
    if (!ctx.permissions.has(READ) && !ctx.permissions.has(PRICES) && !ctx.permissions.has(COSTS)) {
      throw new AppError('FORBIDDEN', 'invoice checks are for order readers', {
        permission: READ,
      });
    }
  }

  /** A manager, the supplier's orderer or a cost holder runs a check. */
  private async assertRunner(ctx: AuthContext, supplierId: number): Promise<void> {
    if (ctx.permissions.has(MANAGE) || ctx.permissions.has(COSTS)) return;
    if (ctx.permissions.has(EDIT) && (await ordererOf(this.db, supplierId)) === ctx.userId) return;
    throw new AppError(
      'FORBIDDEN',
      'the invoice check is for managers, orderers and cost holders',
      {
        permission: MANAGE,
      },
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The model's answer completed with the ordered side of every matched line. */
function resultOf(
  answer: z.infer<typeof ModelAnswer>,
  ordered: readonly { productId: number; sku: string; orderedQty: string; unit: string }[],
): InvoiceCheckResult {
  const byId = new Map(ordered.map((line) => [line.productId, line]));
  return {
    invoiceTotal: numberText(answer.invoiceTotal),
    invoiceLineCount: answer.invoiceLineCount,
    totalsMatch: answer.totalsMatch,
    summary: answer.summary.slice(0, 4_000),
    lines: answer.lines.slice(0, 1_000).map((line) => {
      const match = line.productId === null ? undefined : byId.get(line.productId);
      return {
        productId: match?.productId ?? null,
        sku: match?.sku ?? null,
        invoiceName: line.invoiceName.slice(0, 200),
        invoiceQty: numberText(line.invoiceQty),
        invoiceUnitPrice: numberText(line.invoiceUnitPrice),
        invoiceAmount: numberText(line.invoiceAmount),
        orderedQty: match?.orderedQty ?? null,
        orderedUnit: match?.unit ?? null,
        status: match || line.productId === null ? line.status : 'UNREADABLE',
        note: line.note.slice(0, 500),
      };
    }),
  };
}

/** A decimal string as the model should have written it, else null (never a NaN on screen). */
function numberText(value: string | null): string | null {
  if (value === null) return null;
  const text = value.replace(/[\s,₮]/g, '');
  return /^-?\d{1,13}(\.\d{1,4})?$/.test(text) ? new Decimal(text).toFixed() : null;
}

function moneyOf(value: string | null): Decimal | null {
  if (value === null) return null;
  const amount = new Decimal(value).toDecimalPlaces(2);
  return amount.abs().lt(new Decimal('1e12')) ? amount : null;
}

function viewOf(
  row: typeof purchaseOrderInvoiceChecks.$inferSelect,
  orderId: number,
  supplierId: number,
  names: ReadonlyMap<number, string>,
): InvoiceCheckView {
  return {
    id: row.id,
    orderId,
    supplierId,
    status: row.status,
    model: row.model,
    invoiceTotal: row.invoiceTotal,
    orderedTotal: row.orderedTotal,
    result: row.result === null ? null : (row.result as InvoiceCheckResult),
    errorReason: row.errorReason,
    createdBy: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
