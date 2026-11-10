import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  VISIT_NOTE_MAX,
  VISIT_PLAN_MAX,
  VISIT_RESULTS,
  type VisitResult,
} from '@tugeel/shared/sales';
import { Type } from 'class-transformer';
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
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@ApiSchema({ name: 'RepVisitCustomer' })
export class RepVisitCustomerDto {
  @ApiProperty() customerId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ description: "On the accountant's credit hold" }) creditHold: boolean;
}

@ApiSchema({ name: 'RepPlanDay' })
export class RepPlanDayDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: '1 = Monday' }) weekday: number;
  @ApiProperty({ type: [RepVisitCustomerDto] }) customers: RepVisitCustomerDto[];
}

@ApiSchema({ name: 'RepPlanDayRequest' })
export class RepPlanDayRequestDto {
  @ApiProperty({ type: [Number], maxItems: VISIT_PLAN_MAX, description: 'In visiting order' })
  @IsArray()
  @ArrayMaxSize(VISIT_PLAN_MAX)
  @IsInt({ each: true })
  @Min(1, { each: true })
  customerIds: number[];
}

@ApiSchema({ name: 'RepRef' })
export class RepRefDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}

@ApiSchema({ name: 'RepTodayVisit' })
export class RepTodayVisitDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: VISIT_RESULTS }) result: VisitResult;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) visitedAt: string;
}

@ApiSchema({ name: 'RepTodayStop' })
export class RepTodayStopDto extends RepVisitCustomerDto {
  @ApiProperty({ description: "On the weekday's plan" }) planned: boolean;
  @ApiProperty({ type: RepTodayVisitDto, nullable: true, description: 'The last visit of the day' })
  visit: RepTodayVisitDto | null;
}

@ApiSchema({ name: 'RepToday' })
export class RepTodayDto {
  @ApiProperty({ type: String, format: 'date' }) date: string;
  @ApiProperty({ minimum: 1, maximum: 7 }) weekday: number;
  @ApiProperty({ type: [RepTodayStopDto] }) stops: RepTodayStopDto[];
}

@ApiSchema({ name: 'RepVisitRequest' })
export class RepVisitRequestDto {
  @ApiProperty() @IsInt() @Min(1) customerId: number;
  @ApiProperty({ enum: VISIT_RESULTS }) @IsIn(VISIT_RESULTS) result: VisitResult;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: VISIT_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(VISIT_NOTE_MAX)
  note?: string | null;
}

@ApiSchema({ name: 'RepVisit' })
export class RepVisitDto {
  @ApiProperty() id: number;
  @ApiProperty() userId: number;
  @ApiProperty() userName: string;
  @ApiProperty({ type: RepVisitCustomerDto }) customer: RepVisitCustomerDto;
  @ApiProperty({ type: String, format: 'date' }) visitedOn: string;
  @ApiProperty({ type: String, format: 'date-time' }) visitedAt: string;
  @ApiProperty({ enum: VISIT_RESULTS }) result: VisitResult;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

@ApiSchema({ name: 'RepVisitPage' })
export class RepVisitPageDto {
  @ApiProperty({ type: [RepVisitDto] }) data: RepVisitDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'RepVisitSummaryRow' })
export class RepVisitSummaryRowDto {
  @ApiProperty() userId: number;
  @ApiProperty() userName: string;
  @ApiProperty({ enum: VISIT_RESULTS }) result: VisitResult;
  @ApiProperty() visits: number;
  @ApiProperty({ description: 'Different stores among them' }) stores: number;
}

export class RepVisitQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) userId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(ISO_DATE) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(ISO_DATE) to?: string;
}
