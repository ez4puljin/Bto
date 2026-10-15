import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { PRICE_BASES, type PriceBasis } from '@tugeel/shared/pricing';
import {
  FULFILMENTS,
  type Fulfilment,
  ORDER_CHANNELS,
  ORDER_LIMITS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

/** Up to 11 whole digits and 3 decimals, as the quantity columns hold. */
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'SalesOrderLineRequest' })
export class SalesOrderLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the unit' }) @IsString() @Matches(QTY) qty: string;
}

@ApiSchema({ name: 'SalesOrderRequest' })
export class SalesOrderRequestDto {
  @ApiProperty() @IsInt() @Min(1) customerId: number;
  @ApiProperty({ enum: FULFILMENTS }) @IsIn(FULFILMENTS) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date', description: 'Today or later (Ulaanbaatar)' })
  @Matches(DATE)
  deliveryDate: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Required for DELIVERY' })
  @IsOptional()
  @IsInt()
  @Min(1)
  addressId?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ORDER_LIMITS.maxContactName)
  contactName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '99112233' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod: PaymentMethod;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ORDER_LIMITS.maxNote)
  note?: string | null;
  @ApiProperty({ type: [SalesOrderLineRequestDto] })
  @IsArray()
  @ArrayMaxSize(ORDER_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineRequestDto)
  lines: SalesOrderLineRequestDto[];
}

@ApiSchema({ name: 'SalesOrderCancelRequest' })
export class SalesOrderCancelDto {
  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @MaxLength(ORDER_LIMITS.maxCancelReason)
  reason: string;
}

@ApiSchema({ name: 'SalesOrderListQuery' })
export class SalesOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({ description: 'Part of the order number' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  q?: string;
}

@ApiSchema({ name: 'SalesOrderProductInfoQuery' })
export class SalesOrderProductInfoQueryDto {
  @ApiProperty({ description: 'Product ids, comma separated (at most 200)', example: '12,15' })
  @IsString()
  @Matches(/^\d+(,\d+){0,199}$/)
  productIds: string;
}

@ApiSchema({ name: 'SalesOrderApplied' })
export class SalesOrderAppliedDto {
  @ApiProperty() programId: number;
  @ApiProperty() name: string;
  @ApiProperty() scope: string;
  @ApiProperty() effect: string;
  @ApiProperty() threshold: string;
  @ApiProperty() value: string;
  @ApiProperty({ type: String, nullable: true }) amount: string | null;
}

@ApiSchema({ name: 'SalesOrderPart' })
export class SalesOrderPartDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ enum: PRICE_BASES }) basis: PriceBasis;
  @ApiProperty() qty: string;
  @ApiProperty() factorSnapshot: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty() listPrice: string;
  @ApiProperty() unitPrice: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountAmount: string;
  @ApiProperty() total: string;
  @ApiProperty({ type: [SalesOrderAppliedDto] }) applied: SalesOrderAppliedDto[];
}

@ApiSchema({ name: 'SalesOrderLine' })
export class SalesOrderLineDto {
  @ApiProperty() id: number;
  @ApiProperty() lineNo: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ description: 'In the unit' }) qty: string;
  @ApiProperty() factorSnapshot: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty({ example: 'ш' }) baseUnitName: string;
  @ApiProperty({ description: "The product's home warehouse" }) warehouseId: number;
  @ApiProperty({ description: 'Base units reserved' }) qtyApproved: string;
  @ApiProperty({ description: 'Base units backordered' }) qtyBackordered: string;
  @ApiProperty({ type: String, nullable: true }) subtotal: string | null;
  @ApiProperty({ type: String, nullable: true }) discountAmount: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({ type: [SalesOrderPartDto] }) parts: SalesOrderPartDto[];
}

@ApiSchema({ name: 'SalesOrderEvent' })
export class SalesOrderEventDto {
  @ApiProperty({ enum: ORDER_STATUSES, nullable: true }) fromStatus: OrderStatus | null;
  @ApiProperty({ enum: ORDER_STATUSES }) toStatus: OrderStatus;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: Number, nullable: true }) actorId: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'SalesOrderDetail' })
export class SalesOrderDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'SO-2026-000001' }) number: string | null;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: Number, nullable: true }) addressId: number | null;
  @ApiProperty({ type: String, nullable: true }) addressText: string | null;
  @ApiProperty({ type: String, nullable: true }) addressLat: string | null;
  @ApiProperty({ type: String, nullable: true }) addressLng: string | null;
  @ApiProperty({ type: String, nullable: true }) contactName: string | null;
  @ApiProperty({ type: String, nullable: true }) contactPhone: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) priceDate: string | null;
  @ApiProperty({ type: String, nullable: true }) subtotal: string | null;
  @ApiProperty({ type: String, nullable: true }) discountTotal: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) confirmedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [SalesOrderLineDto] }) lines: SalesOrderLineDto[];
  @ApiProperty({ type: [SalesOrderEventDto] }) events: SalesOrderEventDto[];
}

@ApiSchema({ name: 'SalesOrderSummary' })
export class SalesOrderSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'SalesOrderPage' })
export class SalesOrderPageDto {
  @ApiProperty({ type: [SalesOrderSummaryDto] }) data: SalesOrderSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'SalesOrderProductInfo' })
export class SalesOrderProductInfoDto {
  @ApiProperty() productId: number;
  @ApiProperty({ type: Number, nullable: true }) homeWarehouseId: number | null;
  @ApiProperty({ description: 'Active and complete (ADR-0044)' }) sellable: boolean;
  @ApiProperty({ description: 'Base units available in the home warehouse' }) available: string;
}
