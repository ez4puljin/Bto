import { RECEIPT_TEMPLATE_LIMITS } from '@tugeel/shared/pos';

/** The receipt printer's dots across 72 mm at 203 dpi: a logo is never drawn wider. */
const MAX_WIDTH = 576;
const MAX_HEIGHT = 300;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = src;
  });
}

/** A file as a data URL, kept in the editor so the picture can be made again with other settings. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(file);
  });
}

/**
 * ADR-0142: a picture made fit for the receipt printer, as the POS tools advise (black and white,
 * no grey): at most 576 × 300 dots, on white, each dot black or white — by a threshold for a logo,
 * or dithered (Floyd–Steinberg) for a photo — as a PNG data URL within the template's limit
 * (made smaller until it fits). Null when it cannot be made small enough.
 */
export async function receiptLogo(source: string, dither: boolean): Promise<string | null> {
  const image = await load(source);
  let scale = Math.min(1, MAX_WIDTH / image.width, MAX_HEIGHT / image.height);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    const grey = new Float32Array(width * height);
    for (let index = 0; index < grey.length; index += 1) {
      const at = index * 4;
      grey[index] =
        0.299 * (data[at] ?? 255) + 0.587 * (data[at + 1] ?? 255) + 0.114 * (data[at + 2] ?? 255);
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const old = grey[index] ?? 255;
        const value = old < (dither ? 128 : 160) ? 0 : 255;
        if (dither) {
          const error = old - value;
          const spread = (dx: number, dy: number, share: number) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny >= height) return;
            const at = ny * width + nx;
            grey[at] = (grey[at] ?? 255) + error * share;
          };
          spread(1, 0, 7 / 16);
          spread(-1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(1, 1, 1 / 16);
        }
        const at = index * 4;
        data[at] = value;
        data[at + 1] = value;
        data[at + 2] = value;
        data[at + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (url.length <= RECEIPT_TEMPLATE_LIMITS.maxImageChars) return url;
    scale *= 0.75;
  }
  return null;
}
