import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  AR_ENTRY_KINDS,
  type ArEntryKind,
  MONEY_ACCOUNT_KINDS,
  type MoneyAccountKind,
} from '@tugeel/shared/finance';
import {
  CUSTOMER_NOTIFICATION_KINDS,
  type CustomerNotificationKind,
  NOTICE_KINDS,
  NOTICE_LIMITS,
  type NoticeKind,
} from '@tugeel/shared/notifications';
import { DISCOUNT_EFFECTS, MAX_QUOTE_LINES } from '@tugeel/shared/pricing';
import {
  CUSTOMER_ORDER_STATES,
  type CustomerOrderState,
  FULFILMENTS,
  type Fulfilment,
  HOME_SECTION_KINDS,
  type HomeSectionKind,
  ORDER_CHANNELS,
  ORDER_LIMITS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
  REP_PRODUCT_SORTS,
  type RepProductSort,
  STOCK_WORDS,
  type StockWord,
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';
import { QuoteDto, QuoteLineRequestDto } from '../../pricing';
import { CONTACT_LIMITS } from '../schema';
import {
  CustomerAppBannerDto,
  CustomerAppDealDto,
  CustomerAppHomeCategoryDto,
  CustomerAppHomeSectionDto,
} from './customer-home.dto';

// The customer app «Bto300» (ADR-0079): only what the store's own screens show. Money goes out as
// strings (whole MNT for prices and orders, two decimals for finance), quantities as entered.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const queryBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

// ------------------------------------------------------------------------------------ the store

@ApiSchema({ name: 'CustomerAppCentre' })
export class CustomerAppCentreDto {
  @ApiProperty({ description: 'The branch the store orders from' }) branchName: string;
  @ApiProperty({ type: [String], description: 'Its wholesale warehouses («Өөрөө авна»)' })
  warehouses: string[];
}

@ApiSchema({ name: 'CustomerAppAddress' })
export class CustomerAppAddressDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) label: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
}

@ApiSchema({ name: 'CustomerAppMe' })
export class CustomerAppMeDto {
  @ApiProperty() customerId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The sign-in phone' }) phone: string;
  @ApiProperty({ type: CustomerAppCentreDto, nullable: true }) centre: CustomerAppCentreDto | null;
  @ApiProperty({ type: CustomerAppAddressDto, nullable: true })
  defaultAddress: CustomerAppAddressDto | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Changed only by the office' })
  paymentTermDays: number | null;
  @ApiProperty({ description: 'False while no stage takes app orders: the app does not send' })
  ordersOpen: boolean;
  @ApiProperty({ format: 'date', description: "The server's business date" }) today: string;
}

// ------------------------------------------------------------------------------------- the shop

@ApiSchema({ name: 'CustomerAppCategory' })
export class CustomerAppCategoryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: Number, nullable: true }) parentId: number | null;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'CustomerAppImage' })
export class CustomerAppImageDto {
  @ApiProperty() url: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

@ApiSchema({ name: 'CustomerAppUnit' })
export class CustomerAppUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ type: String, nullable: true }) uomCode: string | null;
  @ApiProperty({ example: '12' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
  @ApiProperty() isDefaultSales: boolean;
  @ApiProperty({ type: [String] }) barcodes: string[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'One unit at the wholesale price, whole MNT; null without a price today',
  })
  wholesale: string | null;
  @ApiProperty({ type: String, enum: ['WAREHOUSE', 'LOOSE', 'MIXED'], nullable: true })
  basis: 'WAREHOUSE' | 'LOOSE' | 'MIXED' | null;
}

