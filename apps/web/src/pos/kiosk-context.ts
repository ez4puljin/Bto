import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EdgeClient, KioskCredentials, KioskCredentialsState } from './edge-client';

export interface KioskServices {
  client: EdgeClient;
  credentials: KioskCredentials;
  /** ADR-0138: the POS the page was opened for (`…:7400/K1`); null: pair with a code. */
  addressTill?: string | null;
}

export const KioskContext = createContext<KioskServices | null>(null);

export function useKiosk(): KioskServices {
  const services = useContext(KioskContext);
  if (!services) throw new Error('useKiosk outside <KioskApp>');
  return services;
}

/** The device and session tokens as they change (pairing, PIN, sign-out, expiry). */
export function useCredentials(): KioskCredentialsState {
  const { credentials } = useKiosk();
  return useSyncExternalStore(
    credentials.subscribe,
    credentials.getSnapshot,
    credentials.getSnapshot,
  );
}
