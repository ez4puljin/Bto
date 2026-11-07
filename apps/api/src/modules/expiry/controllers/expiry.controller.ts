import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ATTENTION_CAP } from '../../../common/attention';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
  UserNamesService,
} from '../../identity';
import {
  ExpiryAttentionDto,
  ExpiryCarryRequestDto,
  ExpiryCarryResultDto,
  ExpiryCreateRequestDto,
  ExpiryFiltersDto,
  ExpiryFiltersQueryDto,
  ExpiryHistoryDto,
  ExpiryItemDto,
  ExpiryItemPageDto,
  ExpiryLiabilityOptionsDto,
  ExpiryLiabilityRequestDto,
  ExpiryListQueryDto,
  ExpiryPatchRequestDto,
  ExpiryStatusRequestDto,
  ExpirySummaryDto,
} from '../dto/expiry.dto';
import { ExpiryCarryService } from '../services/expiry-carry.service';
import { ExpiryItemsService } from '../services/expiry-items.service';
import { ExpiryQueryService } from '../services/expiry-query.service';
import type { ExpiryItemView } from '../services/expiry-view.service';

const MANAGE = 'expiry.items.manage';
const LIABILITY = 'expiry.liability.manage';
const CARRY = 'expiry.items.carry';

/** A picker of every active staff member: far more than the company will ever employ. */
const MAX_LIABILITY_PEOPLE = 5_000;

const toItemDto = (view: ExpiryItemView): ExpiryItemDto => ({
  ...view,
  qtyFloor: view.qtyFloor.toFixed(),
  qtyWarehouse: view.qtyWarehouse.toFixed(),
  qtyTotal: view.qtyTotal.toFixed(),
  createdAt: view.createdAt.toISOString(),
  updatedAt: view.updatedAt.toISOString(),
  archivedAt: view.archivedAt?.toISOString() ?? null,
});

/**
 * The expiry register (ADR-0172). Reading, recording and correcting are open to every signed-in
 * staff member, as the person at the shelf finds the goods; a decision takes its right.
 */
@ApiTags('expiry')
@Controller('expiry')
export class ExpiryController {
  constructor(
    private readonly query: ExpiryQueryService,
    private readonly items: ExpiryItemsService,
    private readonly carrier: ExpiryCarryService,
    private readonly names: UserNamesService,
  ) {}

  @Get('summary')
  @Authenticated()
  @ApiOkResponse({ type: ExpirySummaryDto })
  summary(): Promise<ExpirySummaryDto> {
    return this.query.summary();
  }

  @Get('filters')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryFiltersDto })
  filters(@Query() query: ExpiryFiltersQueryDto): Promise<ExpiryFiltersDto> {
    return this.query.filters(query.view);
  }

  @Get('attention')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryAttentionDto })
  async attention(@CurrentUser() ctx: AuthContext): Promise<ExpiryAttentionDto> {
    return { ...(await this.query.attention(ctx)), cap: ATTENTION_CAP };
  }

  @Get('liability-options')
  @RequirePermission(LIABILITY)
  @ApiOkResponse({ type: ExpiryLiabilityOptionsDto })
  async liabilityOptions(): Promise<ExpiryLiabilityOptionsDto> {
    return {
      roles: await this.names.rolesBrief(),
      users: await this.names.search('', MAX_LIABILITY_PEOPLE),
    };
  }

  @Get('items')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryItemPageDto })
  async list(@Query() query: ExpiryListQueryDto): Promise<ExpiryItemPageDto> {
    const page = await this.query.list(query);
    return { data: page.data.map(toItemDto), nextCursor: page.nextCursor };
  }

  @Post('items')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: ExpiryItemDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ExpiryCreateRequestDto,
  ): Promise<ExpiryItemDto> {
    return toItemDto(await this.items.create(ctx, body));
  }

  // Declared before the routes of one record, so `carry` is never read as an id.
  @Post('items/carry')
  @RequirePermission(CARRY)
  @Idempotent()
  @ApiCreatedResponse({ type: ExpiryCarryResultDto })
  carry(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ExpiryCarryRequestDto,
  ): Promise<ExpiryCarryResultDto> {
    return this.carrier.carry(ctx, body);
  }

  @Get('items/:id')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryItemDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<ExpiryItemDto> {
    return toItemDto(await this.query.get(id));
  }

  @Get('items/:id/history')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryHistoryDto })
  async history(@Param('id', ParseIntPipe) id: number): Promise<ExpiryHistoryDto> {
    const rows = await this.query.history(id);
    return {
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        qtyFloorOld: row.qtyFloorOld.toFixed(),
        qtyFloorNew: row.qtyFloorNew.toFixed(),
        qtyWarehouseOld: row.qtyWarehouseOld.toFixed(),
        qtyWarehouseNew: row.qtyWarehouseNew.toFixed(),
        changedAt: row.changedAt.toISOString(),
        changedByName: row.changedByName,
      })),
    };
  }

  @Patch('items/:id')
  @Authenticated()
  @ApiOkResponse({ type: ExpiryItemDto })
  async patch(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryPatchRequestDto,
  ): Promise<ExpiryItemDto> {
    return toItemDto(await this.items.patch(ctx, id, body));
  }

  @Put('items/:id/status')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ExpiryItemDto })
  async setStatus(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryStatusRequestDto,
  ): Promise<ExpiryItemDto> {
    return toItemDto(await this.items.setStatus(ctx, id, body.status));
  }

  @Put('items/:id/liability')
  @RequirePermission(LIABILITY)
  @ApiOkResponse({ type: ExpiryItemDto })
  async setLiability(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ExpiryLiabilityRequestDto,
  ): Promise<ExpiryItemDto> {
    return toItemDto(await this.items.setLiability(ctx, id, body));
  }
}
