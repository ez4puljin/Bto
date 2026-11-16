import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows, spacing, storeType, type } from '../theme/tokens';
import { CompanyLogo, CompanyMark, useAppName } from '../ui/brand';
import { StoreHeaderBand } from '../ui/store-header';
import { Text } from '../ui/text';

// The staff app's own brand pieces on the blue (the boards of 2026-11-16). The picture stays the
// company's emblem (ADR-0166, ADR-0174): it is dark green, so it always sits on a white plate.

/** The wordmark row of «Нүүр» and the pages without a title: the emblem and the app's name. */
export function StaffWordmarkHeader({ right }: { right?: ReactNode }) {
  const appName = useAppName();
  return (
    <View style={styles.row}>
      <View style={styles.word}>
        <View style={styles.plate}>
          <CompanyMark size={24} />
        </View>
        <Text
          accessibilityRole="header"
          style={[storeType.wordmark, styles.grow]}
          numberOfLines={1}
        >
          {appName}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** The blue band with only the wordmark: the offline page and «эрх алга». */
export function StaffWordmarkBand() {
  return (
    <StoreHeaderBand>
      <StaffWordmarkHeader />
    </StoreHeaderBand>
  );
}

/**
 * The top of the sign-in and server screens: a tall blue band with the company's logo, «Ажилтны
 * апп» and the company. The card under it climbs `HERO_OVERLAP` into the band.
 */
export function StaffHero() {
  const { t } = useTranslation();
  const appName = useAppName();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
      <View style={styles.logo}>
        <CompanyLogo height={44} />
      </View>
      <Text accessibilityRole="header" style={[type.largeTitle, styles.heroName]}>
        {appName}
      </Text>
      <Text style={[type.body, styles.heroCompany]}>{t('brand.company')}</Text>
    </View>
  );
}

/** How far the first card climbs into the hero band. */
export const HERO_OVERLAP = 32;

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.lg,
    paddingRight: 6,
  },
  word: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  plate: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.xl,
    paddingBottom: 24 + HERO_OVERLAP,
    backgroundColor: colors.primary,
  },
  logo: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.hero,
  },
  heroName: { color: colors.primaryForeground, textAlign: 'center' },
  heroCompany: { color: colors.onPrimaryMuted, textAlign: 'center' },
});
