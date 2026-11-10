import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  COUNT_PARTY_KINDS,
  COUNT_SCOPE_MODES,
  COUNT_UNCOUNTED_MODES,
  STOCKTAKE_STATUSES,
} from '../schema';
import { QTY, trimmed } from './bins.dto';

type CountStatus = (typeof STOCKTAKE_STATUSES)[number];
type CountScopeMode = (typeof COUNT_SCOPE_MODES)[number];
type CountUncountedMode = (typeof COUNT_UNCOUNTED_MODES)[number];
type CountPartyKind = (typeof COUNT_PARTY_KINDS)[number];

export const COUNT_LINE_FILTERS = [
  'ALL',
  'COUNTED',
  'UNCOUNTED',
  'DIFFERENT',
  'MATCHED',
  'UNLISTED',
  'MOVED',
] as const;
type CountLineFilter = (typeof COUNT_LINE_FILTERS)[number];
const COUNT_MINE = ['NONE', 'OPEN', 'SENT'] as const;
const ACCOUNT_CODE = /^[0-9A-Za-z.-]{1,20}$/;
const WINDOW = 'the count window (inventory.stocktakes.manage or .approve) only';

// Responses (ADR-0176)

@ApiSchema({ name: 'StockCountParty' })
export class StockCountPartyDto {
  @ApiProperty({ enum: COUNT_PARTY_KINDS }) kind: CountPartyKind;
  @ApiProperty({ type: Number, nullable: true, description: 'Null for a typed name' })
  id: number | null;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'StockCountSettlement' })
export class StockCountSettlementDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '313011',
    description: 'Null: the loss and gain accounts',
  })
  accountCode: string | null;
  @ApiProperty({ type: StockCountPartyDto, nullable: true }) party: StockCountPartyDto | null;
  @ApiProperty({ description: 'A shortage its party pays for at the selling price' })
  charged: boolean;
}

@ApiSchema({ name: 'StockCountSession' })
export class StockCountSessionDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Null: not sent' })
  sentAt: string | null;
  @ApiProperty({ type: String, nullable: true }) sentByName: string | null;
  @ApiProperty({ description: 'Entries not taken back' }) entries: number;
  @ApiProperty() products: number;
}

@ApiSchema({ name: 'StockCountSummary' })
export class StockCountSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ enum: STOCKTAKE_STATUSES }) status: CountStatus;
  @ApiProperty({ type: String, nullable: true, example: 'ST-2026-000001' }) number: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: COUNT_SCOPE_MODES }) scopeMode: CountScopeMode;
  @ApiProperty({ type: String, nullable: true }) scopeLabel: string | null;
  @ApiProperty() showStock: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ description: 'Products on the count' }) lines: number;
  @ApiProperty({ description: 'Products with a sent count' }) counted: number;
}

@ApiSchema({ name: 'StockCountPage' })
export class StockCountPageDto {
  @ApiProperty({ type: [StockCountSummaryDto] }) data: StockCountSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'StockCountDetail' })
export class StockCountDetailDto extends StockCountSummaryDto {
  @ApiProperty({ type: [Number] }) scopeIds: number[];
  @ApiProperty({ enum: COUNT_UNCOUNTED_MODES, nullable: true })
  uncounted: CountUncountedMode | null;
  @ApiProperty({ type: String, nullable: true }) startedByName: string | null;
  @ApiProperty({ type: StockCountSettlementDto }) surplus: StockCountSettlementDto;
  @ApiProperty({ type: StockCountSettlementDto }) shortage: StockCountSettlementDto;
  @ApiProperty({ description: 'Counted products that differ from their stock' }) different: number;
  @ApiProperty({ description: 'Listed products nobody counted' }) uncountedLines: number;
  @ApiProperty({ type: [StockCountSessionDto] }) sessions: StockCountSessionDto[];
}

@ApiSchema({ name: 'StockCountCounter' })
export class StockCountCounterDto {
  @ApiProperty() userId: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: '12', description: 'Sent, base units' }) qty: string;
  @ApiProperty({ example: '0', description: 'Counted but not sent yet' }) pendingQty: string;
}

