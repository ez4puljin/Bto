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
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  StaffAppAssortmentDto,
  StaffAppAssortmentListDto,
  StaffAppAssortmentRequestDto,
} from '../dto/app-settings.dto';
import { APP_SETTINGS_MANAGE } from '../services/app-settings.service';
import {
  type StaffAppAssortment,
  StaffAppAssortmentsService,
} from '../services/staff-app-assortments.service';

const toDto = (row: StaffAppAssortment): StaffAppAssortmentDto => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

/** Which products the staff app shows whom (ADR-0164), the «Апп → Бараа» page's second tab. */
@ApiTags('sales')
@Controller('app-settings/staff-assortments')
export class StaffAppAssortmentsController {
  constructor(private readonly assortments: StaffAppAssortmentsService) {}

  @Get()
  @RequirePermission(APP_SETTINGS_MANAGE)
  @ApiOkResponse({ type: StaffAppAssortmentListDto })
  async list(): Promise<StaffAppAssortmentListDto> {
    return { data: (await this.assortments.list()).map(toDto), nextCursor: null };
  }

  @Post()
  @RequirePermission(APP_SETTINGS_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: StaffAppAssortmentDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: StaffAppAssortmentRequestDto,
  ): Promise<StaffAppAssortmentDto> {
    return toDto(await this.assortments.create(ctx, body));
  }

  @Put(':id')
  @RequirePermission(APP_SETTINGS_MANAGE)
  @ApiOkResponse({ type: StaffAppAssortmentDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StaffAppAssortmentRequestDto,
  ): Promise<StaffAppAssortmentDto> {
    return toDto(await this.assortments.update(ctx, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(APP_SETTINGS_MANAGE)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.assortments.remove(ctx, id);
  }
}
