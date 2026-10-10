import { pipeline } from 'node:stream/promises';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../auth-context';
import { Authenticated, CurrentUser } from '../decorators/access.decorators';
import { PresignedUploadDto, PresignUploadDto } from '../dto/files.dto';
import { StorageService } from '../services/storage.service';
import { StorageUrlSigner } from '../storage/url-signer';

const notFound = () => new AppError('NOT_FOUND', 'no such file');

/**
 * Files (ADR-0014, ADR-0030). The local driver serves its own signed upload URL and the public read
 * path; the go-live Spaces driver replaces both with presigned bucket URLs and a CDN prefix.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly signer: StorageUrlSigner,
  ) {}

  @Post('presign')
  @Authenticated()
  @ApiCreatedResponse({ type: PresignedUploadDto })
  async presign(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PresignUploadDto,
  ): Promise<PresignedUploadDto> {
    const file = await this.storage.createPending(ctx, body);
    const { url, expiresAt } = this.signer.uploadUrl({
      name: file.key,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
    });
    return {
      fileId: file.id,
      uploadUrl: url,
      method: 'PUT',
      headers: { 'Content-Type': file.contentType },
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The signed upload target of the local driver: the body streams straight to disk. */
  @Public()
  @Put('local/:name')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async upload(
    @Param('name') name: string,
    @Query('exp') exp: unknown,
    @Query('sig') sig: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const file = await this.storage.findByKey(name);
    if (!file) throw notFound();
    const claim = { name: file.key, contentType: file.contentType, sizeBytes: file.sizeBytes };
    if (
      typeof exp !== 'string' ||
      typeof sig !== 'string' ||
      !this.signer.verifyUpload(claim, exp, sig)
    ) {
      throw new AppError('FORBIDDEN', 'bad or expired upload signature', { reason: 'SIGNATURE' });
    }
    if (file.status !== 'PENDING' || file.uploadedAt) {
      throw new AppError('CONFLICT', `file ${file.id} was already uploaded`);
    }
    const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== file.contentType) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `expected ${file.contentType}`);
    }
    const length = request.headers['content-length'];
    if (length !== undefined && length !== String(file.sizeBytes)) {
      throw /^\d+$/.test(length) && BigInt(length) > BigInt(file.sizeBytes)
        ? new AppError('PAYLOAD_TOO_LARGE', 'upload larger than declared', {
            maxBytes: file.sizeBytes,
          })
        : new AppError('BAD_REQUEST', 'Content-Length differs from the declared size');
    }
    await this.storage.receiveUpload(file, request);
  }

  /** Public files (product images): immutable, so browsers and the future CDN cache them forever. */
  @Public()
  @Get('public/:name')
  @ApiExcludeEndpoint()
  async publicFile(@Param('name') name: string, @Res() response: Response): Promise<void> {
    const found = await this.storage.openPublic(name);
    if (!found) throw notFound();
    response.status(200);
    response.setHeader('Content-Type', found.file.contentType);
    response.setHeader('Content-Length', String(found.file.sizeBytes));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    await pipeline(found.body, response);
  }
}
