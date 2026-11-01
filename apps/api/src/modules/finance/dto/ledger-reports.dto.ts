import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { queryIds } from '../../../common/pagination/page';
import { LEDGER_REPORT_KINDS, type LedgerReportKind } from '../services/ledger-reports.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROLS = [
  'NONE',
  'RECEIVABLE',
  'PAYABLE',
  'ADVANCE_RECEIVED',
  'ADVANCE_PAID',
  'MONEY',
] as const;
const PARTY_KINDS = ['CUSTOMER', 'SUPPLIER', 'OTHER'] as const;

const queryBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const queryList = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** The prompt of a ledger report (ADR-0133). */
@ApiSchema({ name: 'LedgerReportQuery' })
export class LedgerReportQueryDto {
  @ApiProperty({ enum: LEDGER_REPORT_KINDS }) @IsIn(LEDGER_REPORT_KINDS) kind: LedgerReportKind;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) from: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE) to: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(queryIds)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  accountIds?: number[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(queryList)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  groupCodes?: string[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(queryIds)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  customerIds?: number[];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @Transform(queryIds)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  supplierIds?: number[];

  @ApiPropertyOptional({ description: 'Customers of this group' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerCategoryId?: number;

  @ApiPropertyOptional({ description: 'Lines whose description holds this text' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  description?: string;

  @ApiPropertyOptional({ description: 'Lines with this account (prefix) on the other side' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/^[0-9A-Za-z.-]{1,32}$/)
  counterAccount?: string;

  @ApiPropertyOptional({ description: 'Also rows without an opening or a turnover' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  withEmpty?: boolean;
}

@ApiSchema({ name: 'LedgerLinesQuery' })
export class LedgerLinesQueryDto extends LedgerReportQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) accountId: number;

  @ApiPropertyOptional({ description: "The core's party id, or `none` for lines without one" })
  @IsOptional()
  @Matches(/^([1-9]\d{0,17}|none)$/)
  partyId?: string;
}

@ApiSchema({ name: 'LedgerAccountOption' })
export class LedgerAccountOptionDto {
  @ApiProperty() accountId: number;
  @ApiProperty({ example: '120101' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: CONTROLS }) control: (typeof CONTROLS)[number];
  @ApiProperty({ type: String, nullable: true }) groupCode: string | null;
  @ApiProperty({ type: String, nullable: true }) groupName: string | null;
}

@ApiSchema({ name: 'LedgerAccountOptions' })
export class LedgerAccountOptionsDto {
  @ApiProperty({ type: [LedgerAccountOptionDto] }) data: LedgerAccountOptionDto[];
}

@ApiSchema({ name: 'LedgerParty' })
export class LedgerPartyDto {
  @ApiProperty({ description: "The core's party id" }) partyId: string;
  @ApiProperty({ enum: PARTY_KINDS }) kind: (typeof PARTY_KINDS)[number];
  @ApiProperty({ type: Number, nullable: true, description: 'The customer or supplier id' })
  refId: number | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'LedgerReportRow' })
export class LedgerReportRowDto {
  @ApiProperty() accountId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: CONTROLS }) control: (typeof CONTROLS)[number];
  @ApiProperty({ type: String, nullable: true }) groupCode: string | null;
  @ApiProperty({ type: String, nullable: true }) groupName: string | null;
  @ApiProperty({ type: LedgerPartyDto, nullable: true }) party: LedgerPartyDto | null;
  @ApiProperty({ example: '150000.00', description: 'debit − credit before `from`' })
  opening: string;
  @ApiProperty({ example: '10000.00' }) debit: string;
  @ApiProperty({ example: '0.00' }) credit: string;
  @ApiProperty({ example: '160000.00', description: 'debit − credit at `to`' }) closing: string;
}

@ApiSchema({ name: 'LedgerReport' })
export class LedgerReportDto {
  @ApiProperty({ enum: LEDGER_REPORT_KINDS }) kind: LedgerReportKind;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [LedgerReportRowDto] }) data: LedgerReportRowDto[];
  @ApiProperty() opening: string;
  @ApiProperty() debit: string;
  @ApiProperty() credit: string;
  @ApiProperty() closing: string;
}

@ApiSchema({ name: 'LedgerLine' })
export class LedgerLineDto {
  @ApiProperty() lineId: number;
  @ApiProperty() entryId: number;
  @ApiProperty() entryNumber: string;
  @ApiProperty() entryDate: string;
  @ApiProperty() entryDescription: string;
  @ApiProperty({ type: String, nullable: true }) lineDescription: string | null;
  @ApiProperty({ example: 'BTO' }) system: string;
  @ApiProperty({ type: String, nullable: true }) sourceDocType: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceDocId: string | null;
  @ApiProperty({ type: Number, nullable: true }) documentId: number | null;
  @ApiProperty({ type: String, nullable: true }) documentNumber: string | null;
  @ApiProperty({ type: LedgerPartyDto, nullable: true }) party: LedgerPartyDto | null;
  @ApiProperty() debit: string;
  @ApiProperty() credit: string;
  @ApiProperty({ type: [String], example: ['C:510101'], description: 'D:<code> or C:<code>' })
  counters: string[];
  @ApiProperty() balanceAfter: string;
}

@ApiSchema({ name: 'LedgerLines' })
export class LedgerLinesDto {
  @ApiProperty() opening: string;
  @ApiProperty({ type: [LedgerLineDto] }) data: LedgerLineDto[];
  @ApiProperty({ description: 'More lines than listed (the oldest are shown)' }) truncated: boolean;
}
