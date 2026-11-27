import { CODE128_PATTERNS } from '@/lib/barcode/code128';

/** Set B uses the same Code128 pattern table as the receipt labels. */
export function expiryBarcodeBars(value: string) {
  if (!/^BTOEXP-[1-9]\d*$/.test(value)) throw new RangeError('expiry barcode');
  const data = [...value].map((char) => char.charCodeAt(0) - 32);
  const checksum = data.reduce((sum, code, i) => sum + code * (i + 1), 104) % 103;
  const symbols = [104, ...data, checksum, 106];
  const widths = symbols.flatMap((code) => [...(CODE128_PATTERNS[code] ?? '')].map(Number));
  let x = 10;
  const bars = widths.flatMap((width, i) => {
    const bar = i % 2 === 0 ? [{ x, width }] : [];
    x += width;
    return bar;
  });
  return { bars, width: x + 10 };
}
