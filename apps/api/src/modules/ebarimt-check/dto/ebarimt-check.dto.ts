import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EBARIMT_AMOUNT_PATTERN,
  EBARIMT_HISTORY_FIELDS,
  EBARIMT_HISTORY_KINDS,
  EBARIMT_LIMITS,
  type EbarimtHistoryField,
  type EbarimtHistoryKind,
  isPeriod,
} from '@tugeel/shared/ebarimt-check';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/** A month as one number (202610). */
function IsPeriod(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isPeriod',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'number' && isPeriod(value),
        defaultMessage: () => `${propertyName} must be a month like 202610`,
      },
    });
  };
}

/** «202610,202609» as a list. */
const periodList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part))
    : value;

export class EbarimtPeriodsQueryDto {
  @ApiProperty({ type: String, example: '202610,202609', description: 'Months, comma separated' })
  @Transform(periodList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EBARIMT_LIMITS.maxPeriods)
  @IsPeriod({ each: true })
  periods!: number[];
}

export class EbarimtReceiptsQueryDto extends EbarimtPeriodsQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @IsPositive() supplierId!: number;
}

export class EbarimtEntriesQueryDto extends EbarimtPeriodsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  supplierId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) ttd?: string;
}

export class EbarimtFilesQueryDto {
  @ApiProperty({ example: 2026 }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
}

export class EbarimtFileRemoveQueryDto {
  @ApiProperty({ description: 'The file the person saw: a newer one in the month is a conflict' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  fileId!: number;
}

export class EbarimtImportRequestDto {
  @ApiProperty({ description: 'An uploaded file of kind ebarimt.source' })
  @IsInt()
  @IsPositive()
  fileId!: number;

  @ApiProperty({ example: 'EBARIMT Падаан (Худалдан авалт) 2026 [10-р сар].xlsx' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  fileName!: string;
}

export class EbarimtMonthFileDto {
  @ApiProperty() id!: number;
  @ApiProperty() period!: number;
  @ApiProperty() fileName!: string;
  @ApiProperty() rowCount!: number;
  @ApiProperty({ example: '90909.09' }) vatAmount!: string;
  @ApiProperty({ example: '1000000.00' }) totalAmount!: string;
  @ApiProperty() uploadedAt!: string;
  @ApiProperty({ type: String, nullable: true }) uploadedByName!: string | null;
}

export class EbarimtImportResultDto extends EbarimtMonthFileDto {
  @ApiProperty({ type: Number, nullable: true }) replacedRowCount!: number | null;
}

export class EbarimtMonthDto {
  @ApiProperty() period!: number;
  @ApiProperty({ type: EbarimtMonthFileDto, nullable: true }) file!: EbarimtMonthFileDto | null;
}

export class EbarimtFileOverviewDto {
  @ApiProperty({ type: [EbarimtMonthDto] }) months!: EbarimtMonthDto[];
  @ApiProperty({ type: Number, nullable: true }) latestPeriod!: number | null;
}

export class EbarimtAccountOptionDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() counted!: boolean;
}

export class EbarimtSettingsDto {
  @ApiProperty({ type: [EbarimtAccountOptionDto] }) accounts!: EbarimtAccountOptionDto[];
}

export class EbarimtSettingsRequestDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  accountCodes!: string[];
}

export class EbarimtPeriodValuesDto {
  @ApiProperty() period!: number;
  @ApiProperty() purchaseAmount!: string;
  @ApiProperty() receiptCount!: number;
  @ApiProperty() pendingCount!: number;
  @ApiProperty() ebarimtAmount!: string;
  @ApiProperty() ebarimtCount!: number;
  @ApiProperty() exemptAmount!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}

export class EbarimtEmployeeMonthsDto {
  @ApiProperty({ type: Number, nullable: true }) userId!: number | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: [Number] }) periods!: number[];
}

export class EbarimtHistoryEventDto {
  @ApiProperty() period!: number;
  @ApiProperty({ enum: EBARIMT_HISTORY_FIELDS, enumName: 'EbarimtHistoryField' })
  field!: EbarimtHistoryField;
  @ApiProperty({ enum: EBARIMT_HISTORY_KINDS, enumName: 'EbarimtHistoryKind' })
  kind!: EbarimtHistoryKind;
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ type: String, nullable: true }) userName!: string | null;
  @ApiProperty({ type: String, nullable: true }) source!: string | null;
  @ApiProperty() changedAt!: string;
  @ApiProperty({ type: String, nullable: true }) changedByName!: string | null;
}

