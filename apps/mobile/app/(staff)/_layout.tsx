import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CommunityPopupGate } from '../../src/community/popup-gate';
import { ThumbKeeper } from '../../src/images/thumb-keeper';
import { NoticePopupGate } from '../../src/notifications/popup-gate';
import { useLiveStock } from '../../src/state/live-stock';
import { isRep, mayLoad, mayPick, mayRequestTransfers } from '../../src/state/phase';
import { useSignedIn } from '../../src/state/session';
import { ShopProvider } from '../../src/state/shop';
import { colors } from '../../src/theme/tokens';
import { ToastProvider } from '../../src/ui/toast';
import { UsageGate } from '../../src/usage/usage-gate';

/**
 * The staff app (ADR-0061, ADR-0068, in «Bto300»'s look since ADR-0100): everyone lands on «Нүүр»
 * with «Цэс» beside it (ADR-0174), and each screen opens over them. A guarded screen is out for
 * who lacks its right: a rep's order tabs and their pages, a keeper's «Бэлтгэл» (ADR-0132), a
 * seller's «Шилжүүлэг» (ADR-0116 #1). «Ирц» (ADR-0131) and «Хамт олон» (ADR-0146) are everyone's.
 */
export default function StaffLayout() {
  const { me, server, session } = useSignedIn();
  const rep = isRep(me);
  // The shop's live stock (ADR-0173 #4): only a rep has a shop, and only a rep may open the stream.
  useLiveStock(session, 'STAFF', rep);
  const picker = mayPick(me);
  const seller = mayRequestTransfers(me);
  const driver = mayLoad(me);
  return (
    <ShopProvider server={server} userId={me.id}>
      <ToastProvider>
        {/* White on the blue header (ADR-0100 on ADR-0095); the sign-in screens keep the dark one. */}
        <StatusBar style="light" />
        {rep ? <NoticePopupGate /> : null}
        {rep ? <ThumbKeeper /> : null}
        <CommunityPopupGate />
        {/* Which screens are used (ADR-0197): names and seconds, once a minute. */}
        <UsageGate
          send={(events) =>
            session.client.POST('/api/v1/usage/screens', { body: { app: 'staff', events } })
          }
        />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}
        >
          {/* «Нүүр» and «Цэс» (ADR-0174): first, so everyone lands on them. */}
          <Stack.Screen name="(work)" />
          {/* «ХТ захиалга»: the rep's order tabs. */}
          <Stack.Protected guard={rep}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          {/* The rep's visits and collected money (ADR-0183). */}
          <Stack.Protected guard={rep}>
            <Stack.Screen name="visits/index" />
          </Stack.Protected>
          {/* The picking (ADR-0132). */}
          <Stack.Protected guard={picker}>
            <Stack.Screen name="picking/index" />
            <Stack.Screen name="picking/[id]" />
          </Stack.Protected>
          {/* The driver's loading (ADR-0179). */}
          <Stack.Protected guard={driver}>
            <Stack.Screen name="loading/index" />
          </Stack.Protected>
          {/* The transfers (ADR-0116). */}
          <Stack.Protected guard={rep || seller}>
            <Stack.Screen name="transfers/index" />
            <Stack.Screen name="transfers/new" />
            <Stack.Screen name="transfers/[id]/index" />
            <Stack.Screen name="transfers/[id]/receive" />
          </Stack.Protected>
          {/* «Ирц» (ADR-0131): everyone's. */}
          <Stack.Screen name="attendance/index" />
          <Stack.Screen name="attendance/history" />
          {/* «Цагийн хүсэлт» (ADR-0144): every staff member sends their own. */}
          <Stack.Screen name="attendance/requests" />
          {/* «Хугацаа илрүүлэлт» (ADR-0172, opened from «Цэс» since ADR-0174): every staff member records what is on the shelf. */}
          <Stack.Screen name="expiry/index" />
          <Stack.Screen name="expiry/new" />
          <Stack.Screen name="expiry/[id]" />
          <Stack.Screen name="counts/index" />
          <Stack.Screen name="counts/[id]" />
          {/* «Хамт олон» (ADR-0146): every staff member's. */}
          <Stack.Screen name="community/index" />
          <Stack.Screen name="community/messages" />
          <Stack.Screen name="community/message/[id]" />
          <Stack.Screen name="community/polls" />
          <Stack.Screen name="community/poll/[id]" />
          <Stack.Screen name="community/calendar" />
          <Stack.Screen name="community/thanks" />
          <Stack.Screen name="community/feedback" />
          <Stack.Screen name="community/location" />
          <Stack.Screen name="community/profile" />
          {/* The profile without the rep's context: a seller's and any other staff member's. */}
          <Stack.Screen name="me" />
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
