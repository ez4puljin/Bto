import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  AGING_BUCKETS,
  type AgingBucket,
  SETTLEMENT_GROUPS,
  type SettlementGroup,
} from '@tugeel/shared/finance';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BOARD_PERIOD_KINDS, type BoardPeriodKind } from '@tugeel/shared/reports';
import {
  BOARD_EXPENSE_ENTRY_KINDS,
  BOARD_EXPENSE_ROW_KINDS,
  type BoardExpenseEntryKind,
  type BoardExpenseRowKind,
} from '../services/board-ledger.service';
import {
  BOARD_DIMENSIONS,
  BOARD_ROW_KINDS,
  type BoardDimension,
  type BoardRowKind,
} from '../services/profit-board.service';
import {
  PROFIT_GROUPINGS,
  PROFIT_ROW_KINDS,
  type ProfitGrouping,
  type ProfitRowKind,
  SALES_DOC_KINDS,
  SALES_SOURCES,
  type SalesDocKind,
  type SalesSource,
} from '../services/profit.service';
import {
  SLOW_DAY_OPTIONS,
  STOCK_FILTERS,
  type StockFilter,
} from '../services/stock-report.service';
import { AP_ENTRY_KINDS, type ApEntryKind } from '../services/supplier-report.service';
import { IsDateOnly } from '../../../common/validation/date-only';

const MONTH = /^\d{4}-\d{2}$/;

/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------- common

@ApiSchema({ name: 'ReportRange' })
export class ReportRangeDto {
  @ApiProperty({ example: '2026-10-01' }) from: string;
  @ApiProperty({ example: '2026-10-24' }) to: string;
}

@ApiSchema({ name: 'ReportRefreshState' })
export class RefreshStateDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'The daily totals are as of this time',
  })
  refreshedAt: string | null;
  @ApiProperty({ type: Number, nullable: true }) durationMs: number | null;
}

// ---------------------------------------------------------------- dashboard

@ApiSchema({ name: 'DashboardQuery' })
export class DashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Default: the current month' })
  @IsOptional()
  @Matches(MONTH)
  month?: string;
}

@ApiSchema({ name: 'ReportCompared' })
export class ComparedDto {
  @ApiProperty({ example: '1500000.00' }) current: string;
  @ApiProperty({ example: '1400000.00', description: 'The same days a month earlier' })
  previous: string;
  @ApiProperty({ example: '1200000.00', description: 'The same days a year earlier' })
  lastYear: string;
}

@ApiSchema({ name: 'ReportComparedOrNull' })
export class ComparedOrNullDto {
  @ApiProperty({ type: String, nullable: true }) current: string | null;
  @ApiProperty({ type: String, nullable: true }) previous: string | null;
  @ApiProperty({ type: String, nullable: true }) lastYear: string | null;
}

@ApiSchema({ name: 'DashboardTrendPoint' })
export class DashboardTrendPointDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty() sales: string;
  @ApiProperty() lastYearSales: string;
  @ApiProperty({ type: String, nullable: true }) grossProfit: string | null;
}

@ApiSchema({ name: 'DashboardCategory' })
export class DashboardCategoryDto {
  @ApiProperty({ type: Number, nullable: true }) categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty() sales: string;
  @ApiProperty({ type: String, nullable: true }) grossProfit: string | null;
  @ApiProperty({ type: String, nullable: true, example: '12.5' }) margin: string | null;
  @ApiProperty({ type: String, nullable: true }) previousMargin: string | null;
}

@ApiSchema({ name: 'DashboardOverdueCustomer' })
export class DashboardOverdueCustomerDto {
  @ApiProperty() partyId: number;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty() name: string;
  @ApiProperty() overdue: string;
  @ApiProperty({ type: String, nullable: true }) oldestDueDate: string | null;
}

@ApiSchema({ name: 'DashboardLowStock' })
export class DashboardLowStockDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() onHand: string;
  @ApiProperty() minQty: string;
}

@ApiSchema({ name: 'DashboardTopRep' })
export class DashboardTopRepDto {
  @ApiProperty() userId: number;
  @ApiProperty() name: string;
  @ApiProperty() sales: string;
  @ApiProperty({ type: String, nullable: true, description: 'Percent of wholesale sales' }) share:
    string | null;
}

