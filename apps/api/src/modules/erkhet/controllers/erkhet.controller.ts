import { Body, Controller, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  ErkhetApplyDto,
  ErkhetApplyResultDto,
  ErkhetCheckDto,
  ErkhetItemPageDto,
  ErkhetItemsQueryDto,
  ErkhetOverviewDto,
  ErkhetRunDto,
  ErkhetSettingsDto,
  TestErkhetSettingsDto,
  toItemDto,
  toOverviewDto,
  toRunDto,
  UpdateErkhetSettingsDto,
} from '../dto/erkhet.dto';
import { ErkhetApplyService } from '../services/erkhet-apply.service';
import { ErkhetSettingsFlowService } from '../services/erkhet-settings-flow.service';
import { ErkhetSyncService } from '../services/erkhet-sync.service';

const READ = 'erkhet.sync.read';
const MANAGE = 'erkhet.sync.manage';
const SETTINGS = 'erkhet.settings.manage';

/**
 * «Эрхэт тулгалт» (ADR-0203): Erkhet's customers and items against Bto's. No response ever carries
 * Erkhet's password, and no route writes to Erkhet.
 */
@ApiTags('erkhet')
@Controller('erkhet')
export class ErkhetController {
  constructor(
    private readonly settings: ErkhetSettingsFlowService,
    private readonly sync: ErkhetSyncService,
    private readonly applier: ErkhetApplyService,
  ) {}

  @Get('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErkhetSettingsDto })
  viewSettings(): Promise<ErkhetSettingsDto> {
    return this.settings.view();
  }

  @Patch('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErkhetSettingsDto })
  updateSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateErkhetSettingsDto,
  ): Promise<ErkhetSettingsDto> {
    return this.settings.update(ctx, body);
  }

  /** Signs in to Erkhet with what is typed or saved; saves nothing and reads no list. */
  @Post('settings/test')
  @HttpCode(200)
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: ErkhetCheckDto })
  testSettings(@Body() body: TestErkhetSettingsDto): Promise<ErkhetCheckDto> {
    return this.settings.test(body);
  }

  @Get('sync')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErkhetOverviewDto })
  async overview(): Promise<ErkhetOverviewDto> {
    return toOverviewDto(await this.sync.overview());
  }

  /** Starts a check; the worker runs it and `GET erkhet/sync` says when it ended. */
  @Post('sync/runs')
  @HttpCode(202)
  @RequirePermission(MANAGE)
  @ApiAcceptedResponse({ type: ErkhetRunDto })
  async start(@CurrentUser() ctx: AuthContext): Promise<ErkhetRunDto> {
    return toRunDto(await this.sync.start(ctx, 'MANUAL'));
  }

  @Get('sync/items')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErkhetItemPageDto })
  async items(@Query() query: ErkhetItemsQueryDto): Promise<ErkhetItemPageDto> {
    const page = await this.sync.items(query);
    return { data: page.data.map(toItemDto), nextCursor: page.nextCursor };
  }

  /** Brings Bto to Erkhet for the chosen rows, or for every open row of one issue. */
  @Post('sync/apply')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ErkhetApplyResultDto })
  apply(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ErkhetApplyDto,
  ): Promise<ErkhetApplyResultDto> {
    return this.applier.apply(ctx, body);
  }
}
