import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { APP } from '../src/config/app';
import { i18n } from '../src/i18n/i18n';
import { phaseOf } from '../src/state/phase';
import { SessionProvider, useSession } from '../src/state/session';
import { colors } from '../src/theme/tokens';

void SplashScreen.preventAutoHideAsync();

/** Which app this build is (ADR-0085): the other app's screens are never reachable. */
const STAFF = APP.variant === 'staff';
const CUSTOMER = APP.variant === 'customer';

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
  const userId = state.status === 'signedIn' ? state.userId : 0;

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
        <Stack.Protected guard={STAFF && phase === 'login'}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        {/* «Bto300»: the phone and password, or the office's code (ADR-0079 #3, #13). */}
        <Stack.Protected guard={CUSTOMER && phase === 'login'}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="set-password" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'offline'}>
          <Stack.Screen name="offline" />
        </Stack.Protected>
        <Stack.Protected guard={STAFF && phase === 'notRep'}>
          <Stack.Screen name="not-rep" />
        </Stack.Protected>
        <Stack.Protected guard={STAFF && phase === 'app'}>
          <Stack.Screen name="(staff)" />
        </Stack.Protected>
        <Stack.Protected guard={CUSTOMER && phase === 'app'}>
          <Stack.Screen name="(customer)" />
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
