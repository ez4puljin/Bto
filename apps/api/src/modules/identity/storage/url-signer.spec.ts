import type { AppConfig } from '../../../common/config/app-config';
import { StorageUrlSigner, UPLOAD_URL_TTL_SECONDS } from './url-signer';

const signerWith = (secret: string) =>
  new StorageUrlSigner({ require: () => secret } as unknown as AppConfig);
const claim = {
  name: '0b6a2f0e-3c1d-4a5b-8c7d-9e0f1a2b3c4d.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 1234,
};
const query = (url: string) => {
  const parsed = new URL(url, 'http://tugeel.test');
  return { exp: parsed.searchParams.get('exp') ?? '', sig: parsed.searchParams.get('sig') ?? '' };
};

describe('StorageUrlSigner (ADR-0030)', () => {
  const now = Date.UTC(2026, 9, 11, 3, 0, 0);
  const signer = signerWith('test-jwt-secret-0123456789abcdefghijklmnop');

  it('signs an upload URL for exactly one name, type and size', () => {
    const { url, expiresAt } = signer.uploadUrl(claim, now);
    expect(url).toMatch(/^\/api\/v1\/files\/local\/0b6a2f0e-[0-9a-f-]+\.jpg\?exp=\d+&sig=[\w-]+$/);
    expect(expiresAt.getTime()).toBe(now + UPLOAD_URL_TTL_SECONDS * 1000);
    const { exp, sig } = query(url);
    expect(signer.verifyUpload(claim, exp, sig, now)).toBe(true);
    expect(signer.verifyUpload({ ...claim, sizeBytes: 1235 }, exp, sig, now)).toBe(false);
    expect(signer.verifyUpload({ ...claim, contentType: 'image/png' }, exp, sig, now)).toBe(false);
    const other = { ...claim, name: claim.name.replace('0b6a', '1b6a') };
    expect(signer.verifyUpload(other, exp, sig, now)).toBe(false);
  });

  it('refuses expired, far-future, malformed and foreign signatures', () => {
    const { exp, sig } = query(signer.uploadUrl(claim, now).url);
    expect(signer.verifyUpload(claim, exp, sig, now + (UPLOAD_URL_TTL_SECONDS + 1) * 1000)).toBe(
      false,
    );
    const farFuture = String(Number.parseInt(exp, 10) + 3600);
    expect(signer.verifyUpload(claim, farFuture, sig, now)).toBe(false);
    expect(signer.verifyUpload(claim, '1e9', sig, now)).toBe(false);
    expect(signer.verifyUpload(claim, exp, `${sig}x`, now)).toBe(false);
    const foreign = signerWith('another-jwt-secret-0123456789abcdefghijkl');
    expect(foreign.verifyUpload(claim, exp, sig, now)).toBe(false);
  });
});
