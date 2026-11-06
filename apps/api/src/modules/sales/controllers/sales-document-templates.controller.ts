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
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  DocumentPrintLayoutsDto,
  DocumentPrintLayoutsQueryDto,
  DocumentTemplateCreateDto,
  DocumentTemplateDetailDto,
  DocumentTemplateDraftDto,
  DocumentTemplateDto,
} from '../dto/sales-document-templates.dto';
import { MANAGE, READ } from '../services/sales-access.service';
import {
  type DocumentTemplateDetail,
  type DocumentTemplateSummary,
  SalesDocumentTemplatesService,
} from '../services/sales-document-templates.service';

const templateDto = (row: DocumentTemplateSummary): DocumentTemplateDto => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  isDefault: row.isDefault,
  version: row.version,
  publishedAt: row.publishedAt.toISOString(),
  hasDraft: row.hasDraft,
  pipelines: row.pipelines,
});

const detailDto = (row: DocumentTemplateDetail): DocumentTemplateDetailDto => ({
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
 * The wholesale documents' templates (ADR-0143): the pick list and the delivery note laid out
 * from blocks, a draft published as a new version, one default of each kind, chosen per pipeline.
 * Managers of the boards change them; whoever reads orders prints with them.
 */
@ApiTags('sales')
@Controller('sales/document-templates')
export class SalesDocumentTemplatesController {
  constructor(private readonly templates: SalesDocumentTemplatesService) {}

  @Get()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [DocumentTemplateDto] })
  async list(): Promise<DocumentTemplateDto[]> {
    return (await this.templates.list()).map(templateDto);
  }

  /** The published layouts and these pipelines' choices, for printing an order's documents. */
  @Get('print-layouts')
  @RequirePermission(READ)
  @ApiOkResponse({ type: DocumentPrintLayoutsDto })
  async printLayouts(
    @Query() query: DocumentPrintLayoutsQueryDto,
  ): Promise<DocumentPrintLayoutsDto> {
    const ids = (query.pipelineIds ?? '')
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    const result = await this.templates.forPrint(ids);
    return {
      templates: result.templates.map((entry) => ({
        ...entry,
        layout: entry.layout as unknown as Record<string, unknown>,
      })),
      pipelines: result.pipelines,
    };
  }

  @Get(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.get(id));
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiCreatedResponse({ type: DocumentTemplateDetailDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: DocumentTemplateCreateDto,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(
      await this.templates.create(ctx, {
        kind: body.kind,
        name: body.name,
        copyFromId: body.copyFromId ?? null,
      }),
    );
  }

  @Put(':id/draft')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async saveDraft(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DocumentTemplateDraftDto,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.saveDraft(ctx, id, body));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async publish(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.publish(ctx, id));
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async discard(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.discardDraft(ctx, id));
  }

  @Post(':id/default')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async makeDefault(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.makeDefault(ctx, id));
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: DocumentTemplateDetailDto })
  async restore(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<DocumentTemplateDetailDto> {
    return detailDto(await this.templates.restore(ctx, id, version));
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
