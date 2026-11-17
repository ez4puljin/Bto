import Constants from 'expo-constants';
import { appConfigOf } from './app-config';

/**
 * The web copy of the app (`pnpm mobile:web`): its server is the page's own address, which passes
 * `/api` and `/health` on to the api (`scripts/web.mjs`), so there is no server screen, and a
 * browser never updates an APK.
 */
const built = appConfigOf(Constants.expoConfig?.extra);
export const APP = {
  ...built,
  defaultServer: window.location.origin,
  serverFixed: true,
  selfUpdate: false,
};
