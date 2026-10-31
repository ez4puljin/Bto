import { ApiProperty, ApiPropertyOptional, ApiSchema, OmitType } from '@nestjs/swagger';
import { DEAL_KINDS, DISCOUNT_EFFECTS, DISCOUNT_SCOPES } from '@tugeel/shared/pricing';
import {
  FULFILMENTS,
  type Fulfilment,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
  REP_ORDER_STATES,
  REP_PRODUCT_SORTS,
  type RepOrderState,
  type RepProductSort,
  STAGE_ACTIONS,
  type StageAction,
} from '@tugeel/shared/sales';
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
} from 'class-validator';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';
import { SalesCustomerOverdueDto } from './sales-boards.dto';
import { SalesOrderRequestDto } from './sales-orders.dto';

// The sales-rep app's API (ADR-0061 #5, ADR-0068): only what the phone shows, never another rep's
// data.

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
/** A calendar date's shape; the service checks that the day exists. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@ApiSchema({ name: 'SalesRepStage' })
export class SalesRepStageDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: STAGE_ACTIONS, description: 'NONE: a draft; CONFIRM: reserved at once' })
  action: StageAction;
}

@ApiSchema({ name: 'SalesRepPipeline' })
export class SalesRepPipelineDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: [SalesRepStageDto] }) stages: SalesRepStageDto[];
}

@ApiSchema({ name: 'SalesRepBoard' })
export class SalesRepBoardDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: "The board's branch, if it has one" })
  branchName: string | null;
  @ApiProperty({ type: [SalesRepPipelineDto] }) pipelines: SalesRepPipelineDto[];
}

@ApiSchema({ name: 'SalesRepWarehouse' })
export class SalesRepWarehouseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() branchId: number;
  @ApiProperty() branchName: string;
}

@ApiSchema({ name: 'SalesRepContext' })
export class SalesRepContextDto {
  @ApiProperty({ format: 'date', description: "The server's business date (Ulaanbaatar)" })
  today: string;
  @ApiProperty({ type: [SalesRepBoardDto], description: 'Stages the rep may place orders on' })
  boards: SalesRepBoardDto[];
  @ApiProperty({ type: Number, nullable: true, description: "The SALES_REP channel's stage" })
  defaultStageId: number | null;
  @ApiProperty({
    type: [SalesRepWarehouseDto],
    description: "Active wholesale warehouses: the shop's homes, the location filter",
  })
  warehouses: SalesRepWarehouseDto[];
  @ApiProperty({
    type: [String],
    description: "The branches of the rep's write scope; empty when the rep is not scoped",
  })
  branchNames: string[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The name the office set for the app (ADR-0127 #4)',
  })
  appName: string | null;
  @ApiProperty({ type: String, nullable: true, description: '#RRGGBB the office set for the app' })
  appColor: string | null;
}

@ApiSchema({ name: 'SalesRepSupplier' })
export class SalesRepSupplierDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Shop products whose main supplier this is' }) productCount: number;
}

@ApiSchema({ name: 'SalesRepThumbs' })
export class SalesRepThumbsDto {
  @ApiProperty({
    type: [String],
    description:
      "The primary picture's thumbnail of every product the shop lists (relative URLs that never change)",
  })
  urls: string[];
}

@ApiSchema({ name: 'SalesRepOrderRequest' })
export class SalesRepOrderRequestDto extends OmitType(SalesOrderRequestDto, [
  'pipelineId',
  'stageId',
] as const) {
  @ApiProperty({ description: 'The stage chosen in the app (one of GET /sales-rep/context)' })
  @IsInt()
  @Min(1)
  stageId: number;
}

@ApiSchema({ name: 'SalesRepOrderListQuery' })
export class SalesRepOrderListQueryDto extends PageQueryDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-01',
    description: 'The first Ulaanbaatar day the orders were made on',
  })
  @IsString()
  @Matches(ISO_DATE)
  from: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-16',
    description: 'The last day, included; at most 366 days from `from`',
  })
  @IsString()
  @Matches(ISO_DATE)
  to: string;

  @ApiPropertyOptional({ description: 'Order number or customer (name, code, phone)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Only the orders of this customer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number;

  @ApiPropertyOptional({ description: 'Only orders with a line of this product' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: FULFILMENTS })
  @IsOptional()
  @IsIn(FULFILMENTS)
  fulfilment?: Fulfilment;

  @ApiPropertyOptional({
    enum: REP_ORDER_STATES,
    description:
      'DRAFT; ACTIVE: submitted, not yet delivered; SOLD: delivered, invoiced or closed; CANCELLED',
  })
  @IsOptional()
  @IsIn(REP_ORDER_STATES)
  state?: RepOrderState;
}

@ApiSchema({ name: 'SalesRepOrderSummary' })
export class SalesRepOrderSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() customerId: number;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a draft' })
  total: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "MNT: a draft's lines quoted at today's WHOLESALE prices, never stored; null for any other order or when a line has no price",
  })
  estimatedTotal: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, nullable: true }) pipelineName: string | null;
  @ApiProperty({ type: String, nullable: true }) stageName: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'SalesRepRangeSummary' })
export class SalesRepRangeSummaryDto {
  @ApiProperty() count: number;
  @ApiProperty({ description: 'MNT: the orders not cancelled (a draft has no total yet)' })
  total: string;
  @ApiProperty() drafts: number;
  @ApiProperty({
    description: "MNT: the sum of the drafts' estimates (a draft without one adds nothing)",
  })
  draftsEstimate: string;
}

@ApiSchema({ name: 'SalesRepOrderPage' })
export class SalesRepOrderPageDto {
  @ApiProperty({ type: [SalesRepOrderSummaryDto] }) data: SalesRepOrderSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({
    type: SalesRepRangeSummaryDto,
    nullable: true,
    description: 'First page only: every order the range, search and filters keep',
  })
  summary: SalesRepRangeSummaryDto | null;
}

@ApiSchema({ name: 'SalesRepOrderPart' })
export class SalesRepOrderPartDto {
  @ApiProperty() uomName: string;
  @ApiProperty({ description: 'WAREHOUSE, LOOSE, RETAIL or RETAIL_BULK' }) basis: string;
  @ApiProperty() qty: string;
  @ApiProperty() unitPrice: string;
  @ApiProperty() total: string;
}

@ApiSchema({ name: 'SalesRepOrderLine' })
export class SalesRepOrderLineDto {
  @ApiProperty() lineNo: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty() unitName: string;
  @ApiProperty() qty: string;
  @ApiProperty() qtyBase: string;
  @ApiProperty() baseUnitName: string;
  @ApiProperty({ description: 'Reserved, base units' }) qtyApproved: string;
  @ApiProperty({ description: 'Short, base units' }) qtyBackordered: string;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "MNT: a draft's line in the quote of its lines at today's WHOLESALE prices; null for any other order or when the line has no price",
  })
  estimatedTotal: string | null;
  @ApiProperty({ type: [SalesRepOrderPartDto] }) parts: SalesRepOrderPartDto[];
}

@ApiSchema({ name: 'SalesRepOrderEvent' })
export class SalesRepOrderEventDto {
  @ApiProperty({ enum: ORDER_STATUSES, nullable: true }) fromStatus: OrderStatus | null;
  @ApiProperty({ enum: ORDER_STATUSES }) toStatus: OrderStatus;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'SalesRepOrder' })
export class SalesRepOrderDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: String, nullable: true }) addressText: string | null;
  @ApiProperty({ type: String, nullable: true }) contactName: string | null;
  @ApiProperty({ type: String, nullable: true }) contactPhone: string | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) subtotal: string | null;
  @ApiProperty({ type: String, nullable: true }) discountTotal: string | null;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "MNT: a draft's lines quoted at today's WHOLESALE prices, never stored; null for any other order or when a line has no price",
  })
  estimatedTotal: string | null;
  @ApiProperty({ type: String, nullable: true }) boardName: string | null;
  @ApiProperty({ type: String, nullable: true }) pipelineName: string | null;
  @ApiProperty({ type: String, nullable: true }) stageName: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: [SalesRepOrderLineDto] }) lines: SalesRepOrderLineDto[];
  @ApiProperty({ type: [SalesRepOrderEventDto] }) events: SalesRepOrderEventDto[];
}

@ApiSchema({ name: 'SalesRepProductQuery' })
export class SalesRepProductQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Name words, code or barcode' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Categories, each with its subcategories (1–200 ids, repeated)',
  })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({ description: "The products' home warehouse" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Main suppliers (1–200 ids, repeated)',
  })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  supplierIds?: number[];

  @ApiPropertyOptional({ description: 'Only products with stock free in their home warehouse' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    enum: REP_PRODUCT_SORTS,
    description: 'NEW when left out: the latest to become sale-ready first',
  })
  @IsOptional()
  @IsIn(REP_PRODUCT_SORTS)
  sort?: RepProductSort;
}

@ApiSchema({ name: 'SalesRepProductBatchQuery' })
export class SalesRepProductBatchQueryDto {
  @ApiProperty({ description: 'Product ids, comma separated (at most 200)', example: '12,15' })
  @IsString()
  @Matches(/^\d+(,\d+){0,199}$/)
  productIds: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Also each base price on this day (a price-drop notice shows the old one)',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE)
  priceBefore?: string;
}

@ApiSchema({ name: 'SalesRepProductUnit' })
export class SalesRepProductUnitDto {
  @ApiProperty({ description: 'The product unit id an order line takes' }) id: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ type: String, nullable: true, description: 'PCS, BOX …; null for a custom one' })
  uomCode: string | null;
  @ApiProperty() factorToBase: string;
  @ApiProperty() isBase: boolean;
  @ApiProperty({ description: 'The unit the shop adds by default' }) isDefaultSales: boolean;
  @ApiProperty({ type: [String] }) barcodes: string[];
  @ApiProperty({ type: String, nullable: true, description: 'MNT, one unit at the WHOLESALE list' })
  wholesale: string | null;
  @ApiProperty({ enum: ['WAREHOUSE', 'LOOSE', 'MIXED'], nullable: true })
  basis: 'WAREHOUSE' | 'LOOSE' | 'MIXED' | null;
}

@ApiSchema({ name: 'SalesRepProductImage' })
export class SalesRepProductImageDto {
  @ApiProperty({ description: 'Relative to the server' }) url: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

@ApiSchema({ name: 'SalesRepDealThreshold' })
export class SalesRepDealThresholdDto {
  @ApiProperty({ type: String, nullable: true, description: 'A quantity in `unitName`' })
  qty: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The unit the quantity is in' })
  unitName: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'An amount in MNT (the order’s or a category’s)',
  })
  amount: string | null;
}

/** «Bto300»'s badge (CustomerAppDeal, ADR-0092 #3) on the rep's cards (the owner, 2026-10-23). */
@ApiSchema({ name: 'SalesRepDeal' })
export class SalesRepDealDto {
  @ApiProperty({
    enum: DEAL_KINDS,
    description: 'PROMOTION: with an end date (orange); DISCOUNT (red)',
  })
  kind: (typeof DEAL_KINDS)[number];
  @ApiProperty({ description: 'The badge: «10+ ш −5%», «−200₮», «−10% · 10/31»' }) label: string;
  @ApiProperty() programId: number;
  @ApiProperty() programName: string;
  @ApiProperty({ enum: DISCOUNT_SCOPES }) scope: (typeof DISCOUNT_SCOPES)[number];
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) effect: (typeof DISCOUNT_EFFECTS)[number];
  @ApiProperty({ description: 'The first step: a percentage, tugriks off, or a new unit price' })
  value: string;
  @ApiProperty({
    type: SalesRepDealThresholdDto,
    nullable: true,
    description: 'The first step’s condition; null when it always applies',
  })
  threshold: SalesRepDealThresholdDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'A pack unit the price or amount is for',
  })
  perUnitName: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'A promotion’s last day',
  })
  lastDay: string | null;
}

