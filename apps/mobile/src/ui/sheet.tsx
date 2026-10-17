import { X } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, spacing, type } from '../theme/tokens';

/**
 * Opens and closes with the parent's `visible`: the backdrop fades and the content slides, then
 * the modal leaves (React Native's Modal only fades or slides everything at once).
 */
function usePresence(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);
  return { mounted, progress };
}

/**
 * A sheet from the bottom (the design's filter, suppliers, dates, address): the dimmed page
 * behind, a grabber, a header, the content and an optional bar at the bottom. Tapping the dimmed
 * page or the back button calls `onClose`.
 */
export function Sheet({
  visible,
  onClose,
  closeLabel,
  header,
  footer,
  children,
  top = 62,
}: {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** How far below the status bar the sheet starts: 62, or 12 for one stacked on another. */
  top?: number;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { mounted, progress } = usePresence(visible);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[styles.sheet, { top: insets.top + top, transform: [{ translateY }] }]}
      >
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>
        {header}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.grow}
        >
          <View style={styles.grow}>{children}</View>
          {footer ? (
            <View
              style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}
            >
              {footer}
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

/** A sheet's 50 px header: an action on the left, the title, an action or × on the right. */
export function SheetHeader({
  left,
  title,
  right,
}: {
  left?: ReactNode;
  title: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>{left}</View>
      <Text accessibilityRole="header" style={type.heading} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

/** The round grey × of a sheet. */
export function SheetClose({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.close}
    >
      <X size={16} strokeWidth={2.6} color={colors.muted} />
    </Pressable>
  );
}

/** «Гарах уу?»: a question at the bottom with its actions, and «Болих» apart from them. */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  cancelLabel,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  actions: { label: string; onPress: () => void; destructive?: boolean }[];
  cancelLabel: string;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { mounted, progress } = usePresence(visible);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height / 2, 0] });
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.actions,
          { bottom: Math.max(insets.bottom, spacing.md) + 18, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.actionGroup}>
          <View style={styles.question}>
            <Text style={[type.sectionHeader, styles.center]}>{title}</Text>
            {message ? <Text style={[type.secondary, styles.center]}>{message}</Text> : null}
          </View>
          {actions.map((action) => (
            <View key={action.label}>
              <View style={styles.actionLine} />
              <Pressable
                accessibilityRole="button"
                onPress={action.onPress}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Text
                  style={[
                    styles.actionText,
                    { color: action.destructive ? colors.destructive : colors.primary },
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={[styles.actionText, styles.cancelText]}>{cancelLabel}</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    overflow: 'hidden',
  },
  grabberRow: { alignItems: 'center', paddingTop: 7 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.input },
  header: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.closeFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  footer: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.sheetBarFill,
  },
  actions: { position: 'absolute', left: 10, right: 10, gap: spacing.sm },
  actionGroup: {
    borderRadius: radii.card,
    backgroundColor: colors.floatingFill,
    overflow: 'hidden',
  },
  question: { paddingTop: spacing.lg, paddingBottom: 14, paddingHorizontal: 20, gap: spacing.xs },
  center: { textAlign: 'center' },
  actionLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  action: { height: 58, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...type.sectionTitle, fontFamily: fonts.regular, letterSpacing: 0 },
  cancel: {
    height: 58,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: fonts.semibold, color: colors.primary },
  pressed: { backgroundColor: colors.accent },
});
