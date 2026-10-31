import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { readBrand, writeBrand } from '../device/storage';
import { useSession } from '../state/session';
import { applyBrand, type BrandInput, brandOf, NO_BRAND } from './brand';

/**
 * Takes what a server said about the apps (ADR-0127 #4: `appName`, `appColor` on
 * `/app-settings/branding`, `/customer-app/me` and `/sales-rep/context`) into use and keeps it for
 * that server, so the next start begins in it.
 */
export async function learnBrand(server: string, input: BrandInput): Promise<void> {
  const brand = brandOf(input);
  applyBrand(brand);
  await writeBrand(server, brand);
}

/** Whether the stored brand of the current server is in use (the first screen waits for it). */
const BrandReadyContext = createContext(false);

/**
 * The brand of the server in use: the stored one as soon as the server is known (before any
 * screen, so nothing flashes blue first), then the server's public `GET /app-settings/branding`
 * — before a token exists, for the sign-in screens — and the store's `/customer-app/me` once the
 * session is restored or signed in. No server (the server screen) shows the built-in brand.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const { server, session, state } = useSession();
  const [readyFor, setReadyFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (server === undefined) return;
    if (server === null) {
      applyBrand(NO_BRAND);
      setReadyFor(null);
      return;
    }
    let live = true;
    void readBrand(server).then((stored) => {
      if (!live) return;
      applyBrand(stored);
      setReadyFor(server);
    });
    return () => {
      live = false;
    };
  }, [server]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    void session.client
      .GET('/api/v1/app-settings/branding')
      .then((answer) => {
        if (live && answer.data) void learnBrand(session.server, answer.data);
      })
      .catch(() => {
        // No connection: the stored brand stays until the server answers.
      });
    return () => {
      live = false;
    };
  }, [session]);

  useEffect(() => {
    if (server && state.status === 'signedIn' && 'store' in state.me) {
      void learnBrand(server, state.me.store);
    }
  }, [server, state]);

  return (
    <BrandReadyContext.Provider value={readyFor !== undefined && readyFor === server}>
      {children}
    </BrandReadyContext.Provider>
  );
}

export function useBrandReady(): boolean {
  return useContext(BrandReadyContext);
}
