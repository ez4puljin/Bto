import type { AppVariant } from '../config/app-config';

/**
 * How far the phone's font size setting may enlarge an app's text. Both apps keep the sizes
 * measured on the E-mart screens: «Bto300» since the owner asked «яг ийм хэмжээтэй» (2026-10-21,
 * ADR-0095), the rep app since it took «Bto300»'s look (2026-10-23, ADR-0100; it allowed 1.15
 * before, ADR-0068 #11). A larger setting does not enlarge them; a smaller one still shrinks them.
 */
export const FONT_SCALE_CAPS: Record<AppVariant, number> = { customer: 1, staff: 1 };

export function fontScaleCap(variant: AppVariant): number {
  return FONT_SCALE_CAPS[variant];
}
