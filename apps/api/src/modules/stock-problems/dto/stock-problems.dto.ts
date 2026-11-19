import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  STOCK_PROBLEM_EVENT_KINDS,
  STOCK_PROBLEM_NOTE_MAX,
  STOCK_PROBLEM_OUTCOMES,
  STOCK_PROBLEM_QTY_PATTERN,
  STOCK_PROBLEM_RESOLUTION_KINDS,
  STOCK_PROBLEM_RESOLUTION_STATUSES,
  STOCK_PROBLEM_SHEET_STATUSES,
  type StockProblemEventKind,
  type StockProblemOutcome,
  type StockProblemResolutionKind,
  type StockProblemResolutionStatus,
  type StockProblemSheetStatus,
} from '@tugeel/shared';
import { isIsoDate } from '@tugeel/shared/time';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

/** A real calendar date written as `YYYY-MM-DD`. */
function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isIsoDate(value),
        defaultMessage: () => `${propertyName} must be a date like 2026-11-20`,
      },
    });
  };
}

// ── answers ──────────────────────────────────────────────────────────────────

export class StockProblemProductDto {
  @ApiProperty() id: number;
  @ApiProperty({ description: 'The product code' }) sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The unit every quantity here is in' }) baseUomName: string;
}

export class StockProblemEventDto {
  @ApiProperty({
    enum: STOCK_PROBLEM_EVENT_KINDS,
    description:
      'POS_SHORTFALL = «Улайсан» (a till sold what the shelf lacked); BACKORDER and SHORT_PICK = «Дарагдсан» (cut at the order’s confirmation, or by the picker)',
  })
  kind: StockProblemEventKind;
  @ApiProperty({ description: 'Base units: sold beyond the shelf, or cut from the order' })
  qtyBase: string;
  @ApiProperty({ description: 'When the till sold, the order was confirmed or the part picked' })
  at: string;
  @ApiProperty({ type: Number, nullable: true, description: 'pos_shortfalls id (POS_SHORTFALL)' })
  shortfallId: number | null;
  @ApiProperty({ type: Number, nullable: true }) saleId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The till sale’s number' })
  saleNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) orderLineId: number | null;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Who entered the order (the rep)' })
  repName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Ordered, base units' })
  orderedQtyBase: string | null;
}

export class StockProblemPendingDto {
  @ApiProperty({ description: 'The resolution’s id' }) id: number;
  @ApiProperty({ enum: STOCK_PROBLEM_RESOLUTION_KINDS }) kind: StockProblemResolutionKind;
  @ApiProperty({ type: String, nullable: true }) qtyBase: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The goods issue it waits for' })
  issueId: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The adjustment it waits for' })
  adjustmentId: number | null;
  @ApiProperty({ type: Number, nullable: true }) sheetId: number | null;
  @ApiProperty() createdAt: string;
}

export class StockProblemDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: StockProblemProductDto }) product: StockProblemProductDto;
  @ApiProperty({ description: 'The warehouse’s on-hand now, base units' }) onHand: string;
  @ApiProperty({ description: 'Σ «Улайсан», base units' }) redQty: string;
  @ApiProperty({ description: 'Σ «Дарагдсан», base units' }) cutQty: string;
  @ApiProperty() lastEventAt: string;
  @ApiProperty({ type: [StockProblemEventDto], description: 'Newest first' })
  events: StockProblemEventDto[];
  @ApiProperty({
    type: StockProblemPendingDto,
    nullable: true,
    description: 'A decision that waits for its document; no other decision is taken meanwhile',
  })
  pending: StockProblemPendingDto | null;
}

export class StockProblemListDto {
  @ApiProperty({ type: [StockProblemDto] }) data: StockProblemDto[];
}

export class StockProblemWarehouseDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseCode: string;
  @ApiProperty() warehouseName: string;
  @ApiProperty() productCount: number;
  @ApiProperty({ description: 'Products with a till shortfall' }) redCount: number;
  @ApiProperty({ description: 'Products with an order cut' }) cutCount: number;
  @ApiProperty({ description: 'The fixed customer and the expense type are both chosen' })
  settingsReady: boolean;
}

export class StockProblemSettingsDto {
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseCode: string;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: Number, nullable: true }) expenseTypeId: number | null;
  @ApiProperty({ type: String, nullable: true }) expenseTypeName: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedAt: string | null;
}

