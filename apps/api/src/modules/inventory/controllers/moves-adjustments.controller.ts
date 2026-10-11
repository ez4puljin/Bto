import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  AdjustmentDetailDto,
  AdjustmentLineRequestDto,
  AdjustmentListQueryDto,
  AdjustmentPageDto,
  ApproveAdjustmentDto,
  CreateAdjustmentDto,
  UpdateAdjustmentDto,
  UpdateAdjustmentLineDto,
} from '../dto/adjustments.dto';
import {
  BinMoveDetailDto,
  BinMoveListQueryDto,
  BinMovePageDto,
  CreateBinMoveDto,
} from '../dto/bin-moves.dto';
import { AdjustmentsService } from '../services/adjustments.service';
import { BinMovesService } from '../services/bin-moves.service';
import {
  toAdjustmentDetailDto,
  toAdjustmentSummaryDto,
  toBinMoveDetailDto,
  toBinMoveSummaryDto,
} from './mappers';

const MOVES = 'inventory.moves.manage';
const ADJUST = 'inventory.adjustments.manage';
const APPROVE = 'inventory.adjustments.approve';

const adjustmentLineInput = (line: AdjustmentLineRequestDto) => ({
  productUnitId: line.productUnitId,
  enteredQty: new Decimal(line.enteredQty),
  binId: line.binId,
  ...(line.unitCost === undefined || line.unitCost === null
    ? {}
    : { unitCost: new Decimal(line.unitCost) }),
  ...(line.note === undefined ? {} : { note: line.note }),
});

/** Bin moves (BM-): created and posted in one idempotent request. */
@ApiTags('inventory')
@Controller('bin-moves')
export class BinMovesController {
  constructor(private readonly moves: BinMovesService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: BinMovePageDto })
  async list(@Query() query: BinMoveListQueryDto): Promise<BinMovePageDto> {
    const page = await this.moves.list(query);
    return { data: page.data.map(toBinMoveSummaryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: BinMoveDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<BinMoveDetailDto> {
    return toBinMoveDetailDto(await this.moves.get(id));
  }

  @Post()
  @RequirePermission(MOVES)
  @Idempotent()
  @ApiCreatedResponse({ type: BinMoveDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateBinMoveDto,
  ): Promise<BinMoveDetailDto> {
    return toBinMoveDetailDto(
      await this.moves.create(ctx, {
        warehouseId: body.warehouseId,
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: body.lines.map((line) => ({
          productUnitId: line.productUnitId,
          enteredQty: new Decimal(line.enteredQty),
          fromBinId: line.fromBinId,
          toBinId: line.toBinId,
        })),
      }),
    );
  }
}

/**
 * Adjustments (ADJ-): warehouse staff draft and submit; approvers post or return. Every response is
 * cost-free.
 */
@ApiTags('inventory')
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: AdjustmentPageDto })
  async list(@Query() query: AdjustmentListQueryDto): Promise<AdjustmentPageDto> {
    const page = await this.adjustments.list(query);
    return { data: page.data.map(toAdjustmentSummaryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.get(id));
  }

  @Post()
  @RequirePermission(ADJUST)
  @Idempotent()
  @ApiCreatedResponse({ type: AdjustmentDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateAdjustmentDto,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(
      await this.adjustments.create(ctx, {
        warehouseId: body.warehouseId,
        reason: body.reason,
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: (body.lines ?? []).map(adjustmentLineInput),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(ADJUST)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdjustmentDto,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.update(ctx, id, body));
  }

  @Post(':id/lines')
  @RequirePermission(ADJUST)
  @ApiCreatedResponse({ type: AdjustmentDetailDto })
  async addLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AdjustmentLineRequestDto,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(
      await this.adjustments.addLine(ctx, id, adjustmentLineInput(body)),
    );
  }

  /** DRAFT → SUBMITTED, for an approver. */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission(ADJUST)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async submit(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.submit(ctx, id));
  }

  /** SUBMITTED → DRAFT, back to the warehouse. */
  @Post(':id/return')
  @HttpCode(200)
  @RequirePermission(APPROVE)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async returnToDraft(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.returnToDraft(ctx, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(ADJUST)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.cancel(ctx, id));
  }

  /** SUBMITTED → POSTED by an approver; idempotent so a retried click never posts twice. */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission(APPROVE)
  @Idempotent()
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApproveAdjustmentDto,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(
      await this.adjustments.approve(
        ctx,
        id,
        (body.costs ?? []).map((cost) => ({
          lineId: cost.lineId,
          unitCost: new Decimal(cost.unitCost),
        })),
      ),
    );
  }
}

@ApiTags('inventory')
@Controller('adjustment-lines')
export class AdjustmentLinesController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @Patch(':id')
  @RequirePermission(ADJUST)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdjustmentLineDto,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(
      await this.adjustments.updateLine(ctx, id, {
        ...(body.enteredQty === undefined ? {} : { enteredQty: new Decimal(body.enteredQty) }),
        ...(body.binId === undefined ? {} : { binId: body.binId }),
        ...(body.note === undefined ? {} : { note: body.note }),
      }),
    );
  }

  @Delete(':id')
  @RequirePermission(ADJUST)
  @ApiOkResponse({ type: AdjustmentDetailDto })
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdjustmentDetailDto> {
    return toAdjustmentDetailDto(await this.adjustments.removeLine(ctx, id));
  }
}