@ApiSchema({ name: 'DashboardAlerts' })
export class DashboardAlertsDto {
  @ApiProperty({ type: [DashboardOverdueCustomerDto] }) overdue: DashboardOverdueCustomerDto[];
  @ApiProperty({ type: [DashboardLowStockDto] }) lowStock: DashboardLowStockDto[];
  @ApiProperty() lowStockCount: number;
  @ApiProperty({ type: [DashboardCategoryDto] }) fallingCategories: DashboardCategoryDto[];
  @ApiProperty({ type: DashboardTopRepDto, nullable: true }) topRep: DashboardTopRepDto | null;
}

@ApiSchema({ name: 'Dashboard' })
export class DashboardDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ description: 'The month runs: the comparisons take the same days' })
  running: boolean;
  @ApiProperty({ type: ReportRangeDto }) current: ReportRangeDto;
  @ApiProperty({ type: ReportRangeDto }) previous: ReportRangeDto;
  @ApiProperty({ type: ReportRangeDto }) lastYear: ReportRangeDto;
  @ApiProperty() today: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) refreshedAt: string | null;
  @ApiProperty({ description: 'The caller sees costs, profit and margins' }) margins: boolean;
  @ApiProperty({ example: '8.0' }) threshold: string;
  @ApiProperty({ type: ComparedDto, description: 'Ex-VAT, net of returns' }) sales: ComparedDto;
  @ApiProperty() wholesale: string;
  @ApiProperty() pos: string;
  @ApiProperty() returns: string;
  @ApiProperty({ type: ComparedOrNullDto, nullable: true }) grossProfit: ComparedOrNullDto | null;
  @ApiProperty({ type: ComparedOrNullDto, nullable: true }) margin: ComparedOrNullDto | null;
  @ApiProperty({ type: ComparedDto, description: 'Balance at each period end' })
  receivables: ComparedDto;
  @ApiProperty({ description: 'Overdue today' }) overdue: string;
  @ApiProperty() overdueCustomers: number;
  @ApiProperty({ type: ComparedOrNullDto, nullable: true }) stockValue: ComparedOrNullDto | null;
  @ApiProperty({ type: Number, nullable: true }) turnoverDays: number | null;
  @ApiProperty({ type: [DashboardTrendPointDto] }) trend: DashboardTrendPointDto[];
  @ApiProperty({ type: [DashboardCategoryDto] }) categories: DashboardCategoryDto[];
  @ApiProperty({ type: DashboardAlertsDto }) alerts: DashboardAlertsDto;
}

// ---------------------------------------------------------------- aging

@ApiSchema({ name: 'AgingQuery' })
export class AgingQueryDto {
  @ApiPropertyOptional({ enum: SETTLEMENT_GROUPS })
  @IsOptional()
  @IsIn(SETTLEMENT_GROUPS)
  settlementGroup?: SettlementGroup;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() overdueOnly?: boolean;
}

@ApiSchema({ name: 'AgingAmounts' })
export class AgingAmountsDto implements Record<AgingBucket, string> {
  @ApiProperty() NOT_DUE: string;
  @ApiProperty() D1_30: string;
  @ApiProperty() D31_60: string;
  @ApiProperty() D61_90: string;
  @ApiProperty() D90_PLUS: string;
}

@ApiSchema({ name: 'AgingRow' })
export class AgingRowDto {
  @ApiProperty() partyId: number;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ enum: SETTLEMENT_GROUPS, nullable: true }) settlementGroup: SettlementGroup | null;
  @ApiProperty({ type: AgingAmountsDto }) buckets: AgingAmountsDto;
  @ApiProperty({ description: 'Advances and unapplied payments' }) credit: string;
  @ApiProperty() total: string;
  @ApiProperty() overdue: string;
  @ApiProperty({ type: String, nullable: true }) oldestDueDate: string | null;
}

@ApiSchema({ name: 'AgingReport' })
export class AgingDto {
  @ApiProperty() date: string;
  @ApiProperty({ type: [AgingRowDto] }) rows: AgingRowDto[];
  @ApiProperty({ type: AgingAmountsDto }) totals: AgingAmountsDto;
  @ApiProperty() credit: string;
  @ApiProperty() total: string;
  @ApiProperty() overdue: string;
}

