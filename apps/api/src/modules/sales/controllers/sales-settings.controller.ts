import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  SalesChannelDefaultDto,
  SalesChannelDefaultRequestDto,
  SalesNumberingDto,
  SalesNumberingRequestDto,
} from '../dto/sales-settings.dto';
import { READ } from '../services/sales-access.service';
import { type NumberFormat, SalesSettingsService } from '../services/sales-settings.service';

const numberingDto = (format: NumberFormat): SalesNumberingDto => ({
  pattern: format.pattern,
  digits: format.digits,
  updatedAt: format.updatedAt?.toISOString() ?? null,
});

/**
 * The sales settings (ADR-0057): the order number format and where each channel's new orders
 * land. Every reader of orders reads them; changes need `sales.boards.manage` (in the service).
 */
@ApiTags('sales')
@Controller('sales-settings')
export class SalesSettingsController {
  constructor(private readonly settings: SalesSettingsService) {}

  @Get('numbering')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesNumberingDto })
  async numbering(): Promise<SalesNumberingDto> {
    return numberingDto(await this.settings.numbering());
  }

  @Put('numbering')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesNumberingDto })
  async setNumbering(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesNumberingRequestDto,
  ): Promise<SalesNumberingDto> {
    return numberingDto(await this.settings.setNumbering(ctx, body));
  }

  @Get('channels')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesChannelDefaultDto] })
  channels(): Promise<SalesChannelDefaultDto[]> {
    return this.settings.channels();
  }

  /** Where a channel's new orders land; both ids null clears it. */
  @Put('channels')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesChannelDefaultDto] })
  setChannel(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesChannelDefaultRequestDto,
  ): Promise<SalesChannelDefaultDto[]> {
    const target =
      body.pipelineId && body.stageId
        ? { pipelineId: body.pipelineId, stageId: body.stageId }
        : null;
    return this.settings.setChannel(ctx, body.channel, target);
  }
}