@ApiSchema({ name: 'SalesRepProduct' })
export class SalesRepProductDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() categoryId: number;
  @ApiProperty({ type: String, nullable: true, description: 'Relative to the server' })
  thumbUrl: string | null;
  @ApiProperty({ type: [SalesRepProductImageDto], description: 'The primary first' })
  images: SalesRepProductImageDto[];
  @ApiProperty({ description: 'Became sale-ready within the last 14 days' }) isNew: boolean;
  @ApiProperty({ description: 'An order accepts it (active, complete, with a home warehouse)' })
  sellable: boolean;
  @ApiProperty({ type: Number, nullable: true }) homeWarehouseId: number | null;
  @ApiProperty({ description: 'Base units free in the home warehouse' }) available: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'MNT, one base unit in whole packs (the warehouse price); null without terms',
  })
  basePrice: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The base price on `priceBefore`; null without it',
  })
  basePriceBefore: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'MNT, one base unit in whole packs after an unconditional discount, when lower than basePrice; the card strikes basePrice through',
  })
  dealPrice: string | null;
  @ApiProperty({
    type: SalesRepDealDto,
    nullable: true,
    description: 'The badge of its WHOLESALE discount program; null when none marks it',
  })
  deal: SalesRepDealDto | null;
  @ApiProperty({ type: [SalesRepProductUnitDto] }) units: SalesRepProductUnitDto[];
}