@ApiSchema({ name: 'AgingItem' })
export class AgingItemDto {
  @ApiProperty() itemId: number;
  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] }) side: 'DEBIT' | 'CREDIT';
  @ApiProperty() documentNumber: string;
  @ApiProperty() documentClass: string;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty() itemDate: string;
  @ApiProperty({ type: String, nullable: true }) dueDate: string | null;
  @ApiProperty({ type: Number, nullable: true }) daysOverdue: number | null;
  @ApiProperty({ enum: AGING_BUCKETS, nullable: true }) bucket: AgingBucket | null;
  @ApiProperty() amount: string;
  @ApiProperty() openAmount: string;
}

@ApiSchema({ name: 'AgingItems' })
export class AgingItemsDto {
  @ApiProperty({ type: [AgingItemDto] }) data: AgingItemDto[];
}

// ---------------------------------------------------------------- profit and documents

@ApiSchema({ name: 'SalesFilterQuery' })
export class SalesFilterQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @IsDateOnly() from: string;
  @ApiProperty({ example: '2026-10-31' }) @IsDateOnly() to: string;
  @ApiPropertyOptional({ enum: SALES_SOURCES })
  @IsOptional()
  @IsIn(SALES_SOURCES)
  source?: SalesSource;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) repUserId?: number;
  @ApiPropertyOptional({ description: '«Bto300» orders only' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  app?: boolean;
}

@ApiSchema({ name: 'ProfitQuery' })
export class ProfitQueryDto extends SalesFilterQueryDto {
  @ApiProperty({ enum: PROFIT_GROUPINGS }) @IsIn(PROFIT_GROUPINGS) by: ProfitGrouping;
}

@ApiSchema({ name: 'ProfitTotals' })
export class ProfitTotalsDto {
  @ApiProperty() sales: string;
  @ApiProperty() returns: string;
  @ApiProperty() cost: string;
  @ApiProperty() profit: string;
  @ApiProperty({ type: String, nullable: true }) margin: string | null;
}

@ApiSchema({ name: 'ProfitRow' })
export class ProfitRowDto extends ProfitTotalsDto {
  @ApiProperty({ enum: PROFIT_ROW_KINDS }) kind: ProfitRowKind;
  @ApiProperty({ type: Number, nullable: true }) id: number | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Base units (by product only)' }) qty:
    string | null;
  @ApiProperty({ description: 'Margin under the threshold, or a loss' }) flagged: boolean;
}

@ApiSchema({ name: 'ProfitReport' })
export class ProfitReportDto extends ReportRangeDto {
  @ApiProperty({ enum: PROFIT_GROUPINGS }) by: ProfitGrouping;
  @ApiProperty({ example: '8.0' }) threshold: string;
  @ApiProperty({ type: [ProfitRowDto] }) rows: ProfitRowDto[];
  @ApiProperty({ type: ProfitTotalsDto }) totals: ProfitTotalsDto;
  @ApiProperty({
    type: ProfitTotalsDto,
    nullable: true,
    description: 'Rows beyond the first 2,000, summed',
  })
  others: ProfitTotalsDto | null;
}

@ApiSchema({ name: 'SalesDocument' })
export class SalesDocumentDto {
  @ApiProperty({ enum: SALES_DOC_KINDS }) kind: SalesDocKind;
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() date: string;
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() sales: string;
  @ApiProperty({ type: String, nullable: true }) cost: string | null;
  @ApiProperty({ type: String, nullable: true }) profit: string | null;
  @ApiProperty({ type: String, nullable: true }) margin: string | null;
}

@ApiSchema({ name: 'SalesDocuments' })
export class SalesDocumentsDto extends ReportRangeDto {
  @ApiProperty({ type: [SalesDocumentDto] }) rows: SalesDocumentDto[];
  @ApiProperty({ description: 'More documents than shown (the newest 500 are)' }) more: boolean;
}

// ---------------------------------------------------------------- stock

@ApiSchema({ name: 'StockReportQuery' })
export class StockReportQueryDto {
  @ApiPropertyOptional({ enum: SLOW_DAY_OPTIONS, default: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(SLOW_DAY_OPTIONS)
  slowDays?: number;
  @ApiPropertyOptional({ enum: STOCK_FILTERS })
  @IsOptional()
  @IsIn(STOCK_FILTERS)
  filter?: StockFilter;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) categoryId?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'nextOffset of the previous page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

@ApiSchema({ name: 'StockReportRow' })
export class StockReportRowDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) categoryName: string | null;
  @ApiProperty() onHand: string;
  @ApiProperty({ type: String, nullable: true }) value: string | null;
  @ApiProperty({ description: 'Sold in the last slowDays days, net of returns' }) soldQty: string;
  @ApiProperty({ type: Number, nullable: true }) coverDays: number | null;
  @ApiProperty({ type: String, nullable: true }) lastSaleDate: string | null;
  @ApiProperty({ type: Number, nullable: true }) daysSinceSale: number | null;
  @ApiProperty() slow: boolean;
  @ApiProperty() low: boolean;
  @ApiProperty({ type: String, nullable: true }) minQty: string | null;
}

@ApiSchema({ name: 'StockReportTotals' })
export class StockReportTotalsDto {
  @ApiProperty() products: number;
  @ApiProperty({ type: String, nullable: true }) value: string | null;
  @ApiProperty() slowProducts: number;
  @ApiProperty({ type: String, nullable: true }) slowValue: string | null;
  @ApiProperty() lowProducts: number;
}

@ApiSchema({ name: 'StockReport' })
export class StockReportDto {
  @ApiProperty() date: string;
  @ApiProperty() slowDays: number;
  @ApiProperty({ type: [StockReportRowDto] }) rows: StockReportRowDto[];
  @ApiProperty({ type: Number, nullable: true }) nextOffset: number | null;
  @ApiProperty({ type: StockReportTotalsDto }) totals: StockReportTotalsDto;
}

// ---------------------------------------------------------------- suppliers

@ApiSchema({ name: 'SupplierReportQuery' })
export class SupplierReportQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @IsDateOnly() from: string;
  @ApiProperty({ example: '2026-10-31' }) @IsDateOnly() to: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({
    description:
      'ADR-0234: receipts before their discounts, the discounts apart (default false: after them)',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  splitDiscounts?: boolean;
}

@ApiSchema({ name: 'SupplierReportTotals' })
export class SupplierReportTotalsDto {
  @ApiProperty({
    description:
      'With VAT, at the delivery notes, net of returns; after the receipts’ discounts, or before them with `splitDiscounts`',
  })
  purchases: string;
  @ApiProperty({ description: 'Without VAT, after the receipts’ discounts (the books’ cost)' })
  purchasesExVat: string;
  @ApiProperty() otherBills: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The receipts’ discounts of the period (ADR-0234), with `splitDiscounts` only',
  })
  discounts: string | null;
  @ApiProperty() payments: string;
  @ApiProperty({ description: 'Owed at `to` (+ we owe)' }) balance: string;
}