@ApiSchema({ name: 'StockCountLine' })
export class StockCountLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() unitName: string;
  @ApiProperty({ description: 'False: scanned outside the list' }) listed: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'The stock at the first count' })
  expectedQty: string | null;
  @ApiProperty({ type: String, nullable: true }) countedQty: string | null;
  @ApiProperty() pendingQty: string;
  @ApiProperty({ type: String, nullable: true }) differenceQty: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  firstCountedAt: string | null;
  @ApiProperty({ type: [StockCountCounterDto] }) counters: StockCountCounterDto[];
  @ApiProperty({ description: 'Moved by other documents after the first count, until approval' })
  movedDuring: string;
  @ApiProperty({ description: 'Moved by other documents after the approval' }) movedAfter: string;
  @ApiProperty({ description: 'The line has its own account and party' }) settleOwn: boolean;
  @ApiProperty({ type: StockCountSettlementDto }) settlement: StockCountSettlementDto;
  @ApiProperty({ type: String, nullable: true, description: 'inventory.costs.manage only' })
  unitCost: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'MNT charged to the party' })
  chargeAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
}

@ApiSchema({ name: 'StockCountLinePage' })
export class StockCountLinePageDto {
  @ApiProperty({ type: [StockCountLineDto] }) data: StockCountLineDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'StockCountSheetRow' })
export class StockCountSheetRowDto {
  @ApiProperty() lineId: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() unitName: string;
  @ApiProperty({ description: 'False: counted although outside the list' }) listed: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'The main supplier' })
  supplierId: number | null;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty({ type: String, nullable: true }) expectedQty: string | null;
  @ApiProperty({ type: String, nullable: true }) countedQty: string | null;
  @ApiProperty() pendingQty: string;
  @ApiProperty({ type: String, nullable: true }) differenceQty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Warehouse price per base unit' })
  salePrice: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Difference × selling price, MNT' })
  differenceAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ description: 'The counted quantity was typed in the window' })
  corrected: boolean;
  @ApiProperty() movedDuring: string;
  @ApiProperty() movedAfter: string;
}

@ApiSchema({ name: 'StockCountSheetTotals' })
export class StockCountSheetTotalsDto {
  @ApiProperty() lines: number;
  @ApiProperty() counted: number;
  @ApiProperty() uncounted: number;
  @ApiProperty() unlisted: number;
  @ApiProperty() matched: number;
  @ApiProperty() different: number;
  @ApiProperty() surplusLines: number;
  @ApiProperty() surplusQty: string;
  @ApiProperty() surplusAmount: string;
  @ApiProperty() shortageLines: number;
  @ApiProperty() shortageQty: string;
  @ApiProperty() shortageAmount: string;
  @ApiProperty() netQty: string;
  @ApiProperty() netAmount: string;
  @ApiProperty({ description: 'Differences without a selling price' }) unpriced: number;
}

@ApiSchema({ name: 'StockCountSheetSupplier' })
export class StockCountSheetSupplierDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'StockCountSheet' })
export class StockCountSheetDto {
  @ApiProperty({ type: String, format: 'date' }) priceDate: string;
  @ApiProperty({ type: StockCountSheetTotalsDto }) totals: StockCountSheetTotalsDto;
  @ApiProperty({ type: [StockCountSheetSupplierDto] }) suppliers: StockCountSheetSupplierDto[];
  @ApiProperty({ type: [StockCountSheetRowDto] }) rows: StockCountSheetRowDto[];
  @ApiProperty() truncated: boolean;
}

@ApiSchema({ name: 'StockCountEntry' })
export class StockCountEntryDto {
  @ApiProperty() id: number;
  @ApiProperty() sessionId: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() userId: number;
  @ApiProperty() userName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty() unitName: string;
  @ApiProperty({ example: '24' }) factor: string;
  @ApiProperty({ example: '2', description: 'In the entry unit' }) enteredQty: string;
  @ApiProperty({ example: '48', description: 'Base units' }) qtyBase: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ description: 'Taken back by its counter' }) voided: boolean;
  @ApiProperty({ description: 'Its session was sent' }) sent: boolean;
  @ApiProperty({ description: 'Typed in the count window in place of the entries before it' })
  correction: boolean;
}

