import type { Permission } from '@tugeel/shared/auth';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AuthSession, AuthState } from '@/lib/auth/auth-session';

export const AuthSessionContext = createContext<AuthSession | null>(null);

export function useAuthSession(): AuthSession {
  const session = useContext(AuthSessionContext);
  if (!session) throw new Error('useAuthSession must be used inside <AuthProvider>');
  return session;
}

export function useAuthState(): AuthState {
  const session = useAuthSession();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

export function useHasPermission(permission: Permission): boolean {
  const state = useAuthState();
  return state.status === 'authenticated' && state.me.permissions.includes(permission);
}

/** True when the user holds at least one of `permissions`. */
export function useHasAnyPermission(permissions: Permission | readonly Permission[]): boolean {
  const state = useAuthState();
  return (
    state.status === 'authenticated' &&
    [permissions].flat().some((permission) => state.me.permissions.includes(permission))
  );
}
