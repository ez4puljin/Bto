// A tap on a store's or a contact's number calls at once (the owner, 2026-10-18). This is the pure
// part: the number's `tel:` URI and the choice between a direct call and the dialer. The phone's
// permission and intent calls come in as a CallDevice from src/phone/call.ts, so this runs in tests
// without React Native.

/** What a tap did: the call was placed, the dialer opened with the number, or there was no number. */
export type CallOutcome = 'called' | 'dialer' | 'none';

/** The phone's side of a call; src/phone/call.ts fills it from React Native and expo-intent-launcher. */
export interface CallDevice {
  /** Android: a call can be placed at once (ACTION_CALL); elsewhere only the dialer opens. */
  readonly direct: boolean;
  /** CALL_PHONE is granted already. */
  hasPermission(): Promise<boolean>;
  /** Android's prompt: 'granted', 'denied' or 'never_ask_again' (PermissionsAndroid.RESULTS). */
  askPermission(): Promise<string>;
  /** Places the call: settles only when the rep comes back to the app, rejects when Android refuses. */
  startCall(uri: string): Promise<unknown>;
  /** The dialer with the number filled in: the rep presses call. */
  openDialer(uri: string): Promise<unknown>;
  /** The clock in milliseconds (Date.now by default; tests pass their own). */
  now?(): number;
}

/**
 * After a call is placed, taps for this long are the same call: a double tap, or the number's row
 * and then «Залгах», lands before the in-call screen covers the app on a slow phone.
 */
export const CALL_COOLDOWN_MS = 2000;

/** `tel:` and the number's digits, keeping a `+` typed before them; null when there is no digit. */
export function telUriOf(phone: string): string | null {
  const first = phone.search(/\d/);
  if (first < 0) return null;
  const plus = phone.slice(0, first).includes('+') ? '+' : '';
  return `tel:${plus}${phone.replace(/\D/g, '')}`;
}

/**
 * The tap handler on a device. A granted CALL_PHONE calls at once; the permission is asked on the
 * first tap only, and after a «no» (or a «never ask again») every tap opens the dialer until the app
 * restarts. Anything that fails before the call opens the dialer too; it never throws. Taps within
 * CALL_COOLDOWN_MS of a placed call do nothing more (no second call, no dialer over the call).
 */
export function callerOf(device: CallDevice): (phone: string) => Promise<CallOutcome> {
  const now = () => (device.now ? device.now() : Date.now());
  let asked = false;
  let busy: Promise<CallOutcome> | null = null;
  let placedAt: number | null = null;

  const dialer = async (uri: string): Promise<CallOutcome> => {
    try {
      await device.openDialer(uri);
    } catch {
      // No dialer on the phone: nothing more to try.
    }
    return 'dialer';
  };

  const mayCall = async (): Promise<boolean> => {
    if (await device.hasPermission()) return true;
    if (asked) return false;
    asked = true;
    return (await device.askPermission()) === 'granted';
  };

  const place = async (uri: string): Promise<CallOutcome> => {
    if (!device.direct) return dialer(uri);
    // Not cleared when the call's promise settles: Android may settle it at once, before the
    // in-call screen shows, and a second ACTION_CALL (or the dialer) must not follow.
    if (placedAt !== null && now() - placedAt < CALL_COOLDOWN_MS) return 'called';
    try {
      if (!(await mayCall())) return dialer(uri);
      placedAt = now();
      // Not awaited: Android settles it only when the rep comes back from the call. A refusal (a
      // SecurityException, no app for ACTION_CALL) falls back to the dialer. So does
      // E_ACTIVITY_ALREADY_STARTED: past the cooldown it means an earlier call's result never came
      // back, and the dialer still lets the rep call.
      void device.startCall(uri).catch(() => dialer(uri));
      return 'called';
    } catch {
      return dialer(uri);
    }
  };

  return (phone) => {
    const uri = telUriOf(phone);
    if (uri === null) return Promise.resolve('none');
    // A second tap while the first is still asking or dialling is the same call.
    busy ??= place(uri).finally(() => {
      busy = null;
    });
    return busy;
  };
}
