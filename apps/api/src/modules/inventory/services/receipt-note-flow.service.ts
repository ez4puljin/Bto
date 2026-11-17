import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  normalisedPhoto,
  PAGE_MAX_SIDE,
  thumbnailOf,
  UnreadablePictureError,
} from '../../../common/images/product-picture';
import {
  type LlmClient,
  type LlmContentPart,
  LlmError,
  LlmGateway,
} from '../../../integrations/llm';
import {
  type ScanSource,
  ScannerError,
  type ScannerFacts,
  ScannerGateway,
} from '../../../integrations/scanner';
import { BarcodeService, CatalogService, UnitConversionService } from '../../catalog';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  StorageService,
  type StoredFile,
  UserNamesService,
} from '../../identity';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import {
  goodsReceipts,
  noteScanners,
  receiptNoteAliases,
  receiptNoteReadingPages,
  receiptNoteReadings,
  receiptNoteTemplates,
} from '../schema';
import { scannerUrlOf } from './note-scanner';
import {
  MAX_NOTE_PAGES,
  MAX_OFFERED_UNITS,
  NOTE_IDENTIFY_INSTRUCTIONS,
  NOTE_IDENTIFY_SCHEMA,
  NOTE_READ_INSTRUCTIONS,
  NOTE_READ_SCHEMA,
  noteBarcodes,
  NoteIdentifyAnswer,
  type NoteLine,
  noteLineKey,
  noteLineLabel,
  type NoteMatchKind,
  notePriceOf,
  type NoteProposal,
  noteProposalOf,
  NoteReadAnswer,
  noteReadData,
  type NoteVatState,
  type OfferedUnit,
  supplierOf,
} from './receipt-note-ai';
import { type ReceiptLineInput, ReceiptsService } from './receipts.service';

/** The file kind of a page given to a reading (ADR-0210), private. */
export const NOTE_PAGE = 'inventory.note_page';
const PDF = 'application/pdf';
const COSTS = 'inventory.costs.manage';

/** A whole note in one answer: a hundred lines are several thousand tokens. */
const ANSWER_TOKENS = 20_000;
const IDENTIFY_TOKENS = 500;
/** A many-page note is read for minutes, not seconds. */
const READ_TIMEOUT_MS = 280_000;
/** A reading still «reading» after this long lost its process (a restart); it may be started again. */
const STALE_AFTER_MS = 6 * 60_000;
const OPEN_LIST_LIMIT = 60;

type ReadingRow = typeof receiptNoteReadings.$inferSelect;
type ScannerRow = typeof noteScanners.$inferSelect;
export type NoteReadingStatus = ReadingRow['status'];

/** Why a reading failed: a code for the screen, never the provider's words. */
export interface NoteReadingFailure {
  /** An LlmError reason, UNREADABLE_PAGE for a page that is no picture, or INTERNAL. */
  reason: string;
  status: number | null;
  providerCode: string | null;
}

export interface NoteUnitOption {
  unitId: number;
  name: string;
  factor: string;
}

/** A read line as the screen shows it: prices only for cost holders. */
export interface NoteLineView extends Omit<NoteLine, 'match'> {
  index: number;
  match: {
    how: NoteMatchKind;
    productUnitId: number;
    productId: number;
    sku: string;
    productName: string;
    /** The product's current units, to change the unit without searching again. */
    units: NoteUnitOption[];
  } | null;
}

export interface NoteReadingView {
  id: number;
  status: NoteReadingStatus;
  /** READING for so long that its process must be gone. */
  stale: boolean;
  supplier: { id: number; code: string; name: string } | null;
  pages: { fileId: number; contentType: string }[];
  failure: NoteReadingFailure | null;
  receiptId: number | null;
  receiptNumber: string | null;
  createdByName: string | null;
  createdAt: Date;
  proposal: {
    supplierRead: NoteProposal['supplierRead'];
    docNo: string | null;
    docDate: string | null;
    totalQty: string | null;
    totalAmount: string | null;
    vat: NoteVatState;
    cut: number;
    remark: string;
    lines: NoteLineView[];
  } | null;
  /** What is remembered of the supplier's notes; null without a supplier. */
  memory: NoteMemory | null;
}

