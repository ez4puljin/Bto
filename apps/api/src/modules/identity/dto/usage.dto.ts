import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { USAGE, USAGE_APPS, type UsageApp } from '@tugeel/shared/usage';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** A screen name as the clients make it: `/sales/orders/:id`. */
const SCREEN = /^\/([a-z0-9:_-]+(\/[a-z0-9:_-]+)*)?$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

@ApiSchema({ name: 'ScreenUsageEvent' })
export class ScreenUsageEventDto {
  @ApiProperty({ maxLength: USAGE.screenMax, example: '/sales/orders/:id' })
  @IsString()
  @MaxLength(USAGE.screenMax)
  @Matches(SCREEN)
  screen: string;

  @ApiProperty({
    minimum: 0,
    maximum: USAGE.maxOpensPerEvent,
    description: '0 for a screen that only stayed open since the last send',
  })
  @IsInt()
  @Min(0)
  @Max(USAGE.maxOpensPerEvent)
  opens: number;

  @ApiProperty({ minimum: 0, description: 'Seconds the screen stood open, all its opens together' })
  @IsInt()
  @Min(0)
  @Max(USAGE.maxSecondsPerOpen * USAGE.maxOpensPerEvent)
  seconds: number;
}

@ApiSchema({ name: 'ScreenUsageRequest' })
export class ScreenUsageRequestDto {
  @ApiProperty({ enum: USAGE_APPS })
  @IsIn(USAGE_APPS)
  app: UsageApp;

  @ApiProperty({ type: [ScreenUsageEventDto], maxItems: USAGE.maxEvents })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(USAGE.maxEvents)
  @ValidateNested({ each: true })
  @Type(() => ScreenUsageEventDto)
  events: ScreenUsageEventDto[];
}

@ApiSchema({ name: 'ScreenUsageQuery' })
export class ScreenUsageQueryDto {
  @ApiProperty({ example: '2026-11-01' }) @Matches(DATE) from: string;
  @ApiProperty({ example: '2026-11-30' }) @Matches(DATE) to: string;
}

@ApiSchema({ name: 'ScreenUsageRow' })
export class ScreenUsageRowDto {
  @ApiProperty({ enum: USAGE_APPS }) app: UsageApp;
  @ApiProperty() screen: string;
  @ApiProperty() opens: number;
  @ApiProperty() seconds: number;
  @ApiProperty({ description: 'Different people who opened it' }) people: number;
}

@ApiSchema({ name: 'ScreenUsageList' })
export class ScreenUsageListDto {
  @ApiProperty({ type: [ScreenUsageRowDto] }) data: ScreenUsageRowDto[];
}
