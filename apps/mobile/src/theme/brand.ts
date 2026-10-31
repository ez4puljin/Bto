import { APP_SETTINGS_LIMITS } from '@tugeel/shared/sales';

// The office's branding of the apps (ADR-0127 #4): the display name and the primary colour it set
// on «Апп → Ерөнхий», read from the server and kept on the phone per server. The tokens read the
// colour from here (`src/theme/tokens.ts`); a sheet built on it is rebuilt when it changes
// (`brandSheet`). Pure: no React, no storage.

/** What the office set, checked: a name or null, a usable `#RRGGBB` or null. */
export interface Brand {
  name: string | null;
  primary: string | null;
}

export const NO_BRAND: Brand = { name: null, primary: null };

/** Bto's own blue (docs/ui.md §1). */
export const BUILT_IN_PRIMARY = '#0071E3';

/**
 * White text and icons sit on the primary colour everywhere (the header band, the buttons, the
 * tab bar's camera): a colour that gives them less contrast than WCAG's 3:1 for large text and
 * controls is not used, and the built-in blue stays.
 */
export const MIN_CONTRAST_WITH_WHITE = 3;

/** What the server says about the apps (`/app-settings/branding`, `/customer-app/me`, `/sales-rep/context`). */
export interface BrandInput {
  appName?: string | null | undefined;
  appColor?: string | null | undefined;
}

type Rgb = readonly [number, number, number];

function rgbOf(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

const hex2 = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

const hexOf = ([r, g, b]: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** WCAG 2 relative luminance of an sRGB colour. */
function luminanceOf([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio of white text on a colour, 1 (white on white) to 21 (on black). */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminanceOf(rgbOf(hex)) + 0.05);
}

/** Whether a value is a `#RRGGBB` white text can stand on. */
export function isUsableColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    APP_SETTINGS_LIMITS.colorPattern.test(value) &&
    contrastWithWhite(value) >= MIN_CONTRAST_WITH_WHITE
  );
}

/** The office's name, trimmed, within the web form's limit; nothing else counts. */
export function usableName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name !== '' && name.length <= APP_SETTINGS_LIMITS.maxAppName ? name : null;
}

/** The brand a server answer (or a stored copy) gives; anything odd falls back to the built-in. */
export function brandOf(input: BrandInput | null | undefined): Brand {
  return {
    name: usableName(input?.appName),
    primary: isUsableColor(input?.appColor) ? input.appColor.toUpperCase() : null,
  };
}

/** A stored `{name, primary}`, checked the same way (an old or odd value is no brand). */
export function storedBrandOf(value: unknown): Brand {
  if (typeof value !== 'object' || value === null) return NO_BRAND;
  const stored = value as { name?: unknown; primary?: unknown };
  return brandOf({
    appName: typeof stored.name === 'string' ? stored.name : null,
    appColor: typeof stored.primary === 'string' ? stored.primary : null,
  });
}

export function sameBrand(a: Brand, b: Brand): boolean {
  return a.name === b.name && a.primary === b.primary;
}

/** The colours the primary one decides (`docs/ui.md` §1: the pressed shade, links, the tint, the glows). */
export interface Palette {
  primary: string;
  /** A pressed button and a link: the primary a tenth darker. */
  primaryPressed: string;
  link: string;
  /** The soft tint behind a blue chip. */
  secondary: string;
  /** The tinted range of a calendar. */
  rangeFill: string;
  shadows: {
    brand: string;
    accentCard: string;
    scanButton: string;
    bluePill: string;
  };
}

/** The web's values (apps/web/src/index.css), byte for byte, when the office set no colour. */
export const BUILT_IN_PALETTE: Palette = {
  primary: BUILT_IN_PRIMARY,
  primaryPressed: '#0066CC',
  link: '#0066CC',
  secondary: '#E8F0FB',
  rangeFill: 'rgba(0,113,227,0.12)',
  shadows: {
    brand: '0 6px 16px rgba(0,113,227,0.28)',
    accentCard: '0 6px 18px rgba(0,113,227,0.22)',
    scanButton: '0 4px 12px rgba(0,113,227,0.35)',
    bluePill: '0 8px 24px rgba(0,113,227,0.3)',
  },
};

/** The palette of a primary colour; the built-in one for null. */
export function paletteOf(primary: string | null): Palette {
  if (primary === null) return BUILT_IN_PALETTE;
  const rgb = rgbOf(primary);
  const [r, g, b] = rgb;
  const darker = hexOf([r * 0.9, g * 0.9, b * 0.9]);
  const tint = hexOf([255 - (255 - r) * 0.09, 255 - (255 - g) * 0.09, 255 - (255 - b) * 0.09]);
  const alpha = (value: number) => `rgba(${r},${g},${b},${value})`;
  return {
    primary,
    primaryPressed: darker,
    link: darker,
    secondary: tint,
    rangeFill: alpha(0.12),
    shadows: {
      brand: `0 6px 16px ${alpha(0.28)}`,
      accentCard: `0 6px 18px ${alpha(0.22)}`,
      scanButton: `0 4px 12px ${alpha(0.35)}`,
      bluePill: `0 8px 24px ${alpha(0.3)}`,
    },
  };
}

// --- The store: one brand for the running app, read by the tokens and by `useBrand()`.

let current: Brand = NO_BRAND;
let currentPalette: Palette = BUILT_IN_PALETTE;
let version = 0;
const listeners = new Set<() => void>();

export function currentBrand(): Brand {
  return current;
}

/** The palette of the brand in use: the tokens' getters read it at every render. */
export function currentPaletteOf(): Palette {
  return currentPalette;
}

/** Grows with every change; a sheet built on an older version is built again. */
export function brandVersion(): number {
  return version;
}

/** Puts a brand in use; true when anything changed (then every listener hears). */
export function applyBrand(brand: Brand): boolean {
  if (sameBrand(current, brand)) return false;
  current = brand;
  currentPalette = paletteOf(brand.primary);
  version += 1;
  for (const listener of listeners) listener();
  return true;
}

export function subscribeBrand(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A module-level sheet (or colour map) that reads the primary colour: expo-router loads every
 * screen when the app starts, before the stored brand is read, so `StyleSheet.create({...})` would
 * keep the built-in blue for good. Wrapped here, the sheet is built again the first time it is read
 * after the brand changed; the screens read it exactly as before (`styles.row`).
 */
export function brandSheet<T extends object>(build: () => T): T {
  let built = build();
  let builtAt = version;
  const sheet = () => {
    if (builtAt !== version) {
      built = build();
      builtAt = version;
    }
    return built;
  };
  const view = {} as T;
  for (const key of Object.keys(built) as (keyof T)[]) {
    Object.defineProperty(view, key, { enumerable: true, get: () => sheet()[key] });
  }
  return view;
}
