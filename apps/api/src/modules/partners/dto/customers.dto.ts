import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SETTLEMENT_GROUPS, type SettlementGroup } from '@tugeel/shared/finance';
import { CUSTOMER_KINDS, type CustomerKind } from '@tugeel/shared/taxpayer';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { GPS_SOURCES, PARTNER_STATUSES, TAX_INFO_SOURCES } from '../schema';
import {
  CODE,
  COORDINATE,
  ContactDto,
  ListContactDto,
  MONEY,
  queryBoolean,
  trimmed,
} from './common.dto';

type PartnerStatus = (typeof PARTNER_STATUSES)[number];

@ApiSchema({ name: 'CustomerAddressRequest' })
export class AddressRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  label?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: COORDINATE.source,
    example: '47.918412',
  })
  @IsOptional()
  @Matches(COORDINATE)
  lat?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: COORDINATE.source,
    example: '106.917712',
  })
  @IsOptional()
  @Matches(COORDINATE)
  lng?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, description: 'Landmark' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

@ApiSchema({ name: 'CustomerAddressCreateRequest' })
export class CreateAddressDto extends AddressRequestDto {
  @ApiPropertyOptional({ description: 'Make it the default address' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@ApiSchema({ name: 'CustomerAddress' })
export class AddressDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) label: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ type: String, nullable: true, example: '47.918412' }) lat: string | null;
  @ApiProperty({ type: String, nullable: true, example: '106.917712' }) lng: string | null;
  @ApiProperty({ enum: GPS_SOURCES, nullable: true }) gpsSource:
    (typeof GPS_SOURCES)[number] | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Delivery zone (delivery 5)' })
  zoneId: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() isDefault: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
}

@ApiSchema({ name: 'CustomerOverdue' })
export class CustomerOverdueDto {
  @ApiProperty({ example: '50000', description: 'Open invoices past their due date, whole MNT' })
  amount: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) oldestDueDate: string | null;
}

@ApiSchema({ name: 'CustomerSummary' })
export class CustomerSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty({ enum: CUSTOMER_KINDS }) kind: CustomerKind;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) regNo: string | null;
  @ApiProperty({ type: String, nullable: true }) tin: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ enum: PARTNER_STATUSES }) status: PartnerStatus;
  @ApiProperty() creditHold: boolean;
  @ApiProperty({ description: 'A company without a TIN: receipts wait for it' })
  tinPending: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Text of the default address' })
  address: string | null;
  @ApiProperty({ description: 'The default address has a GPS point' }) hasGps: boolean;
}

@ApiSchema({ name: 'CustomerDetail' })
export class CustomerDetailDto extends CustomerSummaryDto {
  @ApiProperty({ enum: TAX_INFO_SOURCES, nullable: true })
  tinSource: (typeof TAX_INFO_SOURCES)[number] | null;
  @ApiProperty({ type: String, nullable: true }) consumerNo: string | null;
  @ApiProperty() vatPayer: boolean;
  @ApiProperty() cityPayer: boolean;
  @ApiProperty({ enum: TAX_INFO_SOURCES, nullable: true, description: 'null = not checked yet' })
  taxStatusSource: (typeof TAX_INFO_SOURCES)[number] | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  taxStatusCheckedAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '5000000.00',
    description: 'null = not decided',
  })
  creditLimit: string | null;
  @ApiProperty({
    enum: SETTLEMENT_GROUPS,
    description:
      'DAY_20 «Мөрөн»: purchases of the 21st–20th due on the 20th; MONTH_END «Орон нутаг»: a month due on its last day (ADR-0101)',
  })
  settlementGroup: SettlementGroup;
  @ApiProperty({ type: String, nullable: true }) creditHoldReason: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The customer category (ADR-0107)' })
  categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [AddressDto], description: 'Active addresses, the default first' })
  addresses: AddressDto[];
  @ApiProperty({ type: [ContactDto] }) contacts: ContactDto[];
}

@ApiSchema({ name: 'GpsPoint' })
export class GpsPointDto {
  @ApiProperty({ example: '47.918540' }) lat: string;
  @ApiProperty({ example: '106.917450' }) lng: string;
}

/** A row of the customer list screen: the summary plus every other field (ADR-0037). */
@ApiSchema({ name: 'CustomerListItem' })
export class CustomerListItemDto extends CustomerSummaryDto {
  @ApiProperty({ type: String, nullable: true }) consumerNo: string | null;
  @ApiProperty() vatPayer: boolean;
  @ApiProperty() cityPayer: boolean;
  @ApiProperty({ enum: TAX_INFO_SOURCES, nullable: true, description: 'null = not checked yet' })
  taxStatusSource: (typeof TAX_INFO_SOURCES)[number] | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '5000000.00',
    description: 'null = not decided',
  })
  creditLimit: string | null;
  @ApiProperty({ enum: SETTLEMENT_GROUPS }) settlementGroup: SettlementGroup;
  @ApiProperty({ type: String, nullable: true }) creditHoldReason: string | null;
  @ApiProperty({
    type: CustomerOverdueDto,
    nullable: true,
    description: 'The overdue receivable: a reminder, never a block (ADR-0101); null when none',
  })
  overdue: CustomerOverdueDto | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The customer category (ADR-0107)' })
  categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) categoryName: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({
    type: GpsPointDto,
    nullable: true,
    description: 'The point of the default address',
  })
  gps: GpsPointDto | null;
  @ApiProperty({ type: ListContactDto, nullable: true, description: 'The first contact' })
  contact: ListContactDto | null;
  @ApiProperty({
    enum: ['ACTIVE', 'DISABLED'],
    enumName: 'CustomerAppAccountStatus',
    nullable: true,
    description: 'The customer app account (ADR-0079 #11); null = not linked',
  })
  appAccount: 'ACTIVE' | 'DISABLED' | null;
}

