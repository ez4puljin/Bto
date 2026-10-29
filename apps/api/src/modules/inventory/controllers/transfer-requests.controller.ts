import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
  CancelTransferRequestDto,
  CreateTransferRequestDto,
  SaveTransferRequestLinesDto,
  TransferRequestContextDto,
  TransferRequestDetailDto,
  TransferRequestListQueryDto,
  TransferRequestPageDto,
  TransferRequestRowsPageDto,
  TransferRequestRowsQueryDto,
  TransferRequestSaveResultDto,
  UpdateTransferRequestDto,
} from '../dto/transfer-requests.dto';
import {
  type RequestRowsPage,
  type TransferRequestDetail,
  TransferRequestsService,
  type TransferRequestSummary,
} from '../services/transfer-requests.service';
import { toTransferDetailDto } from './mappers';

const TRANSFERS = 'inventory.transfers.manage';

/**
 * Transfer requests (ADR-0116): the store's request of goods from several home warehouses at once,
 * made and sent from the staff app; each group of it is then a transfer of its own.
 */
@ApiTags('inventory')
@Controller('transfer-requests')
export class TransferRequestsController {
  constructor(private readonly requests: TransferRequestsService) {}

  @Get('context')
  @Authenticated()
  @ApiOkResponse({ type: TransferRequestContextDto })
  context(@CurrentUser() ctx: AuthContext): Promise<TransferRequestContextDto> {
    return this.requests.context(ctx);
  }

  @Get('rows')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestRowsPageDto })
  async rows(
    @CurrentUser() ctx: AuthContext,
    @Query() query: TransferRequestRowsQueryDto,
  ): Promise<TransferRequestRowsPageDto> {
    return toRowsDto(await this.requests.rows(ctx, query));
  }

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: TransferRequestPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: TransferRequestListQueryDto,
  ): Promise<TransferRequestPageDto> {
    const page = await this.requests.list(ctx, query);
    return { data: page.data.map(toSummaryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: TransferRequestDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<TransferRequestDetailDto> {
    return toDetailDto(await this.requests.get(id));
  }

  @Post()
  @RequirePermission(TRANSFERS)
  @Idempotent()
  @ApiCreatedResponse({ type: TransferRequestDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateTransferRequestDto,
  ): Promise<TransferRequestDetailDto> {
    return toDetailDto(
      await this.requests.create(ctx, {
        destWarehouseId: body.destWarehouseId,
        ...(body.note === undefined ? {} : { note: body.note }),
        lines: body.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: new Decimal(line.qty),
        })),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestDetailDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTransferRequestDto,
  ): Promise<TransferRequestDetailDto> {
    return toDetailDto(await this.requests.update(ctx, id, body));
  }

  /** Writes only the changed cells, each against the value the page opened with. */
  @Put(':id/lines')
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestSaveResultDto })
  async saveLines(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveTransferRequestLinesDto,
  ): Promise<TransferRequestSaveResultDto> {
    const result = await this.requests.saveLines(
      ctx,
      id,
      body.changes.map((change) => ({
        productId: change.productId,
        productUnitId: change.productUnitId ?? null,
        qty: change.qty === null || change.qty === undefined ? null : new Decimal(change.qty),
        previous:
          change.previousUnitId === null ||
          change.previousUnitId === undefined ||
          change.previousQty === null ||
          change.previousQty === undefined
            ? null
            : { productUnitId: change.previousUnitId, qty: new Decimal(change.previousQty) },
      })),
    );
    return {
      applied: result.applied,
      conflicts: result.conflicts.map((conflict) => ({
        productId: conflict.productId,
        productUnitId: conflict.productUnitId,
        qty: conflict.qty?.toFixed() ?? null,
      })),
      refused: result.refused,
    };
  }

  /** DRAFT → REQUESTED: every group is sent and numbered. */
  @Post(':id/request')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestDetailDto })
  async request(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TransferRequestDetailDto> {
    return toDetailDto(await this.requests.request(ctx, id));
  }

  /** Every REQUESTED group back to DRAFT for editing (ADR-0046). */
  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestDetailDto })
  async reopen(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TransferRequestDetailDto> {
    return toDetailDto(await this.requests.reopen(ctx, id));
  }

  /** The store withdraws the whole request while nothing is shipped. */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission(TRANSFERS)
  @ApiOkResponse({ type: TransferRequestDetailDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelTransferRequestDto,
  ): Promise<TransferRequestDetailDto> {
    return toDetailDto(await this.requests.cancel(ctx, id, body.reason));
  }
}

function toDetailDto(detail: TransferRequestDetail): TransferRequestDetailDto {
  return {
    id: detail.id,
    destWarehouseId: detail.destWarehouseId,
    destWarehouseName: detail.destWarehouseName,
    status: detail.status,
    note: detail.note,
    requestedAt: detail.requestedAt?.toISOString() ?? null,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    groups: detail.groups.map((group) => ({
      ...toTransferDetailDto(group),
      sourceWarehouseName: group.sourceWarehouseName,
    })),
  };
}

function toSummaryDto(summary: TransferRequestSummary): TransferRequestPageDto['data'][number] {
  return {
    id: summary.id,
    destWarehouseId: summary.destWarehouseId,
    status: summary.status,
    note: summary.note,
    requestedAt: summary.requestedAt?.toISOString() ?? null,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
    groupCount: summary.groupCount,
    lineCount: summary.lineCount,
    numbers: summary.numbers,
  };
}

function toRowsDto(page: RequestRowsPage): TransferRequestRowsPageDto {
  return {
    data: page.data.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      thumbUrl: row.thumbUrl,
      units: row.units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        uomCode: unit.uomCode,
        factor: unit.factor.toFixed(),
        isBase: unit.isBase,
      })),
      homeWarehouseId: row.homeWarehouseId,
      homeWarehouseName: row.homeWarehouseName,
      homeOnHand: row.homeOnHand.toFixed(),
      storeOnHand: row.storeOnHand.toFixed(),
      lastMonthOut: row.lastMonthOut.toFixed(),
      line: row.line
        ? {
            transferId: row.line.transferId,
            lineId: row.line.lineId,
            productUnitId: row.line.productUnitId,
            qty: row.line.qty.toFixed(),
          }
        : null,
    })),
    nextCursor: page.nextCursor,
    total: page.total,
    outflowFrom: page.outflowFrom,
    outflowTo: page.outflowTo,
  };
}
