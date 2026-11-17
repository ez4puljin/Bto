import type { LocalUpload } from './upload-file';

/**
 * The web copy of the app (`pnpm mobile:web`): a picked or resized image is a blob or data URL of
 * the page, read whole and sent with fetch.
 */
export async function localUpload(uri: string): Promise<LocalUpload> {
  const blob = await (await fetch(uri)).blob();
  return {
    size: blob.size,
    put: async (url, headers) => {
      const response = await fetch(url, { method: 'PUT', headers, body: blob });
      return { status: response.status, body: await response.text() };
    },
  };
}
