import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PRINT_LIMITS, PRINT_WIDTHS, type PrintWidth } from '../printing.rules';

// Price labels and their printers (ADR-0226): the staff app's routes (`price-labels/*`,
// `print-stations`, `print-jobs/*`), the office's (`printing/stations/*`) and the bridge's
// (`print-bridge/*`). Kinds and statuses are lower case on the wire.

export const WIRE_STATION_KINDS = ['bridge', 'network'] as const;
export type WireStationKind = (typeof WIRE_STATION_KINDS)[number];
export const WIRE_JOB_STATUSES = ['queued', 'printing', 'done', 'failed'] as const;
export type WireJobStatus = (typeof WIRE_JOB_STATUSES)[number];

@ApiSchema({ name: 'PriceLabelTill' })
export class PriceLabelTillDto {
  @ApiProperty() id: number;
  @ApiProperty({ description: 'The till’s short code, e.g. К1' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The store (warehouse) it sells from' }) storeName: string;
}

@ApiSchema({ name: 'PriceLabelItem' })
export class PriceLabelItemDto {
  @ApiProperty() productId: number;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The product code (SKU) the label prints' }) code: string;
  @ApiProperty({ type: [String], description: 'Every barcode of every current unit' })
  barcodes: string[];
  @ApiProperty({ description: 'The base unit’s name' }) unit: string;
  @ApiProperty({ description: 'One base unit at the till today, whole MNT' }) price: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'From how many base units the till charges the bulk price; null = none',
  })
  bulkQty: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'One base unit at the bulk price' })
  bulkPrice: number | null;
}

export class PriceLabelTillQueryDto {
  @ApiProperty({ description: 'One of the caller’s tills (GET /price-labels/tills)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tillId: number;
}

export class PriceLabelSearchQueryDto extends PriceLabelTillQueryDto {
  @ApiPropertyOptional({ description: 'Name (any case, Cyrillic or Latin), code or barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'PriceLabelLine' })
export class PriceLabelLineDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ minimum: 1, maximum: PRINT_LIMITS.maxCopies })
  @IsInt()
  @Min(1)
  @Max(PRINT_LIMITS.maxCopies)
  copies: number;
}

@ApiSchema({ name: 'PriceLabelOrder' })
export class PriceLabelOrderDto {
  @ApiProperty() @IsInt() @Min(1) tillId: number;
  @ApiProperty({
    type: [PriceLabelLineDto],
    description: `1 to ${PRINT_LIMITS.maxItems} products; at most ${PRINT_LIMITS.maxLabels} labels in all`,
  })
  @ValidateNested({ each: true })
  @Type(() => PriceLabelLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_LIMITS.maxItems)
  items: PriceLabelLineDto[];
}

@ApiSchema({ name: 'PriceLabelEscPosRequest' })
export class PriceLabelEscPosRequestDto extends PriceLabelOrderDto {
  @ApiPropertyOptional({
    enum: PRINT_WIDTHS,
    description: 'Dots across: 576 for 80 mm paper (default), 384 for 58 mm',
  })
  @IsOptional()
  @IsIn(PRINT_WIDTHS)
  widthDots?: PrintWidth;
}

@ApiSchema({ name: 'PriceLabelEscPos' })
export class PriceLabelEscPosDto {
  @ApiProperty({
    description: 'Base64 of the ESC/POS bytes: per label ESC @, GS v 0 raster, GS V 66 0 (cut)',
  })
  data: string;
  @ApiProperty() labels: number;
}

@ApiSchema({ name: 'PriceLabelPrintRequest' })
export class PriceLabelPrintRequestDto extends PriceLabelOrderDto {
  @ApiProperty({ description: 'A printer of GET /print-stations' })
  @IsInt()
  @Min(1)
  stationId: number;
}

@ApiSchema({ name: 'PriceLabelPrintResult' })
export class PriceLabelPrintResultDto {
  @ApiProperty() jobId: number;
  @ApiProperty() labels: number;
}

@ApiSchema({ name: 'PrintStationChoice' })
export class PrintStationChoiceDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WIRE_STATION_KINDS, enumName: 'PrintStationKind' })
  kind: WireStationKind;
  @ApiProperty({ description: 'Its bridge called, or the api reached it, within a minute' })
  online: boolean;
}

@ApiSchema({ name: 'PrintJob' })
export class PrintJobDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: WIRE_JOB_STATUSES, enumName: 'PrintJobStatus' }) status: WireJobStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'A failed job’s code (mn.json errors.<code>): PRINTER_OFFLINE, PRINTER_UNREACHABLE or PRINTER_REFUSED',
  })
  error: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'What the printer side said' })
  detail: string | null;
  @ApiProperty() labels: number;
}

// The office.

@ApiSchema({ name: 'PrintStation' })
export class PrintStationDto extends PrintStationChoiceDto {
  @ApiProperty({ type: String, nullable: true, description: 'NETWORK: the printer’s address' })
  host: string | null;
  @ApiProperty({ type: Number, nullable: true }) port: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'BRIDGE: the Windows printer the bridge writes to',
  })
  printerName: string | null;
  @ApiProperty({ enum: PRINT_WIDTHS }) widthDots: number;
  @ApiProperty({ enum: ['active', 'disabled'] }) status: 'active' | 'disabled';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSeenAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PrintStationCreated' })
export class PrintStationCreatedDto {
  @ApiProperty({ type: PrintStationDto }) station: PrintStationDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'BRIDGE: the key, shown this once; null for NETWORK',
  })
  key: string | null;
}

@ApiSchema({ name: 'PrintStationCreateRequest' })
export class PrintStationCreateRequestDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(PRINT_LIMITS.nameMax) name: string;
  @ApiProperty({ enum: WIRE_STATION_KINDS }) @IsIn(WIRE_STATION_KINDS) kind: WireStationKind;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, default: 9100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;
  @ApiPropertyOptional({ enum: PRINT_WIDTHS })
  @IsOptional()
  @IsIn(PRINT_WIDTHS)
  widthDots?: PrintWidth;
}

@ApiSchema({ name: 'PrintStationUpdateRequest' })
export class PrintStationUpdateRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;
  @ApiPropertyOptional({ enum: PRINT_WIDTHS })
  @IsOptional()
  @IsIn(PRINT_WIDTHS)
  widthDots?: PrintWidth;
  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

// The bridge.

@ApiSchema({ name: 'PrintBridgeJob' })
export class PrintBridgeJobDto {
  @ApiProperty() id: number;
  @ApiProperty() labels: number;
  @ApiProperty({ description: 'Base64 of the ESC/POS bytes, written RAW to the printer' })
  data: string;
}

@ApiSchema({ name: 'PrintBridgeDoneRequest' })
export class PrintBridgeDoneRequestDto {
  @ApiProperty({ description: 'true: the printer took the bytes' }) @IsBoolean() ok: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Windows’ error, when not ok' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string | null;
}

@ApiSchema({ name: 'PrintBridgeNext' })
export class PrintBridgeNextDto {
  @ApiProperty({ type: PrintBridgeJobDto, nullable: true, description: 'null: no job came' })
  job: PrintBridgeJobDto | null;
}
