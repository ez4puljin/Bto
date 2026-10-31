import { Image } from 'expo-image';
import { Server } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './text';
import customerIcon from '../../assets/customer/splash-icon.png';
import splashIcon from '../../assets/splash-icon.png';
import { APP } from '../config/app';
import { serverHost } from '../server/server-url';
import { brandSheet } from '../theme/brand';
import { colors, fonts, radii, shadows, type } from '../theme/tokens';
import { useBrand } from '../theme/use-brand';

/**
 * The splash's tile, the same picture the phone starts with: a white «B» on rounded blue, or
 * «B300» for the stores' app (ADR-0079 #13).
 */
const LOGO = APP.variant === 'customer' ? customerIcon : splashIcon;

/**
 * The app's name: the one the office set on «Апп → Ерөнхий» (ADR-0127 #4, read from the server and
 * kept per server), else this build's own — «Bto», or «Bto300» for the stores (ADR-0079).
 */
export function useAppName(): string {
  const { t } = useTranslation();
  const brand = useBrand();
  return brand.name ?? (APP.variant === 'customer' ? t('mobile.customer.appName') : t('app.name'));
}

/** The logo with the app's name and the company: the top of the server, sign-in and offline screens. */
export function BrandLockup({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const name = useAppName();
  return (
    <View style={[styles.lockup, style]}>
      <View style={styles.logo} accessible={false} importantForAccessibility="no-hide-descendants">
        <Image source={LOGO} contentFit="contain" accessible={false} style={styles.image} />
      </View>
      <View style={styles.names}>
        <Text accessibilityRole="header" style={type.wordmark}>
          {name}
        </Text>
        <Text style={type.secondary}>{t('brand.company')}</Text>
      </View>
    </View>
  );
}

/** «Bto300»'s home mark (ADR-0092 #1, the Main board): the small logo tile and the app's name. */
export function BrandMark({ style }: { style?: StyleProp<ViewStyle> }) {
  const name = useAppName();
  return (
    <View style={[styles.mark, style]}>
      <View
        style={styles.markLogo}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Image source={LOGO} contentFit="contain" accessible={false} style={styles.markImage} />
      </View>
      <Text accessibilityRole="header" style={type.wordmark} numberOfLines={1}>
        {name}
      </Text>
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

const styles = brandSheet(() =>
  StyleSheet.create({
    lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    logo: { width: 48, height: 48, borderRadius: radii.control, boxShadow: shadows.brand },
    image: { width: 48, height: 48, borderRadius: radii.control },
    names: { flexShrink: 1 },
    mark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    markLogo: { width: 34, height: 34, borderRadius: radii.control },
    markImage: { width: 34, height: 34, borderRadius: radii.control },
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
  }),
);
