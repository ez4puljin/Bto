import type { ConfigContext, ExpoConfig } from 'expo/config';

// One Expo project, one variant per APP_VARIANT (ADR-0006 #1). Only the staff app exists so far
// (ADR-0061): the sales-rep route group. The customer app comes with delivery 6.
const variant = process.env.APP_VARIANT ?? 'staff';
if (variant !== 'staff') throw new Error(`APP_VARIANT=${variant} is not built yet (ADR-0061)`);

/** Production builds talk HTTPS only; builds for the office network may use plain HTTP (ADR-0061 #2). */
const production = process.env.APP_ENV === 'production';

const versionCode = Number.parseInt(process.env.BTO_VERSION_CODE ?? '1', 10);

const inter = (face: string) =>
  require.resolve(`@expo-google-fonts/inter/${face}/Inter_${face}.ttf`);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bto',
  slug: 'bto-staff',
  scheme: 'bto-staff',
  version: '0.6.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  backgroundColor: '#F2F2F7',
  android: {
    // TODO-VERIFY (owner): permanent once the app is handed to the reps.
    package: 'mn.butenorgil.bto.staff',
    versionCode: Number.isSafeInteger(versionCode) && versionCode > 0 ? versionCode : 1,
    allowBackup: false,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0071E3' },
    // A store's number calls at once (the owner, 2026-10-18): src/phone/call.ts, asked on first tap.
    permissions: ['android.permission.CALL_PHONE'],
    // The store map asks for the position only while it is open (foreground, the owner 2026-10-18).
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ],
    softwareKeyboardLayoutMode: 'resize',
  },
  plugins: [
    'expo-router',
    ['expo-camera', { recordAudioAndroid: false }],
    'expo-secure-store',
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-font',
      {
        fonts: [inter('400Regular'), inter('500Medium'), inter('600SemiBold'), inter('700Bold')],
      },
    ],
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 96, backgroundColor: '#FFFFFF' },
    ],
    ['expo-build-properties', { android: { usesCleartextTraffic: !production } }],
    './plugins/with-cmake-object-path.cjs',
  ],
  extra: {
    /** The PC's address on the office network, filled in by `pnpm mobile:apk`. */
    defaultServer: process.env.BTO_DEFAULT_SERVER ?? null,
  },
});
