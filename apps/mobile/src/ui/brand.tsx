import { Image } from 'expo-image';
import { Server } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './text';
import splashIcon from '../../assets/splash-icon.png';
import { serverHost } from '../server/server-url';
import { colors, fonts, radii, shadows, type } from '../theme/tokens';

/** The splash's tile: a white «B» on rounded blue, the same picture the phone starts with. */
const LOGO = splashIcon;

/** The logo with «Bto» and the company: the top of the server, sign-in and offline screens. */
export function BrandLockup({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.lockup, style]}>
      <View style={styles.logo} accessible={false} importantForAccessibility="no-hide-descendants">
        <Image source={LOGO} contentFit="contain" accessible={false} style={styles.image} />
      </View>
      <View style={styles.names}>
        <Text accessibilityRole="header" style={type.wordmark}>
          {t('app.name')}
        </Text>
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