@ApiSchema({ name: 'SalesRepProductPage' })
export class SalesRepProductPageDto {
  @ApiProperty({ type: [SalesRepProductDto] }) data: SalesRepProductDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'First page only: how many products the filters keep',
  })
  total: number | null;
}

@ApiSchema({ name: 'SalesRepCustomerQuery' })
export class SalesRepCustomerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Name, code, phone or registration number' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'SalesRepCustomer' })
export class SalesRepCustomerDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'The default address' })
  address: string | null;
  @ApiProperty({
    type: SalesCustomerOverdueDto,
    nullable: true,
    description: 'The overdue receivable: a red reminder, never a block (ADR-0101); null when none',
  })
  overdue: SalesCustomerOverdueDto | null;
}

@ApiSchema({ name: 'SalesRepCustomerPage' })
export class SalesRepCustomerPageDto {
  @ApiProperty({ type: [SalesRepCustomerDto] }) data: SalesRepCustomerDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'SalesRepCustomerAddress' })
export class SalesRepCustomerAddressDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) label: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a point without text' })
  address: string | null;
  @ApiProperty() isDefault: boolean;
}

@ApiSchema({ name: 'SalesRepCustomerContact' })
export class SalesRepCustomerContactDto {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
}

@ApiSchema({ name: 'SalesRepMapStore' })
export class SalesRepMapStoreDto {
  @ApiProperty() customerId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ description: "The customer's manual credit hold: no new orders (partners)" })
  creditHold: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Set only while on hold' })
  creditHoldReason: string | null;
  @ApiProperty({
    type: SalesCustomerOverdueDto,
    nullable: true,
    description: 'The overdue receivable: a red reminder, never a block (ADR-0101); null when none',
  })
  overdue: SalesCustomerOverdueDto | null;
  @ApiProperty({ description: 'The customer address whose point this is' }) addressId: number;
  @ApiProperty({ type: String, nullable: true, description: "The point's address text" })
  address: string | null;
  @ApiProperty({ example: '49.639810', description: 'Degrees, 6 decimals' }) lat: string;
  @ApiProperty({ example: '100.162540', description: 'Degrees, 6 decimals' }) lng: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: "The caller's own last rep order for the store (drafts count, cancelled do not)",
  })
  lastOrderId: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastOrderAt: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: "The last order's Ulaanbaatar day",
  })
  lastOrderDate: string | null;
  @ApiProperty({ description: 'No such order within `freshDays` days, today included' })
  stale: boolean;
}

