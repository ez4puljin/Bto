import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  LOADING_MAX_ORDERS,
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';

/** Who loaded an order and when (ADR-0179). */
@ApiSchema({ name: 'SalesOrderLoading' })
export class SalesOrderLoadingDto {
  @ApiProperty() loadId: number;
  @ApiProperty() driverId: number;
  @ApiProperty({ type: String, nullable: true }) driverName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) loadedAt: string;
}

/** An order on the driver's «Ачилт» list (ADR-0179 #1). */
@ApiSchema({ name: 'SalesLoadingOrder' })
export class SalesLoadingOrderDto {
  @ApiProperty() orderId: number;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ type: String, nullable: true }) customerPhone: string | null;
  @ApiProperty({ type: String, nullable: true }) addressText: string | null;
  @ApiProperty({ type: String, nullable: true }) contactPhone: string | null;
  @ApiProperty({ type: String, format: 'date' }) deliveryDate: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ type: String, nullable: true, description: 'Whole MNT' }) total: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) pickedAt: string;
  @ApiProperty({ type: String, nullable: true }) pipelineName: string | null;
  @ApiProperty({
    type: SalesOrderLoadingDto,
    nullable: true,
    description: "Null while waiting; the caller's own loading of today otherwise",
  })
  loading: SalesOrderLoadingDto | null;
}

@ApiSchema({ name: 'SalesLoadRequest' })
export class SalesLoadRequestDto {
  @ApiProperty({ type: [Number], description: `The orders loaded, 1…${LOADING_MAX_ORDERS}` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LOADING_MAX_ORDERS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  orderIds: number[];
}

/** A loading as the API writes it. */
export const loadingDto = (
  loading: { loadId: number; driverId: number; driverName: string | null; loadedAt: Date } | null,
): SalesOrderLoadingDto | null =>
  loading === null ? null : { ...loading, loadedAt: loading.loadedAt.toISOString() };
