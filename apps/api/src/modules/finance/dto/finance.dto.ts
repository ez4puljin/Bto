import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  AGING_BUCKETS,
  ALLOCATION_SOURCES,
  type AllocationSource,
  AR_ENTRY_KINDS,
  type ArEntryKind,
  FINANCE_DOC_KINDS,
  FINANCE_LIMITS,
  type FinanceDocKind,
  GL_ACCOUNT_KINDS,
  GL_ROLES,
  type GlAccountKind,
  type GlRole,
  INVOICE_STATUSES,
  type InvoiceStatus,
  JOURNAL_SOURCES,
  type JournalSource,
  MONEY_ACCOUNT_KINDS,
  type MoneyAccountKind,
  PAYMENT_DIRECTIONS,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
  type PaymentDirection,
  type PaymentKind,
  type PaymentStatus,
  SETTLEMENTS,
  type Settlement,
} from '@tugeel/shared/finance';
import { PRICE_BASES, type PriceBasis } from '@tugeel/shared/pricing';
import { PAYMENT_METHODS, type PaymentMethod } from '@tugeel/shared/sales';
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { VAT_TYPES, type VatType } from '../../catalog';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
type AccountStatus = (typeof STATUSES)[number];

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

// ---------------------------------------------------------------- settings

@ApiSchema({ name: 'FinanceNumberFormat' })
export class FinanceNumberFormatDto {
  @ApiProperty({ example: 'Н-{year}{month}{day}-' }) pattern: string;
  @ApiProperty({ example: 4 }) digits: number;
}

@ApiSchema({ name: 'FinanceNumbering' })
export class FinanceNumberingDto {
  @ApiProperty({ type: FinanceNumberFormatDto }) INVOICE: FinanceNumberFormatDto;
  @ApiProperty({ type: FinanceNumberFormatDto }) PAYMENT: FinanceNumberFormatDto;
  @ApiProperty({ type: FinanceNumberFormatDto }) CREDIT_NOTE: FinanceNumberFormatDto;
  @ApiProperty({ type: FinanceNumberFormatDto }) JOURNAL: FinanceNumberFormatDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'FinanceNumberFormatRequest' })
export class FinanceNumberFormatRequestDto {
  @ApiProperty({
    example: 'Н-{year}{month}{day}-',
    description: 'Literal characters and {year}, {month}, {day}; ends with a non-digit',
  })
  @Transform(trimmed)
  @IsString()
  @MaxLength(24)
  pattern: string;
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(8) digits: number;
}

@ApiSchema({ name: 'FinanceNumberingRequest' })
export class FinanceNumberingRequestDto {
  @ApiProperty({ type: FinanceNumberFormatRequestDto })
  @ValidateNested()
  @Type(() => FinanceNumberFormatRequestDto)
  INVOICE: FinanceNumberFormatRequestDto;
  @ApiProperty({ type: FinanceNumberFormatRequestDto })
  @ValidateNested()
  @Type(() => FinanceNumberFormatRequestDto)
  PAYMENT: FinanceNumberFormatRequestDto;
  @ApiProperty({ type: FinanceNumberFormatRequestDto })
  @ValidateNested()
  @Type(() => FinanceNumberFormatRequestDto)
  CREDIT_NOTE: FinanceNumberFormatRequestDto;
  @ApiProperty({ type: FinanceNumberFormatRequestDto })
  @ValidateNested()
  @Type(() => FinanceNumberFormatRequestDto)
  JOURNAL: FinanceNumberFormatRequestDto;
}

@ApiSchema({ name: 'VoidRequest' })
export class VoidRequestDto {
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxReason })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxReason)
  reason: string;
}

@ApiSchema({ name: 'DateRangeQuery' })
export class DateRangeQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE) to?: string;
}

// ---------------------------------------------------------------- accounts

@ApiSchema({ name: 'GlAccount' })
export class GlAccountDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '120101' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: GL_ACCOUNT_KINDS }) kind: GlAccountKind;
  @ApiProperty({ enum: GL_ROLES, nullable: true }) role: GlRole | null;
  @ApiProperty({ enum: STATUSES }) status: AccountStatus;
  @ApiProperty({ example: '150000.00', description: 'Σ debit of the entries' }) debit: string;
  @ApiProperty({ example: '0.00' }) credit: string;
  @ApiProperty({ example: '150000.00', description: 'debit − credit; negative = credit' })
  balance: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'GlAccountRequest' })
