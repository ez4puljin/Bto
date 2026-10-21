import { Stack } from 'expo-router';
import { unwrap } from '../../src/api/problem';
import {
  STORE_SUMMARY_KEY,
  useStoreNotificationSummary,
} from '../../src/api/customer-notifications';
import { ThumbKeeperFor } from '../../src/images/thumb-keeper';
import { PopupGate } from '../../src/notifications/popup-gate';
import { useCustomer } from '../../src/state/session';
import { ShopProvider, useShop } from '../../src/state/shop';
import { colors } from '../../src/theme/tokens';
import { ToastProvider } from '../../src/ui/toast';

/** Screens the launch notice never covers: the camera, the checkout, a new password. */
const BUSY_PATHS = new Set(['/scan', '/checkout', '/password', '/notice-popup']);

/** The launch notice of «Bto300» (ADR-0079 #8) over the store's summary. */
function StorePopupGate() {
  const { pending } = useShop();
  const { data, isFetching } = useStoreNotificationSummary();
  return (
    <PopupGate
      notices={data?.notices}
      fetching={isFetching}
      pending={pending !== null}
      summaryKey={STORE_SUMMARY_KEY}
      busyPaths={BUSY_PATHS}
    />
  );
}

/**
 * «Bto300», the stores' app (ADR-0079, the boards «Bto300 дэлгэц»): the tabs and the screens opened
 * from them. The cart and the pending send are kept on the phone per server and app account.
 */
export default function CustomerLayout() {
  const { session, server, accountId } = useCustomer();
  return (
    <ShopProvider server={server} userId={accountId}>
      <ToastProvider>
        <StorePopupGate />
        <ThumbKeeperFor
          server={server}
          urlsOf={async () => unwrap(await session.client.GET('/api/v1/customer-app/thumbs')).urls}
        />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="product/[id]"
            options={{ contentStyle: { backgroundColor: colors.card } }}
          />
          {/* «Нүүр»'s lists (ADR-0092): a section's products, a category, every category. */}
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
          <Stack.Screen name="invoice/[id]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="notice/[id]" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="password" />
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal' }} />
          {/* The launch notice over whatever is open (ADR-0062 #3); the back button closes it. */}
          <Stack.Screen
            name="notice-popup"
            options={{
              presentation: 'transparentModal',
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
        </Stack>
      </ToastProvider>
    </ShopProvider>
  );
}
