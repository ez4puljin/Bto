import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { queryIds } from '../../../common/pagination/page';
import { BOOK_DOC_TYPES, type BookDocType } from '../services/book-sql';
import {
  PRODUCT_SALES_GROUPINGS,
  PRODUCT_SALES_KINDS,
  type ProductSalesGrouping,
  type ProductSalesKind,
} from '../services/product-sales.service';
import {
  SALES_DOC_KINDS,
  SALES_SOURCES,
  type SalesDocKind,
  type SalesSource,
} from '../services/profit.service';
import {
  STOCK_BALANCE_GROUPINGS,
  type StockBalanceGrouping,
} from '../services/stock-balance.service';
import { STOCK_PARTY_KINDS, type StockPartyKind } from '../services/stock-documents.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const queryList = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

class RangeQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) from: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE) to: string;
}

function optionalId() {
  return (target: object, key: string) => {
    ApiPropertyOptional()(target, key);
    IsOptional()(target, key);
    Type(() => Number)(target, key);
    IsInt()(target, key);
    Min(1)(target, key);
  };
}

function optionalIds() {
  return (target: object, key: string) => {
    ApiPropertyOptional({ type: [Number] })(target, key);
    IsOptional()(target, key);
    Transform(queryIds)(target, key);
    ArrayMaxSize(100)(target, key);
    IsInt({ each: true })(target, key);
  };
}

// ------------------------------------------------------------- the options of the prompts

@ApiSchema({ name: 'BookReportOption' })
export class BookReportOptionDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ type: Number, nullable: true, description: 'The parent category' })
  parentId: number | null;
}

/** What the prompts of the stock and sales reports offer (ADR-0133). */
@ApiSchema({ name: 'BookReportOptions' })
export class BookReportOptionsDto {
  @ApiProperty({ type: [BookReportOptionDto] }) warehouses: BookReportOptionDto[];
  @ApiProperty({ type: [BookReportOptionDto] }) categories: BookReportOptionDto[];
  @ApiProperty({ type: [BookReportOptionDto] }) customerCategories: BookReportOptionDto[];
  @ApiProperty({ type: [BookReportOptionDto], description: 'Active staff members' })
  users: BookReportOptionDto[];
  @ApiProperty({ type: [BookReportOptionDto], description: 'The main suppliers of products' })
  brands: BookReportOptionDto[];
  @ApiProperty({ type: [BookReportOptionDto], description: 'Live hand-picked product segments' })
  segments: BookReportOptionDto[];
}

// ------------------------------------------------------------- stock balance

@ApiSchema({ name: 'StockBalanceQuery' })
export class StockBalanceQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: STOCK_BALANCE_GROUPINGS, default: 'product' })
  @IsOptional()
  @IsIn(STOCK_BALANCE_GROUPINGS)
  by?: StockBalanceGrouping;

  @optionalIds() warehouseIds?: number[];
  @optionalId() categoryId?: number;
  @optionalId() productId?: number;
}

@ApiSchema({ name: 'StockBalanceRow' })
export class StockBalanceRowDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) unit: string | null;
  @ApiProperty({ type: Number, nullable: true }) categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) categoryName: string | null;
  @ApiProperty({ type: Number, nullable: true }) warehouseId: number | null;
  @ApiProperty({ type: String, nullable: true }) warehouseName: string | null;
  @ApiProperty() openingQty: string;
  @ApiProperty({ type: String, nullable: true }) openingValue: string | null;
  @ApiProperty() inQty: string;
  @ApiProperty({ type: String, nullable: true }) inValue: string | null;
  @ApiProperty() outQty: string;
  @ApiProperty({ type: String, nullable: true }) outValue: string | null;
  @ApiProperty() closingQty: string;
  @ApiProperty({ type: String, nullable: true }) closingValue: string | null;
}

@ApiSchema({ name: 'StockBalanceTotals' })
export class StockBalanceTotalsDto {
  @ApiProperty({ type: String, nullable: true }) openingValue: string | null;
  @ApiProperty({ type: String, nullable: true }) inValue: string | null;
  @ApiProperty({ type: String, nullable: true }) outValue: string | null;
  @ApiProperty({ type: String, nullable: true }) closingValue: string | null;
}

