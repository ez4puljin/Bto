import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../common/config/app-config';

/** Upload URLs live 15 minutes (ADR-0030); signed downloads arrive with the first private kind. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** Path of the local driver's routes under the API prefix (identity FilesController). */
export const LOCAL_FILES_PATH = '/api/v1/files/local';

export interface UploadClaim {
  name: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * HMAC signatures of the local driver's URLs (api only). The key is derived from JWT_SECRET with HKDF,
 * so no extra secret exists; rotating JWT_SECRET invalidates URLs issued in the last 15 minutes.
 */
@Injectable()
export class StorageUrlSigner {
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    this.key = Buffer.from(
      hkdfSync(
        'sha256',
        config.require('JWT_SECRET'),
        Buffer.alloc(0),
        'tugeel storage url v1',
        32,
      ),
    );
  }

  uploadUrl(claim: UploadClaim, now = Date.now()): { url: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + UPLOAD_URL_TTL_SECONDS;
    const sig = this.sign(this.uploadPayload(claim, exp));
    return {
      url: `${LOCAL_FILES_PATH}/${claim.name}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** True for an unexpired signature over exactly this name, type and size. */
  verifyUpload(claim: UploadClaim, exp: string, sig: string, now = Date.now()): boolean {
    const expiry = /^\d{1,12}$/.test(exp) ? Number.parseInt(exp, 10) : Number.NaN;
    const remaining = expiry - Math.floor(now / 1000);
    if (!(remaining >= 0 && remaining <= UPLOAD_URL_TTL_SECONDS)) return false;
    const expected = Buffer.from(this.sign(this.uploadPayload(claim, expiry)));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private uploadPayload(claim: UploadClaim, exp: number): string {
    return ['PUT', claim.name, String(exp), claim.contentType, String(claim.sizeBytes)].join('\n');
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload, 'utf8').digest('base64url');
  }
}
