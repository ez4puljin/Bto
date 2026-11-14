import { UnsupportedImageError } from './image-resize';

// The catalogue picture «AI ашиглах» makes of a product (ADR-0198): the background service's
// cut-out, only the product kept (a matchbox laid beside it for scale goes), centred on a white
// square with the company's logo in the top-left corner. The browser draws it, so the server
// handles no pixels; the result is uploaded like any other product photo.

/** The side of the finished picture, in pixels. */
export const PICTURE_SIDE = 1000;
/** White space kept around the product, as a share of the side. */
export const PICTURE_MARGIN = 0.07;
/** The logo's box in the top-left corner: its distance from the edges and its size, as shares. */
export const STAMP_MARGIN = 0.035;
export const STAMP_WIDTH = 0.22;
export const STAMP_HEIGHT = 0.14;
/** Clear space kept between the logo and the product. */
export const STAMP_GAP = 0.015;
/**
 * A pixel at least half opaque belongs to an object. Fainter ones do not join objects: the haze
 * of a shadow between the product and a matchbox must not make one object of the two.
 */
const SOLID = 128;
/** Pixels of an object's soft rim kept around it. */
const RIM = 3;
/** A separate object is the product's when at least this share of it lies in the product's place. */
const INSIDE = 0.5;

/** A place on a photo, as fractions of its width and height. */
export interface PhotoBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Keeps the product and clears everything else in an RGBA image's alpha channel, and returns the
 * product's bounds (null: nothing is left of the picture). Objects are the connected groups of
 * solid pixels. With the product's place known (the model's answer), every object lying mostly
 * inside it stays — a set of two bottles is one product — together with the one that overlaps it
 * most; without it, or when nothing overlaps, the largest object is the product.
 */
export function keepProduct(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  box: PhotoBox | null,
): PixelRect | null {
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  const objects: { area: number; inside: number; rect: PixelRect }[] = [];
  const inBox = box
    ? {
        x0: box.left * width,
        y0: box.top * height,
        x1: (box.left + box.width) * width,
        y1: (box.top + box.height) * height,
      }
    : null;
  const solid = (pixel: number) => (rgba[pixel * 4 + 3] ?? 0) >= SOLID;

  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== 0 || !solid(start)) continue;
    const label = objects.length + 1;
    let area = 0;
    let inside = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const pixel = stack.pop() ?? 0;
      const x = pixel % width;
      const y = (pixel - x) / width;
      area += 1;
      if (inBox && x >= inBox.x0 && x < inBox.x1 && y >= inBox.y0 && y < inBox.y1) inside += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const visit = (next: number) => {
        if (labels[next] === 0 && solid(next)) {
          labels[next] = label;
          stack.push(next);
        }
      };
      if (x > 0) visit(pixel - 1);
      if (x < width - 1) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y < height - 1) visit(pixel + width);
    }
    objects.push({
      area,
      inside,
      rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }
  if (objects.length === 0) return null;

  const by = (key: 'area' | 'inside') =>
    objects.reduce((best, object, index) => {
      const bestObject = objects[best];
      return bestObject && object[key] > bestObject[key] ? index : best;
    }, 0);
  const keep = new Set<number>();
  const most = by('inside');
  if ((objects[most]?.inside ?? 0) > 0) {
    keep.add(most);
    objects.forEach((object, index) => {
      if (object.inside >= object.area * INSIDE) keep.add(index);
    });
  } else {
    keep.add(by('area'));
  }

  // The soft rim of a kept object (pixels too faint to be solid) stays with it, so its edge is
  // not jagged: a few rounds, a pixel each, take the label of a kept neighbour.
  for (let round = 0; round < RIM; round += 1) {
    const rim: number[] = [];
    for (let pixel = 0; pixel < labels.length; pixel += 1) {
      if (labels[pixel] !== 0 || (rgba[pixel * 4 + 3] ?? 0) === 0) continue;
      const x = pixel % width;
      const near = [
        x > 0 ? labels[pixel - 1] : 0,
        x < width - 1 ? labels[pixel + 1] : 0,
        labels[pixel - width],
        labels[pixel + width],
      ].find((label) => label !== undefined && label > 0 && keep.has(label - 1));
      if (near !== undefined) rim.push(pixel, near);
    }
    for (let at = 0; at < rim.length; at += 2) labels[rim[at] ?? 0] = rim[at + 1] ?? 0;
  }
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const label = labels[pixel] ?? 0;
    // What is left is another object, or haze far from the product: it goes.
    if (label === 0 || !keep.has(label - 1)) rgba[pixel * 4 + 3] = 0;
  }
  let bounds: PixelRect | null = null;
  for (const index of keep) {
    const rect = objects[index]?.rect;
    if (!rect) continue;
    if (!bounds) {
      bounds = { ...rect };
      continue;
    }
    const right = Math.max(bounds.x + bounds.width, rect.x + rect.width);
    const bottom = Math.max(bounds.y + bounds.height, rect.y + rect.height);
    bounds.x = Math.min(bounds.x, rect.x);
    bounds.y = Math.min(bounds.y, rect.y);
    bounds.width = right - bounds.x;
    bounds.height = bottom - bounds.y;
  }
  return bounds;
}

/**
 * Where the product is drawn on the square: as large as the margins allow, in the middle. With a
 * logo in the corner (`avoid`), a product that would reach under it is drawn in the room below
 * the logo instead, so the two never overlap; a narrow one (a bottle) keeps the whole height.
 */
export function productPlace(
  bounds: PixelRect,
  side = PICTURE_SIDE,
  avoid: PixelRect | null = null,
): PixelRect {
  const margin = side * PICTURE_MARGIN;
  const fit = (top: number): PixelRect => {
    const roomWidth = side - 2 * margin;
    const roomHeight = side - margin - top;
    const scale = Math.min(roomWidth / bounds.width, roomHeight / bounds.height);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    return {
      x: Math.round((side - width) / 2),
      y: Math.round(top + (roomHeight - height) / 2),
      width,
      height,
    };
  };
  const whole = fit(margin);
  if (!avoid) return whole;
  const gap = side * STAMP_GAP;
  const under = whole.x < avoid.x + avoid.width + gap && whole.y < avoid.y + avoid.height + gap;
  return under ? fit(avoid.y + avoid.height + gap) : whole;
}

/** Where the logo is drawn: inside its box in the top-left corner, at its own proportions. */
export function stampPlace(logoWidth: number, logoHeight: number, side = PICTURE_SIDE): PixelRect {
  const scale = Math.min((side * STAMP_WIDTH) / logoWidth, (side * STAMP_HEIGHT) / logoHeight);
  return {
    x: Math.round(side * STAMP_MARGIN),
    y: Math.round(side * STAMP_MARGIN),
    width: Math.max(1, Math.round(logoWidth * scale)),
    height: Math.max(1, Math.round(logoHeight * scale)),
  };
}

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
