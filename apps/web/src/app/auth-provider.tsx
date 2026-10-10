import { type ReactNode, useEffect } from 'react';
import { AuthSessionContext } from '@/app/auth-context';
import type { AuthSession } from '@/lib/auth/auth-session';

/** Provides the session and restores it from the refresh cookie on start. */
export function AuthProvider({ session, children }: { session: AuthSession; children: ReactNode }) {
  useEffect(() => {
    void session.restore();
  }, [session]);
  return <AuthSessionContext value={session}>{children}</AuthSessionContext>;
}
