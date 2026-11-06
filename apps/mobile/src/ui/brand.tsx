import { Image } from 'expo-image';
import { Server } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './text';
import orgilMark from '../../assets/customer/logo-mark.png';
import orgilLogo from '../../assets/customer/logo.png';
import splashIcon from '../../assets/splash-icon.png';
import { APP } from '../config/app';
import { serverHost } from '../server/server-url';
import { colors, fonts, radii, shadows, type } from '../theme/tokens';

/** The picture's own width to height (920 × 322). */
const LOGO_RATIO = 920 / 322;

/**
 * The company's logo, the emblem with «Оргил» (the owner, 2026-11-06, ADR-0166). Dark green: on the
 * blue header it needs a white ground.
 */
export function CompanyLogo({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[{ width: Math.round(height * LOGO_RATIO), height }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={orgilLogo} contentFit="contain" accessible={false} style={styles.fill} />
    </View>
  );
}

/** The logo's round emblem alone, for a small square: a notification's picture (ADR-0166). */
export function CompanyMark({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={orgilMark} contentFit="contain" accessible={false} style={styles.fill} />
    </View>
  );
}

/** This build's name: «Bto», or «Bto300» for the stores (ADR-0079). */
export function useAppName(): string {
  const { t } = useTranslation();
  return APP.variant === 'customer' ? t('mobile.customer.appName') : t('app.name');
}

/**
 * The top of the server and offline screens: the company's logo in «Bto300» (ADR-0166), the staff
 * app's «B» tile and its name otherwise, each with the company.
 */
export function BrandLockup({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const name = useAppName();
  return (
    <View style={[styles.lockup, style]}>
      {APP.variant === 'customer' ? (
        <CompanyLogo height={44} />
      ) : (
        <View
          style={styles.logo}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Image source={splashIcon} contentFit="contain" accessible={false} style={styles.image} />
        </View>
      )}
      <View style={styles.names}>
        {APP.variant === 'customer' ? null : (
          <Text accessibilityRole="header" style={type.wordmark}>
            {name}
          </Text>
        )}
        <Text style={type.secondary}>{t('brand.company')}</Text>
      </View>
    </View>
  );
}

/** «⌘ 192.168.0.104:3301 · Сервер солих»: the server in use, a tap goes back to the server screen. */
export function ServerChip({
  server,
  onPress,
  style,
}: {
  server: string | null | undefined;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const host = server ? serverHost(server) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        host ? `${host}, ${t('mobile.server.change')}` : t('mobile.server.change')
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? colors.fill : colors.imageFill },
        style,
      ]}
    >
      <Server size={14} strokeWidth={2} color={colors.muted} />
      {host ? (
        <>
          <Text numberOfLines={1} style={[type.secondary, styles.host]}>
            {host}
          </Text>
          <Text style={type.secondary}>{'·'}</Text>
        </>
      ) : null}
      <Text numberOfLines={1} style={[type.secondary, styles.change]}>
        {t('mobile.server.change')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 48, height: 48, borderRadius: radii.control, boxShadow: shadows.brand },
  image: { width: 48, height: 48, borderRadius: radii.control },
  names: { flexShrink: 1 },
  fill: { width: '100%', height: '100%' },
  chip: {
    alignSelf: 'center',
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  host: { maxWidth: 180, color: colors.label2, fontVariant: ['tabular-nums'] },
  change: { fontFamily: fonts.semibold, color: colors.link },
});
