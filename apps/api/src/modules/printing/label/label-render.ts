import type { OverlayOptions, Sharp, SharpOptions } from 'sharp';

/**
 * The supermarket price label of the old system, drawn on the server (ADR-0226 #2). The old
 * system wrote Erxes' «Шошго» template as HTML (pos_label.py `_TEMPLATE`, `_RECEIPT_CSS`,
 * `_FIT_JS`) and had a headless browser draw it 272 CSS px wide, scaled to the printer's 576 dots.
 * This draws the same boxes and text with libvips' Pango (sharp's `text` input) at the same
 * sizes: every length below is the template's CSS pixels, multiplied by `dots / 272`.
 *
 *   ┌──────────────────────────────────┐  2 px frame, 3 px padding, no bottom border
 *   │        Product name (16 bold)     │  centred, wraps
 *   │ code: 101007 (12 b, 14 b)  date10 │  flex, baseline, space-between
 *   ├──────────────────────────────────┤
 *   │ Үнэ :(18)  29,700 (22 bold)       │
 *   │ Бөөний ширхэг 2 Бөөний үнэ: 29,130│  16 / 20 bold, shrunk to one line
 *   └──────────────────────────────────┘
 */

/** What one label says; the strings are printed as given (the caller formats them). */
export interface LabelFace {
  name: string;
  code: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Thousands with commas, no ₮; empty when unknown. */
  price: string;
  /** Empty when the till has no bulk price for the product. */
  bulkQty: string;
  bulkPrice: string;
}

/** A label as 8-bit grey pixels, one byte a dot, rows top to bottom; 255 is white. */
export interface LabelBitmap {
  width: number;
  height: number;
  grey: Buffer;
}

type SharpFactory = (input?: Buffer | Uint8Array | SharpOptions, options?: SharpOptions) => Sharp;

let factory: SharpFactory | undefined;

/** libvips, loaded at the first label and not when the api starts (as common/images does). */
async function vips(): Promise<SharpFactory> {
  factory ??= (await import('sharp')).default as SharpFactory;
  return factory;
}

const CSS_WIDTH = 272;
/** Arial's metrics (Liberation Sans has the same): ascent, descent and line gap per em. */
const ASCENT = 1854 / 2048;
const DESCENT = 434 / 2048;
const LINE_GAP = 67 / 2048;
/** CSS `line-height: normal` and where the baseline sits in that line. */
const lineHeight = (px: number) => (ASCENT + DESCENT + LINE_GAP) * px;
const baselineIn = (px: number) => (LINE_GAP / 2 + ASCENT) * px;
/** The receipt CSS's root size: the `<p>`s' strut and their 1em margins. */
const ROOT_PX = 11;
const BORDER = 2;
const PADDING = 3;
const MARGIN = ROOT_PX;
/** Arial first; Liberation Sans is metric-compatible and has Cyrillic; then any sans. */
const FONT = 'Arial, Liberation Sans, Helvetica, DejaVu Sans, sans-serif';
/** Invisible glyphs taller and deeper than any text, so every run's image has the same frame. */
const STRUT = 'ÉЙqу|';
const NBSP = ' ';

interface Segment {
  text: string;
  px: number;
  bold?: boolean;
}

interface Run {
  /** RGBA pixels of the visible part, full frame height. */
  rgba: Buffer;
  width: number;
  height: number;
  /** Rows from the frame's top down to the baseline. */
  baseline: number;
}

const escapeMarkup = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const span = (segment: Segment, scale: number) =>
  `<span size="${Math.max(1, Math.round(segment.px * scale * 1024))}"${
    segment.bold ? ' weight="bold"' : ''
  } foreground="#000000">${escapeMarkup(segment.text)}</span>`;

async function rasterise(markup: string): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = await vips();
  const { data, info } = await sharp({
    text: { text: markup, font: FONT, dpi: 72, rgba: true, wrap: 'none' },
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const baselines = new Map<number, number>();

/** Where the baseline sits in a strut's frame of this pixel size: the bottom of an «H». */
async function strutBaseline(sizeDots: number): Promise<number> {
  const key = Math.round(sizeDots * 1024);
  const known = baselines.get(key);
  if (known !== undefined) return known;
  const image = await rasterise(
    `<span size="${key}" foreground="#000000">H</span><span size="${key}" fgalpha="1">${STRUT}</span>`,
  );
  let bottom = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) {
        bottom = y + 1;
        break;
      }
    }
  }
  baselines.set(key, bottom);
  return bottom;
}