export class GlAccountRequestDto {
  @ApiProperty({ example: '120102' }) @Transform(trimmed) @IsString() @Matches(CODE) code: string;
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxName)
  name: string;
  @ApiProperty({ enum: GL_ACCOUNT_KINDS }) @IsIn(GL_ACCOUNT_KINDS) kind: GlAccountKind;
}

@ApiSchema({ name: 'GlAccountPatch' })
export class GlAccountPatchDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @Matches(CODE) code?: string;
  @ApiPropertyOptional({ maxLength: FINANCE_LIMITS.maxName })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxName)
  name?: string;
  @ApiPropertyOptional({ enum: GL_ACCOUNT_KINDS })
  @IsOptional()
  @IsIn(GL_ACCOUNT_KINDS)
  kind?: GlAccountKind;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: AccountStatus;
}

@ApiSchema({ name: 'GlAccountRoleRequest' })
export class GlAccountRoleRequestDto {
  @ApiProperty({ enum: GL_ROLES, nullable: true, description: 'null takes the role away' })
  @IsOptional()
  @IsIn(GL_ROLES)
  role: GlRole | null;
}

@ApiSchema({ name: 'AccountLedgerLine' })
export class AccountLedgerLineDto {
  @ApiProperty() id: number;
  @ApiProperty() entryId: number;
  @ApiProperty({ example: 'Ж-20261016-0003' }) entryNumber: string;
  @ApiProperty({ example: '2026-10-16' }) entryDate: string;
  @ApiProperty() entryDescription: string;
  @ApiProperty({ enum: JOURNAL_SOURCES }) source: JournalSource;
  @ApiProperty() lineNo: number;
  @ApiProperty({ example: '150000.00' }) debit: string;
  @ApiProperty({ example: '0.00' }) credit: string;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ example: '150000.00', description: 'debit − credit after this line' })
  balanceAfter: string;
}

@ApiSchema({ name: 'AccountLedgerPage' })
export class AccountLedgerPageDto {
  @ApiProperty({ type: [AccountLedgerLineDto] }) data: AccountLedgerLineDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ example: '0.00', description: 'The balance before `from`' }) opening: string;
}

// ---------------------------------------------------------------- money accounts

@ApiSchema({ name: 'MoneyAccount' })
export class MoneyAccountDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'CASH-1' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: MONEY_ACCOUNT_KINDS }) kind: MoneyAccountKind;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty({ type: String, nullable: true }) branchName: string | null;
  @ApiProperty({ type: String, nullable: true }) bankName: string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccountNo: string | null;
  @ApiProperty() glAccountId: number;
  @ApiProperty({ example: '100101' }) glAccountCode: string;
  @ApiProperty() glAccountName: string;
  @ApiProperty({ enum: STATUSES }) status: AccountStatus;
  @ApiProperty({ example: '250000.00', description: 'Σ in − Σ out of the posted vouchers' })
  balance: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'MoneyAccountRequest' })
export class MoneyAccountRequestDto {
  @ApiProperty({ example: 'KHAN-1' }) @Transform(trimmed) @IsString() @Matches(CODE) code: string;
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxName)
  name: string;
  @ApiProperty({ enum: MONEY_ACCOUNT_KINDS }) @IsIn(MONEY_ACCOUNT_KINDS) kind: MoneyAccountKind;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  bankName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  bankAccountNo?: string | null;
  @ApiProperty({ description: 'The asset account the vouchers hit' })
  @IsInt()
  @Min(1)
  glAccountId: number;
}

@ApiSchema({ name: 'MoneyAccountPatch' })
export class MoneyAccountPatchDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @Matches(CODE) code?: string;
  @ApiPropertyOptional({ maxLength: FINANCE_LIMITS.maxName })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxName)
  name?: string;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  bankName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  bankAccountNo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) glAccountId?: number;
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES) status?: AccountStatus;
}

// ---------------------------------------------------------------- journal

@ApiSchema({ name: 'JournalLineRequest' })
export class JournalLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) accountId: number;
  @ApiPropertyOptional({ example: '150000', description: 'Default 0' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  debit?: string;
  @ApiPropertyOptional({ example: '0', description: 'Default 0' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  credit?: string;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  moneyAccountId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: FINANCE_LIMITS.maxDescription })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxDescription)
  description?: string | null;
}

