import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
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
  ValidateNested,
} from 'class-validator';
import {
  RECEIPT_DISCOUNT_KINDS,
  RECEIPT_PAYMENT_METHODS,
  type ReceiptDiscountKind,
  type ReceiptPaymentMethod,
} from '@tugeel/shared/inventory';
import { PageQueryDto, queryIds } from '../../../common/pagination/page';
import { COSTING_STATUSES, RECEIPT_STATUSES } from '../schema';
import { QTY, queryBoolean, trimmed } from './bins.dto';

export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
/** A percentage with up to two decimals (the service keeps it in (0, 100]). */
export const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
/** A warehouse price: whole tugriks. */
export const WHOLE_MNT = /^\d{1,12}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
type CostingStatus = (typeof COSTING_STATUSES)[number];

@ApiSchema({ name: 'ReceiptLine' })
export class ReceiptLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ example: '2' }) enteredQty: string;
  @ApiProperty({ example: '24' }) factorSnapshot: string;
  @ApiProperty({ example: '48', description: 'Base units' }) qtyBase: string;
  @ApiProperty({ description: 'Its product’s home warehouse (ADR-0099)' }) warehouseId: number;
  @ApiProperty() warehouseName: string;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty({ type: Number, nullable: true }) lotId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'kg per base unit' })
  weightKg: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'New warehouse price per base unit, in force from the posting',
  })
  salePrice: string | null;
  // Cost data (ADR-0078): present only for holders of inventory.costs.manage.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Delivery-note price per unit',
  })
  docUnitPrice?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Delivery-note amount, VAT in',
  })
  docAmount?: string | null;
  @ApiPropertyOptional() freeGoods?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Share of the discount' })
  discountAmount?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Amount less the discount' })
  netAmount?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) vatAmount?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Net amount less VAT' })
  costAmount?: string | null;
}

@ApiSchema({ name: 'ReceiptTotals' })
export class ReceiptTotalsDto {
  @ApiProperty({ description: 'Σ delivery-note amounts, VAT in' }) docTotal: string;
  @ApiProperty({ description: 'The receipt’s discounts' }) discountTotal: string;
  @ApiProperty({ description: 'A discount exceeds its lines; the posting will refuse it' })
  discountTooLarge: boolean;
  @ApiProperty({ description: 'The payable: docTotal less the discount' }) netTotal: string;
  @ApiProperty() vatTotal: string;
  @ApiProperty() costTotal: string;
  @ApiProperty({ description: 'Lines priced or free' }) pricedLines: number;
}

/** A receipt's discount (ADR-0103): on chosen lines or on the whole note. Cost data. */
@ApiSchema({ name: 'ReceiptDiscount' })
export class ReceiptDiscountDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: RECEIPT_DISCOUNT_KINDS }) kind: ReceiptDiscountKind;
  @ApiProperty({ type: String, nullable: true, example: '5' }) pct: string | null;
  @ApiProperty({ type: String, nullable: true }) amount: string | null;
  @ApiProperty({ type: [Number], description: 'LINES: the lines it applies to' }) lineIds: number[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'In tugriks on the lines priced so far; null while it exceeds them',
  })
  total: string | null;
}

@ApiSchema({ name: 'ReceiptDiscountRequest' })
export class ReceiptDiscountRequestDto {
  @ApiProperty({ enum: RECEIPT_DISCOUNT_KINDS })
  @IsIn(RECEIPT_DISCOUNT_KINDS)
  kind: ReceiptDiscountKind;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'A percentage, or …' })
  @IsOptional()
  @Matches(PERCENT)
  pct?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: '… an amount' })
  @IsOptional()
  @Matches(MONEY)
  amount?: string | null;
  @ApiPropertyOptional({ type: [Number], description: 'LINES only' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  lineIds?: number[];
}

@ApiSchema({ name: 'ReceiptDiscountsRequest' })
export class ReceiptDiscountsDto {
  @ApiProperty({ type: [ReceiptDiscountRequestDto], description: 'Replaces the receipt’s list' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReceiptDiscountRequestDto)
  discounts: ReceiptDiscountRequestDto[];
}

@ApiSchema({ name: 'ReceiptWarehouse' })
export class ReceiptWarehouseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ReceiptPaymentAccount' })
export class ReceiptPaymentAccountDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['CASH', 'BANK'] }) kind: 'CASH' | 'BANK';
}

