import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  HandoverRequestDto,
  PosAttentionDto,
  RejectionListQueryDto,
  RejectionPageDto,
  ResolveShortfallDto,
  SaleDetailDto,
  SaleListQueryDto,
  SalePageDto,
  ShiftDto,
  ShiftListQueryDto,
  ShiftPageDto,
  ShortfallDto,
  ShortfallListQueryDto,
  ShortfallPageDto,
  SyncOutcomeDto,
  VoidDetailDto,
  VoidListQueryDto,
  VoidPageDto,
} from '../dto/pos.dto';
import { PosQueryService } from '../services/pos-query.service';
import { PosReplayService } from '../services/pos-replay.service';
import { PosShiftsService } from '../services/pos-shifts.service';
import { PosVoidsService } from '../services/pos-voids.service';
import {
  outcomeDto,
  rejectionDto,
  saleDetailDto,
  saleDto,
  shiftDto,
  shortfallDto,
  voidDetailDto,
  voidDto,
} from './mappers';

const READ = 'pos.read';
const MANAGE = 'pos.manage';
const HANDOVER = 'finance.payments.record';

/** Shifts (ADR-0064): the list, one shift with its Z facts, and the accountant's hand-over. */
@ApiTags('pos')
@Controller('pos/shifts')
export class PosShiftsController {
  constructor(
    private readonly query: PosQueryService,
    private readonly shifts: PosShiftsService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: ShiftPageDto })
  async list(@Query() query: ShiftListQueryDto): Promise<ShiftPageDto> {
    const page = await this.query.listShifts(query);
    return { data: page.data.map(shiftDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ShiftDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<ShiftDto> {
    return shiftDto(await this.query.getShift(id));
  }

  @Post(':id/handover')
  @HttpCode(200)
  @RequirePermission(HANDOVER)
  @Idempotent()
  @ApiOkResponse({ type: ShiftDto })
  async handOver(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HandoverRequestDto,
  ): Promise<ShiftDto> {
    await this.shifts.handOver(ctx, id, {
      moneyAccountId: body.moneyAccountId ?? null,
      amount: body.amount ? new Decimal(body.amount) : null,
      paidOn: body.paidOn ?? null,
    });
    return shiftDto(await this.query.getShift(id));
  }
}

/** Sales and returns as the tills made them (ADR-0063 #3). */
@ApiTags('pos')
@Controller('pos/sales')
export class PosSalesController {
  constructor(private readonly query: PosQueryService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalePageDto })
  async list(@Query() query: SaleListQueryDto): Promise<SalePageDto> {
    const page = await this.query.listSales(query);
    return { data: page.data.map(saleDto), nextCursor: page.nextCursor, total: page.total };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SaleDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<SaleDetailDto> {
    return saleDetailDto(await this.query.getSale(id));
  }
}

/** What the shelf lacked when a till sold it (ADR-0063 #5): the storekeeper's list. */
@ApiTags('pos')
@Controller('pos/shortfalls')
export class PosShortfallsController {
  constructor(private readonly query: PosQueryService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: ShortfallPageDto })
  async list(@Query() query: ShortfallListQueryDto): Promise<ShortfallPageDto> {
    const page = await this.query.listShortfalls(query);
    return { data: page.data.map(shortfallDto), nextCursor: page.nextCursor };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.manage')
  @ApiOkResponse({ type: ShortfallDto })
  async resolve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResolveShortfallDto,
  ) {
    return shortfallDto(await this.query.resolveShortfall(ctx, id, body.note ?? null));
  }
}

/** Documents the centre refused (ADR-0063 #4), and their replay once the data is fixed. */
@ApiTags('pos')
@Controller('pos/sync-rejections')
export class PosRejectionsController {
  constructor(
    private readonly query: PosQueryService,
    private readonly replay: PosReplayService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: RejectionPageDto })
  async list(@Query() query: RejectionListQueryDto): Promise<RejectionPageDto> {
    const page = await this.query.listRejections(query);
    return { data: page.data.map(rejectionDto), nextCursor: page.nextCursor };
  }

  @Post(':id/replay')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiOkResponse({ type: SyncOutcomeDto })
  async replayOne(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SyncOutcomeDto> {
    return outcomeDto(await this.replay.replay(ctx, id));
  }
}

/** The home tile and the pages' counts. */
@ApiTags('pos')
@Controller('pos')
export class PosAttentionController {
  constructor(private readonly query: PosQueryService) {}

  @Get('attention')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PosAttentionDto })
  attention(): Promise<PosAttentionDto> {
    return this.query.attention();
  }
}

/** What tills took off carts before payment, with the approving supervisor (ADR-0104). */
@ApiTags('pos')
@Controller('pos/voids')
export class PosVoidsController {
  constructor(private readonly voids: PosVoidsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: VoidPageDto })
  async list(@Query() query: VoidListQueryDto): Promise<VoidPageDto> {
    const page = await this.voids.list(query);
    return {
      data: page.data.map(voidDto),
      nextCursor: page.nextCursor,
      total: page.total,
      sum: page.sum === null ? null : page.sum.toFixed(2),
    };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: VoidDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<VoidDetailDto> {
    return voidDetailDto(await this.voids.get(id));
  }
}