@ApiSchema({ name: 'StockCountMovedDocument' })
export class StockCountMovedDocumentDto {
  @ApiProperty({ example: 'CN' }) docType: string;
  @ApiProperty() docId: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ example: '3', description: 'Net base units in the count warehouse' }) qty: string;
  @ApiProperty({ type: String, format: 'date-time' }) postedAt: string;
  @ApiProperty({ type: String, format: 'date' }) effectiveDate: string;
  @ApiProperty() afterApproval: boolean;
}

@ApiSchema({ name: 'OpenStockCount' })
export class OpenStockCountDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: COUNT_SCOPE_MODES }) scopeMode: CountScopeMode;
  @ApiProperty({ type: String, nullable: true }) scopeLabel: string | null;
  @ApiProperty() showStock: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ enum: COUNT_MINE, description: 'OPEN: started and not sent yet' })
  mine: (typeof COUNT_MINE)[number];
}

@ApiSchema({ name: 'MyStockCountSession' })
export class MyStockCountSessionDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, format: 'date-time' }) startedAt: string;
}

@ApiSchema({ name: 'MyStockCount' })
export class MyStockCountDto {
  @ApiProperty({ type: OpenStockCountDto }) count: OpenStockCountDto;
  @ApiProperty({ enum: STOCKTAKE_STATUSES }) status: CountStatus;
  @ApiProperty({ type: MyStockCountSessionDto, nullable: true })
  session: MyStockCountSessionDto | null;
  @ApiProperty({ type: [StockCountEntryDto], description: 'My entries, newest first' })
  entries: StockCountEntryDto[];
}

@ApiSchema({ name: 'StockCountProductInfo' })
export class StockCountProductInfoDto {
  @ApiProperty() productId: number;
  @ApiProperty() listed: boolean;
  @ApiProperty({ description: 'My unsent quantity, base units' }) myQty: string;
  @ApiProperty({ type: String, nullable: true, description: 'Only when the count shows stock' })
  expectedQty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only when the count shows stock' })
  countedQty: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The entry just written' })
  entryId: number | null;
}

@ApiSchema({ name: 'StockCountAccountChoice' })
export class StockCountAccountChoiceDto {
  @ApiProperty({ example: '313011' }) code: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'StockCountVarianceRow' })
export class StockCountVarianceRowDto {
  @ApiProperty() lineId: number;
  @ApiProperty() stocktakeId: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() unitName: string;
  @ApiProperty({ type: String, nullable: true }) expectedQty: string | null;
  @ApiProperty({ type: String, nullable: true }) countedQty: string | null;
  @ApiProperty({ description: 'What the approval posted' }) differenceQty: string;
  @ApiProperty({ type: String, nullable: true, description: 'inventory.costs.manage only' })
  unitCost: string | null;
  @ApiProperty({ type: StockCountSettlementDto }) settlement: StockCountSettlementDto;
  @ApiProperty({ type: String, nullable: true }) chargeAmount: string | null;
}

@ApiSchema({ name: 'StockCountVariancePage' })
export class StockCountVariancePageDto {
  @ApiProperty({ type: [StockCountVarianceRowDto] }) data: StockCountVarianceRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

// Requests

export class StockCountListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: STOCKTAKE_STATUSES })
  @IsOptional()
  @IsIn(STOCKTAKE_STATUSES)
  status?: CountStatus;
}