@ApiSchema({ name: 'SupplierReportRow' })
export class SupplierReportRowDto extends SupplierReportTotalsDto {
  @ApiProperty() partyId: number;
  @ApiProperty({ type: Number, nullable: true }) supplierId: number | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'SupplierReport' })
export class SupplierReportDto extends ReportRangeDto {
  @ApiProperty({ type: [SupplierReportRowDto], description: 'Largest purchases first' })
  rows: SupplierReportRowDto[];
  @ApiProperty({ type: SupplierReportTotalsDto }) totals: SupplierReportTotalsDto;
}

@ApiSchema({ name: 'SupplierEntriesQuery' })
export class SupplierEntriesQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @IsDateOnly() from: string;
  @ApiProperty({ example: '2026-10-31' }) @IsDateOnly() to: string;
  @ApiPropertyOptional({
    description:
      'ADR-0234: receipts before their discounts, the discounts apart (default false: after them)',
  })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  splitDiscounts?: boolean;
}

@ApiSchema({ name: 'SupplierEntry' })
export class SupplierEntryDto {
  @ApiProperty() entryId: number;
  @ApiProperty() date: string;
  @ApiProperty({ enum: AP_ENTRY_KINDS }) kind: ApEntryKind;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ type: Number, nullable: true }) receiptId: number | null;
  @ApiProperty({
    description:
      '+ raised the payable, − lowered it; with `splitDiscounts` a receipt’s before its discount',
  })
  amount: string;
  @ApiProperty() vatAmount: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The receipt’s discount the entry carries (ADR-0234), with `splitDiscounts` only; amount − discount is the payable’s movement',
  })
  discount: string | null;
  @ApiProperty() reversal: boolean;
}

@ApiSchema({ name: 'SupplierEntries' })
export class SupplierEntriesDto {
  @ApiProperty({ type: [SupplierEntryDto] }) data: SupplierEntryDto[];
}

// ---------------------------------------------------------------- profit board (ADR-0237)

