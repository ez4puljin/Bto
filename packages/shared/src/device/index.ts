// What a sign-in says about the device it came from. The apps name themselves in the `User-Agent`
// header (`appUserAgent`), the api stores that header on the session row as it is, and the web
// reads it back into words (`describeClient`). One format, written and read here only.

/** What an app knows about its phone. */
export interface AppClient {
  /** The app's own name in the header: `Bto-staff`, `Bto300`. */
  app: string;
  /** `0.19.0`. */
  version: string;
  /** `Android`, `iOS`. */
  os: string;
  /** `14`. */
  osVersion: string;
  /** `samsung`. */
  brand: string;
  /** `SM-A546E`. */
  model: string;
  /** A random id made once per install: tells two phones of one model apart. */
  installId: string;
}

/** Printable ASCII without the header format's own separators, squeezed and cut. */
function clean(value: string, max: number): string {
  return value
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/[();/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** `3f2a9c1e`: the first eight hex digits of an install's id; `00000000` when it has none. */
export function shortInstallId(id: string): string {
  const hex = id.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length >= 8 ? hex.slice(0, 8) : '00000000';
}

/**
 * The header an app sends: `Bto-staff/0.19.0 (Android 14; samsung SM-A546E; id 3f2a9c1e)`. Always
 * plain ASCII and at most about 150 characters (the api keeps 300).
 */
export function appUserAgent(client: AppClient): string {
  const app = clean(client.app, 24).replace(/\s/g, '-') || 'Bto';
  const version = clean(client.version, 16).replace(/\s/g, '') || '0';
  const os = `${clean(client.os, 16)} ${clean(client.osVersion, 16)}`.trim() || 'unknown';
  const brand = clean(client.brand, 32);
  const model = clean(client.model, 48);
  // Many models begin with their brand («Xiaomi Redmi …»): it is not said twice.
  const device =
    (model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`.trim()) ||
    'unknown';
  return `${app}/${version} (${os}; ${device}; id ${shortInstallId(client.installId)})`;
}

/** What a stored `User-Agent` says, as far as it can be read. */
export type ClientDescription =
  /** One of our apps since it names itself. */
  | {
      kind: 'app';
      app: string;
      appVersion: string;
      os: string;
      device: string;
      installId: string;
    }
  /** One of our apps from before it named itself: only the HTTP library is known. */
  | { kind: 'legacyApp' }
  | { kind: 'browser'; browser: string; os: string }
  /** A script or a tool: the header as it came. */
  | { kind: 'other'; raw: string }
  | { kind: 'unknown' };

const APP = /^(Bto[\w-]*)\/([\w.-]+) \(([^;)]+); ([^;)]+); id ([0-9a-f]{8})\)$/;

function browserOf(agent: string): string | null {
  const pick = (pattern: RegExp, name: string): string | null => {
    const match = pattern.exec(agent);
    return match?.[1] ? `${name} ${match[1]}` : null;
  };
  // Order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
  return (
    pick(/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge') ??
    pick(/\bOPR\/(\d+)/, 'Opera') ??
    pick(/\bSamsungBrowser\/(\d+)/, 'Samsung Internet') ??
    pick(/\bFirefox\/(\d+)/, 'Firefox') ??
    pick(/\b(?:Chrome|CriOS)\/(\d+)/, 'Chrome') ??
    pick(/\bVersion\/(\d+)[\d.]* (?:Mobile\/\w+ )?Safari\//, 'Safari')
  );
}

function osOf(agent: string): string {
  const android = /\bAndroid (\d+(?:\.\d+)?)/.exec(agent);
  if (android?.[1]) return `Android ${android[1]}`;
  const ios = /\b(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(agent);
  if (ios?.[1]) return `iOS ${ios[1]}.${ios[2] ?? '0'}`;
  // Windows 11 still says «NT 10.0»: the header cannot tell them apart.
  if (/\bWindows NT 10\.0/.test(agent)) return 'Windows 10/11';
  if (/\bWindows NT/.test(agent)) return 'Windows';
  if (/\bMac OS X/.test(agent)) return 'macOS';
  if (/\bCrOS\b/.test(agent)) return 'ChromeOS';
  if (/\bLinux\b/.test(agent)) return 'Linux';
  return '';
}

/** Reads a session's stored `User-Agent`; never throws, whatever a client sent. */
export function describeClient(userAgent: string | null | undefined): ClientDescription {
  const agent = userAgent?.trim() ?? '';
  if (!agent) return { kind: 'unknown' };
  const app = APP.exec(agent);
  if (app?.[1] && app[2] && app[3] && app[4] && app[5]) {
    return {
      kind: 'app',
      app: app[1],
      appVersion: app[2],
      os: app[3],
      device: app[4],
      installId: app[5],
    };
  }
  // React Native's Android HTTP library, before the apps named themselves (2026-11-13).
  if (/^okhttp\//.test(agent)) return { kind: 'legacyApp' };
  if (/^Mozilla\//.test(agent)) {
    const browser = browserOf(agent);
    if (browser) return { kind: 'browser', browser, os: osOf(agent) };
  }
  return { kind: 'other', raw: agent };
}
