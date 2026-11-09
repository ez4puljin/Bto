import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

// «Нууц үг сануулах» and the fingerprint sign-in of the staff app (ADR-0174): the login and the
// password the person chose to keep, in the phone's secure storage (Android Keystore), for the one
// server they were typed for. The fingerprint (or the phone's own lock) only unlocks them here; the
// server still checks the password as on any sign-in.

const KEY = 'bto.login.saved.v1';

export type SavedLogin = { login: string; password: string };

type Stored = SavedLogin & { server: string };

function isStored(value: unknown): value is Stored {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Stored).server === 'string' &&
    typeof (value as Stored).login === 'string' &&
    typeof (value as Stored).password === 'string'
  );
}

/** The login kept for this server, or null; a read that fails is "nothing kept". */
export async function readSavedLogin(server: string): Promise<SavedLogin | null> {
  try {
    const text = await SecureStore.getItemAsync(KEY);
    if (!text) return null;
    const value = JSON.parse(text) as unknown;
    if (!isStored(value) || value.server !== server) return null;
    return { login: value.login, password: value.password };
  } catch {
    return null;
  }
}

/** Keeps the login for this server (one at a time), or forgets it with null. */
export async function writeSavedLogin(server: string, value: SavedLogin | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, JSON.stringify({ server, ...value } satisfies Stored));
  } catch {
    // Storage is a convenience: the next sign-in writes again.
  }
}

/** Whether the phone can unlock with a fingerprint (or face) that its owner has enrolled. */
export async function biometricsReady(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

/** Asks for the fingerprint; the phone's PIN or pattern is the fallback Android offers. */
export async function confirmWithBiometrics(
  promptMessage: string,
  cancelLabel: string,
): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel });
    return result.success;
  } catch {
    return false;
  }
}
