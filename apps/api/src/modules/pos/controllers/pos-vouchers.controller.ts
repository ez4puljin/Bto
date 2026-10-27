import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  VoucherBatchDetailDto,
  VoucherBatchDto,
  VoucherBatchListQueryDto,
  VoucherBatchPageDto,
  VoucherBatchRequestDto,
  VoucherReviewDto,
  VoucherUseDto,
  VoucherUsesQueryDto,
} from '../dto/vouchers.dto';
import {
  PosVouchersService,
  type VoucherBatchView,
  type VoucherCodeView,
  type VoucherUseView,
} from '../services/pos-vouchers.service';

const READ = 'pos.read';
const MANAGE = 'pos.manage';

/** The till's coupons and partner vouchers (ADR-0110): batches, their codes and their uses. */
@ApiTags('pos')
@Controller('pos/voucher-batches')
export class PosVoucherBatchesController {
  constructor(private readonly vouchers: PosVouchersService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: VoucherBatchPageDto })
  async list(@Query() query: VoucherBatchListQueryDto): Promise<VoucherBatchPageDto> {
    const page = await this.vouchers.listBatches(query);
    return { data: page.data.map(batchDto), nextCursor: page.nextCursor };
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: VoucherBatchDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: VoucherBatchRequestDto,
  ): Promise<VoucherBatchDetailDto> {
    const batch = await this.vouchers.createBatch(ctx, {
      kind: body.kind,
      name: body.name,
      effect: body.effect,
      value: new Decimal(body.value),
      customerId: body.customerId ?? null,
      validFrom: body.validFrom,
      validTo: body.validTo,
      qty: body.qty,
      note: body.note ?? null,
    });
    return this.detail(batch);
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: VoucherBatchDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<VoucherBatchDetailDto> {
    return this.detail(await this.vouchers.getBatch(id));
  }

  /** Stops the batch: its unused codes leave the tills at their next pull. */
  @Post(':id/stop')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: VoucherBatchDto })
  async stop(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<VoucherBatchDto> {
    return batchDto(await this.vouchers.stopBatch(ctx, id));
  }

  private async detail(batch: VoucherBatchView): Promise<VoucherBatchDetailDto> {
    const [codes, uses] = await Promise.all([
      this.vouchers.codesOf(batch.id),
      this.vouchers.uses({ batchId: batch.id }),
    ]);
    return { ...batchDto(batch), codes: codes.map(codeDto), uses: uses.map(useDto) };
  }
}

/** The codes tills took, and «Шалгасан» on the ones the centre found wrong (ADR-0110). */
@ApiTags('pos')
@Controller('pos/sale-vouchers')
export class PosSaleVouchersController {
  constructor(private readonly vouchers: PosVouchersService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [VoucherUseDto] })
  async list(@Query() query: VoucherUsesQueryDto): Promise<VoucherUseDto[]> {
    return (await this.vouchers.uses(query)).map(useDto);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: VoucherUseDto })
  async review(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VoucherReviewDto,
  ): Promise<VoucherUseDto> {
    return useDto(await this.vouchers.reviewUse(ctx, id, body.note ?? null));
  }
}

function batchDto(batch: VoucherBatchView): VoucherBatchDto {
  return {
    ...batch,
    value: batch.value.toFixed(2),
    createdAt: batch.createdAt.toISOString(),
    stoppedAt: batch.stoppedAt?.toISOString() ?? null,
  };
}

function codeDto(code: VoucherCodeView): VoucherBatchDetailDto['codes'][number] {
  return {
    ...code,
    redeemedAt: code.redeemedAt?.toISOString() ?? null,
    amount: code.amount?.toFixed(2) ?? null,
  };
}

function useDto(use: VoucherUseView): VoucherUseDto {
  return {
    ...use,
    soldAt: use.soldAt.toISOString(),
    face: use.face.toFixed(2),
    amount: use.amount.toFixed(2),
    reviewedAt: use.reviewedAt?.toISOString() ?? null,
  };
}
