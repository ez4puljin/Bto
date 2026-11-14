import sharp from 'sharp';
import {
  composedPicture,
  normalisedPhoto,
  PHOTO_MAX_SIDE,
  thumbnailOf,
  UnreadablePictureError,
} from './product-picture';

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } });

/** A transparent PNG with opaque rectangles: what the background service answers. */
async function cutOut(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number; colour: string }[],
): Promise<Buffer> {
  const layers = await Promise.all(
    rects.map(async (rect) => ({
      input: await solid(rect.w, rect.h, rect.colour).png().toBuffer(),
      left: rect.x,
      top: rect.y,
    })),
  );
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/** The colour of a finished picture at a point, as [r, g, b]. */
async function colourAt(jpeg: Buffer, x: number, y: number): Promise<number[]> {
  const { data } = await sharp(jpeg)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [...data.subarray(0, 3)];
}
const isRed = ([r, g, b]: number[]) => (r ?? 0) > 200 && (g ?? 255) < 60 && (b ?? 255) < 60;
const isBlue = ([r, g, b]: number[]) => (b ?? 0) > 200 && (r ?? 255) < 60 && (g ?? 255) < 60;
const isGreen = ([r, g, b]: number[]) => (g ?? 0) > 100 && (r ?? 255) < 60 && (b ?? 255) < 60;
const isWhite = ([r, g, b]: number[]) => (r ?? 0) > 245 && (g ?? 0) > 245 && (b ?? 0) > 245;

describe('photos and pictures on the server (ADR-0199)', () => {
  it('leaves an upright small JPEG untouched, byte for byte', async () => {
    const photo = await solid(640, 480, '#336699').jpeg().toBuffer();
    expect(await normalisedPhoto(photo)).toBe(photo);
  });

  it('scales a camera photo down and turns it upright by its EXIF orientation', async () => {
    // Orientation 6: the sensor's 4000 × 3000 is a portrait photo for the person.
    const camera = await solid(4000, 3000, '#336699')
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const meta = await sharp(await normalisedPhoto(camera)).metadata();
    expect([meta.width, meta.height]).toEqual([960, PHOTO_MAX_SIDE]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.format).toBe('jpeg');
  });

  it('turns a PNG into a JPEG on white', async () => {
    const png = await cutOut(100, 100, [{ x: 0, y: 0, w: 50, h: 100, colour: '#ff0000' }]);
    const jpeg = await normalisedPhoto(png);
    expect((await sharp(jpeg).metadata()).format).toBe('jpeg');
    expect(isWhite(await colourAt(jpeg, 80, 50))).toBe(true);
  });

  it('refuses bytes that are no picture', async () => {
    await expect(normalisedPhoto(Buffer.from('not a picture'))).rejects.toBeInstanceOf(
      UnreadablePictureError,
    );
  });

  it('makes the thumbnail within 256 px', async () => {
    const jpeg = await solid(1000, 1000, '#ffffff').jpeg().toBuffer();
    const meta = await sharp(await thumbnailOf(jpeg)).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it('keeps the product, drops the matchbox and centres it on a white square', async () => {
    // A tall red product and a small blue matchbox apart from it.
    const png = await cutOut(600, 800, [
      { x: 100, y: 50, w: 200, h: 700, colour: '#ff0000' },
      { x: 420, y: 650, w: 100, h: 60, colour: '#0000ff' },
    ]);
    const picture = await composedPicture(png, null, null);
    if (!picture) throw new Error('a picture was expected');
    const meta = await sharp(picture).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1000, 1000, 'jpeg']);
    expect(isRed(await colourAt(picture, 500, 500))).toBe(true);
    expect(isWhite(await colourAt(picture, 20, 20))).toBe(true);
    // Nothing blue anywhere: the matchbox is gone.
    const { data } = await sharp(picture).raw().toBuffer({ resolveWithObject: true });
    let blue = 0;
    for (let at = 0; at < data.length; at += 3) {
      if (isBlue([data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0])) blue += 1;
    }
    expect(blue).toBe(0);
  });

  it('keeps what lies in the place the model named, even when it is the smaller object', async () => {
    const png = await cutOut(600, 600, [
      { x: 40, y: 400, w: 80, h: 60, colour: '#ff0000' },
      { x: 300, y: 300, w: 250, h: 200, colour: '#0000ff' },
    ]);
    const picture = await composedPicture(
      png,
      { left: 0.05, top: 0.6, width: 0.2, height: 0.2 },
      null,
    );
    if (!picture) throw new Error('a picture was expected');
    expect(isRed(await colourAt(picture, 500, 500))).toBe(true);
  });

  it('draws the logo in the top-left corner and keeps a wide product clear of it', async () => {
    const png = await cutOut(800, 800, [{ x: 0, y: 0, w: 800, h: 800, colour: '#ff0000' }]);
    const logo = await solid(300, 100, '#008000').png().toBuffer();
    const picture = await composedPicture(png, null, logo);
    if (!picture) throw new Error('a picture was expected');
    // The logo's box starts 35 px from the corner; the product starts below it.
    expect(isGreen(await colourAt(picture, 60, 60))).toBe(true);
    expect(isWhite(await colourAt(picture, 500, 60))).toBe(true);
    expect(isRed(await colourAt(picture, 500, 600))).toBe(true);
  });

  it('answers null when nothing is left of the cut-out', async () => {
    expect(await composedPicture(await cutOut(50, 50, []), null, null)).toBeNull();
  });
});