/** One line of text in spans, cut to its visible columns, with its baseline. */
async function run(segments: readonly Segment[], scale: number): Promise<Run> {
  const largest = Math.max(...segments.map((segment) => segment.px)) * scale;
  const strutSize = Math.round(largest * 1024);
  const image = await rasterise(
    `${segments.map((segment) => span(segment, scale)).join('')}<span size="${strutSize}" fgalpha="1">${STRUT}</span>`,
  );
  let left = image.width;
  let right = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  const baseline = await strutBaseline(largest);
  if (right < left) {
    return { rgba: Buffer.alloc(0), width: 0, height: image.height, baseline };
  }
  const width = right - left + 1;
  const rgba = Buffer.alloc(width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) {
    image.data.copy(
      rgba,
      y * width * 4,
      (y * image.width + left) * 4,
      (y * image.width + right + 1) * 4,
    );
  }
  return { rgba, width, height: image.height, baseline };
}

/** The name in lines no wider than `limit` dots: by words, a word too long by characters. */
async function wrapName(name: string, scale: number, limit: number): Promise<Run[]> {
  const style = (text: string): Segment[] => [{ text, px: 16, bold: true }];
  const whole = await run(style(name), scale);
  if (whole.width <= limit) return [whole];
  const lines: Run[] = [];
  let current = '';
  let currentRun: Run | null = null;
  const pieces = name.split(/\s+/).filter((word) => word.length > 0);
  for (const word of pieces) {
    const candidate = current ? `${current} ${word}` : word;
    const tried = await run(style(candidate), scale);
    if (tried.width <= limit) {
      current = candidate;
      currentRun = tried;
      continue;
    }
    if (currentRun) lines.push(currentRun);
    const alone = await run(style(word), scale);
    if (alone.width <= limit) {
      current = word;
      currentRun = alone;
      continue;
    }
    // A word wider than the label: as many characters a line as fit.
    let chunk = '';
    let chunkRun: Run | null = null;
    for (const char of word) {
      const next = await run(style(chunk + char), scale);
      if (next.width > limit && chunkRun) {
        lines.push(chunkRun);
        chunk = char;
        chunkRun = await run(style(chunk), scale);
      } else {
        chunk += char;
        chunkRun = next;
      }
    }
    current = chunk;
    currentRun = chunkRun;
  }
  if (currentRun) lines.push(currentRun);
  return lines;
}

/** The bulk line's spans at a factor of their sizes. */
const bulkSegments = (face: LabelFace, factor: number): Segment[] => [
  { text: `Бөөний ширхэг${NBSP}`, px: 16 * factor },
  { text: face.bulkQty, px: 16 * factor, bold: true },
  { text: `${NBSP}Бөөний үнэ: `, px: 16 * factor },
  { text: face.bulkPrice, px: 20 * factor, bold: true },
];

interface Placed {
  run: Run;
  /** Left edge of the visible text, in dots. */
  x: number;
  /** The baseline, in dots from the label's top. */
  baselineY: number;
}

/**
 * Draws one label `widthDots` wide (576 for 80 mm paper, 384 for 58 mm), as tall as its frame:
 * the old system cut the browser's picture to the frame the same way.
 */