/** A receipt without any cost: what every user sees (ADR-0033 #8). */
@ApiSchema({ name: 'ReceiptDetail' })
export class ReceiptDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'GR-2026-000001' }) number: string | null;
  @ApiProperty({ type: [ReceiptWarehouseDto], description: 'The warehouses of its lines' })
  warehouses: ReceiptWarehouseDto[];
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierCode: string;
  @ApiProperty() supplierName: string;
  @ApiProperty({ type: String, nullable: true, description: 'The supplier’s delivery note number' })
  supplierDocNo: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) supplierDocDate: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty() costingVersion: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) recostUntil: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: RECEIPT_PAYMENT_METHODS }) paymentMethod: ReceiptPaymentMethod;
  @ApiProperty({ type: Number, nullable: true }) moneyAccountId: number | null;
  @ApiProperty({ type: String, nullable: true }) moneyAccountName: string | null;
  @ApiProperty() supplierVatPayer: boolean;
  @ApiProperty({ example: '10', description: 'VAT inside the delivery-note prices' })
  vatRatePct: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [ReceiptLineDto] }) lines: ReceiptLineDto[];
  @ApiProperty({ description: 'Σ base qty × weight, kg (lines with a weight)' }) weightKg: string;
  @ApiProperty({ description: 'Lines whose product has no weight' }) weightMissing: number;
  // Cost data: present only for holders of inventory.costs.manage.
  @ApiPropertyOptional({ type: [ReceiptDiscountDto], description: 'Cost holders only' })
  discounts?: ReceiptDiscountDto[];
  @ApiPropertyOptional({ type: ReceiptTotalsDto, description: 'Cost holders only' })
  totals?: ReceiptTotalsDto;
}

@ApiSchema({ name: 'ReceiptSummary' })
export class ReceiptSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() supplierId: number;
  @ApiProperty() supplierName: string;
  @ApiProperty({ type: String, nullable: true }) supplierDocNo: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) supplierDocDate: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty({ enum: RECEIPT_PAYMENT_METHODS }) paymentMethod: ReceiptPaymentMethod;
  @ApiProperty() lineCount: number;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The payable (cost holders only)',
  })
  netAmount?: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'ReceiptPage' })
export class ReceiptPageDto {
  @ApiProperty({ type: [ReceiptSummaryDto] }) data: ReceiptSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class ReceiptListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Receipts with a line in this warehouse' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;
  @ApiPropertyOptional({ description: 'Receipts with a line of this product' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description: 'Delivery-note date (else the posting date) from',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date', description: '… until (inclusive)' })
  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
  @ApiPropertyOptional({ enum: RECEIPT_STATUSES })
  @IsOptional()
  @IsIn(RECEIPT_STATUSES)
  status?: ReceiptStatus;
  @ApiPropertyOptional({ description: 'Posted receipts waiting for the accountant' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  costingPending?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) supplierId?: number;
  @ApiPropertyOptional({ description: 'Receipt or delivery note number' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}

@ApiSchema({ name: 'ReceiptLineRequest' })
export class ReceiptLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the product unit' })
  @Matches(QTY)
  enteredQty: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Only for a product without a home: the wholesale warehouse, which becomes its home',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Delivery-note price per unit',
  })
  @IsOptional()
  @Matches(MONEY)
  docUnitPrice?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Or the line amount, VAT in' })
  @IsOptional()
  @Matches(MONEY)
  docAmount?: string | null;
  @ApiPropertyOptional({ description: 'Free goods (бонус)' })
  @IsOptional()
  @IsBoolean()
  freeGoods?: boolean;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'New warehouse price per base unit (price holders)',
  })
  @IsOptional()
  @Matches(WHOLE_MNT)
  salePrice?: string | null;
}

class ReceiptHeaderFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  supplierDocNo?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @Matches(ISO_DATE)
  supplierDocDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: RECEIPT_PAYMENT_METHODS, description: 'Default CREDIT' })
  @IsOptional()
  @IsIn(RECEIPT_PAYMENT_METHODS)
  paymentMethod?: ReceiptPaymentMethod;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Cash box or bank account' })
  @IsOptional()
  @IsInt()
  @Min(1)
  moneyAccountId?: number | null;
}

@ApiSchema({ name: 'ReceiptCreateRequest' })
export class CreateReceiptDto extends ReceiptHeaderFieldsDto {
  @ApiProperty() @IsInt() @Min(1) supplierId: number;
  @ApiPropertyOptional({ type: [ReceiptLineRequestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineRequestDto)
  lines?: ReceiptLineRequestDto[];
}

@ApiSchema({ name: 'ReceiptUpdateRequest' })
export class UpdateReceiptDto extends ReceiptHeaderFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) supplierId?: number;
}

