import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  NOTICE_KINDS,
  NOTICE_LIMITS,
  NOTICE_STATES,
  type NoticeKind,
  type NoticeState,
  USER_NOTIFICATION_KINDS,
  type UserNotificationKind,
} from '@tugeel/shared/notifications';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

// App notices (ADR-0062): the admin's routes and the app's own.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'AppNoticeRequest' })
export class AppNoticeRequestDto {
  @ApiProperty({ enum: NOTICE_KINDS }) @IsIn(NOTICE_KINDS) kind: NoticeKind;

  @ApiProperty({ maxLength: NOTICE_LIMITS.titleMax, description: 'Characters, trimmed' })
  @Transform(trimmed)
  @IsString()
  // A coarse bound: the service counts characters (code points) as the database does.
  @MaxLength(NOTICE_LIMITS.titleMax * 2)
  title: string;

  @ApiProperty({ maxLength: NOTICE_LIMITS.bodyMax, description: 'Characters, trimmed' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(NOTICE_LIMITS.bodyMax * 2)
  body: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'An uploaded file of kind notifications.notice_image',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  imageFileId?: number | null;

  @ApiProperty({
    type: [Number],
    maxItems: NOTICE_LIMITS.productsMax,
    description: 'Active, sale-ready products in the order the app shows them',
  })
  @IsArray()
  @ArrayMaxSize(NOTICE_LIMITS.productsMax)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];

  @ApiProperty({
    example: '2026-10-16',
    description: 'The first day, today or later (Ulaanbaatar)',
  })
  @Matches(ISO_DATE)
  validFrom: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2026-10-31',
    description: 'Up to, not including; null runs until withdrawn',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  validTo?: string | null;

  @ApiProperty({ description: 'Pops up in the middle of the screen when the app opens' })
  @IsBoolean()
  popup: boolean;
}

@ApiSchema({ name: 'AppNoticeProduct' })
export class AppNoticeProductDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

@ApiSchema({ name: 'AppNotice' })
export class AppNoticeDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: NOTICE_KINDS }) kind: NoticeKind;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, nullable: true, description: 'Relative to the server' })
  imageUrl: string | null;
  @ApiProperty() popup: boolean;
  @ApiProperty({ format: 'date' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
  @ApiProperty({ enum: NOTICE_STATES, description: 'On the business date of the answer' })
  state: NoticeState;
  @ApiProperty({ type: [AppNoticeProductDto], description: 'In the order the admin chose' })
  products: AppNoticeProductDto[];
  @ApiProperty({ description: 'Active holders of sales.orders.rep beside ADMIN' })
  recipients: number;
  @ApiProperty({ description: 'Those recipients who read or closed it' }) reads: number;
  @ApiProperty() createdBy: number;
  @ApiProperty() createdByName: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) withdrawnAt: string | null;
  @ApiProperty({ type: String, nullable: true }) withdrawnByName: string | null;
}

@ApiSchema({ name: 'AppNoticePage' })
export class AppNoticePageDto {
  @ApiProperty({ type: [AppNoticeDto] }) data: AppNoticeDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'MyNotice' })
export class MyNoticeDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: NOTICE_KINDS }) kind: NoticeKind;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ type: String, nullable: true, description: 'Relative to the server' })
  imageUrl: string | null;
  @ApiProperty() popup: boolean;
  @ApiProperty({ format: 'date', description: 'The day it first shows' }) validFrom: string;
  @ApiProperty({ type: String, nullable: true, description: 'Up to, not including' })
  validTo: string | null;
  @ApiProperty({ type: [Number], description: 'In the order the admin chose' })
  productIds: number[];
  @ApiProperty() read: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'MyNotificationSummary' })
export class MyNotificationSummaryDto {
  @ApiProperty({ description: 'Unread running notices plus unread own notifications' })
  unread: number;
  @ApiProperty({
    type: [MyNoticeDto],
    description: `The running notices, newest first (at most ${NOTICE_LIMITS.summaryMax})`,
  })
  notices: MyNoticeDto[];
}

@ApiSchema({ name: 'MyNotification' })
export class MyNotificationDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: USER_NOTIFICATION_KINDS }) kind: UserNotificationKind;
  @ApiProperty({ type: Number, nullable: true }) orderId: number | null;
  @ApiProperty() orderNumber: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ type: String, nullable: true, description: 'Whole MNT, frozen at the submit' })
  orderTotal: string | null;
  @ApiProperty({ type: String, nullable: true }) invoiceNumber: string | null;
  @ApiProperty() read: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'MyNotificationPage' })
export class MyNotificationPageDto {
  @ApiProperty({ type: [MyNotificationDto] }) data: MyNotificationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'MyNotificationReadRequest' })
export class MyNotificationReadRequestDto {
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

@ApiSchema({ name: 'MyNotificationReadResult' })
export class MyNotificationReadResultDto {
  @ApiProperty({ description: 'The unread count after marking' }) unread: number;
}
