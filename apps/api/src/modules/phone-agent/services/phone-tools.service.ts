import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NEW_PRODUCT_DAYS } from '@tugeel/shared/catalog';
import { Decimal } from '@tugeel/shared/money';
import { FULFILMENTS } from '@tugeel/shared/sales';
import { addDays, businessDate } from '@tugeel/shared/time';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { CodedError, isCodedError } from '../../../common/errors/coded-error';
import { canonicalJson } from '../../../common/json/canonical';
import { UnitConversionService } from '../../catalog';
import type { PhoneLineActor } from '../../identity';
import { CustomerAddressesService } from '../../partners';
import { PriceQuoteService } from '../../pricing';
import {
  CustomerOrdersService,
  type RepProduct,
  SalesOrdersService,
  SalesPipelinesService,
  SalesRepShopService,
} from '../../sales';
import { PHONE_AGENT_LISTENER, type PhoneAgentListener } from '../hooks';
import { PhoneError } from '../phone-agent.errors';
import { confirmed, isPhoneTool, PHONE_LIMITS, type PhoneTool } from '../phone-agent.rules';
import { phoneCallbacks, phoneCallMessages, phoneCalls } from '../schema';
import { type CallRow, type MessageMeta, metaOf, PhoneCallsService } from './phone-calls.service';
import type { PhoneLine } from './phone-lines.service';
import { PhoneProductSearchService } from './phone-product-search.service';

/** One tool call as the bridge forwards it (ADR-0232 #3). */
export interface ToolCall {
  /** Every sequence number up to this one was delivered before the call. */
  afterSeq: number;
  /** The call's own place in the transcript. */
  seq: number;
  /** Milliseconds from the call's start; the server's clock when the bridge sends none. */
  atMs?: number | null;
  args: Record<string, unknown>;
}

/** A tool's answer for the agent: small, by value, nothing but what it may say (ADR-0232 #11). */
export type ToolAnswer = Record<string, unknown>;

interface ToolResult {
  answer: ToolAnswer;
  meta?: Partial<MessageMeta>;
}

/** What a tool writes, inside the transaction that also stores its TOOL message. */
type Commit = (tx: Tx, call: CallRow) => Promise<ToolResult>;

type MessageRow = typeof phoneCallMessages.$inferSelect;

const DAY_MS = 86_400_000;
/** A quantity as the agent may send it: a number or digits, at most three decimals. */
const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const qty = z
  .union([z.number().positive().finite(), z.string().trim().regex(QTY)])
  .transform((value) => String(value))
  .refine((value) => QTY.test(value) && new Decimal(value).gt(0));
const id = z.number().int().positive();

const ARGS = {
  search_products: z.object({ query: z.string().trim().min(1).max(PHONE_LIMITS.queryMax) }),
  check_availability: z.object({ productId: id, unitId: id, qty }),
  quote: z.object({
    lines: z
      .array(z.object({ unitId: id, qty }))
      .min(1)
      .max(PHONE_LIMITS.quoteLines),
  }),
  place_order: z.object({
    quoteId: z.uuid(),
    fulfilment: z.enum(FULFILMENTS).nullish(),
    note: z.string().trim().max(PHONE_LIMITS.noteMax).nullish(),
  }),
  order_status: z.object({
    number: z.string().trim().max(PHONE_LIMITS.orderNumberMax).nullish(),
  }),
  new_products: z.object({
    limit: z.number().int().min(1).max(PHONE_LIMITS.newProductsMax).nullish(),
  }),
  request_callback: z.object({ reason: z.string().trim().min(1).max(PHONE_LIMITS.reasonMax) }),
  end_call: z.object({ reason: z.string().trim().max(PHONE_LIMITS.reasonMax).nullish() }),
} as const;

function parsed<T extends PhoneTool>(tool: T, args: unknown): z.infer<(typeof ARGS)[T]> {
  const result = ARGS[tool].safeParse(args);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join('.') ?? '';
    throw invalid(path ? `args.${path}` : 'args', 'toolArgs', `${tool}: bad arguments`);
  }
  return result.data as z.infer<(typeof ARGS)[T]>;
}

/** A product as a tool names it: no price, no stock number, no code. */
function spoken(product: RepProduct) {
  return {
    productId: product.id,
    name: product.name,
    units: product.units.map((unit) => ({
      unitId: unit.id,
      name: unit.uomName,
      /** Base units in one of this unit: «нэг хайрцагт 24 ширхэг». */
      factor: unit.factorToBase.toString(),
      base: unit.isBase,
    })),
  };
}