@ApiSchema({ name: 'JournalEntryRequest' })
export class JournalEntryRequestDto {
  @ApiProperty({ example: '2026-10-16' }) @Matches(DATE) entryDate: string;
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxDescription })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxDescription)
  description: string;
  @ApiProperty({ type: [JournalLineRequestDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(FINANCE_LIMITS.maxJournalLines)
  @ValidateNested({ each: true })
  @Type(() => JournalLineRequestDto)
  lines: JournalLineRequestDto[];
}

@ApiSchema({ name: 'JournalReverseRequest' })
export class JournalReverseRequestDto {
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxDescription })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxDescription)
  description: string;
}

@ApiSchema({ name: 'JournalEntry' })
export class JournalEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Ж-20261016-0003' }) number: string;
  @ApiProperty({ example: '2026-10-16' }) entryDate: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: JOURNAL_SOURCES }) source: JournalSource;
  @ApiProperty({ enum: FINANCE_DOC_KINDS, nullable: true }) sourceType: FinanceDocKind | null;
  @ApiProperty({ type: Number, nullable: true }) sourceId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'The document behind it' })
  sourceNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) reversesId: number | null;
  @ApiProperty({ type: String, nullable: true }) reversesNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) reversedById: number | null;
  @ApiProperty({ type: String, nullable: true }) reversedByNumber: string | null;
  @ApiProperty({ example: '150000.00', description: 'Σ debit' }) amount: string;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, nullable: true }) postedByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'JournalLine' })
export class JournalLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() accountId: number;
  @ApiProperty({ example: '120101' }) accountCode: string;
  @ApiProperty() accountName: string;
  @ApiProperty({ example: '150000.00' }) debit: string;
  @ApiProperty({ example: '0.00' }) credit: string;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: Number, nullable: true }) moneyAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) moneyAccountName: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
}

@ApiSchema({ name: 'JournalEntryDetail' })
export class JournalEntryDetailDto extends JournalEntryDto {
  @ApiProperty({ type: [JournalLineDto] }) lines: JournalLineDto[];
}

@ApiSchema({ name: 'JournalListQuery' })
export class JournalListQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: JOURNAL_SOURCES })
  @IsOptional()
  @IsIn(JOURNAL_SOURCES)
  source?: JournalSource;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) accountId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
}

@ApiSchema({ name: 'JournalPage' })
export class JournalPageDto {
  @ApiProperty({ type: [JournalEntryDto] }) data: JournalEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

// ---------------------------------------------------------------- invoices

@ApiSchema({ name: 'Invoice' })
export class InvoiceDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Н-20261016-0001' }) number: string;
  @ApiProperty({ enum: INVOICE_STATUSES }) status: InvoiceStatus;
  @ApiProperty({ enum: SETTLEMENTS }) settlement: Settlement;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty({ type: String, nullable: true }) branchName: string | null;
  @ApiProperty({ example: '2026-10-16' }) invoiceDate: string;
  @ApiProperty({ example: '2026-11-15' }) dueDate: string;
  @ApiProperty({ description: 'Issued, not settled and past due today' }) overdue: boolean;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ example: '150000.00' }) subtotal: string;
  @ApiProperty({ example: '0.00' }) discountTotal: string;
  @ApiProperty({ example: '150000.00' }) total: string;
  @ApiProperty({ example: '13636.36' }) vatTotal: string;
  @ApiProperty({ example: '0.00' }) cityTaxTotal: string;
  @ApiProperty({ example: '150000.00' }) openAmount: string;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

@ApiSchema({ name: 'InvoiceLine' })
export class InvoiceLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty({ type: Number, nullable: true }) orderLineId: number | null;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) uomName: string;
  @ApiProperty({ enum: PRICE_BASES }) basis: PriceBasis;
  @ApiProperty({ example: '2' }) qty: string;
  @ApiProperty({ example: '20' }) factorSnapshot: string;
  @ApiProperty({ example: '40' }) qtyBase: string;
  @ApiProperty({ type: Number, nullable: true }) warehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty({ example: '20000.00' }) listPrice: string;
  @ApiProperty({ example: '20000.00' }) unitPrice: string;
  @ApiProperty({ example: '40000.00' }) subtotal: string;
  @ApiProperty({ example: '0.00' }) discountAmount: string;
  @ApiProperty({ example: '40000.00' }) total: string;
  @ApiProperty({ enum: VAT_TYPES }) vatType: VatType;
  @ApiProperty({ example: '10.00' }) vatRatePct: string;
  @ApiProperty({ example: '0.00' }) cityTaxRatePct: string;
  @ApiProperty({ example: '3636.36' }) vatAmount: string;
  @ApiProperty({ example: '0.00' }) cityTaxAmount: string;
  @ApiProperty({ example: '0', description: 'Base units credit notes took back' })
  returnedBase: string;
}

