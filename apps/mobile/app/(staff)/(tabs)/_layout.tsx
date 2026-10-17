import { Tabs } from 'expo-router/js-tabs';
import { CircleUserRound, ClipboardList, House, Package, ShoppingCart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { useNotificationSummary } from '../../../src/api/notifications';
import { useShop } from '../../../src/state/shop';
import { colors } from '../../../src/theme/tokens';
import { FloatingTabBar } from '../../../src/ui/tab-bar';

/**
 * «Нүүр», «Бараа», «Сагс», «Захиалга», «Профайл» on the design's floating bar (ADR-0066): 22 px
 * icons, bolder on the open tab; the cart's count of lines, and the unread count of the bell on
 * «Профайл» (ADR-0062 #3).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { cart } = useShop();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const icon =
    (Icon: typeof House) =>
    ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
      <Icon
        size={size}
        color={typeof color === 'string' ? color : colors.label2}
        strokeWidth={focused ? 2.1 : 1.75}
      />
    );
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('mobile.tabs.home'), tabBarIcon: icon(House) }}
      />
      <Tabs.Screen
        name="shop"
        options={{ title: t('mobile.tabs.shop'), tabBarIcon: icon(Package) }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: t('mobile.tabs.cart'),
          tabBarIcon: icon(ShoppingCart),
          tabBarAccessibilityLabel: t('mobile.tabs.cartCount', { n: cart.lines.length }),
          ...(cart.lines.length > 0 ? { tabBarBadge: cart.lines.length } : {}),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: t('mobile.tabs.orders'), tabBarIcon: icon(ClipboardList) }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('mobile.tabs.profile'),
          tabBarIcon: icon(CircleUserRound),
          ...(unread > 0 ? { tabBarBadge: unread > 99 ? '99+' : unread } : {}),
        }}
      />
    </Tabs>
  );
}