@ApiSchema({ name: 'CustomerAppProduct' })
export class CustomerAppProductDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() categoryId: number;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
  @ApiProperty({ type: [CustomerAppImageDto], description: 'The primary first' })
  images: CustomerAppImageDto[];
  @ApiProperty({ description: '«Шинэ»' }) isNew: boolean;
  @ApiProperty({
    enum: STOCK_WORDS,
    enumName: 'StockWord',
    description: '«Байгаа», «Цөөхөн үлдсэн», «Дууссан»; never the number (ADR-0079 #4)',
  })
  stock: StockWord;
  @ApiProperty({ description: 'The store starred it' }) favourite: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'One base unit in whole packs' })
  basePrice: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'One base unit in whole packs after an unconditional discount; the card strikes basePrice through (ADR-0093)',
  })
  dealPrice: string | null;
  @ApiProperty({
    type: CustomerAppDealDto,
    nullable: true,
    description: 'The badge of its discount program (ADR-0092 #3)',
  })
  deal: CustomerAppDealDto | null;
  @ApiProperty({ type: [CustomerAppUnitDto] }) units: CustomerAppUnitDto[];
}

// ------------------------------------------------------------------- the home (ADR-0092, ADR-0093)

@ApiSchema({ name: 'CustomerAppHomeSectionRow' })
export class CustomerAppHomeSectionRowDto extends CustomerAppHomeSectionDto {
  @ApiProperty({ type: [CustomerAppProductDto], description: 'At most 10, «Дууссан» last' })
  products: CustomerAppProductDto[];
}

@ApiSchema({ name: 'CustomerAppHome' })
export class CustomerAppHomeDto {
  @ApiProperty({ format: 'date' }) today: string;
  @ApiProperty({ type: [CustomerAppBannerDto], description: 'Running, in their order' })
  banners: CustomerAppBannerDto[];
  @ApiProperty({
    type: [CustomerAppHomeCategoryDto],
    description: '«Ангиллын жагсаалт»: top categories with products, by name',
  })
  categories: CustomerAppHomeCategoryDto[];
  @ApiProperty({
    type: [CustomerAppHomeSectionRowDto],
    description: 'In the fixed order of ADR-0092 #1; an empty one is left out',
  })
  sections: CustomerAppHomeSectionRowDto[];
}

@ApiSchema({ name: 'CustomerAppSectionPage' })
export class CustomerAppSectionPageDto {
  @ApiProperty() key: string;
  @ApiProperty({ enum: HOME_SECTION_KINDS }) kind: HomeSectionKind;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiProperty({ type: String, nullable: true }) subtitle: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) lastDay: string | null;
  @ApiProperty({ type: [CustomerAppProductDto] }) data: CustomerAppProductDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page' })
  total: number | null;
}

@ApiSchema({ name: 'CustomerAppCategoryHeader' })
export class CustomerAppCategoryHeaderDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: Number, nullable: true }) parentId: number | null;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
}

@ApiSchema({ name: 'CustomerAppCategoryPage' })
export class CustomerAppCategoryPageDto {
  @ApiProperty({ type: CustomerAppCategoryHeaderDto }) category: CustomerAppCategoryHeaderDto;
  @ApiProperty({ description: '«… бүх бараа · N»: products «Бараа» sells in its subtree' })
  productCount: number;
  @ApiProperty({ type: [CustomerAppBannerDto], description: 'Running banners linked to it' })
  banners: CustomerAppBannerDto[];
  @ApiProperty({
    type: [CustomerAppHomeCategoryDto],
    description: 'Its subcategories with products',
  })
  subcategories: CustomerAppHomeCategoryDto[];
  @ApiProperty({
    type: [CustomerAppHomeSectionRowDto],
    description: '«Шинээр нэмэгдсэн бараа» (new) and «Хямдралтай бараа» (deals) of its subtree',
  })
  sections: CustomerAppHomeSectionRowDto[];
}

@ApiSchema({ name: 'CustomerAppProductPage' })
export class CustomerAppProductPageDto {
  @ApiProperty({ type: [CustomerAppProductDto] }) data: CustomerAppProductDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page' })
  total: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '«★ Дуртай N»: the stars the shop still lists, on the first page',
  })
  favouriteCount: number | null;
}