@ApiSchema({ name: 'ProfitBoardQuery' })
export class ProfitBoardQueryDto {
  @ApiProperty({ enum: BOARD_PERIOD_KINDS }) @IsIn(BOARD_PERIOD_KINDS) kind: BoardPeriodKind;
  @ApiPropertyOptional({
    example: '2026-Q4',
    description: '`YYYY-MM`, `YYYY-Qn` or `YYYY` by the kind; default: the current period',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  period?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchId?: number;
  @ApiPropertyOptional({ enum: SALES_SOURCES })
  @IsOptional()
  @IsIn(SALES_SOURCES)
  source?: SalesSource;
}

@ApiSchema({ name: 'ProfitBoardProductsQuery' })
export class ProfitBoardProductsQueryDto extends ProfitBoardQueryDto {
  @ApiProperty({ enum: BOARD_DIMENSIONS }) @IsIn(BOARD_DIMENSIONS) dimension: BoardDimension;
  @ApiProperty({ enum: BOARD_ROW_KINDS }) @IsIn(BOARD_ROW_KINDS) rowKind: BoardRowKind;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
  @ApiPropertyOptional({ description: 'A category row: only the products right on it' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  own?: boolean;
}

@ApiSchema({ name: 'ProfitBoardFigures' })
export class BoardFiguresDto {
  @ApiProperty({ description: 'Net sales without VAT and city tax, net of returns' }) sales: string;
  @ApiProperty({ description: 'Cost of goods sold from the stock ledger' }) cost: string;
  @ApiProperty({ description: 'Gross profit' }) profit: string;
  @ApiProperty({ type: String, nullable: true, example: '12.5' }) margin: string | null;
}

@ApiSchema({ name: 'ProfitBoardRow' })
export class BoardRowDto extends BoardFiguresDto {
  @ApiProperty({ enum: BOARD_ROW_KINDS }) kind: BoardRowKind;
  @ApiProperty({ type: Number, nullable: true }) id: number | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Percent of the whole gross profit' })
  share: string | null;
  @ApiProperty({ description: 'Margin under the threshold, or a loss' }) flagged: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Supplier rows: receipt discounts' })
  discount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Supplier rows: profit + discounts' })
  profitWithDiscount: string | null;
  @ApiProperty({ type: () => [BoardRowDto], description: 'Category rows: the children' })
  children: BoardRowDto[];
  @ApiProperty({ description: 'A category row of the products right on the category' })
  own: boolean;
}

@ApiSchema({ name: 'ProfitBoardOthers' })
export class BoardOthersDto extends BoardFiguresDto {
  @ApiProperty() count: number;
  @ApiProperty({ type: String, nullable: true }) share: string | null;
  @ApiProperty({ type: String, nullable: true }) discount: string | null;
  @ApiProperty({ type: String, nullable: true }) profitWithDiscount: string | null;
}

@ApiSchema({ name: 'ProfitBoardBreakdown' })
export class BoardBreakdownDto {
  @ApiProperty({ type: [BoardRowDto] }) rows: BoardRowDto[];
  @ApiProperty({ type: BoardOthersDto, nullable: true }) others: BoardOthersDto | null;
}

@ApiSchema({ name: 'ProfitBoardBreakdowns' })
export class BoardBreakdownsDto {
  @ApiProperty({ type: BoardBreakdownDto }) supplier: BoardBreakdownDto;
  @ApiProperty({ type: BoardBreakdownDto }) category: BoardBreakdownDto;
  @ApiProperty({ type: BoardBreakdownDto }) location: BoardBreakdownDto;
  @ApiProperty({ type: BoardBreakdownDto }) rep: BoardBreakdownDto;
  @ApiProperty({ type: BoardBreakdownDto }) branch: BoardBreakdownDto;
}

@ApiSchema({ name: 'ProfitBoardTotals' })
export class BoardTotalsDto {
  @ApiProperty({ type: BoardFiguresDto }) current: BoardFiguresDto;
  @ApiProperty({ type: BoardFiguresDto }) previous: BoardFiguresDto;
  @ApiProperty({ type: BoardFiguresDto }) lastYear: BoardFiguresDto;
}

@ApiSchema({ name: 'ProfitBoardDiscounts' })
export class BoardDiscountsDto {
  @ApiProperty() current: string;
  @ApiProperty() previous: string;
  @ApiProperty() lastYear: string;
}

@ApiSchema({ name: 'ProfitBoardBonus' })
export class BoardBonusDto {
  @ApiProperty() lines: number;
  @ApiProperty({ description: 'Base units' }) qty: string;
  @ApiProperty({ description: 'Information only: never added to profit' }) value: string;
  @ApiProperty() unvalued: number;
}

@ApiSchema({ name: 'ProfitBoardTrendPoint' })
export class BoardTrendPointDto extends BoardFiguresDto {
  @ApiProperty({ example: '2026-Q4' }) period: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Net profit (ADR-0238); null under a source filter',
  })
  netProfit: string | null;
}

@ApiSchema({ name: 'ProfitBoardResult' })
export class BoardResultDto {
  @ApiProperty({ description: '«Бусад орлого»: INCOME accounts off the sales row' })
  otherIncome: string;
  @ApiProperty({
    description:
      '«НӨАТ хасуулах» discounts by their documents, reversals netted (ADR-0241); never in expenses',
  })
  vatWaiverDiscounts: string;
  @ApiProperty({ description: '«Урсгал зардал»: the operating expense accounts' }) expenses: string;
  @ApiProperty({
    description: 'Gross profit + supplier discounts + other income − waiver discounts − expenses',
  })
  operatingProfit: string;
  @ApiProperty({ description: '«Татвар»: the income tax expense' }) tax: string;
  @ApiProperty({ description: 'Operating profit − tax' }) netProfit: string;
}

@ApiSchema({ name: 'ProfitBoardResults' })
export class BoardResultsDto {
  @ApiProperty({ type: BoardResultDto }) current: BoardResultDto;
  @ApiProperty({ type: BoardResultDto }) previous: BoardResultDto;
  @ApiProperty({ type: BoardResultDto }) lastYear: BoardResultDto;
}

@ApiSchema({ name: 'ProfitBoardAmounts' })
export class BoardAmountsDto {
  @ApiProperty() current: string;
  @ApiProperty() previous: string;
  @ApiProperty() lastYear: string;
}

@ApiSchema({ name: 'ProfitBoardExpenseRow' })
export class BoardExpenseRowDto {
  @ApiProperty({ enum: BOARD_EXPENSE_ROW_KINDS, enumName: 'ProfitBoardExpenseRowKind' })
  kind: BoardExpenseRowKind;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The group or account; null: no group',
  })
  id: number | null;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty() amount: string;
  @ApiProperty({ description: 'The period before' }) previous: string;
  @ApiProperty({ description: 'The same period a year earlier' }) lastYear: string;
  @ApiProperty({ type: String, nullable: true, description: 'Percent of the operating expenses' })
  share: string | null;
  @ApiProperty({ type: () => [BoardExpenseRowDto] }) children: BoardExpenseRowDto[];
}

