import {
  keepProduct,
  type PhotoBox,
  PICTURE_SIDE,
  productPlace,
  stampPlace,
} from '@tugeel/shared/pictures';
import type { Sharp, SharpOptions } from 'sharp';

// The api's hands for pictures (ADR-0199): the staff app has no canvas, so what the office's
// browser draws for itself (ADR-0198) the server draws for a phone, by the same rules of
// `@tugeel/shared/pictures`. libvips works off the event loop; only `keepProduct` runs on it, a
// tenth of a second for a 1280 px photo.

/** Longest side of a photo as it is kept and sent on (ADR-0030: the web scales to the same). */
export const PHOTO_MAX_SIDE = 1280;
export const THUMB_MAX_SIDE = 256;
/** A decoded photo larger than this is refused before it takes the memory (a phone's is ~50 MP). */
const MAX_INPUT_PIXELS = 120_000_000;

/** Thrown for bytes that are no picture libvips can read. */
export class UnreadablePictureError extends Error {
  constructor(reason: string) {
    super(`unreadable picture: ${reason}`);
    this.name = 'UnreadablePictureError';
  }
}

type SharpFactory = (
  input?: Buffer | Uint8Array | Uint8ClampedArray | SharpOptions,
  options?: SharpOptions,
) => Sharp;

let factory: SharpFactory | undefined;

/**
 * libvips, loaded at the first picture and not when the api starts: a native library that would
 * not load on some machine then costs the phone its pictures, never the whole api its start.
 */
async function vips(): Promise<SharpFactory> {
  factory ??= (await import('sharp')).default as SharpFactory;
  return factory;
}

const open = async (bytes: Buffer) =>
  (await vips())(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

async function reading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof UnreadablePictureError) throw error;
    throw new UnreadablePictureError(error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * A photo as the rest of the flow wants it: upright, within 1280 px, a JPEG without EXIF. One that
 * already is (the web's uploads) comes back untouched, byte for byte; a phone's camera photo is
 * turned by its EXIF orientation, scaled down and re-encoded.
 */
export async function normalisedPhoto(bytes: Buffer): Promise<Buffer> {
  return reading(async () => {
    const meta = await (await open(bytes)).metadata();
    const upright = meta.orientation === undefined || meta.orientation === 1;
    const small = Math.max(meta.width, meta.height) <= PHOTO_MAX_SIDE;
    if (meta.format === 'jpeg' && upright && small) return bytes;
    return (await open(bytes))
      .rotate()
      .resize({
        width: PHOTO_MAX_SIDE,
        height: PHOTO_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  });
}

/** The 256 px thumbnail of a product photo, as the web makes it. */
export async function thumbnailOf(jpeg: Buffer): Promise<Buffer> {
  return reading(async () =>
    (await open(jpeg))
      .resize({
        width: THUMB_MAX_SIDE,
        height: THUMB_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
}

/**
 * The finished catalogue picture as a JPEG: `cutOut` is the background service's PNG, `box` the
 * product's place on the photo when the model named it, `stamp` the company's logo when one is
 * uploaded. Null when nothing is left of the cut-out (the service found no subject).
 */
export async function composedPicture(
  cutOut: Buffer,
  box: PhotoBox | null,
  stamp: Buffer | null,
): Promise<Buffer | null> {
  return reading(async () => {
    const sharp = await vips();
    const { data, info } = await (
      await open(cutOut)
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bounds = keepProduct(data, info.width, info.height, box);
    if (!bounds) return null;

    let logo: { input: Buffer; left: number; top: number; width: number; height: number } | null =
      null;
    if (stamp) {
      const meta = await (await open(stamp)).metadata();
      const at = stampPlace(meta.width, meta.height);
      logo = {
        input: await (
          await open(stamp)
        )
          .resize({ width: at.width, height: at.height, fit: 'fill' })
          .png()
          .toBuffer(),
        left: at.x,
        top: at.y,
        width: at.width,
        height: at.height,
      };
    }
    const place = productPlace(
      bounds,
      PICTURE_SIDE,
      logo ? { x: logo.left, y: logo.top, width: logo.width, height: logo.height } : null,
    );
    const product = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
      .resize({ width: place.width, height: place.height, fit: 'fill' })
      .png()
      .toBuffer();
    return sharp({
      create: { width: PICTURE_SIDE, height: PICTURE_SIDE, channels: 3, background: '#ffffff' },
    })
      .composite([
        { input: product, left: place.x, top: place.y },
        ...(logo ? [{ input: logo.input, left: logo.left, top: logo.top }] : []),
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  });
}