@ApiSchema({ name: 'StockBalanceReport' })
export class StockBalanceReportDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ enum: STOCK_BALANCE_GROUPINGS }) by: StockBalanceGrouping;
  @ApiProperty({ type: [StockBalanceRowDto] }) rows: StockBalanceRowDto[];
  @ApiProperty({ type: StockBalanceTotalsDto }) totals: StockBalanceTotalsDto;
  @ApiProperty() truncated: boolean;
}

@ApiSchema({ name: 'StockBalanceLinesQuery' })
export class StockBalanceLinesQueryDto extends RangeQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) productId: number;
  @optionalIds() warehouseIds?: number[];
}

@ApiSchema({ name: 'StockBalanceLine' })
export class StockBalanceLineDto {
  @ApiProperty() date: string;
  @ApiProperty({ example: 'GR' }) docType: string;
  @ApiProperty() docId: number;
  @ApiProperty({ type: String, nullable: true }) docNumber: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() inQty: string;
  @ApiProperty() outQty: string;
  @ApiProperty({ type: String, nullable: true }) value: string | null;
  @ApiProperty() balanceQty: string;
}

@ApiSchema({ name: 'StockBalanceLines' })
export class StockBalanceLinesDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() openingQty: string;
  @ApiProperty({ type: [StockBalanceLineDto] }) rows: StockBalanceLineDto[];
  @ApiProperty() truncated: boolean;
}

// ------------------------------------------------------------- sales by product

@ApiSchema({ name: 'ProductSalesQuery' })
export class ProductSalesQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: SALES_SOURCES, default: 'ALL' })
  @IsOptional()
  @IsIn(SALES_SOURCES)
  source?: SalesSource;

  @ApiPropertyOptional({ enum: PRODUCT_SALES_KINDS, default: 'ALL' })
  @IsOptional()
  @IsIn(PRODUCT_SALES_KINDS)
  kind?: ProductSalesKind;

  @optionalId() repUserId?: number;
  @optionalId() customerCategoryId?: number;
  @optionalId() customerId?: number;
  @optionalId() productId?: number;
  @optionalId() categoryId?: number;
  @optionalId() warehouseId?: number;
  @optionalIds() brandIds?: number[];
  @optionalIds() segmentIds?: number[];

  @ApiPropertyOptional({ enum: PRODUCT_SALES_GROUPINGS, default: 'none' })
  @IsOptional()
  @IsIn(PRODUCT_SALES_GROUPINGS)
  by?: ProductSalesGrouping;

  @ApiPropertyOptional({ description: 'Split the sales by payment' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  payments?: boolean;

  @ApiPropertyOptional({ description: "The documents' group key under `by` (documents only)" })
  @IsOptional()
  @MaxLength(24)
  @Matches(/^(\d+|APP|NONE)$/)
  group?: string;
}

@ApiSchema({ name: 'PaidAmount' })
export class PaidAmountDto {
  @ApiProperty({ example: 'AR' }) key: string;
  @ApiProperty({ description: 'Net of VAT' }) amount: string;
}

@ApiSchema({ name: 'ProductSalesPayment' })
export class ProductSalesPaymentDto {
  @ApiProperty({ example: 'AR' }) key: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ProductSalesRow' })
export class ProductSalesRowDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) unit: string | null;
  @ApiProperty({ type: Number, nullable: true }) categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) categoryName: string | null;
  @ApiProperty({ type: String, nullable: true }) group: string | null;
  @ApiProperty({ type: String, nullable: true }) groupName: string | null;
  @ApiProperty() qty: string;
  @ApiProperty({ description: 'Net of VAT and city tax, returns subtracted' }) sales: string;
  @ApiProperty() returns: string;
  @ApiProperty({ type: String, nullable: true }) avgPrice: string | null;
  @ApiProperty({ type: String, nullable: true }) cost: string | null;
  @ApiProperty({ type: String, nullable: true }) profit: string | null;
  @ApiProperty({ type: String, nullable: true }) margin: string | null;
  @ApiProperty({ type: [PaidAmountDto] }) paid: PaidAmountDto[];
}

@ApiSchema({ name: 'ProductSalesTotals' })
export class ProductSalesTotalsDto {
  @ApiProperty() sales: string;
  @ApiProperty() returns: string;
  @ApiProperty({ type: String, nullable: true }) cost: string | null;
  @ApiProperty({ type: String, nullable: true }) profit: string | null;
  @ApiProperty({ type: [PaidAmountDto] }) paid: PaidAmountDto[];
}

