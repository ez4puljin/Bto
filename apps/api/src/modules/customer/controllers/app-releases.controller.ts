import { pipeline } from 'node:stream/promises';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { AppError } from '../../../common/errors/app-error';
import { AppReleaseLookupDto } from '../dto/app-releases.dto';
import {
  APP_RELEASE_VARIANTS,
  type AppReleaseVariant,
  AppReleasesService,
  isAppReleaseVariant,
} from '../services/app-releases.service';

const variantOf = (value: string): AppReleaseVariant => {
  if (!isAppReleaseVariant(value)) throw new AppError('NOT_FOUND', 'no such app');
  return value;
};

/**
 * An app's newest APK for its own update on the phone (ADR-0166). Public on purpose: an APK holds no
 * secret, and Android installs it only over an app signed with the same key.
 */
@ApiTags('app-releases')
@Controller('app-releases')
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Public()
  @Get(':variant')
  @ApiParam({ name: 'variant', enum: APP_RELEASE_VARIANTS })
  @ApiOkResponse({ type: AppReleaseLookupDto })
  async latest(@Param('variant') variant: string): Promise<AppReleaseLookupDto> {
    const release = await this.releases.latest(variantOf(variant));
    return {
      release: release
        ? {
            version: release.version,
            versionCode: release.versionCode,
            sizeBytes: release.sizeBytes,
          }
        : null,
    };
  }

  @Public()
  @Get(':variant/apk')
  @ApiExcludeEndpoint()
  async download(@Param('variant') variant: string, @Res() response: Response): Promise<void> {
    const found = await this.releases.open(variantOf(variant));
    if (!found) throw new AppError('NOT_FOUND', 'no release of this app');
    response.status(200);
    response.setHeader('Content-Type', 'application/vnd.android.package-archive');
    response.setHeader('Content-Length', String(found.release.sizeBytes));
    response.setHeader('Content-Disposition', `attachment; filename="${found.release.fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    await pipeline(found.body, response);
  }
}