@ApiSchema({ name: 'CustomerPage' })
export class CustomerPageDto {
  @ApiProperty({ type: [CustomerListItemDto] }) data: CustomerListItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

class CustomerFieldsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 20,
    description: 'Registration number',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(30)
  regNo?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Company 11 digits, citizen 12–14 (spaces allowed)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tin?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Citizens only, 8 digits' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  consumerNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Mongolian mobile number' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ description: 'Setting it records a manual payer check' })
  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() cityPayer?: boolean;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'An active customer category (ADR-0107); null = none',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

@ApiSchema({ name: 'CustomerCreateRequest' })
export class CreateCustomerDto extends CustomerFieldsDto {
  @ApiPropertyOptional({ pattern: CODE.source, description: 'Omitted: the next free number' })
  @IsOptional()
  @Matches(CODE)
  code?: string;

  @ApiProperty({ enum: CUSTOMER_KINDS }) @IsIn(CUSTOMER_KINDS) kind: CustomerKind;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    enum: SETTLEMENT_GROUPS,
    description:
      'DAY_20 «Мөрөн»: purchases of the 21st–20th due on the 20th; MONTH_END «Орон нутаг»: a month due on its last day (ADR-0101)',
  })
  @IsIn(SETTLEMENT_GROUPS)
  settlementGroup: SettlementGroup;

  @ApiPropertyOptional({ type: AddressRequestDto, description: 'The first, default address' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressRequestDto)
  address?: AddressRequestDto;
}

@ApiSchema({ name: 'CustomerUpdateRequest' })
export class UpdateCustomerDto extends CustomerFieldsDto {
  @ApiPropertyOptional({ pattern: CODE.source }) @IsOptional() @Matches(CODE) code?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_KINDS })
  @IsOptional()
  @IsIn(CUSTOMER_KINDS)
  kind?: CustomerKind;

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

@ApiSchema({ name: 'CustomerCreditRequest' })
export class CreditDto {
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY.source,
    description: 'MNT; null = not decided yet',
  })
  @IsOptional()
  @Matches(MONEY)
  creditLimit: string | null;

  @ApiProperty({
    enum: SETTLEMENT_GROUPS,
    description:
      'DAY_20 «Мөрөн»: purchases of the 21st–20th due on the 20th; MONTH_END «Орон нутаг»: a month due on its last day (ADR-0101)',
  })
  @IsIn(SETTLEMENT_GROUPS)
  settlementGroup: SettlementGroup;

  @ApiProperty() @IsBoolean() creditHold: boolean;

  @ApiProperty({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  creditHoldReason: string | null;
}

export class CustomerListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Name in either script, code, phone, TIN or registration number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_KINDS })
  @IsOptional()
  @IsIn(CUSTOMER_KINDS)
  kind?: CustomerKind;

  @ApiPropertyOptional({ enum: PARTNER_STATUSES })
  @IsOptional()
  @IsIn(PARTNER_STATUSES)
  status?: PartnerStatus;

  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() creditHold?: boolean;

  @ApiPropertyOptional({ enum: SETTLEMENT_GROUPS })
  @IsOptional()
  @IsIn(SETTLEMENT_GROUPS)
  settlementGroup?: SettlementGroup;

  @ApiPropertyOptional({ description: 'One customer category (ADR-0107)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Companies without a TIN' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  tinPending?: boolean;

  @ApiPropertyOptional({ description: 'The default address has no GPS point' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  gpsMissing?: boolean;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'DISABLED', 'NONE'],
    description: 'The customer app account: ACTIVE, DISABLED or NONE (not linked)',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED', 'NONE'])
  app?: 'ACTIVE' | 'DISABLED' | 'NONE';

  @ApiPropertyOptional({ description: 'A saved customer segment (ADR-0049)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  segmentId?: number;
}

@ApiSchema({ name: 'CustomerLookup' })
export class CustomerLookupDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class CustomerLookupQueryDto {
  @ApiPropertyOptional({ description: 'Name or code' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class NextCustomerCodeQueryDto {
  @ApiPropertyOptional({
    description: "The new customer's category: its largest code plus one (ADR-0107)",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;
}

@ApiSchema({ name: 'CustomerCategory' })
export class CustomerCategoryDto {
  @ApiProperty() id: number;
  @ApiProperty({ maxLength: 80 }) name: string;
  @ApiProperty({ description: 'false = retired: kept on its customers, left out of the pickers' })
  active: boolean;
  @ApiProperty() sortOrder: number;
}

@ApiSchema({ name: 'CustomerCategoryCreateRequest' })
export class CreateCustomerCategoryDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ description: 'Omitted: after the others' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

@ApiSchema({ name: 'CustomerCategoryUpdateRequest' })
export class UpdateCustomerCategoryDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
