import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BulkProductsDto } from '../../../common/bulk/bulk.dto';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';
import { PARTNER_STATUSES } from '../schema';
import { CODE, ContactDto, ListContactDto, trimmed } from './common.dto';

type PartnerStatus = (typeof PARTNER_STATUSES)[number];

@ApiSchema({ name: 'SupplierSummary' })
export class SupplierSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) tin: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ description: 'A VAT payer: delivery-note prices hold VAT (ADR-0078)' })
  vatPayer: boolean;
  @ApiProperty({ enum: PARTNER_STATUSES }) status: PartnerStatus;
}

@ApiSchema({ name: 'SupplierDetail' })
export class SupplierDetailDto extends SupplierSummaryDto {
  @ApiProperty({ type: String, nullable: true }) regNo: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ type: String, nullable: true }) bankName: string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccount: string | null;
  @ApiProperty({ type: Number, nullable: true }) paymentTermDays: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [ContactDto] }) contacts: ContactDto[];
}

/** A row of the supplier list screen: the summary plus every other field (ADR-0037). */
@ApiSchema({ name: 'SupplierListItem' })
export class SupplierListItemDto extends SupplierSummaryDto {
  @ApiProperty({ type: String, nullable: true }) regNo: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ type: String, nullable: true }) bankName: string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccount: string | null;
  @ApiProperty({ type: Number, nullable: true }) paymentTermDays: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: ListContactDto, nullable: true, description: 'The first contact' })
  contact: ListContactDto | null;
  @ApiProperty({ description: 'Products linked to the supplier' }) productCount: number;
}

@ApiSchema({ name: 'SupplierPage' })
export class SupplierPageDto {
  @ApiProperty({ type: [SupplierListItemDto] }) data: SupplierListItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

class SupplierFieldsDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Registration number' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  regNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '11–14 digits' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tin?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Mongolian mobile number' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  bankName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Account number or IBAN; spaces are removed',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankAccount?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Days we have to pay them' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number | null;

  @ApiPropertyOptional({ description: 'A VAT payer (ADR-0078); omitted on create: no' })
  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

@ApiSchema({ name: 'SupplierCreateRequest' })
export class CreateSupplierDto extends SupplierFieldsDto {
  @ApiPropertyOptional({ pattern: CODE.source, description: 'Omitted: the next free number' })
  @IsOptional()
  @Matches(CODE)
  code?: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

@ApiSchema({ name: 'SupplierUpdateRequest' })
export class UpdateSupplierDto extends SupplierFieldsDto {
  @ApiPropertyOptional({ pattern: CODE.source }) @IsOptional() @Matches(CODE) code?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: PARTNER_STATUSES })
  @IsOptional()
  @IsIn(PARTNER_STATUSES)
  status?: PartnerStatus;
}

export class SupplierListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Name in either script, code, phone, TIN or registration number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PARTNER_STATUSES })
  @IsOptional()
  @IsIn(PARTNER_STATUSES)
  status?: PartnerStatus;

  @ApiPropertyOptional({ description: 'A saved supplier segment (ADR-0049)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  segmentId?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Only these suppliers (1–200 ids, ADR-0037 batch read): names of a filter',
  })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  ids?: number[];
}

@ApiSchema({ name: 'LinkedSupplier' })
export class LinkedSupplierDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: PARTNER_STATUSES }) status: PartnerStatus;
}

@ApiSchema({ name: 'ProductSupplierLink' })
export class ProductSupplierLinkDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty({ description: 'The supplier the product is usually ordered from' }) isMain: boolean;
  @ApiProperty({ type: LinkedSupplierDto }) supplier: LinkedSupplierDto;
}

@ApiSchema({ name: 'ProductSupplierList' })
export class ProductSupplierListDto {
  @ApiProperty({ type: [ProductSupplierLinkDto] }) data: ProductSupplierLinkDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the list is short' })
  nextCursor: null;
}

@ApiSchema({ name: 'ProductSupplierRequest' })
export class LinkRequestDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty() @IsInt() @Min(1) supplierId: number;
}

/** One product, or several (the product list, ADR-0037): exactly one of the two. */
export class ProductSuppliersQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: MAX_PAGE_LIMIT,
    description: 'Repeated: productIds=1&productIds=2',
  })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];
}

@ApiSchema({ name: 'SupplierProductItem' })
export class SupplierProductItemDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
  @ApiProperty({ description: 'Name of the base unit' }) baseUnitName: string;
}

@ApiSchema({ name: 'SupplierProduct' })
export class SupplierProductDto {
  @ApiProperty() linkId: number;
  @ApiProperty() isMain: boolean;
  @ApiProperty({ type: SupplierProductItemDto }) product: SupplierProductItemDto;
}

@ApiSchema({ name: 'SupplierProductPage' })
export class SupplierProductPageDto {
  @ApiProperty({ type: [SupplierProductDto] }) data: SupplierProductDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

/** Makes a supplier the main one of ticked products (ADR-0051). */
@ApiSchema({ name: 'BulkMainSupplierRequest' })
export class BulkMainSupplierDto extends BulkProductsDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplierId: number;
}
