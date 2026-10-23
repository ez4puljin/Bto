import { Tabs } from 'expo-router/js-tabs';
import { ClipboardList, House, Package, ShoppingCart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { StoreTabBar } from '../../../src/ui/store-tab-bar';
import { useShop } from '../../../src/state/shop';
import { colors } from '../../../src/theme/tokens';

/**
 * «Нүүр», «Бараа», [баркод], «Сагс», «Захиалга» on «Bto300»'s flat bar (ADR-0095, the E-mart
 * structure): the barcode camera raised in the middle, the cart's count on «Сагс»; «Профайл» and
 * the bell open from «Нүүр», «Тооцоо» from «Профайл».
 */
export default function CustomerTabsLayout() {
  const { t } = useTranslation();
  const { cart } = useShop();
  const icon =
    (Icon: typeof House) =>
    ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
      <Icon
        size={size}
        color={typeof color === 'string' ? color : colors.placeholder}
        strokeWidth={focused ? 2 : 1.6}
      />
    );
  return (
    <Tabs
      tabBar={(props) => <StoreTabBar {...props} />}
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
    </Tabs>
  );
}