@ApiSchema({ name: 'InvoiceAllocation' })
export class InvoiceAllocationDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ALLOCATION_SOURCES }) sourceType: AllocationSource;
  @ApiProperty() sourceId: number;
  @ApiProperty({ example: 'Т-20261016-0002' }) sourceNumber: string;
  @ApiProperty({ example: '2026-10-16' }) sourceDate: string;
  @ApiProperty({ example: '50000.00' }) amount: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt: string | null;
}

@ApiSchema({ name: 'InvoiceCreditNoteRef' })
export class InvoiceCreditNoteRefDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'К-20261017-0001' }) number: string;
  @ApiProperty({ example: '2026-10-17' }) noteDate: string;
  @ApiProperty({ example: '20000.00' }) total: string;
}

@ApiSchema({ name: 'InvoiceDetail' })
export class InvoiceDetailDto extends InvoiceDto {
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: Number, nullable: true }) journalEntryId: number | null;
  @ApiProperty({ type: String, nullable: true }) journalNumber: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty({ type: Number, nullable: true }) voidJournalEntryId: number | null;
  @ApiProperty({ type: [InvoiceLineDto] }) lines: InvoiceLineDto[];
  @ApiProperty({ type: [InvoiceAllocationDto] }) allocations: InvoiceAllocationDto[];
  @ApiProperty({ type: [InvoiceCreditNoteRefDto] }) creditNotes: InvoiceCreditNoteRefDto[];
}

@ApiSchema({ name: 'InvoiceListQuery' })
export class InvoiceListQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Part of the number, the order number or the customer' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) orderId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchId?: number;
  @ApiPropertyOptional({ enum: SETTLEMENTS })
  @IsOptional()
  @IsIn(SETTLEMENTS)
  settlement?: Settlement;
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;
  @ApiPropertyOptional({ description: 'Only overdue invoices' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdue?: boolean;
}

@ApiSchema({ name: 'InvoicePage' })
export class InvoicePageDto {
  @ApiProperty({ type: [InvoiceDto] }) data: InvoiceDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Matches; first page only' })
  total: number | null;
}

// ---------------------------------------------------------------- credit notes

@ApiSchema({ name: 'CreditNoteLineRequest' })
export class CreditNoteLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) invoiceLineId: number;
  @ApiProperty({ example: '1', description: "In the invoice line's unit" })
  @IsString()
  @Matches(QTY)
  qty: string;
}

@ApiSchema({ name: 'CreditNoteRequest' })
export class CreditNoteRequestDto {
  @ApiProperty() @IsInt() @Min(1) invoiceId: number;
  @ApiProperty({ maxLength: FINANCE_LIMITS.maxReason })
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxReason)
  reason: string;
  @ApiPropertyOptional({ example: '2026-10-17', description: 'Default today' })
  @IsOptional()
  @Matches(DATE)
  noteDate?: string | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Where the goods go back; null = nothing comes back',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Default the RETURNS bin' })
  @IsOptional()
  @IsInt()
  @Min(1)
  binId?: number | null;
  @ApiProperty({ type: [CreditNoteLineRequestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FINANCE_LIMITS.maxCreditNoteLines)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineRequestDto)
  lines: CreditNoteLineRequestDto[];
}

@ApiSchema({ name: 'CreditNote' })
export class CreditNoteDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'К-20261017-0001' }) number: string;
  @ApiProperty() invoiceId: number;
  @ApiProperty({ example: 'Н-20261016-0001' }) invoiceNumber: string;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ example: '2026-10-17' }) noteDate: string;
  @ApiProperty() reason: string;
  @ApiProperty({ type: Number, nullable: true }) warehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty({ type: Number, nullable: true }) binId: number | null;
  @ApiProperty({ type: String, nullable: true }) binCode: string | null;
  @ApiProperty({ example: '20000.00' }) subtotal: string;
  @ApiProperty({ example: '0.00' }) discountTotal: string;
  @ApiProperty({ example: '20000.00' }) total: string;
  @ApiProperty({ example: '1818.18' }) vatTotal: string;
  @ApiProperty({ example: '0.00' }) cityTaxTotal: string;
  @ApiProperty({ example: '20000.00', description: 'What it settled of the invoice' })
  allocatedAmount: string;
  @ApiProperty({ type: Number, nullable: true }) journalEntryId: number | null;
  @ApiProperty({ type: String, nullable: true }) journalNumber: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