export interface NoteReadingSummary {
  id: number;
  status: NoteReadingStatus;
  stale: boolean;
  supplierName: string | null;
  pageCount: number;
  lineCount: number | null;
  createdByName: string | null;
  createdAt: Date;
}

/** What the system keeps of one supplier's notes. */
export interface NoteMemory {
  /** Notes of this supplier saved as receipts. */
  readings: number;
  /** Lines remembered with their product. */
  lines: number;
  /** Whether the model's notes on the layout are kept. */
  layout: boolean;
}

export interface NoteDraftInput {
  supplierId: number;
  supplierDocNo?: string | null;
  supplierDocDate?: string | null;
  /** The lines to save, by their index in the reading, with the product unit and the quantity. */
  lines: readonly { index: number; productUnitId: number; enteredQty: Decimal }[];
}

export interface NoteScannerView {
  id: number;
  name: string;
  url: string;
  active: boolean;
}

export interface NoteStatus {
  /** A model is set, so notes can be read. */
  read: boolean;
  scanners: { id: number; name: string }[];
}

export interface ScannedSheet {
  fileId: number;
  /** A small JPEG of the sheet in base64, to show before it is read. */
  preview: string;
}

/**
 * «Падаан унших» (owner 2026-11-17, ADR-0210). A supplier's delivery note, as photos, scanned
 * sheets or PDF files, is read by the vision model into a proposal: the note's header and its
 * lines, each matched to a product unit by its barcode, by what a person saved for the same line of
 * this supplier before, or by the model's choice among the supplier's products. A person checks the
 * proposal and saves it as a draft receipt, which is then finished in the receipt window like any
 * other; saving teaches the supplier's memory. The model is called outside any transaction and its
 * prompt, pages and answer are never logged; the answer is kept only as the checked proposal.
 */
@Injectable()
export class ReceiptNoteFlowService {
  private readonly logger = new Logger(ReceiptNoteFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmGateway,
    private readonly scannerGateway: ScannerGateway,
    private readonly storage: StorageService,
    private readonly receipts: ReceiptsService,
    private readonly suppliers: SuppliersService,
    private readonly links: ProductSuppliersService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly barcodes: BarcodeService,
    private readonly audit: AuditService,
    private readonly userNames: UserNamesService,
  ) {}

  async status(): Promise<NoteStatus> {
    const scanners = await this.db
      .select({ id: noteScanners.id, name: noteScanners.name })
      .from(noteScanners)
      .where(eq(noteScanners.active, true))
      .orderBy(asc(noteScanners.name), asc(noteScanners.id));
    return { read: (await this.llm.current()) !== null, scanners };
  }

  // ---------------------------------------------------------------------------------------------
  // Readings
  // ---------------------------------------------------------------------------------------------

