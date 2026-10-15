import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  BOARD_LIMITS,
  FULFILMENTS,
  type Fulfilment,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  STAGE_ACTIONS,
  type StageAction,
} from '@tugeel/shared/sales';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'SalesBoardRequest' })
export class SalesBoardRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The branch the board is for' })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number | null;
}

@ApiSchema({ name: 'SalesBoardRolesRequest' })
export class SalesBoardRolesRequestDto {
  @ApiProperty({ type: [Number], description: 'Roles that see the board; none = everyone' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  VIEW: number[];
  @ApiProperty({ type: [Number], description: 'Roles that configure it' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  MANAGE: number[];
}

@ApiSchema({ name: 'SalesStageRoles' })
export class SalesStageRolesDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  VIEW: number[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  EDIT: number[];
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  MOVE: number[];
}

@ApiSchema({ name: 'SalesStageRequest' })
export class SalesStageRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiProperty({ enum: STAGE_ACTIONS }) @IsIn(STAGE_ACTIONS) action: StageAction;
  @ApiProperty() @IsBoolean() printPickList: boolean;
  @ApiProperty() @IsBoolean() printDeliveryNote: boolean;
  @ApiProperty({ type: SalesStageRolesDto })
  @ValidateNested()
  @Type(() => SalesStageRolesDto)
  roles: SalesStageRolesDto;
}

@ApiSchema({ name: 'SalesStageOrderRequest' })
export class SalesStageOrderRequestDto {
  @ApiProperty({ type: [Number], description: 'Every live stage of the board, in its new order' })
  @IsArray()
  @ArrayMaxSize(BOARD_LIMITS.maxStages)
  @IsInt({ each: true })
  stageIds: number[];
}

@ApiSchema({ name: 'SalesChannelDefaultRequest' })
export class SalesChannelDefaultRequestDto {
  @ApiProperty({ enum: ORDER_CHANNELS }) @IsIn(ORDER_CHANNELS) channel: OrderChannel;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null clears the default' })
  @IsOptional()
  @IsInt()
  @Min(1)
  boardId?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  stageId?: number | null;
}

@ApiSchema({ name: 'SalesStage' })
export class SalesStageDto {
  @ApiProperty() id: number;
  @ApiProperty() boardId: number;
  @ApiProperty() name: string;
  @ApiProperty() position: number;
  @ApiProperty({ enum: STAGE_ACTIONS }) action: StageAction;
  @ApiProperty() printPickList: boolean;
  @ApiProperty() printDeliveryNote: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: SalesStageRolesDto }) roles: SalesStageRolesDto;
  @ApiProperty({ description: 'The caller may see the stage' }) canView: boolean;
  @ApiProperty({ description: 'The caller may edit orders in the stage' }) canEdit: boolean;
  @ApiProperty({ description: 'The caller may move cards into the stage' }) canMove: boolean;
}

@ApiSchema({ name: 'SalesBoard' })
export class SalesBoardDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty() position: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: SalesBoardRolesRequestDto }) roles: SalesBoardRolesRequestDto;
  @ApiProperty({ description: 'The caller may configure the board' }) canManage: boolean;
  @ApiProperty({ type: [SalesStageDto] }) stages: SalesStageDto[];
}

@ApiSchema({ name: 'SalesChannelDefault' })
export class SalesChannelDefaultDto {
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty() boardId: number;
  @ApiProperty() stageId: number;
}

@ApiSchema({ name: 'SalesOrderCard' })
export class SalesOrderCardDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status: OrderStatus;
  @ApiProperty({ enum: ORDER_CHANNELS }) channel: OrderChannel;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) stageEnteredAt: string;
}

@ApiSchema({ name: 'SalesStageCards' })
export class SalesStageCardsDto {
  @ApiProperty() stageId: number;
  @ApiProperty({ type: [SalesOrderCardDto], description: 'Newest first, at most 200' })
  cards: SalesOrderCardDto[];
  @ApiProperty({ description: 'Cards in the stage, also beyond the first 200' }) count: number;
  @ApiProperty({ description: 'Sum of the frozen totals, whole MNT' }) total: string;
}
