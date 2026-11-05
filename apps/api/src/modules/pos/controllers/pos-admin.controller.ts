import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { formatEdgeLinkCode } from '@tugeel/shared/pos';
import { Public } from '../../../common/auth/public.decorator';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  CashierDto,
  CashierStatusDto,
  EdgeLinkCodeDto,
  EdgeLinkRequestDto,
  EdgeLinkResponseDto,
  EdgeNodeDto,
  EdgeNodePatchDto,
  EdgeNodeRequestDto,
  EdgeTokenDto,
  PairingCodeDto,
  PinRequestDto,
  PosSettingsDto,
  PosSettingsPatchDto,
  PaymentTypeDto,
  PaymentTypesRequestDto,
  QuickButtonsRequestDto,
  QuickGroupDto,
  ReceiptTemplateCreateDto,
  ReceiptTemplateDetailDto,
  ReceiptTemplateDraftDto,
  ReceiptTemplateDto,
  TillAccessDto,
  TillDto,
  TillPatchDto,
  TillRequestDto,
  TillsQueryDto,
} from '../dto/pos.dto';
import { PosCashiersService } from '../services/pos-cashiers.service';
import { PosEdgeNodesService } from '../services/pos-edge-nodes.service';
import { PosPaymentTypesService } from '../services/pos-payment-types.service';
import { PosQuickButtonsService } from '../services/pos-quick-buttons.service';
import {
  PosReceiptTemplatesService,
  type ReceiptTemplateDetail,
  type ReceiptTemplateSummary,
} from '../services/pos-receipt-templates.service';
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

  /** ADR-0136: a one-time code to link a new edge from its kiosk (instead of typing the token). */
  @Post(':id/link-code')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: EdgeLinkCodeDto })
  async issueLinkCode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EdgeLinkCodeDto> {
    const { code, expiresAt } = await this.nodes.issueLinkCode(ctx, id);
    return { code: formatEdgeLinkCode(code), expiresAt: expiresAt.toISOString() };
  }
}

/**
 * ADR-0136: the one public door a new edge knocks on — its node's code and the admin's one-time
 * code buy the node token and the PIN key. Wrong codes count against the code in force.
 */
@ApiTags('pos-sync')
@Controller('pos/edge-link')
@Public()
export class PosEdgeLinkController {
  constructor(private readonly nodes: PosEdgeNodesService) {}

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: EdgeLinkResponseDto })
  async link(@Body() body: EdgeLinkRequestDto): Promise<EdgeLinkResponseDto> {
    return this.nodes.claimLink(body.nodeCode, body.linkCode);
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
        warehouseId: body.warehouseId,
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

  /** Who works the till and what it sells (ADR-0124); the lists replace the old ones. */
  @Put(':id/access')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: TillDto })
  async setAccess(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TillAccessDto,
  ): Promise<TillDto> {
    return tillDto(await this.tills.setAccess(ctx, id, body));
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

/** The till's F7 panel (ADR-0104): groups of products, saved as a whole set. */
@ApiTags('pos')
@Controller('pos/quick-buttons')
export class PosQuickButtonsController {
  constructor(private readonly quickButtons: PosQuickButtonsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [QuickGroupDto] })
  list(): Promise<QuickGroupDto[]> {
    return this.quickButtons.list();
  }

  @Put()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [QuickGroupDto] })
  replace(
    @CurrentUser() ctx: AuthContext,
    @Body() body: QuickButtonsRequestDto,
  ): Promise<QuickGroupDto[]> {
    return this.quickButtons.replace(ctx, body);
  }
}

/** The ways to pay at the till (ADR-0111): named and ordered by the admin, saved as a whole list. */
@ApiTags('pos')
@Controller('pos/payment-types')
export class PosPaymentTypesController {
  constructor(private readonly paymentTypes: PosPaymentTypesService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [PaymentTypeDto] })
  list(): Promise<PaymentTypeDto[]> {
    return this.paymentTypes.list();
  }

  @Put()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [PaymentTypeDto] })
  replace(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PaymentTypesRequestDto,
  ): Promise<PaymentTypeDto[]> {
    return this.paymentTypes.replace(ctx, {
      types: body.types.map((type) => ({ ...type, id: type.id ?? null })),
    });
  }
}

const templateDto = (row: ReceiptTemplateSummary): ReceiptTemplateDto => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  isDefault: row.isDefault,
  version: row.version,
  publishedAt: row.publishedAt.toISOString(),
  hasDraft: row.hasDraft,
  tills: row.tills,
});

const templateDetailDto = (row: ReceiptTemplateDetail): ReceiptTemplateDetailDto => ({
  ...templateDto(row),
  layout: row.layout as unknown as Record<string, unknown>,
  draft: row.draft as unknown as Record<string, unknown> | null,
  versions: row.versions.map((entry) => ({
    version: entry.version,
    publishedAt: entry.publishedAt.toISOString(),
    publishedBy: entry.publishedBy,
  })),
});

/**
 * The receipt templates (ADR-0141): laid out from blocks in the office, a draft published as a new
 * version, one default of each kind, chosen per POS; the edge takes the published layouts.
 */
@ApiTags('pos')
@Controller('pos/receipt-templates')
export class PosReceiptTemplatesController {
  constructor(private readonly templates: PosReceiptTemplatesService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [ReceiptTemplateDto] })
  async list(): Promise<ReceiptTemplateDto[]> {
    return (await this.templates.list()).map(templateDto);
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: ReceiptTemplateDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ReceiptTemplateCreateDto,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(
      await this.templates.create(ctx, {
        kind: body.kind,
        name: body.name,
        copyFromId: body.copyFromId ?? null,
      }),
    );
  }

  @Put(':id/draft')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async saveDraft(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReceiptTemplateDraftDto,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.saveDraft(ctx, id, body));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async publish(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.publish(ctx, id));
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async discard(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.discardDraft(ctx, id));
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async makeDefault(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.makeDefault(ctx, id));
  }

  /** An earlier version's layout becomes the draft. */
  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ReceiptTemplateDetailDto })
  async restore(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<ReceiptTemplateDetailDto> {
    return templateDetailDto(await this.templates.restore(ctx, id, version));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(MANAGE)
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.templates.remove(ctx, id);
  }
}
