import { useRouter } from 'expo-router';
import { ArrowLeft, ShoppingCart } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShop } from '../state/shop';
import { brandSheet } from '../theme/brand';
import { colors, spacing, storeType, TOUCH } from '../theme/tokens';
import { CountBadge } from './controls';
import { Text } from './text';

// The blue header of both apps (ADR-0095, the E-mart structure in Bto300's blue; the rep app since
// ADR-0100): it runs under the status bar; a page has ← with its title and the cart, the home its
// own rows.

/** The header's 48 px row height and its icons. */
export const HEADER_ROW = 48;
const ICON = 22;

/** The blue band from the top of the screen; its rows are the children. */
export function StoreHeaderBand({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.band, { paddingTop: insets.top }]}>{children}</View>;
}

/** A white icon button on the header, with an optional red count. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  badge = 0,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      {icon}
      <CountBadge count={badge} ring={colors.primary} style={styles.badge} />
    </Pressable>
  );
}

/** The cart with its count; it opens «Сагс». */
export function HeaderCart() {
  const { t } = useTranslation();
  const router = useRouter();
  const { cart } = useShop();
  const n = cart.lines.length;
  return (
    <HeaderIconButton
      icon={<ShoppingCart size={ICON} strokeWidth={1.8} color={colors.primaryForeground} />}
      label={t('mobile.tabs.cartCount', { n })}
      badge={n}
      onPress={() => router.navigate('/cart')}
    />
  );
}

/** A white text button on the header: «Бүгдийг уншсан», «Засах». */
export function HeaderTextButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.textButton}
    >
      <Text style={[storeType.headerButton, disabled && styles.faded]}>{title}</Text>
    </Pressable>
  );
}

/**
 * A page's header: ← (when it goes back), the title, and the right side (the cart by default).
 * `children` are more rows under it in the blue (a search field).
 */
export function StoreHeader({
  title,
  onBack,
  right = <HeaderCart />,
  children,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <StoreHeaderBand>
      <View style={[styles.row, !onBack && styles.rowNoBack]}>
        {onBack ? (
          <HeaderIconButton
            icon={<ArrowLeft size={ICON} strokeWidth={2} color={colors.primaryForeground} />}
            label={t('common.back')}
            onPress={onBack}
          />
        ) : null}
        <Text
          accessibilityRole="header"
          style={[storeType.headerTitle, styles.title]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
      {children}
    </StoreHeaderBand>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    band: { backgroundColor: colors.primary },
    row: {
      height: HEADER_ROW,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 2,
      paddingRight: 6,
      gap: spacing.xs,
    },
    rowNoBack: { paddingLeft: spacing.lg },
    title: { flex: 1, minWidth: 0 },
    right: { flexDirection: 'row', alignItems: 'center' },
    icon: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
    pressed: { opacity: 0.6 },
    badge: { position: 'absolute', top: 5, right: 3 },
    textButton: { height: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.sm },
    faded: { opacity: 0.5 },
  }),
);
