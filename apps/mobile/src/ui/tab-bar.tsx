import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, shadows, spacing, type } from '../theme/tokens';

const BAR_HEIGHT = 64;

/** How far the bar floats above the bottom edge, past the system's navigation. */
const barBottom = (inset: number) => Math.max(inset, spacing.sm) + 10;

/** Room a tab's content leaves at its end so the floating bar never covers it. */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + barBottom(insets.bottom) + spacing.lg;
}

/** True while the software keyboard is open: the bar steps aside instead of riding on it. */
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

/**
 * The design's tab bar (ADR-0066): a white pill floating 16 px from the sides, five tabs, the open
 * one on a grey pill in the accent colour; a tab's `tabBarBadge` is a red count on its icon.
 */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const keyboard = useKeyboardShown();
  if (keyboard) return null;
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { bottom: barBottom(insets.bottom) }]}>
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const focused = state.index === index;
        const color = focused ? colors.primary : colors.foreground;
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
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            style={[styles.item, focused && styles.itemActive]}
          >
            {options.tabBarIcon?.({ focused, color, size: 24 })}
            <Text
              numberOfLines={1}
              style={[type.tab, { color, fontFamily: focused ? fonts.bold : fonts.semibold }]}
            >
              {options.title}
            </Text>
            {badge !== undefined ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{String(badge)}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    height: BAR_HEIGHT,
    paddingHorizontal: 5,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: colors.barFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    boxShadow: shadows.tabBar,
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  itemActive: { backgroundColor: colors.tabActive },
  badge: {
    position: 'absolute',
    top: 4,
    left: '50%',
    marginLeft: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.destructive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 13,
    color: colors.primaryForeground,
  },
});
