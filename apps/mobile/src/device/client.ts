import { type AppClient, appUserAgent } from '@tugeel/shared/device';
import type { AppVariant } from '../config/app-config';

// How the app names itself and its phone to the server (the `User-Agent` of every call): the
// session row of a sign-in keeps it, and the office reads it on the staff member's page. Pure:
// what React Native knows is handed in (`install.ts` does that).

/** The apps' names in the header. */
export const APP_NAMES: Record<AppVariant, string> = { staff: 'Bto-staff', customer: 'Bto300' };

/** What `Platform` of react-native gives: `constants` differs by system. */
export interface PlatformFacts {
  OS: string;
  Version: string | number;
  constants?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The phone's system and model. Android says its release («14»), brand and model; iOS says its
 * version and only that it is an iPhone or an iPad.
 */
export function phoneOf(
  platform: PlatformFacts,
): Pick<AppClient, 'os' | 'osVersion' | 'brand' | 'model'> {
  const constants = (
    typeof platform.constants === 'object' && platform.constants !== null ? platform.constants : {}
  ) as Record<string, unknown>;
  if (platform.OS === 'android') {
    return {
      os: 'Android',
      // `Version` is the API level (34); `Release` is what people call the version (14).
      osVersion: text(constants.Release) || `API ${String(platform.Version)}`,
      brand: text(constants.Brand) || text(constants.Manufacturer),
      model: text(constants.Model),
    };
  }
  if (platform.OS === 'ios') {
    return {
      os: 'iOS',
      osVersion: text(constants.osVersion) || String(platform.Version),
      brand: 'Apple',
      model: constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone',
    };
  }
  return { os: platform.OS, osVersion: String(platform.Version), brand: '', model: '' };
}

/** `Bto-staff/0.19.0 (Android 14; samsung SM-A546E; id 3f2a9c1e)`. */
export function userAgentOf(input: {
  variant: AppVariant;
  version: string;
  platform: PlatformFacts;
  installId: string;
}): string {
  return appUserAgent({
    app: APP_NAMES[input.variant],
    version: input.version,
    ...phoneOf(input.platform),
    installId: input.installId,
  });
}
