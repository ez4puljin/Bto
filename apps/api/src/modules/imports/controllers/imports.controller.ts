import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { IMPORT_KINDS } from '@tugeel/shared/imports';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  CreateImportDto,
  ImportJobDto,
  ImportJobPageDto,
  ImportKindParamDto,
  ImportListQueryDto,
  ImportRowPageDto,
  ImportRowsQueryDto,
} from '../dto/imports.dto';
import { templateFileName } from '../services/import-template';
import { type ImportJob, ImportsService } from '../services/imports.service';

const IMPORTS = 'imports.manage';

function toJobDto(job: ImportJob): ImportJobDto {
  return {
    id: job.id,
    kind: job.kind,
    fileName: job.fileName,
    status: job.status,
    phase: job.phase,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    errorRows: job.errorRows,
    warningRows: job.warningRows,
    summary: typeof job.summary === 'object' && job.summary !== null ? job.summary : null,
    lastError: job.lastError,
    canRevert: job.canRevert,
    createdAt: job.createdAt.toISOString(),
    validatedAt: job.validatedAt?.toISOString() ?? null,
    committedAt: job.committedAt?.toISOString() ?? null,
    revertedAt: job.revertedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * Excel imports (ADR-0036), admins only: templates, a job per uploaded sheet, the preview of its
 * rows, then commit and revert, both carried out by the worker.
 */
@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('templates/:kind')
  @RequirePermission(IMPORTS)
  @ApiParam({ name: 'kind', enum: IMPORT_KINDS })
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async template(@Param() params: ImportKindParamDto): Promise<StreamableFile> {
    const buffer = await this.imports.template(params.kind);
    return new StreamableFile(buffer, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${templateFileName(params.kind)}"`,
      length: buffer.length,
    });
  }

  @Get()
  @RequirePermission(IMPORTS)
  @ApiOkResponse({ type: ImportJobPageDto })
  async list(@Query() query: ImportListQueryDto): Promise<ImportJobPageDto> {
    const page = await this.imports.list(query);
    return { data: page.data.map(toJobDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission(IMPORTS)
  @ApiOkResponse({ type: ImportJobDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<ImportJobDto> {
    return toJobDto(await this.imports.get(id));
  }

  @Get(':id/rows')
  @RequirePermission(IMPORTS)
  @ApiOkResponse({ type: ImportRowPageDto })
  async rows(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ImportRowsQueryDto,
  ): Promise<ImportRowPageDto> {
    return this.imports.rows(id, query);
  }

  /** Attaches an uploaded sheet; the worker reads and checks it. */
  @Post()
  @RequirePermission(IMPORTS)
  @Idempotent()
  @ApiCreatedResponse({ type: ImportJobDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateImportDto,
  ): Promise<ImportJobDto> {
    return toJobDto(await this.imports.create(ctx, body));
  }

  /** VALIDATED → COMMITTING: the worker applies every row in one transaction. */
  @Post(':id/commit')
  @HttpCode(200)
  @RequirePermission(IMPORTS)
  @Idempotent()
  @ApiOkResponse({ type: ImportJobDto })
  async commit(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImportJobDto> {
    return toJobDto(await this.imports.requestCommit(ctx, id));
  }

  /** COMMITTED → REVERTING, for the most recent committed import only. */
  @Post(':id/revert')
  @HttpCode(200)
  @RequirePermission(IMPORTS)
  @Idempotent()
  @ApiOkResponse({ type: ImportJobDto })
  async revert(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImportJobDto> {
    return toJobDto(await this.imports.requestRevert(ctx, id));
  }
}