@ApiSchema({ name: 'ProfitBoardExpenses' })
export class BoardExpensesDto {
  @ApiProperty({ type: [BoardExpenseRowDto] }) rows: BoardExpenseRowDto[];
  @ApiProperty({ type: BoardAmountsDto }) total: BoardAmountsDto;
  @ApiProperty({
    type: BoardAmountsDto,
    nullable: true,
    description: 'With a branch: the operating expenses without a branch («Нийтлэг»)',
  })
  common: BoardAmountsDto | null;
  @ApiProperty({ description: 'Expense lines in the current period' }) lines: number;
}

@ApiSchema({ name: 'ProfitBoardVatWaived' })
export class BoardVatWaivedDto {
  @ApiProperty({ description: 'Sales whose live VAT waiver is dated in the period' }) count: number;
  @ApiProperty({ description: 'Their invoices’ total, VAT included' }) total: string;
  @ApiProperty({ description: 'The VAT inside them' }) vat: string;
  @ApiProperty({ description: 'The discount their waivers gave' }) discount: string;
  @ApiProperty({
    description: 'The period’s wholesale invoices’ total (by invoice date, not VOID)',
  })
  wholesaleTotal: string;
  @ApiProperty({ description: 'Of those invoices, the total of the ones with a POSTED waiver now' })
  wholesaleWaived: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'wholesaleWaived in percent of wholesaleTotal (never above 100)',
  })
  share: string | null;
}

