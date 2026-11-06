import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { problemFrom } from '../api/problem';
import { ubDate, ubTime } from '../dates/dates';
import { initialsOf } from '../format/format';
import { useSignedIn } from '../state/session';
import { colors, fonts, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { ProblemText } from '../ui/kit';
import { Text } from '../ui/text';

// The small pieces the «Хамт олон» screens share (ADR-0146).

/** «2026-11-05 09:12» of an instant, in Ulaanbaatar. */
export function useAt() {
  const { t } = useTranslation();
  return (iso: string) => t('mobile.community.at', { date: ubDate(iso), time: ubTime(iso) });
}

/** A person's photo, or their initials on a blue circle. */
export function Avatar({
  name,
  photoUrl,
  size = 36,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const { server } = useSignedIn();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return (
      <Image
        source={{ uri: `${server}${photoUrl}` }}
        style={round}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <View style={[styles.avatar, round]}>
      <Text style={styles.initials}>{initialsOf(name)}</Text>
    </View>
  );
}

/** A small status on its soft colour. */
export function StatusPill({
  label,
  background,
  color,
}: {
  label: string;
  background: string;
  color: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A list's first load: the spinner, or the problem with «Дахин оролдох»; nothing once it has data. */
export function FirstLoad({
  query,
  children,
}: {
  query: { isLoading: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isLoading) {
    return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  }
  if (query.error) {
    return (
      <View style={styles.failed}>
        <ProblemText problem={problemFrom(query.error)} />
        <PillButton title={t('common.retry')} variant="soft" onPress={() => void query.refetch()} />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  initials: { ...type.chip, fontFamily: fonts.bold, color: colors.primaryForeground },
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  loading: { marginTop: 32 },
  failed: { gap: 12, padding: 16 },
});
