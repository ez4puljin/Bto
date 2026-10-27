/*
 * Code 128 for the till's coupon and voucher cards (ADR-0110): code set C only, which packs two
 * digits into each symbol, so a 16-digit code is a short barcode any scanner reads.
 */

/**
 * The bar and space widths (in modules, bar first) of symbols 0–106: 0–102 are values, 103–105
 * the start codes A, B and C, 106 the stop (13 modules with its final bar).
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212',
  '112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131',
  '311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321',
  '112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121',
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111',
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114',
  '122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212',
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113',
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112',
]
  .join(' ')
  .split(' ');

export const CODE128_START_C = 105;
export const CODE128_STOP = 106;

/**
 * The symbols of an even-length string of digits in code set C: start C, one symbol per pair of
 * digits, the checksum (start + Σ position × value, mod 103) and the stop.
 */
export function code128CSymbols(digits: string): number[] {
  if (!/^(?:[0-9]{2})+$/.test(digits)) {
    throw new Error('code set C takes a non-empty, even-length string of digits');
  }
  const values: number[] = [];
  for (let index = 0; index < digits.length; index += 2) {
    values.push((digits.charCodeAt(index) - 48) * 10 + (digits.charCodeAt(index + 1) - 48));
  }
  const checksum =
    values.reduce((sum, value, index) => sum + value * (index + 1), CODE128_START_C) % 103;
  return [CODE128_START_C, ...values, checksum, CODE128_STOP];
}

/** The module widths of the whole barcode, alternating bar, space, bar…, without quiet zones. */
export function code128CModules(digits: string): number[] {
  return code128CSymbols(digits).flatMap((symbol) =>
    [...(CODE128_PATTERNS[symbol] ?? '')].map((width) => width.charCodeAt(0) - 48),
  );
}
