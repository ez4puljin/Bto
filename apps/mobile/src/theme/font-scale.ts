import type { AppVariant } from '../config/app-config';

/**
 * How far the phone's font size setting may enlarge an app's text. The rep app caps it at 1.15
 * (the owner found it too big, 2026-10-17, ADR-0068 #11). «Bto300» keeps the sizes measured on the
 * E-mart screens (the owner, 2026-10-21: «яг ийм хэмжээтэй», ADR-0095): a larger setting does not
 * enlarge it; a smaller one still shrinks it.
 */
export function fontScaleCap(variant: AppVariant): number {
  return variant === 'customer' ? 1 : 1.15;
}