@ApiSchema({ name: 'CustomerAppProductQuery' })
export class CustomerAppProductQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Name words, code or barcode' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Each with its subcategories (repeated)' })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({ description: '«♡ Дуртай»: only the store’s favourites' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  favourites?: boolean;

  @ApiPropertyOptional({ description: '«Хямдралтай»: products of a promotion or a discount' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  deals?: boolean;

  @ApiPropertyOptional({ description: '«Шинэ»: sale-ready within the last 14 days' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  new?: boolean;

  @ApiPropertyOptional({ description: '«Зөвхөн байгаа бараа»' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({ enum: REP_PRODUCT_SORTS, description: 'NEW when left out' })
  @IsOptional()
  @IsIn(REP_PRODUCT_SORTS)
  sort?: RepProductSort;
}

@ApiSchema({ name: 'CustomerAppProductBatchQuery' })
export class CustomerAppProductBatchQueryDto {
  @ApiProperty({ description: 'Product ids, comma separated (at most 200)', example: '12,15' })
  @IsString()
  @Matches(/^\d+(,\d+){0,199}$/)
  productIds: string;
}

@ApiSchema({ name: 'CustomerAppThumbs' })
export class CustomerAppThumbsDto {
  @ApiProperty({ type: [String] }) urls: string[];
}

@ApiSchema({ name: 'CustomerAppBarcode' })
export class CustomerAppBarcodeDto {
  @ApiProperty({ description: 'The unit the barcode names (a box barcode: the box)' })
  productUnitId: number;
  @ApiProperty({ type: CustomerAppProductDto }) product: CustomerAppProductDto;
}

@ApiSchema({ name: 'CustomerAppFavourites' })
export class CustomerAppFavouritesDto {
  @ApiProperty({ type: [Number], description: 'The newest star first' }) productIds: number[];
}

@ApiSchema({ name: 'CustomerAppQuoteRequest' })
export class CustomerAppQuoteRequestDto {
  @ApiProperty({ type: [QuoteLineRequestDto], maxItems: MAX_QUOTE_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUOTE_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineRequestDto)
  lines: QuoteLineRequestDto[];
}

@ApiSchema({ name: 'CustomerAppQuoteStock' })
export class CustomerAppQuoteStockDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty({ enum: STOCK_WORDS, enumName: 'StockWord' }) stock: StockWord;
  @ApiProperty({ description: '«Зарим нь хойшилж магадгүй»: more than is free now' })
  mayBackorder: boolean;
}

@ApiSchema({ name: 'CustomerAppOrderDealStep' })
export class CustomerAppOrderDealStepDto {
  @ApiProperty({ description: 'The order amount the step starts at, MNT' }) threshold: string;
  @ApiProperty({ description: 'A percentage or tugriks off' }) value: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The next step only: how much the order still needs',
  })
  missing: string | null;
}

@ApiSchema({ name: 'CustomerAppOrderDeal' })
export class CustomerAppOrderDealDto {
  @ApiProperty() programId: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: DISCOUNT_EFFECTS }) effect: (typeof DISCOUNT_EFFECTS)[number];
  @ApiProperty({ type: CustomerAppOrderDealStepDto, nullable: true })
  reached: CustomerAppOrderDealStepDto | null;
  @ApiProperty({ type: CustomerAppOrderDealStepDto, nullable: true })
  next: CustomerAppOrderDealStepDto | null;
}

@ApiSchema({ name: 'CustomerAppQuote' })
export class CustomerAppQuoteDto {
  @ApiProperty({ type: QuoteDto, description: 'The WHOLESALE list today; the app never prices' })
  quote: QuoteDto;
  @ApiProperty({ type: [CustomerAppQuoteStockDto], description: 'By line, as asked' })
  stock: CustomerAppQuoteStockDto[];
  @ApiProperty({
    type: [CustomerAppOrderDealDto],
    description:
      'Order amount programs in force: the cart’s hint «500,000₮ хүрвэл 3%» (ADR-0092 #3)',
  })
  orderDeals: CustomerAppOrderDealDto[];
}

// --------------------------------------------------------------------------------- the checkout

@ApiSchema({ name: 'CustomerAppCheckoutAddress' })
export class CustomerAppCheckoutAddressDto extends CustomerAppAddressDto {
  @ApiProperty() isDefault: boolean;
}

@ApiSchema({ name: 'CustomerAppCheckout' })
export class CustomerAppCheckoutDto {
  @ApiProperty({ format: 'date' }) today: string;
  @ApiProperty({ format: 'date', description: 'The last day an order may ask for (today + 60)' })
  lastDay: string;
  @ApiProperty({ type: [CustomerAppCheckoutAddressDto], description: 'Live, the default first' })
  addresses: CustomerAppCheckoutAddressDto[];
  @ApiProperty({ type: CustomerAppCentreDto, nullable: true }) pickup: CustomerAppCentreDto | null;
  @ApiProperty() ordersOpen: boolean;
}

@ApiSchema({ name: 'CustomerAppCreditCheckQuery' })
export class CustomerAppCreditCheckQueryDto {
  @ApiProperty({ example: '125000', description: "The cart's total from the quote" })
  @Matches(MONEY)
  amount: string;
}

@ApiSchema({ name: 'CustomerAppCreditCheck' })
export class CustomerAppCreditCheckDto {
  @ApiProperty({
    enum: ['HOLD', 'OVERDUE', 'LIMIT'],
    isArray: true,
    description: 'Why the office may not confirm yet; the store may still send',
  })
  warnings: ('HOLD' | 'OVERDUE' | 'LIMIT')[];
  @ApiProperty({ example: '0.00' }) overdueAmount: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) oldestOverdueDate: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only when the store has a limit' })
  creditLimit: string | null;
  @ApiProperty({ type: String, nullable: true }) creditAvailable: string | null;
  @ApiProperty({ description: 'How far this amount passes the limit; 0.00 when it does not' })
  excess: string;
}

@ApiSchema({ name: 'CustomerAppOrderLineRequest' })
export class CustomerAppOrderLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the unit' })
  @Matches(/^\d{1,11}(\.\d{1,3})?$/)
  qty: string;
}

@ApiSchema({ name: 'CustomerAppOrderRequest' })
export class CustomerAppOrderRequestDto {
  @ApiProperty({ enum: FULFILMENTS }) @IsIn(FULFILMENTS) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date', description: 'Today … today + 60 (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  deliveryDate: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'One of the store’s live addresses; required for DELIVERY',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  addressId?: number | null;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod: PaymentMethod;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: ORDER_LIMITS.maxNote })
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_LIMITS.maxNote)
  note?: string | null;
  @ApiProperty({ type: [CustomerAppOrderLineRequestDto], maxItems: ORDER_LIMITS.maxLines })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_LIMITS.maxLines)
  @ValidateNested({ each: true })
  @Type(() => CustomerAppOrderLineRequestDto)
  lines: CustomerAppOrderLineRequestDto[];
}