@ApiSchema({ name: 'ProductSalesReport' })
export class ProductSalesReportDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ enum: PRODUCT_SALES_GROUPINGS }) by: ProductSalesGrouping;
  @ApiProperty({ type: [ProductSalesRowDto] }) rows: ProductSalesRowDto[];
  @ApiProperty({ type: [ProductSalesPaymentDto] }) payments: ProductSalesPaymentDto[];
  @ApiProperty({ type: ProductSalesTotalsDto }) totals: ProductSalesTotalsDto;
  @ApiProperty() truncated: boolean;
}

@ApiSchema({ name: 'ProductSalesDocument' })
export class ProductSalesDocumentDto {
  @ApiProperty({ enum: SALES_DOC_KINDS }) kind: SalesDocKind;
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() date: string;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() qty: string;
  @ApiProperty() sales: string;
  @ApiProperty({ type: String, nullable: true }) cost: string | null;
  @ApiProperty({ type: [PaidAmountDto] }) paid: PaidAmountDto[];
}

@ApiSchema({ name: 'ProductSalesDocuments' })
export class ProductSalesDocumentsDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [ProductSalesDocumentDto] }) rows: ProductSalesDocumentDto[];
  @ApiProperty() truncated: boolean;
}

// ------------------------------------------------------------- stock documents

@ApiSchema({ name: 'StockDocumentsQuery' })
export class StockDocumentsQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: BOOK_DOC_TYPES, isArray: true })
  @IsOptional()
  @Transform(queryList)
  @ArrayMaxSize(BOOK_DOC_TYPES.length)
  @IsIn(BOOK_DOC_TYPES, { each: true })
  docTypes?: BookDocType[];

  @optionalIds() warehouseIds?: number[];
  @optionalId() productId?: number;
  @optionalId() customerId?: number;
  @optionalId() supplierId?: number;
  @optionalId() userId?: number;
}

@ApiSchema({ name: 'StockDocumentRow' })
export class StockDocumentRowDto {
  @ApiProperty({ enum: BOOK_DOC_TYPES }) docType: BookDocType;
  @ApiProperty() docId: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() date: string;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true, description: "An adjustment's reason" })
  reason: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceWarehouse: string | null;
  @ApiProperty({ type: String, nullable: true }) destWarehouse: string | null;
  @ApiProperty({ type: String, nullable: true }) authorName: string | null;
  @ApiProperty({ enum: STOCK_PARTY_KINDS, nullable: true }) partyKind: StockPartyKind | null;
  @ApiProperty({ type: Number, nullable: true }) partyId: number | null;
  @ApiProperty({ type: String, nullable: true }) partyName: string | null;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty() inQty: string;
  @ApiProperty() outQty: string;
  @ApiProperty({ type: String, nullable: true }) inValue: string | null;
  @ApiProperty({ type: String, nullable: true }) outValue: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({ type: String, nullable: true }) net: string | null;
}

@ApiSchema({ name: 'StockDocumentsTotals' })
export class StockDocumentsTotalsDto {
  @ApiProperty({ type: String, nullable: true }) inValue: string | null;
  @ApiProperty({ type: String, nullable: true }) outValue: string | null;
  @ApiProperty() total: string;
  @ApiProperty() net: string;
}

@ApiSchema({ name: 'StockDocumentsReport' })
export class StockDocumentsReportDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [StockDocumentRowDto] }) rows: StockDocumentRowDto[];
  @ApiProperty({ type: StockDocumentsTotalsDto }) totals: StockDocumentsTotalsDto;
  @ApiProperty() truncated: boolean;
}

@ApiSchema({ name: 'StockDocumentLinesQuery' })
export class StockDocumentLinesQueryDto {
  @ApiProperty({ enum: BOOK_DOC_TYPES }) @IsIn(BOOK_DOC_TYPES) docType: BookDocType;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) docId: number;
  @optionalIds() warehouseIds?: number[];
}

@ApiSchema({ name: 'StockDocumentLine' })
export class StockDocumentLineDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) unit: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ description: 'Signed: in positive, out negative' }) qty: string;
  @ApiProperty({ type: String, nullable: true }) unitCost: string | null;
  @ApiProperty({ type: String, nullable: true }) value: string | null;
}

@ApiSchema({ name: 'StockDocumentLines' })
export class StockDocumentLinesDto {
  @ApiProperty({ type: [StockDocumentLineDto] }) data: StockDocumentLineDto[];
}
