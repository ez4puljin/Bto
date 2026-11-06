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
import { AiSettingsFlowService } from '../services/ai-settings-flow.service';

const MANAGE = 'ai.settings.manage';

/** The AI's connection, limits and usage (ADR-0162). No response ever carries the key. */
@ApiTags('ai')
@Controller('ai')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsFlowService) {}

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
}
