import type { ApiClient } from '@tugeel/api-client';
import type { FileKind } from '@tugeel/shared/files';
import { ApiProblem, problemOf, unwrap } from '@/lib/problem';

/**
 * Asks the API for an upload URL, sends the bytes there and returns the file id (ADR-0030). The PUT
 * is a plain fetch without the Authorization header: after go-live the URL points at the bucket,
 * which must not see our token. A path starting with "/" is relative to the API origin.
 */
export async function uploadFile(
  api: ApiClient,
  kind: FileKind,
  blob: Blob,
  options: { origin?: string; fetch?: typeof fetch } = {},
): Promise<number> {
  const issued = unwrap(
    await api.POST('/api/v1/files/presign', {
      body: { kind, contentType: blob.type, sizeBytes: blob.size },
    }),
  );
  const origin = options.origin ?? window.location.origin;
  const url = issued.uploadUrl.startsWith('/') ? `${origin}${issued.uploadUrl}` : issued.uploadUrl;
  const send = options.fetch ?? fetch;
  const response = await send(url, { method: 'PUT', headers: issued.headers, body: blob });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiProblem(problemOf(body));
  }
  return issued.fileId;
}