@ApiSchema({ name: 'CreditNoteLine' })
export class CreditNoteLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() invoiceLineId: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) uomName: string;
  @ApiProperty({ example: '1' }) qty: string;
  @ApiProperty({ example: '20' }) factorSnapshot: string;
  @ApiProperty({ example: '20' }) qtyBase: string;
  @ApiProperty({ example: '20000.00' }) unitPrice: string;
  @ApiProperty({ example: '20000.00' }) subtotal: string;
  @ApiProperty({ example: '0.00' }) discountAmount: string;
  @ApiProperty({ example: '20000.00' }) total: string;
  @ApiProperty({ example: '1818.18' }) vatAmount: string;
  @ApiProperty({ example: '0.00' }) cityTaxAmount: string;
}

@ApiSchema({ name: 'CreditNoteDetail' })
export class CreditNoteDetailDto extends CreditNoteDto {
  @ApiProperty({ type: [CreditNoteLineDto] }) lines: CreditNoteLineDto[];
}

@ApiSchema({ name: 'CreditNoteListQuery' })
export class CreditNoteListQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) invoiceId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
}

@ApiSchema({ name: 'CreditNotePage' })
export class CreditNotePageDto {
  @ApiProperty({ type: [CreditNoteDto] }) data: CreditNoteDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

// ---------------------------------------------------------------- payments

@ApiSchema({ name: 'PaymentAllocationRequest' })
export class PaymentAllocationRequestDto {
  @ApiProperty() @IsInt() @Min(1) invoiceId: number;
  @ApiProperty({ example: '50000' }) @IsString() @Matches(MONEY) amount: string;
}

@ApiSchema({ name: 'PaymentRequest' })
export class PaymentRequestDto {
  @ApiProperty({ enum: PAYMENT_KINDS }) @IsIn(PAYMENT_KINDS) kind: PaymentKind;
  @ApiProperty() @IsInt() @Min(1) moneyAccountId: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Customer kinds' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Other income or expense' })
  @IsOptional()
  @IsInt()
  @Min(1)
  glAccountId?: number | null;
  @ApiProperty({ example: '150000' }) @IsString() @Matches(MONEY) amount: string;
  @ApiProperty({ example: '2026-10-16' }) @Matches(DATE) paidOn: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: FINANCE_LIMITS.maxDescription })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxDescription)
  description?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: FINANCE_LIMITS.maxReference,
    description: 'A bank reference or a receipt number',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FINANCE_LIMITS.maxReference)
  reference?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  counterpartyName?: string | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'The driver or staff member who handed the money in',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  collectedBy?: number | null;
  @ApiPropertyOptional({
    type: [PaymentAllocationRequestDto],
    nullable: true,
    description: 'What a customer payment settles; omitted = oldest due first',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FINANCE_LIMITS.maxAllocations)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationRequestDto)
  allocations?: PaymentAllocationRequestDto[] | null;
}

@ApiSchema({ name: 'Payment' })
export class PaymentDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Т-20261016-0002' }) number: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status: PaymentStatus;
  @ApiProperty({ enum: PAYMENT_KINDS }) kind: PaymentKind;
  @ApiProperty({ enum: PAYMENT_DIRECTIONS }) direction: PaymentDirection;
  @ApiProperty() moneyAccountId: number;
  @ApiProperty({ example: 'CASH-1' }) moneyAccountCode: string;
  @ApiProperty() moneyAccountName: string;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerCode: string | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: Number, nullable: true }) glAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) glAccountCode: string | null;
  @ApiProperty({ type: String, nullable: true }) glAccountName: string | null;
  @ApiProperty({ example: '150000.00' }) amount: string;
  @ApiProperty({ example: '150000.00', description: 'Settled by its live allocations' })
  allocatedAmount: string;
  @ApiProperty({ example: '2026-10-16' }) paidOn: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) reference: string | null;
  @ApiProperty({ type: String, nullable: true }) counterpartyName: string | null;
  @ApiProperty({ type: Number, nullable: true }) collectedBy: number | null;
  @ApiProperty({ type: String, nullable: true }) collectedByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

@ApiSchema({ name: 'PaymentAllocation' })
export class PaymentAllocationDto {
  @ApiProperty() id: number;
  @ApiProperty() invoiceId: number;
  @ApiProperty({ example: 'Н-20261016-0001' }) invoiceNumber: string;
  @ApiProperty({ example: '2026-11-15' }) invoiceDueDate: string;
  @ApiProperty({ example: '50000.00' }) amount: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt: string | null;
}