export class StockProblemResolutionDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() productId: number;
  @ApiProperty({ enum: STOCK_PROBLEM_RESOLUTION_KINDS }) kind: StockProblemResolutionKind;
  @ApiProperty({ enum: STOCK_PROBLEM_RESOLUTION_STATUSES }) status: StockProblemResolutionStatus;
  @ApiProperty({ type: String, nullable: true }) qtyBase: string | null;
  @ApiProperty({ type: String, nullable: true }) onHand: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: Number, nullable: true }) issueId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The issue’s status after the action' })
  issueStatus: string | null;
  @ApiProperty({ type: Number, nullable: true }) adjustmentId: number | null;
  @ApiProperty({ type: Number, nullable: true }) sheetId: number | null;
  @ApiProperty() createdAt: string;
}

export class StockProblemSheetDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseCode: string;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ description: 'YYYY-MM-DD, Ulaanbaatar' }) sheetDate: string;
  @ApiProperty({ enum: STOCK_PROBLEM_SHEET_STATUSES }) status: StockProblemSheetStatus;
  @ApiProperty() lineCount: number;
  @ApiProperty() countedCount: number;
  @ApiProperty() builtAt: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null: built by the 07:00 job' })
  builtByName: string | null;
  @ApiProperty({ type: String, nullable: true }) approvedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) approvedByName: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The shortages’ goods issue' })
  issueId: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The surpluses’ adjustment' })
  adjustmentId: number | null;
}

export class StockProblemSheetLineDto {
  @ApiProperty() id: number;
  @ApiProperty() sheetId: number;
  @ApiProperty({ type: StockProblemProductDto }) product: StockProblemProductDto;
  @ApiProperty({ type: String, nullable: true, description: 'The product’s fixed shelf' })
  binCode: string | null;
  @ApiProperty({ description: 'The system’s on-hand when the sheet was built' }) systemQty: string;
  @ApiProperty() redQty: string;
  @ApiProperty() cutQty: string;
  @ApiProperty({ type: String, nullable: true }) countedQty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The on-hand when it was counted' })
  onHandAtCount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'counted − on-hand at the count' })
  difference: string | null;
  @ApiProperty({ type: String, nullable: true }) countedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) countedByName: string | null;
  @ApiProperty({ enum: STOCK_PROBLEM_OUTCOMES, nullable: true, description: 'Set by the approval' })
  outcome: StockProblemOutcome | null;
  @ApiProperty({ type: Number, nullable: true }) resolutionId: number | null;
}

export class StockProblemSheetDetailDto extends StockProblemSheetDto {
  @ApiProperty({ type: [StockProblemSheetLineDto], description: 'In shelf order' })
  lines: StockProblemSheetLineDto[];
}

export class StockProblemSheetPageDto {
  @ApiProperty({ type: [StockProblemSheetDto] }) data: StockProblemSheetDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

// ── requests ─────────────────────────────────────────────────────────────────

export class StockProblemListQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @IsPositive() warehouseId: number;
}

export class MarkLegitimateDto {
  @ApiProperty() @IsInt() @IsPositive() warehouseId: number;
  @ApiProperty() @IsInt() @IsPositive() productId: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: STOCK_PROBLEM_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(STOCK_PROBLEM_NOTE_MAX)
  note?: string | null;
}

export class ZeroOutDto {
  @ApiProperty() @IsInt() @IsPositive() warehouseId: number;
  @ApiProperty() @IsInt() @IsPositive() productId: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Base units to issue; omitted: the whole on-hand of the warehouse',
  })
  @IsOptional()
  @IsString()
  @Matches(STOCK_PROBLEM_QTY_PATTERN)
  qty?: string | null;
}

export class StockProblemSettingsRequestDto {
  @ApiProperty({ type: Number, nullable: true, description: 'The warehouse’s fixed customer' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsPositive()
  customerId: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'A goods issue expense type' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsPositive()
  expenseTypeId: number | null;
}

export class BuildSheetsDto {
  @ApiPropertyOptional({ description: 'Omitted: every warehouse of the caller’s scope' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  warehouseId?: number;
}

export class StockProblemSheetListQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  warehouseId?: number;

  @ApiPropertyOptional({ enum: STOCK_PROBLEM_SHEET_STATUSES })
  @IsOptional()
  @IsIn(STOCK_PROBLEM_SHEET_STATUSES)
  status?: StockProblemSheetStatus;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsCalendarDate()
  sheetDate?: string;
}

export class CountSheetLineDto {
  @ApiProperty({ description: 'Counted, base units; zero or more, up to 3 decimals' })
  @IsString()
  @Matches(STOCK_PROBLEM_QTY_PATTERN)
  countedQty: string;
}

export class ApproveSheetDto {
  @ApiPropertyOptional({
    description:
      'true: approve the counted lines and leave the rest on the list; default false refuses a sheet with uncounted lines',
  })
  @IsOptional()
  @IsBoolean()
  countedOnly?: boolean;
}
