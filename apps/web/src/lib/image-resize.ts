/** Longest side of stored product photos and their thumbnails (ADR-0030). */
export const IMAGE_MAX_SIDE = 1280;
export const THUMB_MAX_SIDE = 256;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Thrown for files the browser cannot turn into a JPEG (HEIC on desktop Chrome, PDFs, …). */
export class UnsupportedImageError extends Error {
  constructor(reason: string) {
    super(`unsupported image: ${reason}`);
    this.name = 'UnsupportedImageError';
  }
}

/** Target size within `maxSide`, keeping the aspect ratio and never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decodes a photo with its EXIF orientation applied, scales it down on a white background and
 * re-encodes it as JPEG. Re-encoding also drops EXIF and GPS data from phone photos.
 */
export async function resizeToJpeg(file: Blob, maxSide: number, quality = 0.85): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new UnsupportedImageError(file.type || 'unknown');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedImageError('cannot decode');
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new UnsupportedImageError('no canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob || blob.type !== 'image/jpeg') throw new UnsupportedImageError('encoding failed');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** «Bto300»'s banner (2:1, ADR-0092 #5) and a top category's picture (square, #6). */
export const BANNER_SIZE = { width: 1200, height: 600 } as const;
export const CATEGORY_PICTURE_SIZE = { width: 512, height: 512 } as const;

/**
 * The part of a `width` × `height` image that fills a `targetWidth` × `targetHeight` frame when
 * cut from its middle (CSS `object-fit: cover`).
 */
export function coverRect(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(targetWidth / width, targetHeight / height);
  const cropWidth = Math.min(width, Math.round(targetWidth / scale));
  const cropHeight = Math.min(height, Math.round(targetHeight / scale));
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * A picture cut from the middle of the photo to exactly `size` (a banner, a category tile), as a
 * JPEG without EXIF; a smaller photo is scaled up to fill the frame.
 */
export async function cropToJpeg(
  file: Blob,
  size: { width: number; height: number },
  quality = 0.85,
): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new UnsupportedImageError(file.type || 'unknown');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnsupportedImageError('cannot decode');
  }
  try {
    const source = coverRect(bitmap.width, bitmap.height, size.width, size.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new UnsupportedImageError('no canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      size.width,
      size.height,
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob || blob.type !== 'image/jpeg') throw new UnsupportedImageError('encoding failed');
    return blob;
  } finally {
    bitmap.close();
  }
}