/**
 * The agent's client tools (ADR-0232 #6, #7), one call at a time per phone call. Every call is
 * stored as a TOOL message at its sequence number with its answer, or with the code it was refused
 * with: the transcript is complete, and a call sent again with the same number, tool and arguments
 * gets the stored answer instead of a second effect. An order is created only after the caller
 * answered the read-back of this call's latest quote, which the server checks itself.
 *
 * No answer carries a credit limit, a debt, a hold, another store's data or staff data.
 */
@Injectable()
export class PhoneToolsService implements OnModuleInit {
  private listener: PhoneAgentListener | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly calls: PhoneCallsService,
    private readonly shop: SalesRepShopService,
    private readonly units: UnitConversionService,
    private readonly quotes: PriceQuoteService,
    private readonly pipelines: SalesPipelinesService,
    private readonly orders: SalesOrdersService,
    private readonly history: CustomerOrdersService,
    private readonly addresses: CustomerAddressesService,
    private readonly search: PhoneProductSearchService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.listener = this.moduleRef.get<PhoneAgentListener>(PHONE_AGENT_LISTENER, {
        strict: false,
      });
    } catch {
      this.listener = null; // nothing bound (the worker, tests that load the module alone)
    }
  }

  async run(line: PhoneLine, callId: number, name: string, input: ToolCall): Promise<ToolAnswer> {
    if (input.seq <= input.afterSeq) {
      throw invalid('seq', 'afterSeq', 'the tool call comes after the turns it follows');
    }
    const call = await this.calls.ownAnswered(line.id, callId);
    const before = await this.stored(this.db, call.id, name, input);
    if (before) return before;
    try {
      if (!isPhoneTool(name)) {
        throw new PhoneError('PHONE_TOOL_UNKNOWN', `no tool ${name.slice(0, 40)}`);
      }
      if (call.endedAt !== null) throw ended(callId);
      const commit = await this.prepare(name, line, call, input);
      return await inTransaction(this.db, async (tx) => {
        const locked = await this.calls.ownAnswered(line.id, callId, tx, true);
        if (locked.endedAt !== null) throw ended(callId);
        // Another request with the same number got here first: its answer is this one's.
        const raced = await this.stored(tx, callId, name, input);
        if (raced) return raced;
        const result = await commit(tx, locked);
        await tx.insert(phoneCallMessages).values({
          callId,
          seq: input.seq,
          role: 'TOOL',
          text: name,
          atMs: atMsOf(locked, input),
          meta: {
            source: 'BRIDGE',
            tool: name,
            args: input.args,
            ok: true,
            answer: result.answer,
            ...result.meta,
          } satisfies MessageMeta,
        });
        return result.answer;
      });
    } catch (error) {
      // A refusal is part of the conversation: stored at its number, so no gap is left behind it.
      if (isCodedError(error) && error.status < 500 && error.code !== 'PHONE_SEQ_TAKEN') {
        await this.db
          .insert(phoneCallMessages)
          .values({
            callId,
            seq: input.seq,
            role: 'TOOL',
            text: name.slice(0, 60),
            atMs: atMsOf(call, input),
            meta: {
              source: 'BRIDGE',
              tool: name.slice(0, 60),
              args: input.args,
              ok: false,
              code: error.code,
              status: error.status,
            } satisfies MessageMeta,
          })
          .onConflictDoNothing();
      }
      throw error;
    }
  }

  /**
   * What already stands at the call's sequence number: the same tool call's answer (returned) or
   * refusal (thrown again), or PHONE_SEQ_TAKEN for anything else. Null when the number is free.
   */
  private async stored(
    executor: Db | Tx,
    callId: number,
    name: string,
    input: ToolCall,
  ): Promise<ToolAnswer | null> {
    const [row] = await executor
      .select()
      .from(phoneCallMessages)
      .where(and(eq(phoneCallMessages.callId, callId), eq(phoneCallMessages.seq, input.seq)));
    if (!row) return null;
    const meta = metaOf(row.meta);
    const same =
      row.role === 'TOOL' &&
      meta.tool === name.slice(0, 60) &&
      canonicalJson(meta.args) === canonicalJson(input.args);
    if (!same) {
      throw new PhoneError('PHONE_SEQ_TAKEN', `sequence ${input.seq} holds another message`, {
        seq: input.seq,
      });
    }
    if (meta.ok === true) return (meta.answer ?? {}) as ToolAnswer;
    throw new CodedError(meta.code ?? 'PHONE_TOOL_UNKNOWN', meta.status ?? 409, 'refused before');
  }

  /** Reads and checks outside the transaction; what is returned runs inside it. */
  private async prepare(
    tool: PhoneTool,
    line: PhoneLine,
    call: CallRow,
    input: ToolCall,
  ): Promise<Commit> {
    switch (tool) {
      case 'search_products':
        return ready(await this.searchProducts(parsed(tool, input.args)));
      case 'check_availability':
        return ready(await this.checkAvailability(parsed(tool, input.args)));
      case 'quote':
        return ready(await this.quote(call, parsed(tool, input.args)));
      case 'place_order':
        return this.placeOrder(line, input, parsed(tool, input.args));
      case 'order_status':
        return ready(await this.orderStatus(call, parsed(tool, input.args)));
      case 'new_products':
        return ready(await this.newProducts(call, parsed(tool, input.args)));
      case 'request_callback':
        return this.requestCallback(parsed(tool, input.args));
      case 'end_call':
        parsed(tool, input.args);
        return ready({ answer: { ok: true } });
    }
  }

  /**
   * At most five sellable products by what the caller said: those whose name holds every word
   * first (`match: exact`), then partial matches (a brand word, a case ending, a mis-heard word;
   * `PhoneSearchIndex`), in stock first, with a `family` hint when they share a brand. Nothing
   * found is marked `no_hit`; only partial matches, `partial_only`.
   */
  private async searchProducts(args: { query: string }): Promise<ToolResult> {
    const found = await this.search.search(args.query, PHONE_LIMITS.searchRows);
    const products = found.rows.map(({ product, match }) => ({
      ...spoken(product),
      match,
      sellable: product.sellable,
      stock: product.available.gt(0) ? 'available' : 'out',
    }));
    const meta: Partial<MessageMeta> = { search_ms: found.ms.total };
    if (products.length === 0) meta.no_hit = true;
    else if (found.rows.every((row) => row.match === 'partial')) meta.partial_only = true;
    return {
      answer: { products, ...(found.family ? { family: found.family } : {}) },
      meta,
    };
  }

  /**
   * «Байгаа», or «ердөө N <нэгж> үлдсэн» when less is free than was asked (answer 2): the whole
   * units of the asked unit that are left, or base units when not even one of it is. No other number.
   */
  private async checkAvailability(args: {
    productId: number;
    unitId: number;
    qty: string;
  }): Promise<ToolResult> {
    const product = await this.listed(args.productId);
    const unit = product.units.find((own) => own.id === args.unitId);
    if (!unit) throw unknownProduct(args.productId);
    const asked = await this.units.toBase(unit.id, new Decimal(args.qty));
    const free = product.available;
    if (free.lte(0)) return { answer: { status: 'out' } };
    if (asked.qtyBase.lte(free)) return { answer: { status: 'available' } };
    const whole = free.div(unit.factorToBase).floor();
    if (whole.gt(0)) {
      return { answer: { status: 'only', qty: whole.toString(), unit: unit.uomName } };
    }
    const base = product.units.find((own) => own.isBase) ?? unit;
    return { answer: { status: 'only', qty: free.toString(), unit: base.uomName } };
  }

  /**
   * The cart at today's wholesale prices, as the office's confirmation will price it again: a
   * preliminary total (answer 3) under a `quoteId` the order must name. Only a recognised store
   * hears prices.
   */
  private async quote(
    call: CallRow,
    args: { lines: { unitId: number; qty: string }[] },
  ): Promise<ToolResult> {
    if (call.customerId === null) throw unknownCaller();
    const lines = args.lines.map((line) => ({
      productUnitId: line.unitId,
      qty: new Decimal(line.qty),
    }));
    const scope = await this.shop.customerScope();
    await this.shop.assertUnitsListed(
      scope,
      lines.map((line) => line.productUnitId),
    );
    const quote = await this.quotes.quote({
      list: 'WHOLESALE',
      date: businessDate(),
      pipelineId: await this.pipelines.channelPipeline('PHONE_AI'),
      lines: await this.shop.withSourceWarehouses(lines),
    });
    const products = new Map(
      (
        await this.shop.productsOf(
          scope,
          quote.lines.map((line) => line.productId),
        )
      ).map((product) => [product.id, product]),
    );
    const quoteId = randomUUID();
    const spokenLines = quote.lines.map((line) => {
      const product = products.get(line.productId);
      if (!line.result.priced || !product) {
        throw new PhoneError('PHONE_PRICE_MISSING', `product ${line.productId} has no price`, {
          productId: line.productId,
        });
      }
      return {
        productId: line.productId,
        name: product.name,
        unitId: line.productUnitId,
        unit: product.units.find((unit) => unit.id === line.productUnitId)?.uomName ?? '',
        qty: line.qty.toString(),
        total: line.result.total.toFixed(0),
      };
    });
    return {
      answer: { quoteId, preliminary: true, lines: spokenLines, total: quote.total.toFixed(0) },
      meta: {
        quote_id: quoteId,
        quote_lines: lines.map((line) => ({
          productUnitId: line.productUnitId,
          qty: line.qty.toString(),
        })),
      },
    };
  }

  /**
   * «No order without yes» (ADR-0232 #7), checked here and nowhere else. The order is this call's
   * latest quote, line for line; after that quote's message the agent spoke (the read-back) and
   * after that the caller did; every turn up to `afterSeq` is stored. Then a draft like the
   * customer app's: CREDIT, tomorrow, on the PHONE_AI stage without an action, so it reserves
   * nothing and passes no credit check until the office confirms it.
   */
  private placeOrder(
    line: PhoneLine,
    input: ToolCall,
    args: { quoteId: string; fulfilment?: 'PICKUP' | 'DELIVERY' | null; note?: string | null },
  ): Commit {
    return async (tx, call) => {
      if (call.customerId === null) throw unknownCaller();
      if (call.salesOrderId !== null) {
        throw new PhoneError('PHONE_ORDER_PLACED', `call ${call.id} already placed its order`);
      }
      const turns = await this.calls.messages(call.id, tx, input.afterSeq);
      const quote = [...turns].reverse().find((turn) => {
        const meta = metaOf(turn.meta);
        return turn.role === 'TOOL' && meta.tool === 'quote' && meta.ok === true;
      });
      if (!quote || metaOf(quote.meta).quote_id !== args.quoteId) {
        throw new PhoneError('PHONE_QUOTE_NOT_FOUND', 'not the latest quote of this call');
      }
      if (!confirmed(turns, quote.seq, input.afterSeq)) {
        throw new PhoneError('PHONE_ORDER_NOT_CONFIRMED', 'no answer to the read-back yet');
      }
      const placement = await this.pipelines.phoneAiPlacement(tx);
      if (!placement) throw new PhoneError('PHONE_AI_CLOSED', 'no stage takes phone AI orders');
      const address = await this.addresses.defaultAddress(call.customerId, tx);
      const fulfilment = args.fulfilment ?? (address ? 'DELIVERY' : 'PICKUP');
      if (fulfilment === 'DELIVERY' && !address) {
        throw new PhoneError('PHONE_NO_DELIVERY_ADDRESS', 'the store has no default address');
      }
      const deliveryDate = addDays(businessDate(), 1);
      const actor: PhoneLineActor = { kind: 'PHONE_LINE', phoneLineId: line.id };
      const orderId = await this.orders.createInTx(
        tx,
        actor,
        {
          customerId: call.customerId,
          pipelineId: placement.pipelineId,
          stageId: placement.stageId,
          fulfilment,
          deliveryDate,
          addressId: fulfilment === 'DELIVERY' ? (address?.id ?? null) : null,
          contactName: null,
          contactPhone: call.callerPhone,
          paymentMethod: 'CREDIT',
          note: args.note ? args.note : null,
          lines: quoteLines(quote),
        },
        { channel: 'PHONE_AI', placement: () => Promise.resolve(placement) },
      );
      const number = await this.orders.numberOf(tx, orderId);
      if (number === null) throw new Error('a new order has no number');
      await tx
        .update(phoneCalls)
        .set({ salesOrderId: orderId, orderNumber: number, outcome: 'ORDERED' })
        .where(eq(phoneCalls.id, call.id));
      const customer = await this.calls.customerName(call.customerId, tx);
      await this.listener?.onPhoneOrder(tx, {
        callId: call.id,
        orderId,
        orderNumber: number,
        customerId: call.customerId,
        customerName: customer?.name ?? '',
      });
      return { answer: { number, fulfilment, deliveryDate }, meta: { order_id: orderId } };
    };
  }

  /**
   * The store's own orders only (ADR-0079's principle: the store is the server's): the one with
   * this number, or its newest few. Another store's number is «not found», like one that never was.
   */
  private async orderStatus(call: CallRow, args: { number?: string | null }): Promise<ToolResult> {
    if (call.customerId === null) throw unknownCaller();
    const orders = await this.history.statusOf(call.customerId, {
      number: args.number ?? null,
      limit: PHONE_LIMITS.statusOrders,
    });
    return { answer: { found: orders.length > 0, orders } };
  }

  /**
   * The shop's «Шинэ» products that are in stock (answer 4), newest first; told once per call, a
   * second ask answers none.
   */
  private async newProducts(call: CallRow, args: { limit?: number | null }): Promise<ToolResult> {
    const told = (await this.calls.messages(call.id)).some((turn) => {
      const meta = metaOf(turn.meta);
      return turn.role === 'TOOL' && meta.tool === 'new_products' && meta.ok === true;
    });
    if (told) return { answer: { products: [], alreadySuggested: true } };
    const scope = await this.shop.customerScope();
    const since = Date.now() - NEW_PRODUCT_DAYS * DAY_MS;
    const ids = (await this.shop.index(scope))
      .filter((row) => row.saleReadyAt !== null && row.saleReadyAt.getTime() >= since)
      .map((row) => row.id)
      .slice(0, 40);
    const found = new Map(
      (await this.shop.productsOf(scope, ids)).map((product) => [product.id, product]),
    );
    const products = ids
      .flatMap((productId) => {
        const product = found.get(productId);
        return product && product.sellable && product.available.gt(0) ? [spoken(product)] : [];
      })
      .slice(0, args.limit ?? 2);
    return { answer: { products } };
  }

  /** A task for staff to ring back; a call leaves one, however often the agent asks. */
  private requestCallback(args: { reason: string }): Commit {
    return async (tx, call) => {
      const [existing] = await tx
        .select({ id: phoneCallbacks.id })
        .from(phoneCallbacks)
        .where(eq(phoneCallbacks.callId, call.id))
        .limit(1);
      if (existing) return { answer: { ok: true }, meta: { callback_id: existing.id } };
      const phone = call.callerPhone ?? call.callerRaw;
      const [callback] = await tx
        .insert(phoneCallbacks)
        .values({ callId: call.id, phone, customerId: call.customerId, reason: args.reason })
        .returning({ id: phoneCallbacks.id });
      if (!callback) throw new Error('phone callback not inserted');
      await tx
        .update(phoneCalls)
        .set({ outcome: 'CALLBACK' })
        .where(and(eq(phoneCalls.id, call.id), isNull(phoneCalls.salesOrderId)));
      const customer =
        call.customerId === null ? null : await this.calls.customerName(call.customerId, tx);
      await this.listener?.onPhoneCallback(tx, {
        callId: call.id,
        callbackId: callback.id,
        customerId: call.customerId,
        customerName: customer?.name ?? null,
        phone,
      });
      return { answer: { ok: true }, meta: { callback_id: callback.id } };
    };
  }

  /** A product the line sells: in the shop's assortment, with a home warehouse. */
  private async listed(productId: number): Promise<RepProduct> {
    const [product] = await this.shop.productsOf(await this.shop.customerScope(), [productId]);
    if (!product || product.homeWarehouseId === null) throw unknownProduct(productId);
    return product;
  }
}

