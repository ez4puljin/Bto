import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// One Expo project, one app per APP_VARIANT (ADR-0006 #1, ADR-0085): `staff`, the sales-rep app
// (ADR-0061), and `customer`, the stores' app «Bto300» (ADR-0079). variants.json holds what differs
// (name, package, version, icons, the APK's name); `pnpm mobile:apk -- --variant <name>` reads it too.
interface Variant {
  name: string;
  slug: string;
  version: string;
  package: string;
  assets: string;
  apkPrefix: string;
  location: boolean;
}

const variants = JSON.parse(readFileSync(path.join(__dirname, 'variants.json'), 'utf8')) as Record<
  string,
  Variant
>;
const variantName = process.env.APP_VARIANT ?? 'staff';
const variant = variants[variantName];
if (!variant) throw new Error(`APP_VARIANT=${variantName} is not one of variants.json's apps`);

/** Production builds talk HTTPS only; builds for the office network may use plain HTTP (ADR-0061 #2). */
const production = process.env.APP_ENV === 'production';

/** The PC's address on the office network, filled in by `pnpm mobile:apk`. */
const defaultServer = process.env.BTO_DEFAULT_SERVER || null;

const versionCode = Number.parseInt(process.env.BTO_VERSION_CODE ?? '1', 10);

const inter = (face: string) =>
  require.resolve(`@expo-google-fonts/inter/${face}/Inter_${face}.ttf`);

const location = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant.name,
  slug: variant.slug,
  scheme: variant.slug,
  version: variant.version,
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: `${variant.assets}/icon.png`,
  backgroundColor: '#F2F2F7',
  android: {
    // TODO-VERIFY (owner): permanent once the app is handed out (ADR-0061, ADR-0079 #10).
    package: variant.package,
    versionCode: Number.isSafeInteger(versionCode) && versionCode > 0 ? versionCode : 1,
    allowBackup: false,
    adaptiveIcon: {
      foregroundImage: `${variant.assets}/adaptive-icon.png`,
      backgroundColor: '#0071E3',
    },
    // A store's number (staff) or the office's (customer, ADR-0079 #14) calls at once:
    // src/phone/call.ts, asked on the first tap.
    permissions: ['android.permission.CALL_PHONE'],
    // The store map asks for the position only while it is open (foreground, the owner 2026-10-18);
    // the customer app never asks for it.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      ...(variant.location ? [] : location),
    ],
    softwareKeyboardLayoutMode: 'resize',
  },
  plugins: [
    'expo-router',
    ['expo-camera', { recordAudioAndroid: false }],
    'expo-secure-store',
    ...(variant.location
      ? [
          [
            'expo-location',
            {
              isAndroidBackgroundLocationEnabled: false,
              isAndroidForegroundServiceEnabled: false,
              isIosBackgroundLocationEnabled: false,
            },
          ] as [string, Record<string, boolean>],
        ]
      : []),
    [
      'expo-font',
      {
        fonts: [inter('400Regular'), inter('500Medium'), inter('600SemiBold'), inter('700Bold')],
      },
    ],
    [
      'expo-splash-screen',
      { image: `${variant.assets}/splash-icon.png`, imageWidth: 96, backgroundColor: '#FFFFFF' },
    ],
    ['expo-build-properties', { android: { usesCleartextTraffic: !production } }],
    './plugins/with-cmake-object-path.cjs',
  ],
  extra: {
    /** Which app this build is: src/config/app.ts picks its screens (ADR-0085). */
    variant: variantName,
    defaultServer,
    /** A production build talks only to the server it was built for (ADR-0079 #10). */
    serverFixed: production && defaultServer !== null,
  },
});