@ApiSchema({ name: 'SalesRepMap' })
export class SalesRepMapDto {
  @ApiProperty({ format: 'date', description: "The server's business date (Ulaanbaatar)" })
  today: string;
  @ApiProperty({ description: 'An order within this many days, today included, is fresh' })
  freshDays: number;
  @ApiProperty({
    type: [SalesRepMapStoreDto],
    description:
      'Active customers with a GPS point (the default address, else the oldest active one), by name',
  })
  data: SalesRepMapStoreDto[];
}

@ApiSchema({ name: 'SalesRepStoreOrderQuery' })
/** PageQueryDto's keyset paging with the store history's smaller pages (20, at most 50). */
export class SalesRepStoreOrderQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiSchema({ name: 'SalesRepStoreOrder' })
export class SalesRepStoreOrderDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ enum: ORDER_CHANNELS, description: 'ADMIN: an office order' })
  channel: OrderChannel;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date', description: 'The Ulaanbaatar day the order was taken' })
  createdDate: string;
  @ApiProperty({ example: '14:05', description: 'The Ulaanbaatar time it was taken, HH:mm' })
  createdTime: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "The creator's full name; null when unknown",
  })
  takerName: string | null;
  @ApiProperty({
    description:
      "The caller's own rep order: only these open (GET /sales-rep/orders/{id}), the rest are rows only",
  })
  mine: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a draft' })
  total: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "MNT: a draft's lines quoted at today's WHOLESALE prices, never stored; null for any other order or when a line has no price",
  })
  estimatedTotal: string | null;
  @ApiProperty() lineCount: number;
}

@ApiSchema({ name: 'SalesRepStoreOrderPage' })
export class SalesRepStoreOrderPageDto {
  @ApiProperty({
    type: [SalesRepStoreOrderDto],
    description: "Every order of the store, anyone's, any status, newest first",
  })
  data: SalesRepStoreOrderDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'SalesRepCustomerDetail' })
export class SalesRepCustomerDetailDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: [SalesRepCustomerAddressDto], description: 'Active, the default first' })
  addresses: SalesRepCustomerAddressDto[];
  @ApiProperty({ type: [SalesRepCustomerContactDto] }) contacts: SalesRepCustomerContactDto[];
  @ApiProperty({
    type: SalesCustomerOverdueDto,
    nullable: true,
    description: 'The overdue receivable: a red reminder, never a block (ADR-0101); null when none',
  })
  overdue: SalesCustomerOverdueDto | null;
}