export class EbarimtReportRowDto {
  @ApiProperty() supplierId!: number;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() registers!: string;
  @ApiProperty({ type: String, nullable: true }) registersDefault!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ type: String, nullable: true }) phoneDefault!: string | null;
  @ApiProperty() remark!: string;
  @ApiProperty({ type: [String] }) sharedRegisters!: string[];
  @ApiProperty({ type: Number, nullable: true }) employeeUserId!: number | null;
  @ApiProperty({ type: String, nullable: true }) employeeName!: string | null;
  @ApiProperty({ type: String, nullable: true }) ordererName!: string | null;
  @ApiProperty() employeeAssigned!: boolean;
  @ApiProperty({ type: [EbarimtEmployeeMonthsDto] }) employeeMonths!: EbarimtEmployeeMonthsDto[];
  @ApiProperty() purchaseAmount!: string;
  @ApiProperty() receiptCount!: number;
  @ApiProperty() pendingCount!: number;
  @ApiProperty() ebarimtAmount!: string;
  @ApiProperty() ebarimtCount!: number;
  @ApiProperty() linkedAmount!: string;
  @ApiProperty() exemptAmount!: string;
  @ApiProperty() diffAmount!: string;
  @ApiProperty({ type: [EbarimtPeriodValuesDto] }) byPeriod!: EbarimtPeriodValuesDto[];
  @ApiProperty({ type: [EbarimtHistoryEventDto] }) history!: EbarimtHistoryEventDto[];
}

export class EbarimtUnregisteredRowDto {
  @ApiProperty() ttd!: string;
  @ApiProperty() name!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() count!: number;
  @ApiProperty({ type: [Number] }) periods!: number[];
}

export class EbarimtLinkViewDto {
  @ApiProperty() period!: number;
  @ApiProperty() receiptKey!: string;
  @ApiProperty() ttd!: string;
  @ApiProperty({ type: String, nullable: true }) partnerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryNoteNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) docDate!: string | null;
  @ApiProperty() amount!: string;
  @ApiProperty() supplierId!: number;
  @ApiProperty() supplierCode!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
  @ApiProperty() stale!: boolean;
}

export class EbarimtReportDto {
  @ApiProperty({ type: [Number] }) periods!: number[];
  @ApiProperty({ type: [Number] }) noFile!: number[];
  @ApiProperty({ type: [EbarimtReportRowDto] }) rows!: EbarimtReportRowDto[];
  @ApiProperty({ type: [EbarimtUnregisteredRowDto] }) unregistered!: EbarimtUnregisteredRowDto[];
  @ApiProperty({ type: [EbarimtLinkViewDto] }) links!: EbarimtLinkViewDto[];
  @ApiProperty({ type: [String] }) accountCodes!: string[];
}

export class EbarimtReceiptBriefDto {
  @ApiProperty() id!: number;
  @ApiProperty({ type: String, nullable: true }) number!: string | null;
  @ApiProperty() period!: number;
  @ApiProperty() day!: string;
  @ApiProperty({ type: String, nullable: true }) supplierDocNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) accountCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) accountName!: string | null;
  @ApiProperty() counted!: boolean;
  @ApiProperty() pricePending!: boolean;
  @ApiProperty() lineCount!: number;
  @ApiProperty() warehouses!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) amount!: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
}

export class EbarimtReceiptListDto {
  @ApiProperty({ type: [EbarimtReceiptBriefDto] }) data!: EbarimtReceiptBriefDto[];
}

export class EbarimtEntryLinkDto {
  @ApiProperty() supplierId!: number;
  @ApiProperty() supplierCode!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
}

