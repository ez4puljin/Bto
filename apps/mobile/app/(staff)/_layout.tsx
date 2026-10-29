import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThumbKeeper } from '../../src/images/thumb-keeper';
import { NoticePopupGate } from '../../src/notifications/popup-gate';
import { isRep } from '../../src/state/phase';
import { useSignedIn } from '../../src/state/session';
import { ShopProvider } from '../../src/state/shop';
import { colors } from '../../src/theme/tokens';
import { ToastProvider } from '../../src/ui/toast';

/**
 * The sales-rep app (ADR-0061, ADR-0068, in «Bto300»'s look since ADR-0100): the tabs, and the
 * screens opened from them, for a rep. A store's seller with only the transfer right (ADR-0116 #1)
 * sees none of them: the stack's first screen is then «Шилжүүлэг» (expo-router drops the guarded
 * screens, and the navigator opens on the first one left), with the store profile beside it.
 */
export default function StaffLayout() {
  const { me, server } = useSignedIn();
  const rep = isRep(me);
  return (
    <ShopProvider server={server} userId={me.id}>
      <ToastProvider>
        {/* White on the blue header (ADR-0100 on ADR-0095); the sign-in screens keep the dark one. */}
        <StatusBar style="light" />
        {rep ? <NoticePopupGate /> : null}
        {rep ? <ThumbKeeper /> : null}
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
        >
          <Stack.Protected guard={rep}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          {/* The transfers (ADR-0116): first for a seller, opened from «Нүүр» by a rep. */}
          <Stack.Screen name="transfers/index" />
          <Stack.Screen name="transfers/new" />
          <Stack.Screen name="transfers/[id]/index" />
          <Stack.Screen name="transfers/[id]/receive" />
          <Stack.Screen name="store-profile" />
          <Stack.Protected guard={rep}>
            <Stack.Screen
              name="product/[id]"
              options={{ contentStyle: { backgroundColor: colors.card } }}
            />
            {/* «Нүүр»'s lists as in «Bto300» (ADR-0100 #9): a section, a category, every category. */}
            <Stack.Screen
              name="section/[key]"
              options={{ contentStyle: { backgroundColor: colors.card } }}
            />
            <Stack.Screen
              name="category/[id]"
              options={{ contentStyle: { backgroundColor: colors.card } }}
            />
            <Stack.Screen
              name="categories"
              options={{ contentStyle: { backgroundColor: colors.card } }}
            />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="order/[id]" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="profile-info" />
            <Stack.Screen name="password" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="notice/[id]" />
            <Stack.Screen name="map" />
            <Stack.Screen name="store-orders/[id]" />
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
          </Stack.Protected>
        </Stack>
      </ToastProvider>
    </ShopProvider>
  );
}
