import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { NOTE_READING_STATUSES } from '../schema';
import { NOTE_SCAN_SOURCES } from '../services/note-scanner';
import {
  MAX_NOTE_LINES,
  MAX_NOTE_PAGES,
  NOTE_MATCH_KINDS,
  NOTE_VAT_STATES,
} from '../services/receipt-note-ai';
import { QTY } from './bins.dto';

@ApiSchema({ name: 'NoteReadingRequest' })
export class StartNoteReadingDto {
  @ApiProperty({
    type: [Number],
    description: 'Uploaded files of kind inventory.note_page, in page order: one delivery note',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_NOTE_PAGES)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileIds: number[];

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'The supplier, when the person names it; else it is recognised from the note',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number | null;
}

@ApiSchema({ name: 'NoteDraftLine' })
export class NoteDraftLineDto {
  @ApiProperty({ description: "The line's index in the reading" })
  @IsInt()
  @Min(0)
  index: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  productUnitId: number;

  @ApiProperty({ example: '24' })
  @Matches(QTY)
  enteredQty: string;
}

@ApiSchema({ name: 'NoteDraftRequest' })
export class NoteDraftDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplierId: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  supplierDocNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-11-17' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Length(10, 10)
  supplierDocDate?: string | null;

  @ApiProperty({ type: [NoteDraftLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_NOTE_LINES)
  @ValidateNested({ each: true })
  @Type(() => NoteDraftLineDto)
  lines: NoteDraftLineDto[];
}

@ApiSchema({ name: 'NoteDraftResult' })
export class NoteDraftResultDto {
  @ApiProperty({ description: 'The draft receipt made of the reading' }) receiptId: number;
}

@ApiSchema({ name: 'NoteScannerBrief' })
export class NoteScannerBriefDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'NoteStatus' })
export class NoteStatusDto {
  @ApiProperty({ description: 'A model is configured: notes can be read' }) read: boolean;
  @ApiProperty({ type: [NoteScannerBriefDto] }) scanners: NoteScannerBriefDto[];
}

@ApiSchema({ name: 'NoteReadingFailure' })
export class NoteReadingFailureDto {
  @ApiProperty({ description: 'TIMEOUT, HTTP, REFUSED, UNREADABLE_PAGE, INTERNAL, …' })
  reason: string;
  @ApiProperty({ type: Number, nullable: true }) status: number | null;
  @ApiProperty({ type: String, nullable: true }) providerCode: string | null;
}

@ApiSchema({ name: 'NoteUnitOption' })
export class NoteUnitOptionDto {
  @ApiProperty() unitId: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: '24' }) factor: string;
}

@ApiSchema({ name: 'NoteLineMatch' })
export class NoteLineMatchDto {
  @ApiProperty({ enum: NOTE_MATCH_KINDS }) how: (typeof NOTE_MATCH_KINDS)[number];
  @ApiProperty() productUnitId: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() productName: string;
  @ApiProperty({ type: [NoteUnitOptionDto] }) units: NoteUnitOptionDto[];
}

@ApiSchema({ name: 'NoteLine' })
export class NoteLineDto {
  @ApiProperty() index: number;
  @ApiProperty() page: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) unit: string | null;
  @ApiProperty({ type: String, nullable: true }) barcode: string | null;
  @ApiProperty({ type: String, nullable: true }) qty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Cost holders only' })
  unitPrice: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Cost holders only' })
  amount: string | null;
  @ApiProperty() free: boolean;
  @ApiProperty() unsure: boolean;
  @ApiProperty({ type: NoteLineMatchDto, nullable: true }) match: NoteLineMatchDto | null;
}

@ApiSchema({ name: 'NoteSupplierRead' })
export class NoteSupplierReadDto {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) regNo: string | null;
}

@ApiSchema({ name: 'NoteProposal' })
export class NoteProposalDto {
  @ApiProperty({ type: NoteSupplierReadDto }) supplierRead: NoteSupplierReadDto;
  @ApiProperty({ type: String, nullable: true }) docNo: string | null;
  @ApiProperty({ type: String, nullable: true }) docDate: string | null;
  @ApiProperty({ type: String, nullable: true }) totalQty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Cost holders only' })
  totalAmount: string | null;
  @ApiProperty({ enum: NOTE_VAT_STATES }) vat: (typeof NOTE_VAT_STATES)[number];
  @ApiProperty({ description: 'Lines left out beyond the limit' }) cut: number;
  @ApiProperty() remark: string;
  @ApiProperty({ type: [NoteLineDto] }) lines: NoteLineDto[];
}