// ----------------------------------------------------------------------------------- the orders

/** Who took an order, as the store filters them (the owner 2026-10-20). */
export const CUSTOMER_ORDER_TAKERS = ['APP', 'OFFICE', 'REP'] as const;
export type CustomerOrderTaker = (typeof CUSTOMER_ORDER_TAKERS)[number];

@ApiSchema({ name: 'CustomerAppOrderRep' })
export class CustomerAppOrderRepDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Бат' }) name: string;
}

@ApiSchema({ name: 'CustomerAppOrderReps' })
export class CustomerAppOrderRepsDto {
  @ApiProperty({
    type: [CustomerAppOrderRepDto],
    description: 'The reps who took the store’s orders',
  })
  reps: CustomerAppOrderRepDto[];
}

@ApiSchema({ name: 'CustomerAppOrderListQuery' })
export class CustomerAppOrderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: CUSTOMER_ORDER_TAKERS,
    description: 'Who took it: APP, OFFICE (the office and the till) or REP (one rep with repId)',
  })
  @IsOptional()
  @IsIn(CUSTOMER_ORDER_TAKERS)
  taker?: CustomerOrderTaker;
  @ApiPropertyOptional({ description: 'With taker=REP: one rep (from /customer-app/orders/reps)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repId?: number;
  @ApiPropertyOptional({ description: 'Orders with a line of this product' })
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
  @ApiPropertyOptional({ enum: CUSTOMER_ORDER_STATES, description: 'In the customer’s words' })
  @IsOptional()
  @IsIn(CUSTOMER_ORDER_STATES)
  state?: CustomerOrderState;
  @ApiPropertyOptional({ format: 'date', description: 'Created on or after (Ulaanbaatar)' })
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;
  @ApiPropertyOptional({ format: 'date', description: 'Created on or before (Ulaanbaatar)' })
  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}

class CustomerAppOrderBaseDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({
    enum: CUSTOMER_ORDER_STATES,
    enumName: 'CustomerOrderState',
    description: 'The progress in the customer’s words',
  })
  state: CustomerOrderState;
  @ApiProperty({ enum: ORDER_CHANNELS, description: 'CUSTOMER_APP «Апп», ADMIN «Оффис», …' })
  channel: OrderChannel;
  @ApiProperty({ type: String, nullable: true, description: 'The rep of a SALES_REP order' })
  takerName: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod: PaymentMethod;
  @ApiProperty({ type: String, nullable: true, description: 'Frozen at the confirmation' })
  total: string | null;
  @ApiProperty({ type: String, nullable: true, description: '«≈» a pending order today' })
  estimatedTotal: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
}