  /**
   * Starts a reading of the caller's uploaded pages and answers at once: the model works in the
   * background and the screen asks for the reading until it is READY or FAILED.
   */
  async start(
    ctx: AuthContext,
    input: { fileIds: readonly number[]; supplierId?: number | null },
  ): Promise<NoteReadingView> {
    const fileIds = [...new Set(input.fileIds)];
    if (fileIds.length === 0 || fileIds.length > MAX_NOTE_PAGES) {
      throw invalid('fileIds', 'size', `a reading takes 1 to ${MAX_NOTE_PAGES} pages`);
    }
    const llm = await this.llm.forWork({ purpose: 'RECEIPT_READ', userId: actorUserId(ctx) });
    if (llm === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'no model is configured to read delivery notes');
    }
    // The pages must have arrived before the transaction (an HTTP HEAD with Spaces).
    for (const fileId of fileIds) {
      const file = await this.storage.verifyUploaded(fileId, NOTE_PAGE);
      if (file.ownerId !== actorUserId(ctx)) throw notFound('file', fileId);
    }
    const supplierId = input.supplierId ?? null;
    if (supplierId !== null) await this.suppliers.assertActive(this.db, supplierId);
    const reading = await inTransaction(this.db, async (tx) => {
      for (const fileId of fileIds) await this.storage.confirm(tx, fileId, NOTE_PAGE);
      const [row] = await tx
        .insert(receiptNoteReadings)
        .values({ supplierId, createdBy: actorUserId(ctx) })
        .returning();
      if (!row) throw new Error('reading insert returned no row');
      await tx
        .insert(receiptNoteReadingPages)
        .values(fileIds.map((fileId, position) => ({ readingId: row.id, position, fileId })));
      return row;
    });
    this.runInBackground(reading, llm);
    return this.get(ctx, reading.id);
  }

  /** Reads a FAILED reading, or one whose process was lost, once more. */
  async retry(ctx: AuthContext, id: number): Promise<NoteReadingView> {
    const llm = await this.llm.forWork({ purpose: 'RECEIPT_READ', userId: actorUserId(ctx) });
    if (llm === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'no model is configured to read delivery notes');
    }
    const reading = await inTransaction(this.db, async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status !== 'FAILED' && !(row.status === 'READING' && isStale(row))) {
        throw wrongState(row, 'FAILED');
      }
      const [again] = await tx
        .update(receiptNoteReadings)
        .set({ status: 'READING', failure: null, finishedAt: null, updatedAt: sql`now()` })
        .where(eq(receiptNoteReadings.id, id))
        .returning();
      if (!again) throw new Error('reading update returned no row');
      return again;
    });
    this.runInBackground(reading, llm);
    return this.get(ctx, id);
  }

  private runInBackground(reading: ReadingRow, llm: LlmClient): void {
    void this.run(reading, llm).catch((error: unknown) => {
      this.logger.error(
        { readingId: reading.id, error: error instanceof Error ? error.message : 'unknown' },
        'a note reading could not record its outcome',
      );
    });
  }

  /**
   * The reading itself, outside any transaction: the pages, the supplier (named, or recognised from
   * the first page), that supplier's products and memory, the model's answer, the proposal. The
   * outcome is written only while this run is still the reading's latest (`updated_at` unchanged):
   * a reading discarded or started again meanwhile keeps what it has.
   */
  async run(reading: ReadingRow, llm: LlmClient): Promise<void> {
    let outcome: Partial<ReadingRow>;
    try {
      const pages = await this.pageParts(reading.id);
      const supplierId = reading.supplierId ?? (await this.recognise(llm, pages));
      const supplier = supplierId === null ? null : await this.suppliers.get(supplierId);
      const offered = supplierId === null ? [] : await this.offeredUnits(supplierId);
      const memory = supplierId === null ? null : await this.templateOf(supplierId);
      const answer = await llm.complete({
        instructions: NOTE_READ_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: noteReadData({
                  supplier: supplier ? { name: supplier.name, regNo: supplier.regNo } : null,
                  layoutNotes: memory?.notes ?? null,
                  units: offered,
                }),
              },
              ...pages,
            ],
          },
        ],
        output: NOTE_READ_SCHEMA,
        maxOutputTokens: ANSWER_TOKENS,
        timeoutMs: READ_TIMEOUT_MS,
      });
      const parsed = NoteReadAnswer.safeParse(parseJson(answer.text));
      if (!parsed.success) {
        throw new LlmError('INVALID_RESPONSE', 'the answer does not match the schema');
      }
      const proposal = noteProposalOf(parsed.data, {
        offered: new Set(offered.map((unit) => unit.unitId)),
        remembered: supplierId === null ? new Map() : await this.rememberedOf(supplierId),
        barcodes: await this.unitsOfBarcodes(noteBarcodes(parsed.data)),
      });
      outcome = { status: 'READY', supplierId, result: proposal, model: answer.model };
    } catch (error: unknown) {
      const failure = failureOf(error);
      this.logger.warn({ readingId: reading.id, ...failure }, 'a note reading failed');
      if (failure.reason === 'INTERNAL') {
        this.logger.error(
          { readingId: reading.id, error: error instanceof Error ? error.message : 'unknown' },
          'a note reading failed inside the api',
        );
      }
      outcome = { status: 'FAILED', failure };
    }
    await this.db
      .update(receiptNoteReadings)
      .set({ ...outcome, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(receiptNoteReadings.id, reading.id),
          eq(receiptNoteReadings.status, 'READING'),
          // JavaScript keeps milliseconds of the database's microseconds.
          sql`date_trunc('milliseconds', ${receiptNoteReadings.updatedAt}) = ${reading.updatedAt.toISOString()}::timestamptz`,
        ),
      );
  }

  /** The pages as the model takes them: pictures upright and within PAGE_MAX_SIDE, PDFs as they are. */
  private async pageParts(readingId: number): Promise<LlmContentPart[]> {
    const parts: LlmContentPart[] = [];
    for (const [index, page] of (await this.pagesOf(readingId)).entries()) {
      const { file, body } = await this.storage.openPrivate(page.fileId, NOTE_PAGE);
      const bytes = await bytesOf(body);
      parts.push({ type: 'text', text: `Page ${index + 1}:` });
      if (file.contentType === PDF) {
        parts.push({ type: 'document', mediaType: PDF, data: bytes.toString('base64') });
        continue;
      }
      try {
        const jpeg = await normalisedPhoto(bytes, PAGE_MAX_SIDE);
        parts.push({ type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') });
      } catch (error: unknown) {
        if (!(error instanceof UnreadablePictureError)) throw error;
        throw new UnreadablePage(index + 1);
      }
    }
    return parts;
  }

  /** The supplier of ours the first page names as the seller; null unless exactly one fits. */
  private async recognise(
    llm: LlmClient,
    pages: readonly LlmContentPart[],
  ): Promise<number | null> {
    const first = pages.slice(0, 2);
    const answer = await llm.complete({
      instructions: NOTE_IDENTIFY_INSTRUCTIONS,
      messages: [{ role: 'user', content: [...first] }],
      output: NOTE_IDENTIFY_SCHEMA,
      maxOutputTokens: IDENTIFY_TOKENS,
    });
    const parsed = NoteIdentifyAnswer.safeParse(parseJson(answer.text));
    if (!parsed.success) return null;
    const active = (await this.suppliers.allBrief()).filter(
      (supplier) => supplier.status === 'ACTIVE',
    );
    return (
      supplierOf({ name: parsed.data.supplierName, regNo: parsed.data.supplierRegNo }, active)
        ?.id ?? null
    );
  }

  /** The supplier's products, a row per current unit, as the model chooses from them. */
  private async offeredUnits(supplierId: number): Promise<OfferedUnit[]> {
    const productIds = await this.links.productIdsWhere({
      field: 'supplier',
      op: 'IN',
      ids: [supplierId],
    });
    const products = (await this.catalog.getMany(productIds)).filter(
      (product) => product.status === 'ACTIVE',
    );
    const units = await this.units.currentUnits(products.map((product) => product.id));
    return products
      .flatMap((product) =>
        (units.get(product.id) ?? []).map((unit) => ({
          unitId: unit.unitId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: unit.uomName,
          factor: unit.factorToBase.toString(),
        })),
      )
      .slice(0, MAX_OFFERED_UNITS);
  }

  private async templateOf(
    supplierId: number,
  ): Promise<typeof receiptNoteTemplates.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(receiptNoteTemplates)
      .where(eq(receiptNoteTemplates.supplierId, supplierId));
    return row ?? null;
  }

  /** The supplier's remembered lines whose unit is still current: key → product unit. */
  private async rememberedOf(supplierId: number): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ key: receiptNoteAliases.key, unitId: receiptNoteAliases.productUnitId })
      .from(receiptNoteAliases)
      .where(eq(receiptNoteAliases.supplierId, supplierId));
    const units = await this.units.describe([...new Set(rows.map((row) => row.unitId))]);
    return new Map(
      rows.flatMap((row) => (units.get(row.unitId)?.current ? [[row.key, row.unitId]] : [])),
    );
  }

  /** The catalogue's product unit of each printed barcode; one that names several is left out. */
  private async unitsOfBarcodes(codes: readonly string[]): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    for (const code of codes) {
      const hits = await this.barcodes.lookup(code);
      const unitIds = [...new Set(hits.map((hit) => hit.unitId))];
      if (unitIds.length === 1 && unitIds[0] !== undefined) found.set(code, unitIds[0]);
    }
    return found;
  }

  async get(ctx: AuthContext, id: number): Promise<NoteReadingView> {
    const [row] = await this.db
      .select()
      .from(receiptNoteReadings)
      .where(eq(receiptNoteReadings.id, id));
    if (!row) throw notFound('note reading', id);
    const pages = await this.pagesOf(id);
    const files = await Promise.all(pages.map((page) => this.storage.get(page.fileId)));
    const supplier = row.supplierId === null ? null : await this.suppliers.get(row.supplierId);
    const names = await this.userNames.namesOf(row.createdBy === null ? [] : [row.createdBy]);
    const [receipt] =
      row.receiptId === null
        ? []
        : await this.db
            .select({ number: goodsReceipts.number })
            .from(goodsReceipts)
            .where(eq(goodsReceipts.id, row.receiptId));
    const proposal = row.result === null ? null : (row.result as NoteProposal);
    return {
      id: row.id,
      status: row.status,
      stale: isStale(row),
      supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.name } : null,
      pages: pages.map((page, index) => ({
        fileId: page.fileId,
        contentType: files[index]?.contentType ?? 'application/octet-stream',
      })),
      failure: row.failure === null ? null : (row.failure as NoteReadingFailure),
      receiptId: row.receiptId,
      receiptNumber: receipt?.number ?? null,
      createdByName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
      createdAt: row.createdAt,
      proposal: proposal ? await this.proposalView(proposal, ctx.permissions.has(COSTS)) : null,
      memory: row.supplierId === null ? null : await this.memory(row.supplierId),
    };
  }

  /** The readings still to be checked or read, the newest first; every receipt holder sees all. */
  async open(): Promise<NoteReadingSummary[]> {
    const rows = await this.db
      .select()
      .from(receiptNoteReadings)
      .where(inArray(receiptNoteReadings.status, ['READING', 'READY', 'FAILED']))
      .orderBy(desc(receiptNoteReadings.id))
      .limit(OPEN_LIST_LIMIT);
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const pageCounts = new Map(
      (
        await this.db
          .select({
            readingId: receiptNoteReadingPages.readingId,
            pages: sql<number>`count(*)::int`,
          })
          .from(receiptNoteReadingPages)
          .where(inArray(receiptNoteReadingPages.readingId, ids))
          .groupBy(receiptNoteReadingPages.readingId)
      ).map((row) => [row.readingId, row.pages]),
    );
    const supplierIds = [...new Set(rows.flatMap((row) => row.supplierId ?? []))];
    const supplierNames = new Map(
      (await this.suppliers.getMany(supplierIds)).map((supplier) => [supplier.id, supplier.name]),
    );
    const names = await this.userNames.namesOf([
      ...new Set(rows.flatMap((row) => row.createdBy ?? [])),
    ]);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      stale: isStale(row),
      supplierName: row.supplierId === null ? null : (supplierNames.get(row.supplierId) ?? null),
      pageCount: pageCounts.get(row.id) ?? 0,
      lineCount: row.result === null ? null : (row.result as NoteProposal).lines.length,
      createdByName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
      createdAt: row.createdAt,
    }));
  }

  /** Puts a reading aside: it leaves the list; its pages stay as the record of what was read. */
  async discard(ctx: AuthContext, id: number): Promise<NoteReadingView> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status === 'DISCARDED') return;
      if (row.status === 'SAVED') throw wrongState(row, 'READY');
      await tx
        .update(receiptNoteReadings)
        .set({
          status: 'DISCARDED',
          finishedAt: sql`coalesce(${receiptNoteReadings.finishedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(eq(receiptNoteReadings.id, id));
    });
    return this.get(ctx, id);
  }

  /**
   * Saves a checked reading as a draft receipt, in one transaction: the receipt with its lines
   * (each in the unit and quantity the person confirmed, priced as the note prints it), what the
   * supplier's memory learns from it, and the reading's link to the receipt. The prices come from
   * the reading, never from the caller: a keeper who may not see costs saves them unseen, as the
   * note in their hand carries them, and the accountant checks them on the receipt as always.
   */
  async saveDraft(ctx: AuthContext, id: number, input: NoteDraftInput): Promise<number> {
    if (input.lines.length === 0) {
      throw invalid('lines', 'required', 'a draft needs at least one line');
    }
    if (new Set(input.lines.map((line) => line.index)).size !== input.lines.length) {
      throw invalid('lines', 'unique', 'a read line is saved once');
    }
    return inTransaction(this.db, async (tx) => {
      const reading = await this.lock(tx, id);
      if (reading.status !== 'READY') throw wrongState(reading, 'READY');
      const proposal = reading.result as NoteProposal;
      const lines: ReceiptLineInput[] = [];
      const learnt = new Map<string, { label: string; productUnitId: number }>();
      for (const chosen of input.lines) {
        const read = proposal.lines[chosen.index];
        if (!read) throw invalid('lines', 'index', `the reading has no line ${chosen.index}`);
        if (!chosen.enteredQty.greaterThan(0)) {
          throw invalid('lines', 'positive', 'a quantity must be more than zero');
        }
        lines.push({
          productUnitId: chosen.productUnitId,
          enteredQty: chosen.enteredQty,
          ...notePriceOf(read, chosen.enteredQty),
        });
        const key = noteLineKey(read);
        if (key !== null) {
          learnt.set(key, { label: noteLineLabel(read), productUnitId: chosen.productUnitId });
        }
      }
      const receiptId = await this.receipts.createInTx(tx, ctx, {
        supplierId: input.supplierId,
        supplierDocNo: input.supplierDocNo ?? proposal.docNo,
        supplierDocDate: input.supplierDocDate ?? proposal.docDate,
        noteTotalAmount: proposal.totalAmount === null ? null : new Decimal(proposal.totalAmount),
        lines,
      });
      await this.learn(tx, ctx, input.supplierId, learnt, proposal.layoutNotes);
      await tx
        .update(receiptNoteReadings)
        .set({
          status: 'SAVED',
          supplierId: input.supplierId,
          receiptId,
          updatedAt: sql`now()`,
        })
        .where(eq(receiptNoteReadings.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'receipt_note_readings',
        entityId: id,
        after: { receiptId, lines: lines.length, model: reading.model },
      });
      return receiptId;
    });
  }

  /** What a saved note teaches: its lines' products, and the model's notes on the layout. */
  private async learn(
    tx: Tx,
    ctx: AuthContext,
    supplierId: number,
    lines: ReadonlyMap<string, { label: string; productUnitId: number }>,
    layoutNotes: string,
  ): Promise<void> {
    const updatedBy = actorUserId(ctx);
    for (const [key, line] of lines) {
      await tx
        .insert(receiptNoteAliases)
        .values({
          supplierId,
          key,
          label: line.label,
          productUnitId: line.productUnitId,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: [receiptNoteAliases.supplierId, receiptNoteAliases.key],
          set: {
            label: line.label,
            productUnitId: line.productUnitId,
            uses: sql`${receiptNoteAliases.uses} + 1`,
            updatedBy,
            updatedAt: sql`now()`,
          },
        });
    }
    const notes = layoutNotes || null;
    await tx
      .insert(receiptNoteTemplates)
      .values({ supplierId, notes, readings: 1, updatedBy })
      .onConflictDoUpdate({
        target: receiptNoteTemplates.supplierId,
        set: {
          // A note that taught nothing new keeps what was known.
          ...(notes === null ? {} : { notes }),
          readings: sql`${receiptNoteTemplates.readings} + 1`,
          updatedBy,
          updatedAt: sql`now()`,
        },
      });
  }

  /** The bytes of one page of a reading (the route checks the right). */
  async page(id: number, fileId: number): Promise<{ file: StoredFile; body: Readable }> {
    const [page] = await this.db
      .select({ fileId: receiptNoteReadingPages.fileId })
      .from(receiptNoteReadingPages)
      .where(
        and(eq(receiptNoteReadingPages.readingId, id), eq(receiptNoteReadingPages.fileId, fileId)),
      );
    if (!page) throw notFound('note page', fileId);
    return this.storage.openPrivate(fileId, NOTE_PAGE);
  }

  /** The reading a receipt was made of, when it was. */
  async readingOfReceipt(receiptId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ id: receiptNoteReadings.id })
      .from(receiptNoteReadings)
      .where(eq(receiptNoteReadings.receiptId, receiptId));
    return row?.id ?? null;
  }

  // ---------------------------------------------------------------------------------------------
  // A supplier's memory
  // ---------------------------------------------------------------------------------------------

  async memory(supplierId: number): Promise<NoteMemory> {
    const template = await this.templateOf(supplierId);
    const [aliases] = await this.db
      .select({ lines: sql<number>`count(*)::int` })
      .from(receiptNoteAliases)
      .where(eq(receiptNoteAliases.supplierId, supplierId));
    return {
      readings: template?.readings ?? 0,
      lines: aliases?.lines ?? 0,
      layout: Boolean(template?.notes),
    };
  }

  /** Forgets what was learnt of a supplier's notes: its next note is read as a first one. */
  async forget(ctx: AuthContext, supplierId: number): Promise<NoteMemory> {
    await inTransaction(this.db, async (tx) => {
      const [removed] = await tx
        .select({ lines: sql<number>`count(*)::int` })
        .from(receiptNoteAliases)
        .where(eq(receiptNoteAliases.supplierId, supplierId));
      await tx.delete(receiptNoteAliases).where(eq(receiptNoteAliases.supplierId, supplierId));
      await tx
        .update(receiptNoteTemplates)
        .set({ notes: null, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(receiptNoteTemplates.supplierId, supplierId));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'receipt_note_templates',
        entityId: supplierId,
        before: { lines: removed?.lines ?? 0 },
      });
    });
    return this.memory(supplierId);
  }

  // ---------------------------------------------------------------------------------------------
  // Scanners
  // ---------------------------------------------------------------------------------------------

  async scanners(): Promise<NoteScannerView[]> {
    const rows = await this.db
      .select()
      .from(noteScanners)
      .orderBy(asc(noteScanners.name), asc(noteScanners.id));
    return rows.map(scannerView);
  }

  /** What the device at an address says it is; a ScannerError's reason when it is no scanner. */
  async checkScanner(url: string): Promise<{ facts: ScannerFacts | null; reason: string | null }> {
    const address = addressOf(url);
    try {
      return { facts: await this.scannerGateway.at(address).facts(), reason: null };
    } catch (error: unknown) {
      if (!(error instanceof ScannerError)) throw error;
      return { facts: null, reason: error.reason };
    }
  }

  async saveScanner(
    ctx: AuthContext,
    input: { id?: number; name: string; url: string; active?: boolean },
  ): Promise<NoteScannerView> {
    const values = {
      name: input.name.trim(),
      url: addressOf(input.url),
      active: input.active ?? true,
    };
    return inTransaction(this.db, async (tx) => {
      let before: ScannerRow | undefined;
      let row: ScannerRow | undefined;
      if (input.id === undefined) {
        [row] = await tx
          .insert(noteScanners)
          .values({ ...values, createdBy: actorUserId(ctx) })
          .returning();
      } else {
        [before] = await tx
          .select()
          .from(noteScanners)
          .where(eq(noteScanners.id, input.id))
          .for('update');
        if (!before) throw scannerNotFound(input.id);
        [row] = await tx
          .update(noteScanners)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(noteScanners.id, input.id))
          .returning();
      }
      if (!row) throw new Error('scanner write returned no row');
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'note_scanners',
        entityId: row.id,
        ...(before ? { before } : {}),
        after: row,
      });
      return scannerView(row);
    });
  }

  /**
   * Scans what lies on a scanner and keeps each sheet as a page of the caller's, ready for a
   * reading: one sheet from the glass, every sheet from the feeder. The device is called between
   * transactions; a failure names its reason.
   */
  async scan(ctx: AuthContext, scannerId: number, source: ScanSource): Promise<ScannedSheet[]> {
    const [scanner] = await this.db
      .select()
      .from(noteScanners)
      .where(and(eq(noteScanners.id, scannerId), eq(noteScanners.active, true)));
    if (!scanner) throw scannerNotFound(scannerId);
    let pages: { jpeg: Buffer }[];
    try {
      pages = await this.scannerGateway.at(scanner.url).scan(source);
    } catch (error: unknown) {
      if (!(error instanceof ScannerError)) throw error;
      this.logger.warn({ scannerId, reason: error.reason, status: error.status }, 'a scan failed');
      throw new AppError('SCANNER_FAILED', error.message, {
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
      });
    }
    const sheets: ScannedSheet[] = [];
    for (const page of pages) {
      let jpeg: Buffer;
      try {
        jpeg = await normalisedPhoto(page.jpeg, PAGE_MAX_SIDE);
      } catch (error: unknown) {
        if (!(error instanceof UnreadablePictureError)) throw error;
        throw new AppError('SCANNER_FAILED', 'the scanner sent no readable picture', {
          reason: 'INVALID_RESPONSE',
        });
      }
      const file = await this.storage.ingest({
        kind: NOTE_PAGE,
        contentType: 'image/jpeg',
        bytes: jpeg,
        ownerId: actorUserId(ctx),
      });
      sheets.push({ fileId: file.id, preview: (await thumbnailOf(jpeg)).toString('base64') });
    }
    return sheets;
  }

  // ---------------------------------------------------------------------------------------------

  private async proposalView(
    proposal: NoteProposal,
    withCosts: boolean,
  ): Promise<NonNullable<NoteReadingView['proposal']>> {
    const unitIds = [...new Set(proposal.lines.flatMap((line) => line.match?.productUnitId ?? []))];
    const matched = await this.units.describe(unitIds);
    const productIds = [...new Set([...matched.values()].map((unit) => unit.productId))];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const current = await this.units.currentUnits(productIds);
    const lines = proposal.lines.map((line, index): NoteLineView => {
      const unit = line.match ? matched.get(line.match.productUnitId) : undefined;
      const product = unit ? products.get(unit.productId) : undefined;
      // A unit retired since the reading, or a product put away, is no match any more.
      const match =
        line.match && unit?.current && product?.status === 'ACTIVE'
          ? {
              how: line.match.how,
              productUnitId: unit.unitId,
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              units: (current.get(product.id) ?? []).map((option) => ({
                unitId: option.unitId,
                name: option.uomName,
                factor: option.factorToBase.toString(),
              })),
            }
          : null;
      return {
        ...line,
        index,
        unitPrice: withCosts ? line.unitPrice : null,
        amount: withCosts ? line.amount : null,
        match,
      };
    });
    return {
      supplierRead: proposal.supplierRead,
      docNo: proposal.docNo,
      docDate: proposal.docDate,
      totalQty: proposal.totalQty,
      totalAmount: withCosts ? proposal.totalAmount : null,
      vat: proposal.vat,
      cut: proposal.cut,
      remark: proposal.remark,
      lines,
    };
  }

  private pagesOf(readingId: number): Promise<{ fileId: number }[]> {
    return this.db
      .select({ fileId: receiptNoteReadingPages.fileId })
      .from(receiptNoteReadingPages)
      .where(eq(receiptNoteReadingPages.readingId, readingId))
      .orderBy(asc(receiptNoteReadingPages.position));
  }

  private async lock(tx: Tx, id: number): Promise<ReadingRow> {
    const [row] = await tx
      .select()
      .from(receiptNoteReadings)
      .where(eq(receiptNoteReadings.id, id))
      .for('update');
    if (!row) throw notFound('note reading', id);
    return row;
  }
}

/** A page whose bytes are no picture: the reading fails naming it, without the model. */
class UnreadablePage extends Error {
  constructor(readonly page: number) {
    super(`page ${page} is not a readable picture`);
  }
}

function failureOf(error: unknown): NoteReadingFailure {
  if (error instanceof LlmError) {
    return {
      reason: error.reason,
      status: error.status ?? null,
      providerCode: error.providerCode ?? null,
    };
  }
  if (error instanceof UnreadablePage) {
    return { reason: 'UNREADABLE_PAGE', status: error.page, providerCode: null };
  }
  if (error instanceof AppError) {
    // The limits of ADR-0162 reached while the reading waited its turn, and the like.
    return { reason: error.code, status: null, providerCode: null };
  }
  return { reason: 'INTERNAL', status: null, providerCode: null };
}

const isStale = (row: ReadingRow) =>
  row.status === 'READING' && Date.now() - row.updatedAt.getTime() > STALE_AFTER_MS;

const wrongState = (row: ReadingRow, needed: NoteReadingStatus) =>
  new AppError('NOTE_READING_STATE', `reading ${row.id} is ${row.status}, not ${needed}`, {
    id: row.id,
    status: row.status,
  });

const scannerNotFound = (id: number) =>
  new AppError('SCANNER_NOT_FOUND', `scanner ${id} not found or switched off`, { id });

/** A scanner's address by the rule of note-scanner.ts, or a validation error naming the field. */
function addressOf(url: string): string {
  const address = scannerUrlOf(url);
  if (address === null) {
    throw invalid('url', 'lanAddress', 'a scanner address is http://<private IPv4>[:port]');
  }
  return address;
}

const scannerView = (row: ScannerRow): NoteScannerView => ({
  id: row.id,
  name: row.name,
  url: row.url,
  active: row.active,
});

async function bytesOf(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