export class EbarimtEntryViewDto {
  @ApiProperty() period!: number;
  @ApiProperty({ description: 'The line’s row in the month’s file' }) rowNo!: number;
  @ApiProperty() receiptKey!: string;
  @ApiProperty({ type: String, nullable: true }) ddtd!: string | null;
  @ApiProperty({ type: String, nullable: true }) deliveryNoteNo!: string | null;
  @ApiProperty() docDate!: string;
  @ApiProperty({ type: String, nullable: true }) partnerName!: string | null;
  @ApiProperty() ttd!: string;
  @ApiProperty() vatAmount!: string;
  @ApiProperty() netAmount!: string;
  @ApiProperty() totalAmount!: string;
  @ApiProperty({ type: String, nullable: true }) kind!: string | null;
  @ApiProperty({ type: EbarimtEntryLinkDto, nullable: true }) link!: EbarimtEntryLinkDto | null;
}

export class EbarimtEntriesDto {
  @ApiProperty({ type: [String] }) registers!: string[];
  @ApiProperty({ type: [Number] }) noFile!: number[];
  @ApiProperty({ type: [EbarimtEntryViewDto] }) rows!: EbarimtEntryViewDto[];
}

export class EbarimtMonthValueRequestDto {
  @ApiProperty() @IsPeriod() period!: number;
  @ApiProperty() @IsInt() @IsPositive() supplierId!: number;

  @ApiPropertyOptional({ example: '12500.00', description: 'Exempt from VAT, up to 2 decimals' })
  @ValidateIf((_, value) => value !== undefined)
  @Matches(EBARIMT_AMOUNT_PATTERN)
  exemptAmount?: string;

  @ApiPropertyOptional({
    description:
      'The amount the cell showed, wanted with exemptAmount: a change since is a conflict',
  })
  @ValidateIf(
    (body: EbarimtMonthValueRequestDto) =>
      body.exemptAmount !== undefined || body.previousExemptAmount !== undefined,
  )
  @Matches(EBARIMT_AMOUNT_PATTERN)
  previousExemptAmount?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(EBARIMT_LIMITS.maxNote)
  note?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The note the cell showed, wanted with note: a change since is a conflict',
  })
  @ValidateIf(
    (body: EbarimtMonthValueRequestDto) => body.note !== undefined && body.previousNote !== null,
  )
  @IsString()
  @MaxLength(EBARIMT_LIMITS.maxNote)
  previousNote?: string | null;
}

export class EbarimtAssignRequestDto {
  @ApiProperty() @IsPeriod() period!: number;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EBARIMT_LIMITS.maxSuppliers)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  supplierIds!: number[];

  @ApiProperty({ type: Number, nullable: true, description: 'null: back to the own orderer' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsPositive()
  userId!: number | null;
}

export class EbarimtAssignResultDto {
  @ApiProperty() changed!: number;
}

export class EbarimtProfileRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'null: the record’s' })
  @IsOptional()
  @IsString()
  @MaxLength(EBARIMT_LIMITS.maxRegisters)
  registers?: string | null;

  @ApiPropertyOptional({ description: 'What the cell showed, wanted with registers' })
  @ValidateIf((body: EbarimtProfileRequestDto) => body.registers !== undefined)
  @IsString()
  previousRegisters?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null: the record’s' })
  @IsOptional()
  @IsString()
  @MaxLength(EBARIMT_LIMITS.maxPhone)
  phone?: string | null;

  @ApiPropertyOptional({ description: 'What the cell showed, wanted with phone' })
  @ValidateIf((body: EbarimtProfileRequestDto) => body.phone !== undefined)
  @IsString()
  previousPhone?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(EBARIMT_LIMITS.maxRemark)
  remark?: string | null;

  @ApiPropertyOptional({ description: 'What the cell showed, wanted with remark' })
  @ValidateIf((body: EbarimtProfileRequestDto) => body.remark !== undefined)
  @IsString()
  previousRemark?: string;
}

export class EbarimtLinkRequestDto {
  @ApiProperty() @IsPeriod() period!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EBARIMT_LIMITS.maxReceiptKeys)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  receiptKeys!: string[];

  @ApiProperty({ type: Number, nullable: true, description: 'null: undoes the links' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsPositive()
  supplierId!: number | null;

  @ApiPropertyOptional({
    description: 'Wanted with supplierId null: whose link the person saw; anyone else’s stays',
  })
  @ValidateIf((body: EbarimtLinkRequestDto) => body.supplierId === null)
  @IsInt()
  @IsPositive()
  previousSupplierId?: number;
}

export class EbarimtLinkResultDto {
  @ApiProperty() linked!: number;
  @ApiProperty() unlinked!: number;
  @ApiProperty() skipped!: number;
}
