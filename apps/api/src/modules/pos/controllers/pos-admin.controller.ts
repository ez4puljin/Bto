import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  CashierDto,
  CashierStatusDto,
  EdgeNodeDto,
  EdgeNodePatchDto,
  EdgeNodeRequestDto,
  EdgeTokenDto,
  PairingCodeDto,
  PinRequestDto,
  PosSettingsDto,
  PosSettingsPatchDto,
  TillDto,
  TillPatchDto,
  TillRequestDto,
  TillsQueryDto,
} from '../dto/pos.dto';
import { PosCashiersService } from '../services/pos-cashiers.service';
import { PosEdgeNodesService } from '../services/pos-edge-nodes.service';
import { PosSettingsService } from '../services/pos-settings.service';
import { PosTillsService } from '../services/pos-tills.service';
import { cashierDto, edgeNodeDto, settingsDto, tillDto } from './mappers';

const READ = 'pos.read';
const MANAGE = 'pos.manage';

/** The store's settings (ADR-0063 #2). */
@ApiTags('pos')
@Controller('pos/settings')
export class PosSettingsController {
  constructor(private readonly settings: PosSettingsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: PosSettingsDto })
  async get(): Promise<PosSettingsDto> {
    return settingsDto(await this.settings.get());
  }

  @Put()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PosSettingsDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PosSettingsPatchDto,
  ): Promise<PosSettingsDto> {
    return settingsDto(await this.settings.update(ctx, body));
  }
}

/** The store's edge servers and their tokens (ADR-0063 #1, #6). */
@ApiTags('pos')
@Controller('pos/edge-nodes')
export class PosEdgeNodesController {
  constructor(private readonly nodes: PosEdgeNodesService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [EdgeNodeDto] })
  async list(): Promise<EdgeNodeDto[]> {
    return (await this.nodes.list()).map(edgeNodeDto);
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: EdgeNodeDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EdgeNodeRequestDto,
  ): Promise<EdgeNodeDto> {
    return edgeNodeDto(await this.nodes.create(ctx, body));
  }

  @Put(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: EdgeNodeDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EdgeNodePatchDto,
  ): Promise<EdgeNodeDto> {
    return edgeNodeDto(await this.nodes.update(ctx, id, body));
  }

  @Post(':id/token')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: EdgeTokenDto })
  async issueToken(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EdgeTokenDto> {
    return this.nodes.issueToken(ctx, id);
  }
}

/** The tills (касс) of the store. */
@ApiTags('pos')
@Controller('pos/tills')
export class PosTillsController {
  constructor(private readonly tills: PosTillsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [TillDto] })
  async list(@Query() query: TillsQueryDto): Promise<TillDto[]> {
    return (await this.tills.list(query)).map(tillDto);
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: TillDto })
  async create(@CurrentUser() ctx: AuthContext, @Body() body: TillRequestDto): Promise<TillDto> {
    return tillDto(
      await this.tills.create(ctx, {
        edgeNodeId: body.edgeNodeId,
        code: body.code,
        name: body.name,
        printerHost: body.printerHost ?? null,
        printerPort: body.printerPort,
        drawerKick: body.drawerKick,
      }),
    );
  }

  @Put(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: TillDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TillPatchDto,
  ): Promise<TillDto> {
    return tillDto(await this.tills.update(ctx, id, body));
  }

  @Post(':id/pairing-code')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PairingCodeDto })
  async pairingCode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PairingCodeDto> {
    const issued = await this.tills.issuePairingCode(ctx, id);
    return { code: issued.code, expiresAt: issued.expiresAt.toISOString() };
  }
}

/** Cashiers and their PINs (ADR-0063 #6). */
@ApiTags('pos')
@Controller('pos/cashiers')
export class PosCashiersController {
  constructor(private readonly cashiers: PosCashiersService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [CashierDto] })
  async list(): Promise<CashierDto[]> {
    return (await this.cashiers.list()).map(cashierDto);
  }

  @Put(':userId/pin')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CashierDto })
  async setPin(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: PinRequestDto,
  ): Promise<CashierDto> {
    return cashierDto(await this.cashiers.setPin(ctx, userId, body.pin));
  }

  @Put(':userId/status')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CashierDto })
  async setStatus(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: CashierStatusDto,
  ): Promise<CashierDto> {
    return cashierDto(await this.cashiers.setStatus(ctx, userId, body.status));
  }

  @Post(':userId/unlock')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CashierDto })
  async unlock(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<CashierDto> {
    return cashierDto(await this.cashiers.unlock(ctx, userId));
  }
}
