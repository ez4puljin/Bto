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
  CancelTransferDto,
  CreateTransferDto,
  TransferCountDto,
  TransferCountsDto,
  TransferDetailDto,
  TransferLineRequestDto,
  TransferListQueryDto,
  TransferPageDto,
  UpdateTransferDto,
  UpdateTransferLineDto,
} from '../dto/transfers.dto';
import { type TransferCount, TransfersService } from '../services/transfers.service';
import { toTransferDetailDto, toTransferSummaryDto } from './mappers';

const TRANSFERS = 'inventory.transfers.manage';

const lineInput = (line: TransferLineRequestDto) => ({
  productUnitId: line.productUnitId,
  qty: new Decimal(line.qty),
});

const countInput = (count: TransferCountDto): TransferCount => ({
  lineId: count.lineId,
  ...(count.productUnitId === undefined ? {} : { productUnitId: count.productUnitId }),
  ...(count.qty === undefined ? {} : { qty: new Decimal(count.qty) }),
  ...(count.binId === undefined ? {} : { binId: count.binId }),
});

/**
 * Transfers (TR-, ADR-0035): every signed-in user reads them; the write scope of each step is
 * checked in the service (the destination requests and receives, the source ships).
 */
@ApiTags('inventory')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: TransferPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: TransferListQueryDto,
  ): Promise<TransferPageDto> {
    const page = await this.transfers.list(ctx, query);
    return { data: page.data.map(toTransferSummaryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: TransferDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.get(id));
  }

  @Post()
  @RequirePermission(TRANSFERS)
  @Idempotent()
  @ApiCreatedResponse({ type: TransferDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateTransferDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(
      await this.transfers.create(ctx, {
        origin: body.origin,
        sourceWarehouseId: body.sourceWarehouseId,
        destWarehouseId: body.destWarehouseId,
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: (body.lines ?? []).map(lineInput),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTransferDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.update(ctx, id, body));
  }

  @Post(':id/lines')
  @RequirePermission(TRANSFERS)
  @ApiCreatedResponse({ type: TransferDetailDto })
  async addLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TransferLineRequestDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.addLine(ctx, id, lineInput(body)));
  }

  /** DRAFT → REQUESTED by the destination; the request gets its number. */
  @Post(':id/request')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async request(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.request(ctx, id));
  }

  /** REQUESTED → DRAFT by the destination, to edit the request; it keeps its number (ADR-0046). */
  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async reopen(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.reopen(ctx, id));
  }

  /** The source ships into TRANSIT; idempotent so a retried click never ships twice. */
  @Post(':id/ship')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @Idempotent()
  @ApiOkResponse({ type: TransferDetailDto })
  async ship(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TransferCountsDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(
      await this.transfers.ship(ctx, id, (body.lines ?? []).map(countInput)),
    );
  }

  /** The destination counts what arrived; differences go back to the sender (ADR-0035). */
  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @Idempotent()
  @ApiOkResponse({ type: TransferDetailDto })
  async receive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TransferCountsDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(
      await this.transfers.receive(ctx, id, (body.lines ?? []).map(countInput)),
    );
  }

  /** Cancels a draft, withdraws a request (destination) or declines it (source, with a reason). */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelTransferDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.cancel(ctx, id, body.reason));
  }
}

@ApiTags('inventory')
@Controller('transfer-lines')
export class TransferLinesController {
  constructor(private readonly transfers: TransfersService) {}

  @Patch(':id')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTransferLineDto,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(
      await this.transfers.updateLine(ctx, id, {
        ...(body.productUnitId === undefined ? {} : { productUnitId: body.productUnitId }),
        ...(body.qty === undefined ? {} : { qty: new Decimal(body.qty) }),
      }),
    );
  }

  @Delete(':id')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferDetailDto })
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TransferDetailDto> {
    return toTransferDetailDto(await this.transfers.removeLine(ctx, id));
  }
}