@ApiSchema({ name: 'CustomerAppOrderRow' })
export class CustomerAppOrderRowDto extends CustomerAppOrderBaseDto {
  @ApiProperty({ format: 'date' }) createdDate: string;
  @ApiProperty({ example: '14:05' }) createdTime: string;
  @ApiProperty() lineCount: number;
  @ApiProperty() backorderedLines: number;
}

@ApiSchema({ name: 'CustomerAppOrderSummary' })
export class CustomerAppOrderSummaryDto {
  @ApiProperty() count: number;
  @ApiProperty({ description: 'The orders not cancelled, as frozen, whole MNT' })
  confirmedTotal: string;
  @ApiProperty({ description: '«Хүлээгдэж буй»' }) pending: number;
}

@ApiSchema({ name: 'CustomerAppOrderPage' })
export class CustomerAppOrderPageDto {
  @ApiProperty({ type: [CustomerAppOrderRowDto] }) data: CustomerAppOrderRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: CustomerAppOrderSummaryDto, nullable: true, description: 'First page' })
  summary: CustomerAppOrderSummaryDto | null;
}

@ApiSchema({ name: 'CustomerAppOrderLinePart' })
export class CustomerAppOrderLinePartDto {
  @ApiProperty({ example: 'хайрцаг' }) uomName: string;
  @ApiProperty({ description: 'In that unit' }) qty: string;
  @ApiProperty({ description: 'One unit as confirmed, whole MNT' }) unitPrice: string;
}

@ApiSchema({ name: 'CustomerAppOrderLine' })
export class CustomerAppOrderLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty() unitName: string;
  @ApiProperty({ description: 'In the unit' }) qty: string;
  @ApiProperty() baseUnitName: string;
  @ApiProperty({ description: 'Base units' }) qtyBase: string;
  @ApiProperty({ description: 'Base units waiting for stock («хойшилсон»)' })
  qtyBackordered: string;
  @ApiProperty({ type: String, nullable: true, description: 'Frozen at the confirmation' })
  total: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'A pending line today' })
  estimatedTotal: string | null;
  @ApiProperty({
    type: [CustomerAppOrderLinePartDto],
    description: 'The confirmed price split (whole packs, loose pieces); empty while pending',
  })
  parts: CustomerAppOrderLinePartDto[];
}

@ApiSchema({ name: 'CustomerAppOrderInvoice' })
export class CustomerAppOrderInvoiceDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
}

