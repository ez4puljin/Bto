import { File } from 'expo-file-system';

/** A local file ready to go up through a signed upload URL: its size first, for the presign. */
export interface LocalUpload {
  size: number;
  put: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;
}

/** A file of the phone's cache (a photo taken, picked or resized) as an upload. */
export function localUpload(uri: string): Promise<LocalUpload> {
  const file = new File(uri);
  return Promise.resolve({
    size: file.size,
    put: (url, headers) => file.upload(url, { httpMethod: 'PUT', headers }),
  });
}
