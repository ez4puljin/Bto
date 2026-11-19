import { INK_THRESHOLD, type LabelBitmap } from './label-render';

// ESC/POS for an 80 mm thermal receipt printer, as the old system sent it (label_printer.py):
// `ESC @`, the picture as 1-bit raster `GS v 0` in bands of at most 255 rows (the printer's
// buffer), then `GS V 66 0`, which feeds to the cutter and cuts along the frame.

const INIT = Buffer.from([0x1b, 0x40]);
const CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);
const BAND_ROWS = 255;

/** One label's bytes: initialise, raster bands, cut. */
export function labelEscPos(bitmap: LabelBitmap): Buffer {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const parts: Buffer[] = [INIT];
  for (let top = 0; top < bitmap.height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bitmap.height - top);
    const band = Buffer.alloc(8 + bytesPerRow * rows);
    band.set(
      [0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8],
      0,
    );
    for (let row = 0; row < rows; row += 1) {
      const y = top + row;
      for (let byte = 0; byte < bytesPerRow; byte += 1) {
        let value = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = byte * 8 + bit;
          if (x < bitmap.width && (bitmap.grey[y * bitmap.width + x] ?? 255) < INK_THRESHOLD) {
            value |= 0x80 >> bit;
          }
        }
        band[8 + row * bytesPerRow + byte] = value;
      }
    }
    parts.push(band);
  }
  parts.push(CUT);
  return Buffer.concat(parts);
}