@ApiSchema({ name: 'CustomerAppOrder' })
export class CustomerAppOrderDto extends CustomerAppOrderBaseDto {
  @ApiProperty({ type: String, nullable: true }) addressText: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) confirmedAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) pickedAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) deliveredAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) cancelledAt: string | null;
  @ApiProperty({ type: CustomerAppOrderInvoiceDto, nullable: true })
  invoice: CustomerAppOrderInvoiceDto | null;
  @ApiProperty({ type: [CustomerAppOrderLineDto] }) lines: CustomerAppOrderLineDto[];
}

@ApiSchema({ name: 'CustomerAppReorderLine' })
export class CustomerAppReorderLineDto {
  @ApiProperty() productId: number;
  @ApiProperty() productUnitId: number;
  @ApiProperty() qty: string;
}

@ApiSchema({ name: 'CustomerAppReorderSkip' })
export class CustomerAppReorderSkipDto {
  @ApiProperty() productId: number;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: ['UNAVAILABLE', 'OUT_OF_STOCK', 'UNIT_CHANGED'] })
  reason: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'UNIT_CHANGED';
}

@ApiSchema({ name: 'CustomerAppReorder' })
export class CustomerAppReorderDto {
  @ApiProperty({ type: [CustomerAppReorderLineDto] }) lines: CustomerAppReorderLineDto[];
  @ApiProperty({ type: [CustomerAppReorderSkipDto] }) skipped: CustomerAppReorderSkipDto[];
}

// ---------------------------------------------------------------------------------- the account

@ApiSchema({ name: 'CustomerAppBalance' })
export class CustomerAppBalanceDto {
  @ApiProperty({ example: '125000.00', description: 'Negative = an advance' }) balance: string;
  @ApiProperty() overdueAmount: string;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) oldestOverdueDate: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Only when a limit is set' })
  creditLimit: string | null;
  @ApiProperty({ type: String, nullable: true, description: '«үлдсэн боломж»' })
  creditAvailable: string | null;
  @ApiProperty({ description: '«Зээл хаалттай»; never its internal reason' }) creditHold: boolean;
  @ApiProperty({ type: Number, nullable: true }) paymentTermDays: number | null;
  @ApiProperty({ description: '«Нэхэмжлэх (n)»' }) openInvoices: number;
  @ApiProperty({ description: '«Төлбөр (n)»' }) payments: number;
}

@ApiSchema({ name: 'CustomerAppInvoice' })
export class CustomerAppInvoiceDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty({ format: 'date' }) invoiceDate: string;
  @ApiProperty({ format: 'date' }) dueDate: string;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty() total: string;
  @ApiProperty() openAmount: string;
  @ApiProperty({ description: '«N хоног хэтэрсэн»; 0 when not overdue' }) daysOverdue: number;
  @ApiProperty({ description: '«N хоног үлдсэн»; 0 when overdue or due today' }) daysLeft: number;
}

@ApiSchema({ name: 'CustomerAppInvoiceLine' })
export class CustomerAppInvoiceLineDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() uomName: string;
  @ApiProperty() qty: string;
  @ApiProperty() unitPrice: string;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountAmount: string;
  @ApiProperty() total: string;
  @ApiProperty() vatAmount: string;
}

@ApiSchema({ name: 'CustomerAppInvoiceDetail' })
export class CustomerAppInvoiceDetailDto extends CustomerAppInvoiceDto {
  @ApiProperty({ enum: ['ISSUED', 'VOID'] }) status: 'ISSUED' | 'VOID';
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty({ enum: ORDER_CHANNELS, nullable: true, description: 'Who took the order' })
  orderChannel: OrderChannel | null;
  @ApiProperty({ type: String, nullable: true, description: 'The rep of a SALES_REP order' })
  orderTakerName: string | null;
  @ApiProperty() subtotal: string;
  @ApiProperty() discountTotal: string;
  @ApiProperty({ description: '«Үүнд НӨАТ»' }) vatTotal: string;
  @ApiProperty() cityTaxTotal: string;
  @ApiProperty() paidAmount: string;
  @ApiProperty() creditedAmount: string;
  @ApiProperty({ type: [CustomerAppInvoiceLineDto] }) lines: CustomerAppInvoiceLineDto[];
}

