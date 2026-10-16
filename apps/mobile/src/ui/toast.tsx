import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radii, shadows, spacing } from '../theme/tokens';

export interface ToastInput {
  message: string;
  /** A button on the toast: «Дахин харах». */
  action?: { label: string; onPress: () => void };
  /** How long it stays, 4 s by default (6 s with an action). */
  durationMs?: number;
}

interface ToastValue {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/**
 * Confirmations at the bottom of the screen, above the tab bar (ADR-0066): one at a time, a newer
 * one replaces the shown one.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const next = useRef(0);

  const show = useCallback(
    (input: ToastInput) => {
      next.current += 1;
      setToast({ ...input, id: next.current });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    },
    [opacity],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => {
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(
          ({ finished }) => {
            if (finished) setToast((current) => (current?.id === toast.id ? null : current));
          },
        );
      },
      toast.durationMs ?? (toast.action ? 6_000 : 4_000),
    );
    return () => clearTimeout(timer);
  }, [toast, opacity]);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {toast ? (
          <Animated.View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.toast, { bottom: Math.max(insets.bottom, spacing.sm) + 92, opacity }]}
          >
            <Text style={styles.message}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const action = toast.action;
                  setToast(null);
                  action?.onPress();
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast outside ToastProvider');
  return value;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    borderRadius: radii.tile,
    backgroundColor: colors.floatingFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    boxShadow: shadows.toast,
  },
  message: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.label2,
  },
  action: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.primaryForeground,
  },
});
