import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../../../common/config/app-config';

/** The apps of `apps/mobile/variants.json` a release can be published for (ADR-0166). */
export const APP_RELEASE_VARIANTS = ['staff', 'customer'] as const;
export type AppReleaseVariant = (typeof APP_RELEASE_VARIANTS)[number];

export function isAppReleaseVariant(value: string): value is AppReleaseVariant {
  return (APP_RELEASE_VARIANTS as readonly string[]).includes(value);
}

/** `latest.json`, written by `pnpm mobile:publish`; a name with no path can only stay in its folder. */
const manifestSchema = z.object({
  version: z.string().min(1).max(32),
  versionCode: z.number().int().positive(),
  fileName: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.apk$/),
  sizeBytes: z.number().int().positive(),
});

export type AppRelease = z.infer<typeof manifestSchema>;

/**
 * The newest published APK of each app (ADR-0166): `<STORAGE_LOCAL_DIR>/releases/<variant>/` holds
 * `latest.json` and its APK, outside the `files` table because nobody uploads them through the api.
 * A folder with no release, an unreadable manifest or a file of another size is simply no release:
 * a phone must never be offered a download that cannot finish.
 */
@Injectable()
export class AppReleasesService {
  private readonly root: string;

  constructor(config: AppConfig) {
    this.root = join(config.get('STORAGE_LOCAL_DIR'), 'releases');
  }

  async latest(variant: AppReleaseVariant): Promise<AppRelease | null> {
    const folder = join(this.root, variant);
    let text: string;
    try {
      text = await readFile(join(folder, 'latest.json'), 'utf8');
    } catch {
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const manifest = manifestSchema.safeParse(raw);
    if (!manifest.success) return null;
    try {
      const file = await stat(join(folder, manifest.data.fileName));
      return file.size === manifest.data.sizeBytes ? manifest.data : null;
    } catch {
      return null;
    }
  }

  /** The newest APK's bytes, or null when there is no release to download. */
  async open(variant: AppReleaseVariant): Promise<{ release: AppRelease; body: Readable } | null> {
    const release = await this.latest(variant);
    if (!release) return null;
    return { release, body: createReadStream(join(this.root, variant, release.fileName)) };
  }
}
