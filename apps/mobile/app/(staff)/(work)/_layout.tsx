import { Tabs } from 'expo-router/js-tabs';
import { ArrowLeftRight, CalendarCheck, PackageCheck, UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ColorValue } from 'react-native';
import { isRep, mayPick, mayRequestTransfers } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors } from '../../../src/theme/tokens';
import { StoreTabBar } from '../../../src/ui/store-tab-bar';

/**
 * The staff's work menu (owner 2026-10-31): «Бэлтгэл» for a keeper (ADR-0132), «Шилжүүлэг» for a
 * store's seller (ADR-0116), «Ирц» for everyone (ADR-0131) and «Профайл», on the flat bar without
 * the scan button; a tab the person has no right to is hidden, and the first one left opens. A rep
 * reaches these screens from «Нүүр»: then the bar is not drawn and the screens show the back arrow.
 */
export default function WorkTabsLayout() {
  const { t } = useTranslation();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const picker = mayPick(me);
  const seller = mayRequestTransfers(me);
  const icon =
    (Icon: typeof CalendarCheck) =>
    ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
      <Icon
        size={size}
        color={typeof color === 'string' ? color : colors.placeholder}
        strokeWidth={focused ? 2 : 1.6}
      />
    );
  return (
    <Tabs
      initialRouteName={picker ? 'picking' : seller ? 'transfers' : 'attendance'}
      tabBar={(props) => (rep ? null : <StoreTabBar {...props} scan={false} />)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}
    >
      <Tabs.Screen
        name="picking"
        options={{
          title: t('mobile.picking.title'),
          tabBarIcon: icon(PackageCheck),
          ...(picker ? {} : { href: null }),
        }}
      />
      <Tabs.Screen
        name="transfers"
        options={{
          title: t('mobile.transfers.title'),
          tabBarIcon: icon(ArrowLeftRight),
          ...(seller ? {} : { href: null }),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{ title: t('mobile.attendance.title'), tabBarIcon: icon(CalendarCheck) }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: t('mobile.tabs.profile'),
          tabBarIcon: icon(UserRound),
          ...(rep ? { href: null } : {}),
        }}
      />
    </Tabs>
  );
}
