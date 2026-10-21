import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { ScanBarcode } from 'lucide-react-native';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadows, spacing, storeType } from '../theme/tokens';
import { Text } from '../ui/text';

// «Bto300»'s tab bar (ADR-0095, the E-mart structure): flat and white along the bottom, the four
// tabs and, raised in the middle, the barcode camera.

const BAR_HEIGHT = 56;
const ICON = 22;
const SCAN = 50;

/** Room a tab's content leaves at its end so the bar never covers it. */
export function useStoreTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + insets.bottom + spacing.md;
}

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export function StoreTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const keyboard = useKeyboardShown();
  if (keyboard) return null;
  const middle = Math.ceil(state.routes.length / 2);
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const focused = state.index === index;
        const color = focused ? colors.primary : colors.placeholder;
        const badge = options.tabBarBadge;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Fragment key={route.key}>
            {index === middle ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.scan.title')}
                onPress={() => router.push('/scan')}
                style={[styles.item, styles.scanItem]}
              >
                <View style={styles.scan}>
                  <ScanBarcode size={24} strokeWidth={2} color={colors.primaryForeground} />
                </View>
                <Text numberOfLines={1} style={storeType.tab}>
                  {t('mobile.customer.tabs.scan')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={onPress}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              {options.tabBarIcon?.({ focused, color, size: ICON })}
              <Text numberOfLines={1} style={[storeType.tab, { color }]}>
                {options.title}
              </Text>
              {badge !== undefined ? (
                <View style={styles.badge}>
                  <Text style={storeType.badge}>{String(badge)}</Text>
                </View>
              ) : null}
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.input,
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pressed: { opacity: 0.6 },
  // The label on the others' line: a 22 px icon, 3 px and a 13 px line, centred in 56.
  scanItem: { justifyContent: 'flex-end', paddingBottom: 9 },
  scan: {
    position: 'absolute',
    top: -24,
    width: SCAN,
    height: SCAN,
    borderRadius: SCAN / 2,
    borderWidth: 3,
    borderColor: colors.card,
    backgroundColor: colors.primary,
    boxShadow: shadows.scanButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    left: '50%',
    marginLeft: 3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.destructive,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