export async function renderLabel(face: LabelFace, widthDots = 576): Promise<LabelBitmap> {
  const scale = widthDots / CSS_WIDTH;
  const dots = (css: number) => css * scale;
  const contentLeft = BORDER + PADDING;
  const contentWidth = CSS_WIDTH - 2 * (BORDER + PADDING);
  const limit = Math.floor(dots(contentWidth));
  const placed: Placed[] = [];

  // The top box.
  let y = BORDER + PADDING + MARGIN;
  const nameLines = await wrapName(face.name.trim(), scale, limit);
  for (const line of nameLines) {
    placed.push({
      run: line,
      x: dots(contentLeft) + (dots(contentWidth) - line.width) / 2,
      baselineY: dots(y + baselineIn(16)),
    });
    y += lineHeight(16);
  }
  y += MARGIN;
  const codeRun = await run(
    [
      { text: 'code', px: 12, bold: true },
      { text: ': ', px: ROOT_PX },
      { text: `${face.code} `, px: 14, bold: true },
    ],
    scale,
  );
  const dateRun = await run([{ text: face.date, px: 10 }], scale);
  const codeBaseline = dots(y + baselineIn(14));
  placed.push({ run: codeRun, x: dots(contentLeft), baselineY: codeBaseline });
  placed.push({
    run: dateRun,
    x: dots(contentLeft + contentWidth) - dateRun.width,
    baselineY: codeBaseline,
  });
  y += lineHeight(14) + MARGIN + PADDING;
  const dividerTop = y;

  // The bottom box.
  y += BORDER + PADDING + MARGIN;
  const priceRun = await run(
    [
      { text: 'Үнэ :', px: 18 },
      { text: `${NBSP} `, px: ROOT_PX },
      { text: `${face.price} `, px: 22, bold: true },
    ],
    scale,
  );
  placed.push({ run: priceRun, x: dots(contentLeft), baselineY: dots(y + baselineIn(22)) });
  y += lineHeight(22) + MARGIN;
  // _FIT_JS: every span 3 % smaller at a time until the line fits, never below half.
  let factor = 1;
  let bulkRun = await run(bulkSegments(face, factor), scale);
  while (bulkRun.width > dots(contentWidth + 1) && factor > 0.5) {
    factor -= 0.03;
    bulkRun = await run(bulkSegments(face, factor), scale);
  }
  const bulkLine = Math.max(20 * factor, ROOT_PX);
  placed.push({ run: bulkRun, x: dots(contentLeft), baselineY: dots(y + baselineIn(bulkLine)) });
  y += lineHeight(bulkLine) + MARGIN + PADDING + BORDER;

  const height = Math.round(dots(y));
  const border = Math.max(1, Math.round(dots(BORDER)));
  const black = (left: number, top: number, width: number, tall: number) => ({
    input: {
      create: {
        width: Math.max(1, width),
        height: Math.max(1, tall),
        channels: 4 as const,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    },
    left,
    top,
  });
  const divider = Math.round(dots(dividerTop));
  const layers: OverlayOptions[] = [
    black(0, 0, widthDots, border),
    black(0, divider, widthDots, border),
    black(0, height - border, widthDots, border),
    black(0, 0, border, height),
    black(widthDots - border, 0, border, height),
  ];
  for (const item of placed) {
    if (item.run.width === 0) continue;
    const left = Math.max(0, Math.round(item.x));
    const top = Math.round(item.baselineY - item.run.baseline);
    const width = Math.min(item.run.width, widthDots - left);
    if (width <= 0 || top < 0 || top + item.run.height > height) continue;
    let input = item.run.rgba;
    if (width < item.run.width) {
      input = await (
        await vips()
      )(item.run.rgba, {
        raw: { width: item.run.width, height: item.run.height, channels: 4 },
      })
        .extract({ left: 0, top: 0, width, height: item.run.height })
        .raw()
        .toBuffer();
    }
    layers.push({
      input,
      raw: { width, height: item.run.height, channels: 4 },
      left,
      top,
    });
  }
  const grey = await (
    await vips()
  )({
    create: { width: widthDots, height, channels: 3, background: '#ffffff' },
  })
    .composite(layers)
    .greyscale()
    .raw()
    .toBuffer();
  // greyscale() keeps three channels in a raw buffer: take one.
  const channels = grey.length / (widthDots * height);
  const single = Buffer.alloc(widthDots * height);
  for (let index = 0; index < single.length; index += 1) {
    single[index] = grey[index * channels] ?? 255;
  }
  return { width: widthDots, height, grey: single };
}

/** The label as a black-and-white PNG, as the printer will print it (for tests and previews). */
export async function labelPng(bitmap: LabelBitmap): Promise<Buffer> {
  const bw = Buffer.alloc(bitmap.grey.length);
  for (let index = 0; index < bw.length; index += 1) {
    bw[index] = (bitmap.grey[index] ?? 255) < INK_THRESHOLD ? 0 : 255;
  }
  const sharp = await vips();
  return sharp(bw, { raw: { width: bitmap.width, height: bitmap.height, channels: 1 } })
    .png()
    .toBuffer();
}

/** Grey below this prints black (the old system's 150). */
export const INK_THRESHOLD = 150;
