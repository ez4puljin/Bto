import { Tabs } from 'expo-router/js-tabs';
import { House, LayoutGrid } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { colors } from '../../../src/theme/tokens';
import { StoreTabBar } from '../../../src/ui/store-tab-bar';

/**
 * The staff app's two tabs (ADR-0173): «Нүүр», where everyone lands, and «Цэс», where every screen
 * the person's rights open is listed. Those screens open over the tabs with a back arrow; a rep's
 * order tabs are one of them, «ХТ захиалга».
 */
export default function WorkTabsLayout() {
  const { t } = useTranslation();
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
      tabBar={(props) => <StoreTabBar {...props} scan={false} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('mobile.tabs.home'), tabBarIcon: icon(House) }}
      />
      <Tabs.Screen
        name="menu"
        options={{ title: t('mobile.tabs.menu'), tabBarIcon: icon(LayoutGrid) }}
      />
    </Tabs>
  );
}