@ApiSchema({ name: 'CustomerAppSettledInvoice' })
export class CustomerAppSettledInvoiceDto {
  @ApiProperty() invoiceId: number;
  @ApiProperty() number: string;
  @ApiProperty() amount: string;
}

@ApiSchema({ name: 'CustomerAppPayment' })
export class CustomerAppPaymentDto {
  @ApiProperty() id: number;
  @ApiProperty() number: string;
  @ApiProperty({ enum: ['CUSTOMER_PAYMENT', 'CUSTOMER_REFUND'] })
  kind: 'CUSTOMER_PAYMENT' | 'CUSTOMER_REFUND';
  @ApiProperty({ enum: MONEY_ACCOUNT_KINDS, description: 'Cash or a bank transfer' })
  method: MoneyAccountKind;
  @ApiProperty() amount: string;
  @ApiProperty({ format: 'date' }) paidOn: string;
  @ApiProperty({ type: [CustomerAppSettledInvoiceDto] }) invoices: CustomerAppSettledInvoiceDto[];
}

@ApiSchema({ name: 'CustomerAppPaymentPage' })
export class CustomerAppPaymentPageDto {
  @ApiProperty({ type: [CustomerAppPaymentDto] }) data: CustomerAppPaymentDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'On the first page' })
  total: number | null;
}

@ApiSchema({ name: 'CustomerAppStatementQuery' })
export class CustomerAppStatementQueryDto {
  @ApiProperty({ format: 'date', description: 'The first day (Ulaanbaatar)' })
  @Matches(ISO_DATE)
  from: string;
  @ApiProperty({
    format: 'date',
    description: 'The last day (Ulaanbaatar), today at the latest; at most 366 days',
  })
  @Matches(ISO_DATE)
  to: string;
}

@ApiSchema({ name: 'CustomerAppStatementEntry' })
export class CustomerAppStatementEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty({ enum: AR_ENTRY_KINDS }) kind: ArEntryKind;
  @ApiProperty({ example: 'Н-20261019-0001' }) number: string;
  @ApiProperty({ type: Number, nullable: true, description: 'The invoice it opens' })
  invoiceId: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'A purchase’s order' })
  orderId: number | null;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty({ enum: ORDER_CHANNELS, nullable: true, description: 'Who took the order' })
  orderChannel: OrderChannel | null;
  @ApiProperty({ type: String, nullable: true, description: 'The rep of a SALES_REP order' })
  orderTakerName: string | null;
  @ApiProperty({ example: '350000.00', description: '«Дебит»: a purchase or a refund' })
  debit: string;
  @ApiProperty({ example: '0.00', description: '«Кредит»: a payment or a return' })
  credit: string;
  @ApiProperty({ description: 'The balance after it' }) balance: string;
}

@ApiSchema({ name: 'CustomerAppStatement' })
export class CustomerAppStatementDto {
  @ApiProperty({ format: 'date' }) from: string;
  @ApiProperty({ format: 'date' }) to: string;
  @ApiProperty({ description: '«Эхний үлдэгдэл»: the balance before from; negative = an advance' })
  opening: string;
  @ApiProperty({ type: [CustomerAppStatementEntryDto], description: 'Oldest first' })
  entries: CustomerAppStatementEntryDto[];
  @ApiProperty() totalDebit: string;
  @ApiProperty() totalCredit: string;
  @ApiProperty({ description: '«Эцсийн үлдэгдэл»: the balance after to' }) closing: string;
}

@ApiSchema({ name: 'CustomerAppBankAccount' })
export class CustomerAppBankAccountDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) bankName: string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccountNo: string | null;
}

// ---------------------------------------------------------------------------- the notifications

