import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  BOARD_LIMITS,
  CARD_SORTS,
  type CardSort,
  FULFILMENTS,
  type Fulfilment,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
  PIPELINE_VISIBILITIES,
  type PipelineVisibility,
  PIPELINE_KINDS,
  type PipelineKind,
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const flag = ({ value }: { value: unknown }) => value === true || value === 'true';

// ---------------------------------------------------------------------------------------------
// Boards

@ApiSchema({ name: 'SalesBoardRequest' })
export class SalesBoardRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The branch the board is for' })
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number | null;
}

@ApiSchema({ name: 'SalesBoardTreeQuery' })
export class SalesBoardTreeQueryDto {
  @ApiPropertyOptional({ description: 'Managers: archived boards and pipelines too' })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  archived?: boolean;
}

@ApiSchema({ name: 'SalesPipelineSummary' })
export class SalesPipelineSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() boardId: number;
  @ApiProperty() name: string;
  @ApiProperty() position: number;
  @ApiProperty({ enum: PIPELINE_VISIBILITIES }) visibility: PipelineVisibility;
  @ApiProperty() ownOrdersOnly: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ description: 'The caller may configure it' }) canManage: boolean;
}

@ApiSchema({ name: 'SalesBoard' })
export class SalesBoardDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: Number, nullable: true }) branchId: number | null;
  @ApiProperty() position: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: [SalesPipelineSummaryDto], description: 'The pipelines the caller sees' })
  pipelines: SalesPipelineSummaryDto[];
}

@ApiSchema({ name: 'SalesCreated' })
export class SalesCreatedDto {
  @ApiProperty() id: number;
}

// ---------------------------------------------------------------------------------------------
// Pipelines and stages

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

@ApiSchema({ name: 'SalesPipelineRoles' })
export class SalesPipelineRolesDto {
  @ApiProperty({ type: [Number], description: 'A private pipeline: the roles that see it' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  VIEW: number[];
  @ApiProperty({ type: [Number], description: 'Roles that configure it and see all its orders' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  MANAGE: number[];
  @ApiProperty({
    type: [Number],
    description: 'Own orders only: the roles that still see every order',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  ALL_ORDERS: number[];
}

@ApiSchema({ name: 'SalesStageInput' })
export class SalesStageInputDto {
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'A live stage; none = new' })
  @IsOptional()
  @IsInt()
  @Min(1)
  id?: number | null;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiProperty({ enum: STAGE_ACTIONS }) @IsIn(STAGE_ACTIONS) action: StageAction;
  @ApiProperty() @IsBoolean() printPickList: boolean;
  @ApiProperty() @IsBoolean() printDeliveryNote: boolean;
  @ApiProperty({ type: SalesStageRolesDto })
  @ValidateNested()
  @Type(() => SalesStageRolesDto)
  roles: SalesStageRolesDto;
}

@ApiSchema({ name: 'SalesPipelineRequest' })
export class SalesPipelineRequestDto {
  @ApiProperty() @IsInt() @Min(1) boardId: number;
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiProperty({ enum: PIPELINE_VISIBILITIES })
  @IsIn(PIPELINE_VISIBILITIES)
  visibility: PipelineVisibility;
  @ApiProperty() @IsBoolean() ownOrdersOnly: boolean;
  @ApiPropertyOptional({
    enum: PIPELINE_KINDS,
    description: 'SALES (default) or TRANSFER (ADR-0126)',
  })
  @IsOptional()
  @IsIn(PIPELINE_KINDS)
  kind?: PipelineKind;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'The STORE warehouse a TRANSFER stage moves the picked goods into (ADR-0125)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  transferWarehouseId?: number | null;
  @ApiProperty({ type: SalesPipelineRolesDto })
  @ValidateNested()
  @Type(() => SalesPipelineRolesDto)
  roles: SalesPipelineRolesDto;
  @ApiProperty({ type: [SalesStageInputDto], description: 'Every stage, in its order' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BOARD_LIMITS.maxStages)
  @ValidateNested({ each: true })
  @Type(() => SalesStageInputDto)
  stages: SalesStageInputDto[];
}

@ApiSchema({ name: 'SalesPipelineCopyRequest' })
export class SalesPipelineCopyRequestDto {
  @ApiProperty() @Transform(trimmed) @IsString() @MaxLength(BOARD_LIMITS.maxName) name: string;
  @ApiProperty() @IsInt() @Min(1) boardId: number;
}

@ApiSchema({ name: 'SalesStageSortRequest' })
export class SalesStageSortRequestDto {
  @ApiProperty({ enum: CARD_SORTS }) @IsIn(CARD_SORTS) sort: CardSort;
}

@ApiSchema({ name: 'SalesStage' })
export class SalesStageDto {
  @ApiProperty() id: number;
  @ApiProperty() pipelineId: number;
  @ApiProperty() name: string;
  @ApiProperty() position: number;
  @ApiProperty({ enum: STAGE_ACTIONS }) action: StageAction;
  @ApiProperty() printPickList: boolean;
  @ApiProperty() printDeliveryNote: boolean;
  @ApiProperty({ enum: CARD_SORTS }) cardSort: CardSort;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: SalesStageRolesDto }) roles: SalesStageRolesDto;
  @ApiProperty({ description: 'The caller may see the stage' }) canView: boolean;
  @ApiProperty({ description: 'The caller may edit orders in the stage' }) canEdit: boolean;
  @ApiProperty({ description: 'The caller may move cards into the stage' }) canMove: boolean;
}

@ApiSchema({ name: 'SalesPipeline' })
export class SalesPipelineDto {
  @ApiProperty() id: number;
  @ApiProperty() boardId: number;
  @ApiProperty() name: string;
  @ApiProperty() position: number;
  @ApiProperty({ enum: PIPELINE_VISIBILITIES }) visibility: PipelineVisibility;
  @ApiProperty() ownOrdersOnly: boolean;
  @ApiProperty({ enum: PIPELINE_KINDS }) kind: PipelineKind;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The STORE warehouse a TRANSFER stage moves the picked goods into (ADR-0125)',
  })
  transferWarehouseId: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: SalesPipelineRolesDto }) roles: SalesPipelineRolesDto;
  @ApiProperty({ description: 'The caller may configure the pipeline' }) canManage: boolean;
  @ApiProperty({ description: 'The caller sees every order, not only their own' }) seesAll: boolean;
  @ApiProperty({ type: [SalesStageDto], description: 'By position, archived ones included' })
  stages: SalesStageDto[];
}