export class StockCountLinesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: COUNT_LINE_FILTERS })
  @IsOptional()
  @IsIn(COUNT_LINE_FILTERS)
  filter?: CountLineFilter;
  @ApiPropertyOptional({ description: 'Name, code or barcode' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class StockCountSheetQueryDto {
  @ApiPropertyOptional({ enum: COUNT_LINE_FILTERS })
  @IsOptional()
  @IsIn(COUNT_LINE_FILTERS)
  filter?: CountLineFilter;
  @ApiPropertyOptional({ description: 'Name, code or barcode' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) supplierId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) segmentId?: number;
}

export class StockCountLineReasonDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Empty or null clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

@ApiSchema({ name: 'StockCountLineCountedRequest' })
export class StockCountLineCountedDto {
  @ApiProperty({ example: '12', description: 'The counted quantity in base units' })
  @IsString()
  @Matches(QTY)
  qty: string;
}

export class StockCountVarianceQueryDto extends PageQueryDto {
  @ApiProperty({ type: String, format: 'date', description: `Approval day, from; ${WINDOW}` })
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(10)
  from: string;
  @ApiProperty({ type: String, format: 'date' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(10)
  to: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ description: 'Name, code or barcode' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'StockCountCreateRequest' })
export class CreateStockCountDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiProperty({
    enum: COUNT_SCOPE_MODES,
    description: 'ALL: every product of the warehouse; SCANNED: only what the counters scan',
  })
  @IsIn(COUNT_SCOPE_MODES)
  scopeMode: CountScopeMode;
  @ApiPropertyOptional({
    type: [Number],
    maxItems: 50,
    description: 'One segment, or the suppliers or categories of the mode',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  scopeIds?: number[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  scopeLabel?: string | null;
  @ApiPropertyOptional({ description: 'Counters see the stock and a mismatch notice' })
  @IsOptional()
  @IsBoolean()
  showStock?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'StockCountPartyInput' })
export class StockCountPartyInputDto {
  @ApiProperty({ enum: COUNT_PARTY_KINDS }) @IsIn(COUNT_PARTY_KINDS) kind: CountPartyKind;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'USER, CUSTOMER, SUPPLIER' })
  @IsOptional()
  @IsInt()
  @Min(1)
  id?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, description: 'OTHER' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  name?: string | null;
}

@ApiSchema({ name: 'StockCountSettlementInput' })
export class StockCountSettlementInputDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: '313011' })
  @IsOptional()
  @IsString()
  @Matches(ACCOUNT_CODE)
  accountCode?: string | null;
  @ApiPropertyOptional({ type: StockCountPartyInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => StockCountPartyInputDto)
  party?: StockCountPartyInputDto | null;
  @ApiPropertyOptional({ description: 'A shortage only: its party pays at the selling price' })
  @IsOptional()
  @IsBoolean()
  charged?: boolean;
}

@ApiSchema({ name: 'StockCountDefaultsRequest' })
export class StockCountDefaultsDto {
  @ApiPropertyOptional({ type: StockCountSettlementInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => StockCountSettlementInputDto)
  surplus?: StockCountSettlementInputDto | null;
  @ApiPropertyOptional({ type: StockCountSettlementInputDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => StockCountSettlementInputDto)
  shortage?: StockCountSettlementInputDto | null;
}

@ApiSchema({ name: 'StockCountLineSettlementRequest' })
export class StockCountLineSettlementDto {
  @ApiPropertyOptional({
    type: StockCountSettlementInputDto,
    nullable: true,
    description: 'Null or absent: back to the count default',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StockCountSettlementInputDto)
  settlement?: StockCountSettlementInputDto | null;
}

@ApiSchema({ name: 'StockCountEntryRequest' })
export class CreateStockCountEntryDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ description: 'The unit counted in: a piece, a box' })
  @IsInt()
  @Min(1)
  productUnitId: number;
  @ApiProperty({ example: '10', description: 'In that unit; 0 records a product found empty' })
  @IsString()
  @Matches(QTY)
  qty: string;
}

@ApiSchema({ name: 'StockCountApproveRequest' })
export class ApproveStockCountDto {
  @ApiProperty({
    enum: COUNT_UNCOUNTED_MODES,
    description: 'Listed products nobody counted: ZERO takes their stock out, LEAVE keeps it',
  })
  @IsIn(COUNT_UNCOUNTED_MODES)
  uncounted: CountUncountedMode;
}
