import {
  keepProduct,
  type PhotoBox,
  PICTURE_SIDE,
  type PixelRect,
  productPlace,
  stampPlace,
} from '@tugeel/shared/pictures';
import { UnsupportedImageError } from './image-resize';

// The office's side of the catalogue picture (ADR-0198): the browser draws what
// `@tugeel/shared/pictures` lays out, so the server handles no pixels for the web, and the result
// is uploaded like any other product photo.

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new UnsupportedImageError('no canvas');
  return { canvas, context };
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new UnsupportedImageError('cannot decode');
  }
}

/**
 * The finished picture as a JPEG: `cutOut` is the background service's PNG, `box` the product's
 * place on the photo when the model named it, `stamp` the company's logo when one is uploaded.
 */
export async function composeProductPicture(
  cutOut: Blob,
  box: PhotoBox | null,
  stamp: Blob | null,
  quality = 0.9,
): Promise<Blob> {
  const bitmap = await decode(cutOut);
  let source: HTMLCanvasElement;
  let bounds: PixelRect | null;
  try {
    const cut = canvasOf(bitmap.width, bitmap.height);
    cut.context.drawImage(bitmap, 0, 0);
    const pixels = cut.context.getImageData(0, 0, bitmap.width, bitmap.height);
    bounds = keepProduct(pixels.data, bitmap.width, bitmap.height, box);
    cut.context.putImageData(pixels, 0, 0);
    source = cut.canvas;
  } finally {
    bitmap.close();
  }
  if (!bounds) throw new UnsupportedImageError('nothing left of the picture');

  const { canvas, context } = canvasOf(PICTURE_SIDE, PICTURE_SIDE);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
  context.imageSmoothingQuality = 'high';
  const logo = stamp ? await decode(stamp) : null;
  try {
    const logoAt = logo ? stampPlace(logo.width, logo.height) : null;
    const place = productPlace(bounds, PICTURE_SIDE, logoAt);
    context.drawImage(
      source,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      place.x,
      place.y,
      place.width,
      place.height,
    );
    if (logo && logoAt) context.drawImage(logo, logoAt.x, logoAt.y, logoAt.width, logoAt.height);
  } finally {
    logo?.close();
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  if (!blob || blob.type !== 'image/jpeg') throw new UnsupportedImageError('encoding failed');
  return blob;
}

/** Bytes that came as base64 in a JSON answer, as a file of the given type. */
export function blobOfBase64(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
