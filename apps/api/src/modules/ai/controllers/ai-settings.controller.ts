import { Body, Controller, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  AiCheckDto,
  AiSettingsDto,
  AiUsageDto,
  TestAiSettingsDto,
  UpdateAiSettingsDto,
} from '../dto/ai-settings.dto';
import {
  PictureCheckDto,
  PictureSettingsDto,
  TestPictureSettingsDto,
  UpdatePictureSettingsDto,
} from '../dto/picture-settings.dto';
import { AiSettingsFlowService } from '../services/ai-settings-flow.service';
import { PictureSettingsFlowService } from '../services/picture-settings-flow.service';

const MANAGE = 'ai.settings.manage';

/** The AI's connection, limits and usage (ADR-0162). No response ever carries the key. */
@ApiTags('ai')
@Controller('ai')
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsFlowService,
    private readonly pictures: PictureSettingsFlowService,
  ) {}

  @Get('settings')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: AiSettingsDto })
  view(): Promise<AiSettingsDto> {
    return this.settings.view();
  }

  @Patch('settings')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: AiSettingsDto })
  update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateAiSettingsDto,
  ): Promise<AiSettingsDto> {
    return this.settings.update(ctx, body);
  }

  /** A free request to the provider: it spends no tokens and saves nothing. */
  @Post('settings/test')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: AiCheckDto })
  test(@Body() body: TestAiSettingsDto): Promise<AiCheckDto> {
    return this.settings.test(body);
  }

  @Get('usage')
  @RequirePermission(MANAGE)
  @ApiQuery({ name: 'check', required: false, description: 'true: ask the provider again now' })
  @ApiOkResponse({ type: AiUsageDto })
  usage(@Query('check') check?: string): Promise<AiUsageDto> {
    return this.settings.usage(check === 'true');
  }

  /** Product pictures (ADR-0198): the background service's key and the company's logo. */
  @Get('picture-settings')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PictureSettingsDto })
  pictureSettings(): Promise<PictureSettingsDto> {
    return this.pictures.view();
  }

  @Patch('picture-settings')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PictureSettingsDto })
  updatePictureSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdatePictureSettingsDto,
  ): Promise<PictureSettingsDto> {
    return this.pictures.update(ctx, body);
  }

  /** A free request to the background service: it spends no credit and saves nothing. */
  @Post('picture-settings/test')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: PictureCheckDto })
  testPictureSettings(@Body() body: TestPictureSettingsDto): Promise<PictureCheckDto> {
    return this.pictures.test(body.apiKey);
  }
}
