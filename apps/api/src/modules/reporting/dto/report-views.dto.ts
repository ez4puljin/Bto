import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  PERIOD_PRESETS,
  type PeriodPreset,
  REPORT_VIEW_NAME_MAX_LENGTH,
  REPORT_VIEW_PAGE_KEYS,
  REPORT_VIEW_QUERY_MAX_LENGTH,
  type ReportViewPage,
} from '@tugeel/shared/reports';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** An address's parameters are already encoded: printable ASCII without spaces. */
const QUERY = /^[\x21-\x7e]*$/;
const hasPeriod = (body: { period?: unknown }) => body.period !== null && body.period !== undefined;

@ApiSchema({ name: 'ReportViewsQuery' })
export class ReportViewsQueryDto {
  @ApiProperty({ enum: REPORT_VIEW_PAGE_KEYS })
  @IsIn(REPORT_VIEW_PAGE_KEYS)
  page: ReportViewPage;
}

@ApiSchema({ name: 'ReportViewCreateRequest' })
export class CreateReportViewDto {
  @ApiProperty({ enum: REPORT_VIEW_PAGE_KEYS })
  @IsIn(REPORT_VIEW_PAGE_KEYS)
  page: ReportViewPage;

  @ApiProperty({ maxLength: REPORT_VIEW_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(REPORT_VIEW_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    maxLength: REPORT_VIEW_QUERY_MAX_LENGTH,
    description: 'The page’s address parameters as the browser writes them',
  })
  @IsString()
  @MaxLength(REPORT_VIEW_QUERY_MAX_LENGTH)
  @Matches(QUERY)
  query: string;

  @ApiProperty({
    enum: PERIOD_PRESETS,
    nullable: true,
    description: 'A period that moves with the calendar; null keeps the dates of `query`',
  })
  @ValidateIf(hasPeriod)
  @IsIn(PERIOD_PRESETS)
  period: PeriodPreset | null;

  @ApiProperty({ description: 'Shown to everyone who may open the page' })
  @IsBoolean()
  shared: boolean;
}

@ApiSchema({ name: 'ReportViewUpdateRequest' })
export class UpdateReportViewDto {
  @ApiPropertyOptional({ maxLength: REPORT_VIEW_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(REPORT_VIEW_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: REPORT_VIEW_QUERY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(REPORT_VIEW_QUERY_MAX_LENGTH)
  @Matches(QUERY)
  query?: string;

  @ApiPropertyOptional({ enum: PERIOD_PRESETS, nullable: true })
  @ValidateIf(hasPeriod)
  @IsIn(PERIOD_PRESETS)
  period?: PeriodPreset | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

@ApiSchema({ name: 'ReportViewAuthor' })
export class ReportViewAuthorDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}

@ApiSchema({ name: 'ReportView' })
export class ReportViewDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: REPORT_VIEW_PAGE_KEYS }) page: ReportViewPage;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Address parameters, without the dates when `period` is set' })
  query: string;
  @ApiProperty({ enum: PERIOD_PRESETS, nullable: true }) period: PeriodPreset | null;
  @ApiProperty() shared: boolean;
  @ApiProperty({ description: 'The caller made it' }) mine: boolean;
  @ApiProperty({ description: 'The caller may change it' }) editable: boolean;
  @ApiProperty({ description: 'The caller may delete it' }) removable: boolean;
  @ApiProperty({ type: ReportViewAuthorDto }) createdBy: ReportViewAuthorDto;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'ReportViewList' })
export class ReportViewListDto {
  @ApiProperty({ type: [ReportViewDto] }) data: ReportViewDto[];
}
