import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { addDays, addMonths } from '@tugeel/shared/time';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { HeartHandshake, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type Colleague,
  type ThanksEntry,
  useColleagues,
  useSendThanks,
  useThanks,
  useToday,
} from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { Avatar, FirstLoad } from '../../../src/community/parts';
import { monthOf } from '../../../src/dates/dates';
import { useDebounced } from '../../../src/state/use-debounced';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton, SearchField } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** The sheet: a colleague found by name, a note, «Илгээх»; the key survives a retried send. */
function SendThanksSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { me } = useSignedIn();
  const send = useSendThanks();
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const [text, setText] = useState('');
  const [colleague, setColleague] = useState<Colleague | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const q = useDebounced(text.trim(), 350);
  const found = useColleagues(q, visible && colleague === null && q !== '');
  const rows = (found.data ?? []).filter((entry) => entry.id !== me.id);

  const submit = async () => {
    if (!colleague) return;
    setProblem(null);
    try {
      await send.mutateAsync({ key, body: { toUserId: colleague.id, note: note.trim() } });
      toast.show({ message: t('mobile.community.thanks.sent') });
      setKey(Crypto.randomUUID());
      setText('');
      setColleague(null);
      setNote('');
      onClose();
    } catch (failure) {
      setProblem(problemFrom(failure));
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('mobile.community.close')}
      header={
        <SheetHeader
          title={t('mobile.community.thanks.new')}
          right={<SheetClose label={t('mobile.community.close')} onPress={onClose} />}
        />
      }
      footer={
        <PillButton
          title={t('mobile.community.thanks.send')}
          disabled={!colleague || note.trim() === ''}
          loading={send.isPending}
          onPress={() => void submit()}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={type.label}>{t('mobile.community.thanks.colleague')}</Text>
        {colleague ? (
          <Group>
            <Row
              icon={<Avatar name={colleague.fullName} photoUrl={null} size={30} />}
              title={colleague.fullName}
              chevron={false}
              right={<Text style={styles.change}>{t('mobile.community.thanks.change')}</Text>}
              onPress={() => setColleague(null)}
            />
          </Group>
        ) : (
          <>
            <SearchField
              value={text}
              onChangeText={setText}
              placeholder={t('mobile.community.thanks.searchLabel')}
              accessibilityLabel={t('mobile.community.thanks.searchLabel')}
            />
            {q === '' ? (
              <Text style={type.secondary}>{t('mobile.community.thanks.searchHint')}</Text>
            ) : found.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : found.error ? (
              <ProblemText problem={problemFrom(found.error)} />
            ) : rows.length === 0 ? (
              <Text style={type.secondary}>{t('mobile.community.thanks.noMatch')}</Text>
            ) : (
              <Group>
                {rows.slice(0, 20).map((entry) => (
                  <Row
                    key={entry.id}
                    icon={<Avatar name={entry.fullName} photoUrl={null} size={30} />}
                    title={entry.fullName}
                    onPress={() => setColleague(entry)}
                  />
                ))}
              </Group>
            )}
          </>
        )}
        <TextField
          label={t('mobile.community.thanks.note')}
          placeholder={t('mobile.community.thanks.notePlaceholder')}
          value={note}
          onChangeText={setNote}
          maxLength={ENGAGEMENT_LIMITS.maxNote}
          multiline
        />
        <ProblemText problem={problem} />
      </ScrollView>
    </Sheet>
  );
}

/**
 * «Талархал» (ADR-0146): who received most this month, the newest thanks, and a sheet to send one.
 * Everybody sees them.
 */
export default function ThanksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const first = `${monthOf(today)}-01`;
  const thanks = useThanks(first, addDays(addMonths(first, 1), -1));
  const [open, setOpen] = useState(false);
  const ranking = thanks.data?.ranking ?? [];
  const items = thanks.data?.items ?? [];

  const renderEntry = (entry: ThanksEntry) => (
    <View key={entry.id} style={styles.entry}>
      <Avatar name={entry.toName} photoUrl={entry.toPhotoUrl} />
      <View style={styles.grow}>
        <Text style={type.rowStrong} numberOfLines={2}>
          {t('mobile.community.thanks.fromTo', { from: entry.fromName, to: entry.toName })}
        </Text>
        <Text style={type.body}>{entry.note}</Text>
        <Text style={[type.secondary, tabular]}>{entry.day}</Text>
      </View>
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.thanks.title')}
        onBack={() => router.back()}
        right={null}
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + 72 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={thanks.isRefetching}
            onRefresh={() => void thanks.refetch()}
          />
        }
      >
        <FirstLoad query={thanks}>
          {items.length === 0 ? (
            <EmptyState
              icon={<HeartHandshake size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.community.thanks.empty')}
              hint={t('mobile.community.thanks.emptyHint')}
            />
          ) : null}
          {ranking.length > 0 ? (
            <>
              <Text style={[type.sectionHeader, styles.head]}>
                {t('mobile.community.thanks.ranking')}
              </Text>
              <Group>
                {ranking.map((rank, index) => (
                  <Row
                    key={rank.userId}
                    minHeight={52}
                    icon={
                      <View style={styles.ranked}>
                        <Text style={[styles.place, tabular]}>
                          {t('mobile.community.thanks.rank', { n: index + 1 })}
                        </Text>
                        <Avatar name={rank.fullName} photoUrl={rank.photoUrl} size={32} />
                      </View>
                    }
                    title={rank.fullName}
                    value={t('mobile.community.thanks.count', { n: rank.count })}
                  />
                ))}
              </Group>
            </>
          ) : null}
          {items.length > 0 ? (
            <>
              <Text style={[type.sectionHeader, styles.head]}>
                {t('mobile.community.thanks.newest')}
              </Text>
              <View style={styles.entries}>{items.slice(0, 50).map(renderEntry)}</View>
            </>
          ) : null}
        </FirstLoad>
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={t('mobile.community.thanks.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          onPress={() => setOpen(true)}
        />
      </View>
      <SendThanksSheet visible={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 14, paddingTop: spacing.xs },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  head: { marginTop: spacing.md, marginBottom: 6, paddingHorizontal: spacing.xs },
  ranked: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  place: { ...type.bodyStrong, minWidth: 22, textAlign: 'right' },
  entries: { gap: spacing.sm },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
  form: { padding: spacing.lg, gap: spacing.md },
  change: { ...type.body, color: colors.link, fontFamily: fonts.semibold },
});