// ---------------------------------------------------------------------------------------------
// Cards and the filters the board and the list share

@ApiSchema({ name: 'SalesOrderFiltersQuery' })
export class SalesOrderFiltersQueryDto {
  @ApiPropertyOptional({ description: 'Part of the number, or of a customer name, code or phone' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @ApiPropertyOptional({ description: 'Only the orders the caller entered' })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  mine?: boolean;
  @ApiPropertyOptional({ enum: ORDER_CHANNELS })
  @IsOptional()
  @IsIn(ORDER_CHANNELS)
  channel?: OrderChannel;
  @ApiPropertyOptional({ enum: FULFILMENTS })
  @IsOptional()
  @IsIn(FULFILMENTS)
  fulfilment?: Fulfilment;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(DATE) deliveryFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(DATE) deliveryTo?: string;
}

@ApiSchema({ name: 'SalesCustomerOverdue' })
export class SalesCustomerOverdueDto {
  @ApiProperty({ example: '50000', description: 'Open invoices past their due date, whole MNT' })
  amount: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) oldestDueDate: string | null;
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
  @ApiProperty({
    type: SalesCustomerOverdueDto,
    nullable: true,
    description: "The customer's overdue receivable: a red reminder, never a block (ADR-0101)",
  })
  customerOverdue: SalesCustomerOverdueDto | null;
  @ApiProperty({ enum: FULFILMENTS }) fulfilment: Fulfilment;
  @ApiProperty({ enum: PAYMENT_METHODS, description: "The card's label (ADR-0058)" })
  paymentMethod: PaymentMethod;
  @ApiProperty({ format: 'date' }) deliveryDate: string;
  @ApiProperty({ type: String, nullable: true }) total: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) stageEnteredAt: string;
}

@ApiSchema({ name: 'SalesStageCards' })
export class SalesStageCardsDto {
  @ApiProperty() stageId: number;
  @ApiProperty({ type: [SalesOrderCardDto], description: "In the stage's sort, at most 200" })
  cards: SalesOrderCardDto[];
  @ApiProperty({ description: 'Cards in the stage, also beyond the first 200' }) count: number;
  @ApiProperty({ description: 'Sum of the frozen totals, whole MNT' }) total: string;
}

@ApiSchema({ name: 'SalesArchived' })
export class SalesArchivedDto {
  @ApiProperty({ description: 'Orders archived' }) archived: number;
}