@ApiSchema({ name: 'CustomerAppNotice' })
export class CustomerAppNoticeDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: NOTICE_KINDS }) kind: NoticeKind;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null;
  @ApiProperty() popup: boolean;
  @ApiProperty({ format: 'date' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
  @ApiProperty({ type: [Number], description: '«Бараа харах»' }) productIds: number[];
  @ApiProperty() read: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'CustomerAppNotificationSummary' })
export class CustomerAppNotificationSummaryDto {
  @ApiProperty({ description: 'The bell’s count' }) unread: number;
  @ApiProperty({ type: [CustomerAppNoticeDto] }) notices: CustomerAppNoticeDto[];
}

@ApiSchema({ name: 'CustomerAppNotification' })
export class CustomerAppNotificationDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: CUSTOMER_NOTIFICATION_KINDS, enumName: 'CustomerNotificationKind' })
  kind: CustomerNotificationKind;
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty({ type: Number, nullable: true }) invoiceId: number | null;
  @ApiProperty({ type: Number, nullable: true }) paymentId: number | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'By kind: orderNumber, orderTotal, backorderedLines, backordered[], reason, invoiceNumber, invoiceTotal, paymentNumber, amount, paidOn, method, invoices[], dueDate, openAmount',
  })
  payload: Record<string, unknown>;
  @ApiProperty() read: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'CustomerAppNotificationPage' })
export class CustomerAppNotificationPageDto {
  @ApiProperty({ type: [CustomerAppNotificationDto] }) data: CustomerAppNotificationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'CustomerAppReadRequest' })
export class CustomerAppReadRequestDto {
  @ApiPropertyOptional({ type: [Number], maxItems: NOTICE_LIMITS.readMax })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTICE_LIMITS.readMax)
  @IsInt({ each: true })
  @Min(1, { each: true })
  noticeIds?: number[];

  @ApiPropertyOptional({ type: [Number], maxItems: NOTICE_LIMITS.readMax })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTICE_LIMITS.readMax)
  @IsInt({ each: true })
  @Min(1, { each: true })
  notificationIds?: number[];
}

@ApiSchema({ name: 'CustomerAppReadResult' })
export class CustomerAppReadResultDto {
  @ApiProperty() unread: number;
}

// --------------------------------------------------------------------------- «Холбоо барих»

@ApiSchema({ name: 'CompanyContact' })
export class CompanyContactDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Захиалга, оффис' }) role: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+97699112233' }) phone: string;
  @ApiProperty({ description: 'Listed in the app' }) shown: boolean;
}

@ApiSchema({ name: 'CompanyContactRequest' })
export class CompanyContactRequestDto {
  @ApiProperty({ maxLength: CONTACT_LIMITS.maxRole })
  @Transform(trimmed)
  @IsString()
  @MaxLength(CONTACT_LIMITS.maxRole)
  role: string;
  @ApiProperty({ maxLength: CONTACT_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MaxLength(CONTACT_LIMITS.maxName)
  name: string;
  @ApiProperty({ example: '99112233', description: 'A Mongolian mobile number' })
  @IsString()
  @MaxLength(32)
  phone: string;
  @ApiProperty() @IsBoolean() shown: boolean;
}

@ApiSchema({ name: 'CompanyContactsRequest' })
export class CompanyContactsRequestDto {
  @ApiProperty({
    type: [CompanyContactRequestDto],
    maxItems: CONTACT_LIMITS.maxContacts,
    description: 'The whole list, in its order',
  })
  @IsArray()
  @ArrayMaxSize(CONTACT_LIMITS.maxContacts)
  @ValidateNested({ each: true })
  @Type(() => CompanyContactRequestDto)
  contacts: CompanyContactRequestDto[];
}

@ApiSchema({ name: 'CustomerAppAttention' })
export class CustomerAppAttentionDto {
  @ApiProperty({ description: 'Stores whose app account is open' }) activeAccounts: number;
  @ApiProperty({ description: 'A stage without an action takes app orders' }) ordersOpen: boolean;
}
