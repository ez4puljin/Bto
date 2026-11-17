import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../../common/errors/app-error';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CheckNoteScannerDto,
  NoteDraftDto,
  NoteDraftResultDto,
  NoteMemoryDto,
  NoteReadingDto,
  NoteReadingSummaryDto,
  NoteScanDto,
  NoteScannerCheckDto,
  NoteScannerDto,
  NoteScanResultDto,
  NoteStatusDto,
  ReceiptNoteReadingRefDto,
  SaveNoteScannerDto,
  StartNoteReadingDto,
} from '../dto/receipt-notes.dto';
import { ReceiptNoteFlowService } from '../services/receipt-note-flow.service';

const MANAGE = 'inventory.receipts.manage';
const COSTS = 'inventory.costs.manage';
const SETUP = 'inventory.setup.manage';

/**
 * «Падаан унших» (ADR-0210): a supplier's delivery note read by the model into a proposal, checked
 * by a person and saved as a draft receipt. Receipt holders start, check and save readings and use
 * the scanners; cost holders may open a reading's pages too; the scanners' list is the setup
 * right's. The fixed paths stand before `:id`.
 */
@ApiTags('inventory')
@Controller('receipt-notes')
export class ReceiptNotesController {
  constructor(private readonly notes: ReceiptNoteFlowService) {}

  /** What the screen can offer now: reading (a model is set) and the scanners switched on. */
  @Get('status')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteStatusDto })
  status(): Promise<NoteStatusDto> {
    return this.notes.status();
  }

  @Get('scanners')
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: [NoteScannerDto] })
  scanners(): Promise<NoteScannerDto[]> {
    return this.notes.scanners();
  }

  /** Asks the device at an address what it is, before it is saved. */
  @Post('scanners/check')
  @HttpCode(200)
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: NoteScannerCheckDto })
  async checkScanner(@Body() body: CheckNoteScannerDto): Promise<NoteScannerCheckDto> {
    const { facts, reason } = await this.notes.checkScanner(body.url);
    return {
      ok: facts !== null,
      model: facts?.model ?? null,
      glass: facts?.glass ?? false,
      feeder: facts?.feeder ?? false,
      reason,
    };
  }

  @Post('scanners')
  @RequirePermission(SETUP)
  @ApiCreatedResponse({ type: NoteScannerDto })
  createScanner(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SaveNoteScannerDto,
  ): Promise<NoteScannerDto> {
    return this.notes.saveScanner(ctx, body);
  }

  @Put('scanners/:id')
  @RequirePermission(SETUP)
  @ApiOkResponse({ type: NoteScannerDto })
  updateScanner(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveNoteScannerDto,
  ): Promise<NoteScannerDto> {
    return this.notes.saveScanner(ctx, { ...body, id });
  }

  /**
   * Scans what lies on the scanner: one sheet from the glass, every sheet from the feeder. Each
   * sheet becomes a page of the caller's, to be given to a reading.
   */
  @Post('scanners/:id/scan')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteScanResultDto })
  async scan(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: NoteScanDto,
  ): Promise<NoteScanResultDto> {
    return { sheets: await this.notes.scan(ctx, id, body.source) };
  }

  /** What is remembered of a supplier's notes. */
  @Get('memory/:supplierId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteMemoryDto })
  memory(@Param('supplierId', ParseIntPipe) supplierId: number): Promise<NoteMemoryDto> {
    return this.notes.memory(supplierId);
  }

  /** Forgets it: the supplier's next note is read as a first one. */
  @Delete('memory/:supplierId')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteMemoryDto })
  forget(
    @CurrentUser() ctx: AuthContext,
    @Param('supplierId', ParseIntPipe) supplierId: number,
  ): Promise<NoteMemoryDto> {
    return this.notes.forget(ctx, supplierId);
  }

  /** The reading a receipt was made of, for the receipt window's link to its pages. */
  @Get('of-receipt/:receiptId')
  @Authenticated()
  @ApiOkResponse({ type: ReceiptNoteReadingRefDto })
  async ofReceipt(
    @CurrentUser() ctx: AuthContext,
    @Param('receiptId', ParseIntPipe) receiptId: number,
  ): Promise<ReceiptNoteReadingRefDto> {
    if (!mayOpen(ctx)) return { readingId: null };
    return { readingId: await this.notes.readingOfReceipt(receiptId) };
  }

  /** The readings waiting to be read or checked. */
  @Get()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [NoteReadingSummaryDto] })
  open(): Promise<NoteReadingSummaryDto[]> {
    return this.notes.open();
  }

  /** Starts a reading; the answer comes at once and the reading goes on in the background. */
  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: NoteReadingDto })
  start(
    @CurrentUser() ctx: AuthContext,
    @Body() body: StartNoteReadingDto,
  ): Promise<NoteReadingDto> {
    return this.notes.start(ctx, { fileIds: body.fileIds, supplierId: body.supplierId ?? null });
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: NoteReadingDto })
  get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteReadingDto> {
    assertMayOpen(ctx);
    return this.notes.get(ctx, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteReadingDto })
  retry(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteReadingDto> {
    return this.notes.retry(ctx, id);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: NoteReadingDto })
  discard(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NoteReadingDto> {
    return this.notes.discard(ctx, id);
  }

  /** Saves the checked reading as a draft receipt and teaches the supplier's memory. */
  @Post(':id/receipt')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: NoteDraftResultDto })
  async saveDraft(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: NoteDraftDto,
  ): Promise<NoteDraftResultDto> {
    const receiptId = await this.notes.saveDraft(ctx, id, {
      supplierId: body.supplierId,
      ...(body.supplierDocNo === undefined ? {} : { supplierDocNo: body.supplierDocNo }),
      ...(body.supplierDocDate === undefined ? {} : { supplierDocDate: body.supplierDocDate }),
      lines: body.lines.map((line) => ({
        index: line.index,
        productUnitId: line.productUnitId,
        enteredQty: new Decimal(line.enteredQty),
      })),
    });
    return { receiptId };
  }

  /** One page of a reading: a picture or a PDF file, streamed to receipt and cost holders. */
  @Get(':id/pages/:fileId')
  @Authenticated()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOkResponse({ description: 'The page' })
  async page(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ): Promise<void> {
    assertMayOpen(ctx);
    const { file, body } = await this.notes.page(id, fileId);
    response.status(200);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    await pipeline(body, response);
  }
}

const mayOpen = (ctx: AuthContext) => ctx.permissions.has(MANAGE) || ctx.permissions.has(COSTS);

function assertMayOpen(ctx: AuthContext): void {
  if (!mayOpen(ctx)) {
    throw new AppError('FORBIDDEN', 'a delivery note is for receipt and cost holders', {
      permission: MANAGE,
    });
  }
}