@ApiSchema({ name: 'ProfitBoardBranch' })
export class BoardBranchDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ProfitBoard' })
export class ProfitBoardDto {
  @ApiProperty({ enum: BOARD_PERIOD_KINDS }) kind: BoardPeriodKind;
  @ApiProperty({ example: '2026-Q4' }) period: string;
  @ApiProperty() running: boolean;
  @ApiProperty({ type: ReportRangeDto }) current: ReportRangeDto;
  @ApiProperty({ type: ReportRangeDto }) previous: ReportRangeDto;
  @ApiProperty({ type: ReportRangeDto }) lastYear: ReportRangeDto;
  @ApiProperty() today: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) refreshedAt: string | null;
  @ApiProperty({ example: '8.0' }) threshold: string;
  @ApiProperty({ enum: SALES_SOURCES }) source: SalesSource;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty({ type: BoardTotalsDto }) totals: BoardTotalsDto;
  @ApiProperty({
    type: BoardDiscountsDto,
    nullable: true,
    description: 'Receipt discounts booked as income (ADR-0236); null under a source filter',
  })
  discounts: BoardDiscountsDto | null;
  @ApiProperty({ type: BoardBonusDto, nullable: true }) bonus: BoardBonusDto | null;
  @ApiProperty({
    type: BoardResultsDto,
    nullable: true,
    description: 'From the books (ADR-0238); null under a source filter',
  })
  results: BoardResultsDto | null;
  @ApiProperty({ type: BoardExpensesDto, nullable: true }) expenses: BoardExpensesDto | null;
  @ApiProperty({
    type: BoardVatWaivedDto,
    nullable: true,
    description:
      '«НӨАТ аваагүй борлуулалт» (ADR-0241), information only; null under the POS source filter',
  })
  vatWaived: BoardVatWaivedDto | null;
  @ApiProperty({ type: [BoardTrendPointDto] }) trend: BoardTrendPointDto[];
  @ApiProperty({ type: BoardBreakdownsDto }) breakdowns: BoardBreakdownsDto;
  @ApiProperty({ type: [BoardBranchDto] }) branches: BoardBranchDto[];
}

@ApiSchema({ name: 'ProfitBoardProduct' })
export class BoardProductRowDto extends BoardFiguresDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'The base unit' }) unit: string | null;
  @ApiProperty({ description: 'Base units' }) qty: string;
  @ApiProperty() flagged: boolean;
}

@ApiSchema({ name: 'ProfitBoardProductsOthers' })
export class BoardProductsOthersDto extends BoardFiguresDto {
  @ApiProperty() count: number;
}

@ApiSchema({ name: 'ProfitBoardProducts' })
export class BoardProductsDto extends ReportRangeDto {
  @ApiProperty({ type: [BoardProductRowDto] }) rows: BoardProductRowDto[];
  @ApiProperty({ type: BoardProductsOthersDto, nullable: true })
  others: BoardProductsOthersDto | null;
}

@ApiSchema({ name: 'ProfitBoardExpenseEntriesQuery' })
export class ProfitBoardExpenseEntriesQueryDto extends ProfitBoardQueryDto {
  @ApiProperty({
    enum: BOARD_EXPENSE_ENTRY_KINDS,
    enumName: 'ProfitBoardExpenseEntryKind',
    description: 'A group, an account, the accounts without a group, or the branch-less lines',
  })
  @IsIn(BOARD_EXPENSE_ENTRY_KINDS)
  rowKind: BoardExpenseEntryKind;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
}

@ApiSchema({ name: 'ProfitBoardExpenseEntry' })
export class BoardExpenseEntryDto {
  @ApiProperty() lineId: number;
  @ApiProperty() entryId: number;
  @ApiProperty() date: string;
  @ApiProperty({ description: 'The document number, else the journal entry number' })
  number: string;
  @ApiProperty({ type: String, nullable: true, description: 'The source document type' })
  source: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty() accountId: number;
  @ApiProperty() accountCode: string;
  @ApiProperty() accountName: string;
  @ApiProperty({ type: String, nullable: true }) partyName: string | null;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty({ type: String, nullable: true }) branchName: string | null;
  @ApiProperty() amount: string;
}

@ApiSchema({ name: 'ProfitBoardExpenseEntries' })
export class BoardExpenseEntriesDto extends ReportRangeDto {
  @ApiProperty({ type: [BoardExpenseEntryDto] }) rows: BoardExpenseEntryDto[];
  @ApiProperty({ description: 'More lines stand behind the row than are listed (500)' })
  more: boolean;
  @ApiProperty() total: string;
}
