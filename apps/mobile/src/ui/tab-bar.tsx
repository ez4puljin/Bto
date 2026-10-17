import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, shadows, spacing, type } from '../theme/tokens';

const BAR_HEIGHT = 60;
const ITEM_HEIGHT = 50;
/** A tab's icon (`tabBarIcon` draws it at this size). */
const TAB_ICON_SIZE = 22;

/** How far the bar floats above the bottom edge, past the system's navigation. */
const barBottom = (inset: number) => Math.max(inset, spacing.sm) + spacing.sm;

/** Room a tab's content leaves at its end so the floating bar never covers it. */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + barBottom(insets.bottom) + spacing.md;
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
 * The design's tab bar (ADR-0068): a white pill floating 16 px from the sides, five tabs, the open
 * one on a light blue pill in the accent colour; a tab's `tabBarBadge` is a red count on its icon,
 * cut from the tab by a ring in the colour behind it.
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
        const color = focused ? colors.primary : colors.label2;
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
            style={({ pressed }) => [
              styles.item,
              focused ? styles.itemActive : pressed && styles.itemPressed,
            ]}
          >
            {options.tabBarIcon?.({ focused, color, size: TAB_ICON_SIZE })}
            <Text
              numberOfLines={1}
              style={[type.tab, { color, fontFamily: focused ? fonts.semibold : fonts.medium }]}
            >
              {options.title}
            </Text>
            {badge !== undefined ? (
              <View
                style={[styles.badge, { borderColor: focused ? colors.secondary : colors.card }]}
              >
                <Text style={type.badge}>{String(badge)}</Text>
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
    height: ITEM_HEIGHT,
    borderRadius: ITEM_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  itemActive: { backgroundColor: colors.secondary },
  itemPressed: { backgroundColor: colors.accent },
  badge: {
    position: 'absolute',
    top: 5,
    left: '50%',
    marginLeft: 3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    backgroundColor: colors.destructive,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
