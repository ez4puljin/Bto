import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { type CallOutcome, callerOf } from './dial';

export { type CallOutcome, telUriOf } from './dial';

// The phone's side of a direct call (the owner, 2026-10-18): Android's ACTION_CALL through
// expo-intent-launcher once CALL_PHONE is granted (app.config.ts declares it), the dialer otherwise.
// The rules are in dial.ts.

/**
 * Calls a number at once: Android asks for CALL_PHONE on the first tap; without it, and on other
 * platforms, the dialer opens with the number filled in. Never throws.
 */
export const callNow: (phone: string) => Promise<CallOutcome> = callerOf({
  direct: Platform.OS === 'android',
  hasPermission: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE),
  askPermission: () => PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE),
  startCall: (uri) =>
    IntentLauncher.startActivityAsync('android.intent.action.CALL', { data: uri }),
  openDialer: (uri) => Linking.openURL(uri),
});
