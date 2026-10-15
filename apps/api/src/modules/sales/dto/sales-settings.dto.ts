import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { ORDER_CHANNELS, ORDER_NUMBER_LIMITS, type OrderChannel } from '@tugeel/shared/sales';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'SalesNumbering' })
export class SalesNumberingDto {
  @ApiProperty({ example: '{year}{month}{day}_' }) pattern: string;
  @ApiProperty({ example: 4 }) digits: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

@ApiSchema({ name: 'SalesNumberingRequest' })
export class SalesNumberingRequestDto {
  @ApiProperty({
    example: '{year}{month}{day}_',
    description: 'Literal characters and {year}, {month}, {day}; ends with a non-digit',
  })
  @Transform(trimmed)
  @IsString()
  @MaxLength(ORDER_NUMBER_LIMITS.maxPattern)
  pattern: string;
  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(ORDER_NUMBER_LIMITS.minDigits)
  @Max(ORDER_NUMBER_LIMITS.maxDigits)
  digits: number;
}

@ApiSchema({ name: 'SalesChannelDefault' })
export class SalesChannelDefaultDto {
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty() pipelineId: number;
  @ApiProperty() stageId: number;
}

@ApiSchema({ name: 'SalesChannelDefaultRequest' })
export class SalesChannelDefaultRequestDto {
  @ApiProperty({ enum: ORDER_CHANNELS }) @IsIn(ORDER_CHANNELS) channel: OrderChannel;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null clears the default' })
  @IsOptional()
  @IsInt()
  @Min(1)
  pipelineId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  stageId?: number | null;
}
