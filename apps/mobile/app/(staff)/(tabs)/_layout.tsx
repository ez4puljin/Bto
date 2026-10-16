import { Tabs } from 'expo-router';
import { ClipboardList, Home, ShoppingCart, Store, User } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNotificationSummary } from '../../../src/api/notifications';
import { useShop } from '../../../src/state/shop';
import { colors, fonts } from '../../../src/theme/tokens';

/** «Нүүр», «Дэлгүүр», «Сагс», «Захиалга», «Профайл»: the reference app's order of screens. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { cart } = useShop();
  const unread = useNotificationSummary().data?.unread ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('mobile.tabs.home'),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: t('mobile.tabs.shop'),
          tabBarIcon: ({ color, size }) => <Store color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: t('mobile.tabs.cart'),
          tabBarIcon: ({ color, size }) => <ShoppingCart color={color} size={size} />,
          tabBarBadge: cart.lines.length > 0 ? cart.lines.length : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary },
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('mobile.tabs.orders'),
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('mobile.tabs.profile'),
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
          // The bell's count (ADR-0062 #3): the profile holds the notifications.
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.destructive },
        }}
      />
    </Tabs>
  );
}
