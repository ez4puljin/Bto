import { Stack } from 'expo-router';
import { NoticePopupGate } from '../../src/notifications/popup-gate';
import { useSignedIn } from '../../src/state/session';
import { ShopProvider } from '../../src/state/shop';
import { colors } from '../../src/theme/tokens';

/** The sales-rep app (ADR-0061): the tabs, and the screens opened from them. */
export default function StaffLayout() {
  const { me, server } = useSignedIn();
  return (
    <ShopProvider server={server} userId={me.id}>
      <NoticePopupGate />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="product/[id]" />
        <Stack.Screen name="order/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="notice/[id]" />
        <Stack.Screen name="customers" options={{ presentation: 'modal' }} />
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal' }} />
        {/* The notice popup over whatever is open (ADR-0062 #3); the back button closes it. */}
        <Stack.Screen
          name="notice-popup"
          options={{
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </ShopProvider>
  );
}