@ApiSchema({ name: 'PaymentDetail' })
export class PaymentDetailDto extends PaymentDto {
  @ApiProperty({ type: Number, nullable: true }) journalEntryId: number | null;
  @ApiProperty({ type: String, nullable: true }) journalNumber: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) voidedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty({ type: Number, nullable: true }) voidJournalEntryId: number | null;
  @ApiProperty({ type: [PaymentAllocationDto] }) allocations: PaymentAllocationDto[];
}

@ApiSchema({ name: 'PaymentListQuery' })
export class PaymentListQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Part of the number, reference, counterparty or customer' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) moneyAccountId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({ enum: PAYMENT_KINDS })
  @IsOptional()
  @IsIn(PAYMENT_KINDS)
  kind?: PaymentKind;
  @ApiPropertyOptional({ enum: PAYMENT_DIRECTIONS })
  @IsOptional()
  @IsIn(PAYMENT_DIRECTIONS)
  direction?: PaymentDirection;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;
}

@ApiSchema({ name: 'PaymentPage' })
export class PaymentPageDto {
  @ApiProperty({ type: [PaymentDto] }) data: PaymentDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Matches; first page only' })
  total: number | null;
}

@ApiSchema({ name: 'CashBookRow' })
export class CashBookRowDto extends PaymentDto {
  @ApiProperty({ example: '250000.00', description: "The account's balance after this voucher" })
  balanceAfter: string;
}

@ApiSchema({ name: 'CashBookPage' })
export class CashBookPageDto {
  @ApiProperty({ type: [CashBookRowDto] }) data: CashBookRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ example: '0.00', description: 'The balance before `from`' }) opening: string;
}

// ---------------------------------------------------------------- receivables

@ApiSchema({ name: 'Aging' })
export class AgingDto {
  @ApiProperty({ example: '150000.00' }) NOT_DUE: string;
  @ApiProperty({ example: '0.00' }) D1_30: string;
  @ApiProperty({ example: '0.00' }) D31_60: string;
  @ApiProperty({ example: '0.00' }) D61_90: string;
  @ApiProperty({ example: '0.00' }) D90_PLUS: string;
}

export const AGING_KEYS = AGING_BUCKETS;

@ApiSchema({ name: 'CustomerBalance' })
export class CustomerBalanceDto {
  @ApiProperty() customerId: number;
  @ApiProperty({ example: '0099' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: STATUSES }) status: string;
  @ApiProperty({ type: String, nullable: true, example: '5000000.00' }) creditLimit: string | null;
  @ApiProperty() creditHold: boolean;
  @ApiProperty({ example: '150000.00', description: 'Negative = in advance' }) balance: string;
  @ApiProperty() openInvoices: number;
  @ApiProperty({ example: '0.00' }) overdueAmount: string;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-15' }) oldestDueDate:
    string | null;
  @ApiProperty({ type: AgingDto }) aging: AgingDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'CustomerBalancesQuery' })
export class CustomerBalancesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: "Part of a customer's name or code" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ description: 'Only customers with an overdue amount' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdue?: boolean;
}

@ApiSchema({ name: 'CustomerBalancesPage' })
export class CustomerBalancesPageDto {
  @ApiProperty({ type: [CustomerBalanceDto] }) data: CustomerBalanceDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'LedgerEntry' })
export class LedgerEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '2026-10-16' }) entryDate: string;
  @ApiProperty({ enum: AR_ENTRY_KINDS }) kind: ArEntryKind;
  @ApiProperty({ enum: FINANCE_DOC_KINDS }) docType: FinanceDocKind;
  @ApiProperty() docId: number;
  @ApiProperty({ example: 'Н-20261016-0001' }) docNumber: string;
  @ApiProperty({ example: '150000.00' }) debit: string;
  @ApiProperty({ example: '0.00' }) credit: string;
  @ApiProperty({ example: '150000.00' }) balanceAfter: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'CustomerLedgerPage' })
export class CustomerLedgerPageDto {
  @ApiProperty({ type: [LedgerEntryDto] }) data: LedgerEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ example: '0.00', description: 'The balance before `from`' }) opening: string;
}

@ApiSchema({ name: 'FinanceAttention' })
export class FinanceAttentionDto {
  @ApiProperty({ example: '0.00' }) overdueAmount: string;
  @ApiProperty() overdueCustomers: number;
  @ApiProperty({ example: '150000.00' }) openAmount: string;
  @ApiProperty() openInvoices: number;
}
