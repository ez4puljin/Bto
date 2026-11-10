import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  RepCollectionDto,
  RepCollectionPageDto,
  RepCollectionQueryDto,
  RepCollectionRecordDto,
  RepCollectionRejectDto,
  RepCollectionRequestDto,
} from '../dto/rep-collections.dto';
import { type RepCollection, RepCollectionsService } from '../services/rep-collections.service';

const REP = 'sales.orders.rep';
const READ = 'finance.read';
const PAYMENTS = 'finance.payments.record';

const dto = (row: RepCollection): RepCollectionDto => ({
  ...row,
  amount: row.amount.toFixed(2),
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

/** The rep's own reports of collected money in the staff app (ADR-0183). */
@ApiTags('finance')
@Controller('sales-rep/collections')
export class SalesRepCollectionsController {
  constructor(private readonly collections: RepCollectionsService) {}

  @Get()
  @RequirePermission(REP)
  @ApiOkResponse({ type: [RepCollectionDto] })
  async mine(@CurrentUser() ctx: AuthContext): Promise<RepCollectionDto[]> {
    return (await this.collections.mine(ctx)).map(dto);
  }

  /** A report only: the store's balance changes when the accountant records it. */
  @Post()
  @RequirePermission(REP)
  @Idempotent()
  @ApiCreatedResponse({ type: RepCollectionDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: RepCollectionRequestDto,
  ): Promise<RepCollectionDto> {
    return dto(
      await this.collections.create(ctx, {
        customerId: body.customerId,
        amount: new Decimal(body.amount),
        method: body.method,
        note: body.note ?? null,
      }),
    );
  }
}

/** The accountant's side: the reports, recorded as vouchers or refused (ADR-0183). */
@ApiTags('finance')
@Controller('rep-collections')
export class RepCollectionsController {
  constructor(private readonly collections: RepCollectionsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: RepCollectionPageDto })
  async list(@Query() query: RepCollectionQueryDto): Promise<RepCollectionPageDto> {
    const page = await this.collections.list({
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      data: page.data.map(dto),
      nextCursor: page.nextCursor,
      pendingCount: page.pending.count,
      pendingAmount: new Decimal(page.pending.amount).toFixed(2),
    };
  }

  /** «Орлого бичих»: the voucher and the report's mark in one transaction. */
  @Post(':id/record')
  @HttpCode(200)
  @RequirePermission(PAYMENTS)
  @Idempotent()
  @ApiOkResponse({ type: RepCollectionDto })
  async record(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RepCollectionRecordDto,
  ): Promise<RepCollectionDto> {
    return dto(
      await this.collections.record(ctx, id, {
        moneyAccountId: body.moneyAccountId,
        paidOn: body.paidOn,
      }),
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission(PAYMENTS)
  @ApiOkResponse({ type: RepCollectionDto })
  async reject(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RepCollectionRejectDto,
  ): Promise<RepCollectionDto> {
    return dto(await this.collections.reject(ctx, id, body.reason));
  }
}
