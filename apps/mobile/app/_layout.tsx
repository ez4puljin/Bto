import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { SessionState } from '../src/api/session';
import { i18n } from '../src/i18n/i18n';
import { SessionProvider, useSession } from '../src/state/session';
import { colors } from '../src/theme/tokens';

void SplashScreen.preventAutoHideAsync();

type Phase = 'boot' | 'server' | 'login' | 'offline' | 'notRep' | 'app';

/** Which screens the phone may show now: the server, the login, or the rep app (ADR-0061). */
function phaseOf(server: string | null | undefined, state: SessionState): Phase {
  if (server === undefined) return 'boot';
  if (server === null) return 'server';
  switch (state.status) {
    case 'loading':
      return 'boot';
    case 'anonymous':
      return 'login';
    case 'offline':
      return 'offline';
    case 'signedIn':
      return state.me.permissions.includes('sales.orders.rep') ? 'app' : 'notRep';
  }
}

/** Server data in one cache per user and server: the provider is remounted when either changes. */
function DataProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function Navigator() {
  const { server, state } = useSession();
  const phase = phaseOf(server, state);
  const userId = state.status === 'signedIn' ? state.me.id : 0;

  useEffect(() => {
    if (phase !== 'boot') void SplashScreen.hideAsync();
  }, [phase]);

  if (phase === 'boot') return <View style={styles.boot} />;
  return (
    <DataProvider key={`${server ?? ''}:${userId}`}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
      >
        <Stack.Protected guard={phase === 'server'}>
          <Stack.Screen name="server" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'login'}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'offline'}>
          <Stack.Screen name="offline" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'notRep'}>
          <Stack.Screen name="not-rep" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'app'}>
          <Stack.Screen name="(staff)" />
        </Stack.Protected>
      </Stack>
    </DataProvider>
  );
}

const styles = StyleSheet.create({ boot: { flex: 1, backgroundColor: colors.canvas } });

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SessionProvider>
          <Navigator />
        </SessionProvider>
      </SafeAreaProvider>
    </I18nextProvider>
  );
}
