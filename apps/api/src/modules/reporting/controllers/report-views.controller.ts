import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, type AuthContext, CurrentUser, Idempotent } from '../../identity';
import {
  CreateReportViewDto,
  ReportViewDto,
  ReportViewListDto,
  ReportViewsQueryDto,
  UpdateReportViewDto,
} from '../dto/report-views.dto';
import { type ReportView, ReportViewsService } from '../services/report-views.service';

function dto(view: ReportView): ReportViewDto {
  return { ...view, updatedAt: view.updatedAt.toISOString() };
}

/**
 * Saved views of the report pages (ADR-0194). Every signed-in user may call these routes; the
 * service asks for the right of the page a view belongs to (`REPORT_VIEW_PAGES`). Light routes:
 * they stand outside the reports' gate (ADR-0193) and keep nothing in the process's memory.
 */
@ApiTags('reports')
@Controller('reports/views')
export class ReportViewsController {
  constructor(private readonly views: ReportViewsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ReportViewListDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ReportViewsQueryDto,
  ): Promise<ReportViewListDto> {
    return { data: (await this.views.list(ctx, query.page)).map(dto) };
  }

  @Post()
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: ReportViewDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateReportViewDto,
  ): Promise<ReportViewDto> {
    const { page, ...input } = body;
    return dto(await this.views.create(ctx, page, input));
  }

  @Patch(':id')
  @Authenticated()
  @ApiOkResponse({ type: ReportViewDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReportViewDto,
  ): Promise<ReportViewDto> {
    return dto(await this.views.update(ctx, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @Authenticated()
  @ApiNoContentResponse()
  async remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.views.remove(ctx, id);
  }
}
