import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  BANK_EXPORT_FILES,
  BANK_EXPORT_TYPES,
  BANK_LINE_ACTIONS,
  BANK_LINE_KINDS,
  BANK_LINE_MISSING,
  BANK_STATEMENT_LIMITS,
  type BankExportFile,
  type BankExportType,
  type BankLineAction,
  type BankLineKind,
  type BankLineMissing,
  FINANCE_LIMITS,
} from '@tugeel/shared/finance';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'BankStatementUploadRequest' })
export class BankStatementUploadRequestDto {
  @ApiProperty() @IsInt() @Min(1) fileId: number;
  /** Khan Bank's own name, `Statement_MNT_<number>.xlsx`: it holds the account and the currency. */
  @ApiProperty({ example: 'Statement_MNT_5000000001.xlsx', maxLength: 300 })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  fileName: string;
}

@ApiSchema({ name: 'BankStatementMissing' })
export class BankStatementMissingDto implements Record<BankLineMissing, number> {
  @ApiProperty() party: number;
  @ApiProperty() account: number;
  @ApiProperty() description: number;
  @ApiProperty() action: number;
  @ApiProperty() export: number;
}

@ApiSchema({ name: 'BankStatement' })
export class BankStatementDto {
  @ApiProperty() id: number;
  @ApiProperty() accountNumber: string;
  @ApiProperty({ example: 'MNT' }) currency: string;
  @ApiProperty({ example: '2026-11-05' }) statementDate: string;
  @ApiProperty({ example: '2026-11-05' }) dateTo: string;
  @ApiProperty() fileName: string;
  @ApiProperty() uploadedAt: string;
  @ApiProperty({ type: Number, nullable: true }) moneyAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) moneyAccountName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The chart code of the bank account' })
  accountCode: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty() feeCount: number;
  @ApiProperty({ example: '12006380.00' }) totalCredit: string;
  @ApiProperty({ example: '2180000.00' }) totalDebit: string;
  @ApiProperty() filledCount: number;
  @ApiProperty() postedCount: number;
  @ApiProperty({ type: BankStatementMissingDto }) missing: BankStatementMissingDto;
}

@ApiSchema({ name: 'BankStatementLine' })
export class BankStatementLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() txnAt: string;
  @ApiProperty({ example: '2026-11-05' }) businessDate: string;
  @ApiProperty({ example: '0.00' }) debit: string;
  @ApiProperty({ example: '168980.00' }) credit: string;
  @ApiProperty() bankDescription: string;
  @ApiProperty() bankCounterpart: string;
  @ApiProperty({ enum: BANK_LINE_KINDS, enumName: 'BankLineKind' }) kind: BankLineKind;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: String, nullable: true }) customerCode: string | null;
  @ApiProperty({ type: Number, nullable: true }) supplierId: number | null;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty({ type: String, nullable: true }) supplierCode: string | null;
  @ApiProperty({ type: Number, nullable: true }) counterAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) counterAccountCode: string | null;
  @ApiProperty({ type: String, nullable: true }) counterAccountName: string | null;
  @ApiProperty() description: string;
  @ApiProperty({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction', nullable: true })
  action: BankLineAction | null;
  @ApiProperty({ enum: BANK_EXPORT_TYPES, enumName: 'BankExportType', nullable: true })
  exportType: BankExportType | null;
  @ApiProperty({ type: Number, nullable: true }) paymentId: number | null;
  @ApiProperty({ type: Number, nullable: true }) journalEntryId: number | null;
  @ApiProperty({ type: String, nullable: true }) postedAt: string | null;
  @ApiProperty({ enum: BANK_LINE_MISSING, enumName: 'BankLineMissing', isArray: true })
  missing: BankLineMissing[];
}

@ApiSchema({ name: 'BankStatementDetail' })
export class BankStatementDetailDto extends BankStatementDto {
  @ApiProperty({ type: [BankStatementLineDto] }) lines: BankStatementLineDto[];
}

@ApiSchema({ name: 'BankStatementUpload' })
export class BankStatementUploadDto {
  @ApiProperty({ type: BankStatementDto, nullable: true }) statement: BankStatementDto | null;
  @ApiProperty() newLines: number;
  @ApiProperty() duplicateLines: number;
}

@ApiSchema({ name: 'BankCalendarDay' })
export class BankCalendarDayDto {
  @ApiProperty({ example: '2026-11-05' }) date: string;
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'BankCalendarQuery' })
export class BankCalendarQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;
}

@ApiSchema({ name: 'BankDateQuery' })
export class BankDateQueryDto {
  @ApiProperty({ example: '2026-11-05' }) @Matches(DATE) date: string;
}

@ApiSchema({ name: 'BankFileQuery' })
export class BankFileQueryDto {
  @ApiProperty({ enum: BANK_EXPORT_FILES, enumName: 'BankExportFile' })
  @IsIn(BANK_EXPORT_FILES)
  file: BankExportFile;
}

@ApiSchema({ name: 'BankDateFileQuery' })
export class BankDateFileQueryDto extends BankFileQueryDto {
  @ApiProperty({ example: '2026-11-05' }) @Matches(DATE) date: string;
}

@ApiSchema({ name: 'BankFeesQuery' })
export class BankFeesQueryDto {
  @ApiProperty({ example: '2026-11-01' }) @Matches(DATE) from: string;
  @ApiProperty({ example: '2026-11-30' }) @Matches(DATE) to: string;
}

