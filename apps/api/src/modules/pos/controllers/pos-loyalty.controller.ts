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
import { PageQueryDto } from '../../../common/pagination/page';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  LoyaltyAdjustDto,
  LoyaltyEntryPageDto,
  type LoyaltyMemberFieldsDto,
  LoyaltyMemberDto,
  LoyaltyMemberListQueryDto,
  LoyaltyMemberPageDto,
  LoyaltyMemberPinDto,
  LoyaltyMemberRequestDto,
  LoyaltyMemberUpdateDto,
  LoyaltyTierDto,
  LoyaltyTiersRequestDto,
  SaleLoyaltyDto,
  SaleLoyaltyReviewDto,
} from '../dto/loyalty.dto';
import {
  type LoyaltyTier,
  type MemberInput,
  type MemberView,
  PosLoyaltyService,
  type SaleLoyaltyView,
} from '../services/pos-loyalty.service';

const READ = 'pos.read';
const MANAGE = 'pos.manage';
const MEMBERS = 'pos.loyalty.manage';

/**
 * The bonus card's members (ADR-0112): registered, corrected, given a new PIN, blocked and adjusted
 * at the office by the holders of «Бонус карт удирдах»; never deleted.
 */
@ApiTags('pos')
@Controller('pos/loyalty-members')
export class PosLoyaltyMembersController {
  constructor(private readonly loyalty: PosLoyaltyService) {}

  @Get()
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberPageDto })
  async list(@Query() query: LoyaltyMemberListQueryDto): Promise<LoyaltyMemberPageDto> {
    const page = await this.loyalty.list(query);
    return { data: page.data.map(memberDto), nextCursor: page.nextCursor };
  }

  @Post()
  @RequirePermission(MEMBERS)
  @Idempotent()
  @ApiCreatedResponse({ type: LoyaltyMemberDto })
  async register(
    @CurrentUser() ctx: AuthContext,
    @Body() body: LoyaltyMemberRequestDto,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.register(ctx, { ...fields(body), pin: body.pin }));
  }

  @Get(':id')
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.get(id));
  }

  @Patch(':id')
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LoyaltyMemberUpdateDto,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.update(ctx, id, fields(body)));
  }

  @Get(':id/entries')
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyEntryPageDto })
  async entries(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PageQueryDto,
  ): Promise<LoyaltyEntryPageDto> {
    const page = await this.loyalty.entries(id, query);
    return {
      data: page.data.map((entry) => ({
        ...entry,
        points: entry.points.toFixed(2),
        spendDelta: entry.spendDelta.toFixed(2),
        percent: entry.percent?.toFixed(2) ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** A new four-digit PIN; the till's lock of the old one ends. */
  @Post(':id/pin')
  @HttpCode(200)
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberDto })
  async setPin(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LoyaltyMemberPinDto,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.setPin(ctx, id, body.pin));
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberDto })
  async block(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.setStatus(ctx, id, 'BLOCKED'));
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @RequirePermission(MEMBERS)
  @ApiOkResponse({ type: LoyaltyMemberDto })
  async unblock(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(await this.loyalty.setStatus(ctx, id, 'ACTIVE'));
  }

  /** Points added or removed by hand with a reason, booked as a journal entry. */
  @Post(':id/adjust')
  @RequirePermission(MEMBERS)
  @Idempotent()
  @ApiCreatedResponse({ type: LoyaltyMemberDto })
  async adjust(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LoyaltyAdjustDto,
  ): Promise<LoyaltyMemberDto> {
    return memberDto(
      await this.loyalty.adjust(ctx, id, { points: new Decimal(body.points), reason: body.reason }),
    );
  }
}

/** The bonus card's tiers (ADR-0112): read by every POS reader, set by the admin. */
@ApiTags('pos')
@Controller('pos/loyalty-tiers')
export class PosLoyaltyTiersController {
  constructor(private readonly loyalty: PosLoyaltyService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [LoyaltyTierDto] })
  async list(): Promise<LoyaltyTierDto[]> {
    return (await this.loyalty.tiers()).map(tierDto);
  }

  @Put()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [LoyaltyTierDto] })
  async replace(
    @CurrentUser() ctx: AuthContext,
    @Body() body: LoyaltyTiersRequestDto,
  ): Promise<LoyaltyTierDto[]> {
    const tiers = await this.loyalty.replaceTiers(ctx, {
      tiers: body.tiers.map((tier) => ({
        id: tier.id ?? null,
        name: tier.name,
        fromAmount: new Decimal(tier.fromAmount),
        percent: new Decimal(tier.percent),
      })),
    });
    return tiers.map(tierDto);
  }
}

/** The member sales the centre found wrong, and «Шалгасан» on them (ADR-0112). */
@ApiTags('pos')
@Controller('pos/sale-loyalty')
export class PosSaleLoyaltyController {
  constructor(private readonly loyalty: PosLoyaltyService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SaleLoyaltyDto] })
  async toCheck(): Promise<SaleLoyaltyDto[]> {
    return (await this.loyalty.toCheck()).map(saleLoyaltyDto);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SaleLoyaltyDto })
  async review(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaleLoyaltyReviewDto,
  ): Promise<SaleLoyaltyDto> {
    return saleLoyaltyDto(await this.loyalty.review(ctx, id, body.note ?? null));
  }
}

function fields(body: LoyaltyMemberFieldsDto): MemberInput {
  return {
    name: body.name,
    phone: body.phone,
    regNo: body.regNo ?? null,
    birthDate: body.birthDate ?? null,
    gender: body.gender ?? null,
    note: body.note ?? null,
  };
}

export function memberDto(member: MemberView): LoyaltyMemberDto {
  return {
    ...member,
    balance: member.balance.toFixed(2),
    lifetimeSpend: member.lifetimeSpend.toFixed(2),
    tier: member.tier ? { name: member.tier.name, percent: member.tier.percent.toFixed(2) } : null,
    nextTier: member.nextTier
      ? {
          name: member.nextTier.name,
          percent: member.nextTier.percent.toFixed(2),
          fromAmount: member.nextTier.fromAmount.toFixed(2),
          left: member.nextTier.left.toFixed(2),
        }
      : null,
    pinSetAt: member.pinSetAt.toISOString(),
    createdAt: member.createdAt.toISOString(),
  };
}

function tierDto(tier: LoyaltyTier): LoyaltyTierDto {
  return {
    id: tier.id,
    name: tier.name,
    fromAmount: tier.fromAmount.toFixed(2),
    percent: tier.percent.toFixed(2),
  };
}

function saleLoyaltyDto(view: SaleLoyaltyView): SaleLoyaltyDto {
  return {
    ...view,
    soldAt: view.soldAt.toISOString(),
    earned: view.earned.toFixed(2),
    spent: view.spent.toFixed(2),
    givenBack: view.givenBack.toFixed(2),
    clawback: view.clawback.toFixed(2),
    balanceAfter: view.balanceAfter.toFixed(2),
    reviewedAt: view.reviewedAt?.toISOString() ?? null,
  };
}