const ready =
  (result: ToolResult): Commit =>
  () =>
    Promise.resolve(result);

const ended = (callId: number) =>
  new PhoneError('PHONE_CALL_ENDED', `phone call ${callId} has ended`, { id: callId });
const unknownCaller = () =>
  new PhoneError('PHONE_CALLER_UNKNOWN', 'the caller is not one recognised store');
const unknownProduct = (productId: number) =>
  new PhoneError('PHONE_PRODUCT_NOT_FOUND', `product ${productId} is not sold by phone`, {
    productId,
  });

function atMsOf(call: CallRow, input: ToolCall): number {
  const given = input.atMs ?? Date.now() - call.startedAt.getTime();
  return Math.min(Math.max(Math.trunc(given), 0), PHONE_LIMITS.atMsMax);
}

/** The order's lines: exactly what the quote priced, never something the agent sends later. */
function quoteLines(quote: MessageRow): { productUnitId: number; qty: Decimal }[] {
  const stored = metaOf(quote.meta).quote_lines;
  if (!Array.isArray(stored) || stored.length === 0) {
    throw new PhoneError('PHONE_QUOTE_NOT_FOUND', 'the quote kept no lines');
  }
  return stored.map((line: { productUnitId: number; qty: string }) => ({
    productUnitId: line.productUnitId,
    qty: new Decimal(line.qty),
  }));
}