@ApiSchema({ name: 'BankExportManifest' })
export class BankExportManifestDto implements Record<BankExportFile, number> {
  @ApiProperty() RECEIVABLE: number;
  @ApiProperty() CASH: number;
  @ApiProperty() BANK: number;
  @ApiProperty() fees: number;
}

/** Only the fields sent change: one cell's save never touches the others. */
@ApiSchema({ name: 'BankLinePatch' })
export class BankLinePatchDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  counterAccountId?: number | null;
  @ApiPropertyOptional({ maxLength: BANK_STATEMENT_LIMITS.maxDescription })
  @IsOptional()
  @IsString()
  @MaxLength(BANK_STATEMENT_LIMITS.maxDescription)
  description?: string;
  @ApiPropertyOptional({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction', nullable: true })
  @IsOptional()
  @IsIn(BANK_LINE_ACTIONS)
  action?: BankLineAction | null;
  @ApiPropertyOptional({ enum: BANK_EXPORT_TYPES, enumName: 'BankExportType', nullable: true })
  @IsOptional()
  @IsIn(BANK_EXPORT_TYPES)
  exportType?: BankExportType | null;
}

@ApiSchema({ name: 'BankLinesBulkRequest' })
export class BankLinesBulkRequestDto extends BankLinePatchDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BANK_STATEMENT_LIMITS.maxBatch)
  @IsInt({ each: true })
  @Min(1, { each: true })
  lineIds: number[];
  /** Each line's text made from its own bank text: «Дансаар - <банкны утга>». */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() descriptionFromBank?: boolean;
}

@ApiSchema({ name: 'BankLinesBulkResult' })
export class BankLinesBulkResultDto {
  @ApiProperty() updated: number;
  @ApiProperty({ type: BankStatementDetailDto }) statement: BankStatementDetailDto;
}

@ApiSchema({ name: 'BankStatementPostRequest' })
export class BankStatementPostRequestDto {
  /** Left out: every ready line of the statement. */
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BANK_STATEMENT_LIMITS.maxBatch)
  @IsInt({ each: true })
  @Min(1, { each: true })
  lineIds?: number[];
}

@ApiSchema({ name: 'BankPostFailure' })
export class BankPostFailureDto {
  @ApiProperty() lineId: number;
  @ApiProperty() lineNo: number;
  @ApiProperty({ example: 'FIN_PERIOD_CLOSED' }) code: string;
  @ApiProperty() detail: string;
}

@ApiSchema({ name: 'BankStatementPostResult' })
export class BankStatementPostResultDto {
  @ApiProperty() posted: number;
  @ApiProperty({ description: 'Lines still lacking something' }) skipped: number;
  @ApiProperty({ type: [BankPostFailureDto] }) failures: BankPostFailureDto[];
  @ApiProperty({ type: BankStatementDetailDto }) statement: BankStatementDetailDto;
}

@ApiSchema({ name: 'BankLineReverseRequest' })
export class BankLineReverseRequestDto {
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxDescription })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(FINANCE_LIMITS.maxDescription)
  reason: string;
}

@ApiSchema({ name: 'BankStatementLinkRequest' })
export class BankStatementLinkRequestDto {
  @ApiProperty() @IsInt() @Min(1) moneyAccountId: number;
}

@ApiSchema({ name: 'BankStatementRules' })
export class BankStatementRulesDto {
  @ApiProperty({ type: Number, nullable: true }) settlementAccountId: number | null;
  @ApiProperty() settlementDescription: string;
  @ApiProperty({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction' })
  settlementAction: BankLineAction;
  @ApiProperty({ type: Number, nullable: true }) feeAccountId: number | null;
  @ApiProperty() feeDescription: string;
  @ApiProperty({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction' }) feeAction: BankLineAction;
  @ApiProperty({ enum: BANK_EXPORT_TYPES, enumName: 'BankExportType' })
  feeExportType: BankExportType;
  @ApiProperty({ example: '30000' }) partyCode: string;
  @ApiProperty({ type: [Number] }) counterAccountIds: number[];
}

@ApiSchema({ name: 'BankStatementRulesRequest' })
export class BankStatementRulesRequestDto {
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  settlementAccountId: number | null;
  @ApiProperty({ maxLength: BANK_STATEMENT_LIMITS.maxDescription })
  @IsString()
  @MaxLength(BANK_STATEMENT_LIMITS.maxDescription)
  settlementDescription: string;
  @ApiProperty({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction' })
  @IsIn(BANK_LINE_ACTIONS)
  settlementAction: BankLineAction;
  @ApiProperty({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  feeAccountId: number | null;
  @ApiProperty({ maxLength: BANK_STATEMENT_LIMITS.maxDescription })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(BANK_STATEMENT_LIMITS.maxDescription)
  feeDescription: string;
  @ApiProperty({ enum: BANK_LINE_ACTIONS, enumName: 'BankLineAction' })
  @IsIn(BANK_LINE_ACTIONS)
  feeAction: BankLineAction;
  @ApiProperty({ enum: BANK_EXPORT_TYPES, enumName: 'BankExportType' })
  @IsIn(BANK_EXPORT_TYPES)
  feeExportType: BankExportType;
  @ApiProperty({ maxLength: BANK_STATEMENT_LIMITS.maxPartyCode })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(BANK_STATEMENT_LIMITS.maxPartyCode)
  partyCode: string;
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(BANK_STATEMENT_LIMITS.maxCounterAccounts)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  counterAccountIds: number[];
}