@ApiSchema({ name: 'NoteMemory' })
export class NoteMemoryDto {
  @ApiProperty({ description: 'Notes of the supplier saved as receipts' }) readings: number;
  @ApiProperty({ description: 'Lines remembered with their product' }) lines: number;
  @ApiProperty({ description: "The model's notes on the layout are kept" }) layout: boolean;
}

@ApiSchema({ name: 'NoteReadingSupplier' })
export class NoteReadingSupplierDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'NoteReadingPage' })
export class NoteReadingPageDto {
  @ApiProperty() fileId: number;
  @ApiProperty({ example: 'image/jpeg' }) contentType: string;
}

@ApiSchema({ name: 'NoteReading' })
export class NoteReadingDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: NOTE_READING_STATUSES }) status: (typeof NOTE_READING_STATUSES)[number];
  @ApiProperty({ description: 'Reading for so long that it must be started again' })
  stale: boolean;
  @ApiProperty({ type: NoteReadingSupplierDto, nullable: true })
  supplier: NoteReadingSupplierDto | null;
  @ApiProperty({ type: [NoteReadingPageDto] }) pages: NoteReadingPageDto[];
  @ApiProperty({ type: NoteReadingFailureDto, nullable: true })
  failure: NoteReadingFailureDto | null;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({ type: String, nullable: true }) receiptNumber: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: NoteProposalDto, nullable: true }) proposal: NoteProposalDto | null;
  @ApiProperty({ type: NoteMemoryDto, nullable: true }) memory: NoteMemoryDto | null;
}

@ApiSchema({ name: 'NoteReadingSummary' })
export class NoteReadingSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: NOTE_READING_STATUSES }) status: (typeof NOTE_READING_STATUSES)[number];
  @ApiProperty() stale: boolean;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty() pageCount: number;
  @ApiProperty({ type: Number, nullable: true }) lineCount: number | null;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty() createdAt: Date;
}

@ApiSchema({ name: 'ReceiptNoteReadingRef' })
export class ReceiptNoteReadingRefDto {
  @ApiProperty({ type: Number, nullable: true, description: 'The reading a receipt was made of' })
  readingId: number | null;
}

@ApiSchema({ name: 'NoteScanner' })
export class NoteScannerDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'http://192.168.1.60' }) url: string;
  @ApiProperty() active: boolean;
}

@ApiSchema({ name: 'NoteScannerRequest' })
export class SaveNoteScannerDto {
  @ApiProperty()
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 'http://192.168.1.60', description: 'A private IPv4 address' })
  @IsString()
  @Length(7, 200)
  url: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@ApiSchema({ name: 'NoteScannerCheckRequest' })
export class CheckNoteScannerDto {
  @ApiProperty({ example: 'http://192.168.1.60' })
  @IsString()
  @Length(7, 200)
  url: string;
}

@ApiSchema({ name: 'NoteScannerCheck' })
export class NoteScannerCheckDto {
  @ApiProperty({ description: 'The device answers as a scanner' }) ok: boolean;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty() glass: boolean;
  @ApiProperty() feeder: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'A ScannerError reason' })
  reason: string | null;
}

@ApiSchema({ name: 'NoteScanRequest' })
export class NoteScanDto {
  @ApiProperty({ enum: NOTE_SCAN_SOURCES })
  @IsIn(NOTE_SCAN_SOURCES)
  source: (typeof NOTE_SCAN_SOURCES)[number];
}

@ApiSchema({ name: 'ScannedSheet' })
export class ScannedSheetDto {
  @ApiProperty({ description: "A file of kind inventory.note_page, the caller's" }) fileId: number;
  @ApiProperty({ description: 'A small JPEG in base64' }) preview: string;
}

@ApiSchema({ name: 'NoteScanResult' })
export class NoteScanResultDto {
  @ApiProperty({ type: [ScannedSheetDto] }) sheets: ScannedSheetDto[];
}
