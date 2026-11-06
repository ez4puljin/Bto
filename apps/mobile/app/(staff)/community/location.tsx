import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useMyLocations, useShareLocation } from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad, useAt } from '../../../src/community/parts';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** How long the phone may look for a fix before its last known position is taken. */
const FIX_TIMEOUT_MS = 20_000;
/** A last known position older than this says nothing about where the person is now. */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60_000;
/** The API keeps a coordinate to seven decimals. */
const COORDINATE_DECIMALS = 7;

/** A fresh fix, or a recent last known one when none comes in time; null when there is neither. */
async function currentPosition(): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
  });
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout,
    ]);
    if (fresh) return fresh;
  } catch {
    // The phone's location is off, or the fix failed: the last known position may still do.
  } finally {
    clearTimeout(timer);
  }
  try {
    return await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
  } catch {
    return null;
  }
}

/**
 * «Байршил илгээх» (ADR-0146): one position, asked for only when the person presses the button and
 * sent once with a note; the person's own recent ones below. Foreground only (app.config.ts blocks
 * background location). A refused permission is said plainly, with the way to the settings.
 */
export default function LocationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const at = useAt();
  const locations = useMyLocations();
  const share = useShareLocation();
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [note, setNote] = useState('');
  const [finding, setFinding] = useState(false);
  const [blocked, setBlocked] = useState<'denied' | 'off' | null>(null);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const rows = locations.data ?? [];

  const send = async () => {
    setBlocked(null);
    setProblem(null);
    setFinding(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setBlocked('denied');
        return;
      }
      const position = await currentPosition();
      if (!position) {
        setBlocked('off');
        return;
      }
      const { latitude, longitude, accuracy } = position.coords;
      await share.mutateAsync({
        key,
        body: {
          lat: latitude.toFixed(COORDINATE_DECIMALS),
          lng: longitude.toFixed(COORDINATE_DECIMALS),
          accuracyM:
            typeof accuracy === 'number' && Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          note: note.trim() || null,
        },
      });
      toast.show({ message: t('mobile.community.location.sent') });
      setKey(Crypto.randomUUID());
      setNote('');
    } catch (failure) {
      setProblem(problemFrom(failure));
    } finally {
      setFinding(false);
    }
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.location.title')}
        onBack={() => router.back()}
        right={null}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={locations.isRefetching}
            onRefresh={() => void locations.refetch()}
          />
        }
      >
        <View style={styles.card}>
          <Text style={type.body}>{t('mobile.community.location.lead')}</Text>
          <TextField
            label={t('mobile.community.location.note')}
            placeholder={t('mobile.community.location.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            maxLength={ENGAGEMENT_LIMITS.maxNote}
          />
          <PillButton
            title={t('mobile.community.location.send')}
            icon={<MapPin size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
            loading={finding}
            loadingTitle={t('mobile.community.location.finding')}
            onPress={() => void send()}
          />
          {blocked === 'denied' ? (
            <>
              <Text style={[type.body, styles.error]}>{t('mobile.community.location.denied')}</Text>
              <PillButton
                variant="soft"
                title={t('mobile.community.location.openSettings')}
                onPress={() => void Linking.openSettings()}
              />
            </>
          ) : null}
          {blocked === 'off' ? (
            <Text style={[type.body, styles.error]}>{t('mobile.community.location.off')}</Text>
          ) : null}
          <ProblemText problem={problem} style={styles.problem} />
        </View>

        <Text style={[type.sectionHeader, styles.head]}>
          {t('mobile.community.location.recent')}
        </Text>
        <FirstLoad query={locations}>
          {rows.length === 0 ? (
            <EmptyState title={t('mobile.community.location.empty')} />
          ) : (
            <Group inset={ICON_INSET}>
              {rows.map((row) => (
                <Row
                  key={row.id}
                  minHeight={52}
                  icon={
                    <IconTile color={colors.tint.green}>
                      <MapPin size={16} strokeWidth={2.2} color={colors.primaryForeground} />
                    </IconTile>
                  }
                  title={at(row.createdAt)}
                  subtitle={
                    [
                      row.note,
                      row.accuracyM !== null
                        ? t('mobile.community.location.accuracy', { m: row.accuracyM })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || null
                  }
                />
              ))}
            </Group>
          )}
        </FirstLoad>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: 14, paddingBottom: 40 },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  error: { color: colors.destructiveText },
  problem: { marginTop: 0 },
  head: { marginTop: spacing.lg, marginBottom: 6, paddingHorizontal: spacing.xs },
});