@ApiSchema({ name: 'ReceiptLineUpdateRequest' })
export class UpdateReceiptLineDto {
  @ApiPropertyOptional({ example: '3' }) @IsOptional() @Matches(QTY) enteredQty?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'null clears the price' })
  @IsOptional()
  @Matches(MONEY)
  docUnitPrice?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'null clears the price' })
  @IsOptional()
  @Matches(MONEY)
  docAmount?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() freeGoods?: boolean;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'New warehouse price per base unit; null clears it (price holders)',
  })
  @IsOptional()
  @Matches(WHOLE_MNT)
  salePrice?: string | null;
}

@ApiSchema({ name: 'ReceiptCostLineRequest' })
export class CostLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) lineId: number;
  @ApiPropertyOptional({
    example: '48000',
    description: 'Line amount as on the delivery note (VAT in)',
  })
  @IsOptional()
  @Matches(MONEY)
  amount?: string;
  @ApiPropertyOptional({
    example: '24000',
    description: 'Price per entered unit as on the delivery note',
  })
  @IsOptional()
  @Matches(MONEY)
  unitPrice?: string;
  @ApiPropertyOptional({ description: 'Free bonus goods (amount 0)' })
  @IsOptional()
  @IsBoolean()
  freeGoods?: boolean;
}

@ApiSchema({ name: 'ReceiptCostRequest' })
export class CostReceiptDto {
  @ApiPropertyOptional({
    type: [ReceiptDiscountRequestDto],
    description: 'Given, replaces the receipt’s discounts (ADR-0103)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReceiptDiscountRequestDto)
  discounts?: ReceiptDiscountRequestDto[];
  @ApiProperty({ description: 'The costing version the form was opened at' })
  @IsInt()
  @Min(0)
  costingVersion: number;
  @ApiProperty({ type: [CostLineRequestDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CostLineRequestDto)
  lines: CostLineRequestDto[];
}

@ApiSchema({ name: 'ReceiptCostingLine' })
export class CostedReceiptLineDto {
  @ApiProperty() lineId: number;
  @ApiProperty() productId: number;
  @ApiProperty() productName: string;
  @ApiProperty() unitName: string;
  @ApiProperty() enteredQty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ description: 'Cost per base unit the goods went in at' })
  provisionalUnitCost: string;
  @ApiProperty({ type: String, nullable: true, description: 'Cost: the amount less VAT' })
  amount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'As typed, VAT in' })
  docAmount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Share of the discount' })
  discountAmount: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Per base unit' }) unitCost:
    string | null;
  @ApiProperty() freeGoods: boolean;
}

/** Costs of a receipt: only for holders of inventory.costs.manage. */
@ApiSchema({ name: 'ReceiptCosting' })
export class ReceiptCostingDto {
  @ApiProperty() receiptId: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: RECEIPT_STATUSES }) status: ReceiptStatus;
  @ApiProperty({ enum: COSTING_STATUSES, nullable: true }) costingStatus: CostingStatus | null;
  @ApiProperty() costingVersion: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) recostUntil: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) costedAt: string | null;
  @ApiProperty({ example: '10' }) vatRatePct: string;
  @ApiProperty({ type: [ReceiptDiscountDto] }) discounts: ReceiptDiscountDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Σ cost' }) total: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Σ as typed' }) docTotal: string | null;
  @ApiProperty({ type: [CostedReceiptLineDto] }) lines: CostedReceiptLineDto[];
}

export class LastReceiptPricesQueryDto {
  @ApiProperty({ type: [Number], maxItems: 50, description: 'Repeated: productIds=1&productIds=2' })
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

/** A product's latest delivery-note price (ADR-0099 #3): cost data. */
@ApiSchema({ name: 'LastReceiptPrice' })
export class LastReceiptPriceDto {
  @ApiProperty() productId: number;
  @ApiProperty() receiptId: number;
  @ApiProperty() receiptNumber: string;
  @ApiProperty({ type: String, format: 'date', description: 'The delivery note’s date' })
  date: string;
  @ApiProperty() supplierName: string;
  @ApiProperty() unitName: string;
  @ApiProperty({ description: 'Per entered unit, VAT in, before the discount' }) unitPrice: string;
  @ApiProperty({ description: 'Per base unit' }) basePrice: string;
}
