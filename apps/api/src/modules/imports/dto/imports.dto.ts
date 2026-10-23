import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  IMPORT_KINDS,
  type ImportKind,
  RECEIPT_IMPORT_PAYMENT_METHODS,
  type ReceiptImportOptions,
} from '@tugeel/shared/imports';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { IMPORT_ACTIONS, IMPORT_STATUSES, type ImportAction, type ImportStatus } from '../schema';

const ROW_FILTERS = ['ERRORS', 'WARNINGS', 'ALL'] as const;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'ImportProblem' })
export class ImportProblemDto {
  @ApiProperty({ example: 'IMPORT_REVERT_BLOCKED' }) code: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) params?: Record<
    string,
    unknown
  >;
}

@ApiSchema({ name: 'ImportFileIssue' })
export class ImportFileIssueDto {
  @ApiProperty({ example: 'MISSING_COLUMNS' }) code: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) params?: Record<
    string,
    unknown
  >;
}

@ApiSchema({ name: 'ImportSummary' })
export class ImportSummaryDto {
  @ApiPropertyOptional({
    type: [ImportFileIssueDto],
    description: 'Why the whole sheet was refused',
  })
  fileIssues?: ImportFileIssueDto[];
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Rows by action: CREATE, UPDATE, UNCHANGED',
  })
  actions?: Record<string, number>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'number' } })
  errors?: Record<string, number>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'number' } })
  warnings?: Record<string, number>;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'What the commit did, by action; COMPLETED: products a price import completed (ADR-0054)',
  })
  applied?: Record<string, number>;
  @ApiPropertyOptional({ description: 'The commit found the data changed and checked again' })
  refreshed?: boolean;
  @ApiPropertyOptional({ description: 'Advisory locks the commit held at its end (diagnostics)' })
  advisoryLocks?: number;
  @ApiPropertyOptional({
    description: 'The rows were deleted 90 days after the import was refused, failed or reverted',
  })
  rowsPruned?: boolean;
  @ApiPropertyOptional({ description: 'The uploaded sheet was deleted a year after the upload' })
  sheetDeleted?: boolean;
}

@ApiSchema({ name: 'ReceiptImportOptions' })
export class ReceiptImportOptionsDto implements ReceiptImportOptions {
  @ApiProperty({ enum: RECEIPT_IMPORT_PAYMENT_METHODS })
  @IsIn(RECEIPT_IMPORT_PAYMENT_METHODS)
  paymentMethod: ReceiptImportOptions['paymentMethod'];
  @ApiProperty({ type: Number, nullable: true, description: 'Cash box or bank account' })
  @IsOptional()
  @IsInt()
  @Min(1)
  moneyAccountId: number | null;
}

@ApiSchema({ name: 'IssueImportOptions' })
export class IssueImportOptionsDto {
  @ApiProperty({ description: 'A warehouse or store' }) @IsInt() @Min(1) warehouseId: number;
}

@ApiSchema({ name: 'FinOpeningImportOptions' })
export class FinOpeningImportOptionsDto {
  @ApiProperty({ example: '2026-12-31', description: 'The opening date: the day before go-live' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

@ApiSchema({ name: 'ImportJob' })
export class ImportJobDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: IMPORT_KINDS }) kind: ImportKind;
  @ApiProperty() fileName: string;
  @ApiProperty({ enum: IMPORT_STATUSES }) status: ImportStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PARSING, CHECKING, APPLYING or REVERTING while the worker runs',
  })
  phase: string | null;
  @ApiProperty() totalRows: number;
  @ApiProperty() processedRows: number;
  @ApiProperty() errorRows: number;
  @ApiProperty() warningRows: number;
  @ApiProperty({ type: ImportSummaryDto, nullable: true }) summary: ImportSummaryDto | null;
  @ApiProperty({ type: ImportProblemDto, nullable: true }) lastError: ImportProblemDto | null;
  @ApiProperty({ type: ReceiptImportOptionsDto, nullable: true, description: 'RECEIPTS only' })
  receiptOptions: ReceiptImportOptionsDto | null;
  @ApiProperty({ type: IssueImportOptionsDto, nullable: true, description: 'ISSUES only' })
  issueOptions: IssueImportOptionsDto | null;
  @ApiProperty({
    type: FinOpeningImportOptionsDto,
    nullable: true,
    description: 'FIN_OPENING only',
  })
  openingOptions: FinOpeningImportOptionsDto | null;
  @ApiProperty({ description: 'The most recent committed import: only it can be reverted' })
  canRevert: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validatedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) committedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revertedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'ImportJobPage' })
export class ImportJobPageDto {
  @ApiProperty({ type: [ImportJobDto] }) data: ImportJobDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'ImportIssue' })
export class ImportIssueDto {
  @ApiProperty({ type: String, nullable: true, description: 'Column key; null for the whole row' })
  column: string | null;
  @ApiProperty({ example: 'NOT_FOUND' }) code: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) params?: Record<
    string,
    unknown
  >;
}

@ApiSchema({ name: 'ImportRow' })
export class ImportRowDto {
  @ApiProperty({ description: 'The row number in the sheet' }) rowNo: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    description: 'Cell text by column key',
  })
  raw: Record<string, string | null>;
  @ApiProperty({ type: [ImportIssueDto] }) errors: ImportIssueDto[];
  @ApiProperty({ type: [ImportIssueDto] }) warnings: ImportIssueDto[];
  @ApiProperty({ enum: IMPORT_ACTIONS, nullable: true }) action: ImportAction | null;
  @ApiProperty({ type: [String], description: 'Fields an UPDATE row changes' }) changed: string[];
}

@ApiSchema({ name: 'ImportRowPage' })
export class ImportRowPageDto {
  @ApiProperty({ type: [ImportRowDto] }) data: ImportRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'ImportCreateRequest' })
export class CreateImportDto {
  @ApiProperty({ enum: IMPORT_KINDS }) @IsIn(IMPORT_KINDS) kind: ImportKind;
  @ApiProperty({ description: 'An uploaded file of kind imports.source' })
  @IsInt()
  @Min(1)
  fileId: number;
  @ApiProperty({ example: 'Бараа.xlsx', maxLength: 255 })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;
  @ApiPropertyOptional({ type: ReceiptImportOptionsDto, description: 'Required for RECEIPTS' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptImportOptionsDto)
  receiptOptions?: ReceiptImportOptionsDto;
  @ApiPropertyOptional({ type: IssueImportOptionsDto, description: 'Required for ISSUES' })
  @IsOptional()
  @ValidateNested()
  @Type(() => IssueImportOptionsDto)
  issueOptions?: IssueImportOptionsDto;
  @ApiPropertyOptional({
    type: FinOpeningImportOptionsDto,
    description: 'Required for FIN_OPENING',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FinOpeningImportOptionsDto)
  openingOptions?: FinOpeningImportOptionsDto;
}

export class ImportListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: IMPORT_KINDS }) @IsOptional() @IsIn(IMPORT_KINDS) kind?: ImportKind;
  @ApiPropertyOptional({ enum: IMPORT_STATUSES })
  @IsOptional()
  @IsIn(IMPORT_STATUSES)
  status?: ImportStatus;
}

export class ImportRowsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ROW_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsIn(ROW_FILTERS)
  filter?: (typeof ROW_FILTERS)[number];
}

export class ImportKindParamDto {
  @ApiProperty({ enum: IMPORT_KINDS }) @IsIn(IMPORT_KINDS) kind: ImportKind;
}
