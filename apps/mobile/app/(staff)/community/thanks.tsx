import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { addDays, addMonths } from '@tugeel/shared/time';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { ArrowRight, Heart, HeartHandshake, Plus, Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
import { colors, fonts, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton, SearchField } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { Group, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../../../src/ui/sheet';
import { FooterBar, PAGE, Pill } from '../../../src/ui/staff-kit';
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
          icon={<Send size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
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
  const today = useToday();
  const first = `${monthOf(today)}-01`;
  const thanks = useThanks(first, addDays(addMonths(first, 1), -1));
  const [open, setOpen] = useState(false);
  const ranking = thanks.data?.ranking ?? [];
  const items = thanks.data?.items ?? [];

  /** «Өнөөдөр» or «11-р сарын 13»: the day in words, never the raw date. */
  const dayLabel = (day: string): string => {
    if (day === today) return t('mobile.days.today');
    const [, month = '1', date = '1'] = day.split('-');
    return t('mobile.calendar.day', {
      month: Number.parseInt(month, 10),
      day: Number.parseInt(date, 10),
    });
  };

  const renderEntry = (entry: ThanksEntry) => (
    <View key={entry.id} style={styles.entry}>
      <Avatar name={entry.toName} photoUrl={entry.toPhotoUrl} size={32} />
      <View style={styles.grow}>
        <View
          accessible
          accessibilityLabel={t('mobile.community.thanks.fromTo', {
            from: entry.fromName,
            to: entry.toName,
          })}
          style={styles.names}
        >
          <Text style={[type.rowStrong, styles.name]} numberOfLines={1}>
            {entry.fromName}
          </Text>
          <ArrowRight size={14} strokeWidth={2.2} color={colors.muted} />
          <Text style={[type.rowStrong, styles.name]} numberOfLines={1}>
            {entry.toName}
          </Text>
        </View>
        <Text style={[type.body, styles.note]}>{entry.note}</Text>
        <Text style={type.caption}>{dayLabel(entry.day)}</Text>
      </View>
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.thanks.title')} onBack={() => router.back()} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
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
              icon={<HeartHandshake size={40} strokeWidth={1.5} color={colors.muted} />}
              title={t('mobile.community.thanks.empty')}
              hint={t('mobile.community.thanks.emptyHint')}
            />
          ) : null}
          {ranking.length > 0 ? (
            <>
              <SectionHeader style={styles.section}>
                {t('mobile.community.thanks.ranking')}
              </SectionHeader>
              <Group inset={spacing.lg}>
                {ranking.map((rank, index) => (
                  <View
                    key={rank.userId}
                    accessible
                    accessibilityLabel={`${t('mobile.community.thanks.rank', { n: index + 1 })} ${rank.fullName}, ${t('mobile.community.thanks.count', { n: rank.count })}`}
                    style={styles.rank}
                  >
                    <View style={[styles.place, index === 0 && styles.placeFirst]}>
                      <Text style={[styles.placeText, tabular]}>{String(index + 1)}</Text>
                    </View>
                    <Avatar name={rank.fullName} photoUrl={rank.photoUrl} size={32} />
                    <Text
                      style={[index === 0 ? type.rowStrong : type.row, styles.name]}
                      numberOfLines={1}
                    >
                      {rank.fullName}
                    </Text>
                    <Pill icon={Heart} tone="bad" label={String(rank.count)} style={styles.pill} />
                  </View>
                ))}
              </Group>
            </>
          ) : null}
          {items.length > 0 ? (
            <>
              <SectionHeader style={styles.section}>
                {t('mobile.community.thanks.newest')}
              </SectionHeader>
              <Group inset={spacing.lg + 32 + spacing.md}>
                {items.slice(0, 50).map(renderEntry)}
              </Group>
            </>
          ) : null}
        </FirstLoad>
      </ScrollView>
      <FooterBar>
        <PillButton
          style={styles.flex}
          title={t('mobile.community.thanks.new')}
          icon={<Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />}
          onPress={() => setOpen(true)}
        />
      </FooterBar>
      <SendThanksSheet visible={open} onClose={() => setOpen(false)} />
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: PAGE.padding, gap: PAGE.gap },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  /** A label sits 16 px under the block above it and 8 px over its own list. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  rank: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  place: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeFirst: { backgroundColor: colors.tint.amber },
  placeText: { ...type.chip, fontFamily: fonts.bold, color: colors.label2 },
  name: { flexShrink: 1, minWidth: 0 },
  pill: { alignSelf: 'center', marginLeft: 'auto' },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  names: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { color: colors.label2 },
  form: { padding: spacing.lg, gap: spacing.md },
  change: { ...type.body, color: colors.link, fontFamily: fonts.semibold },
});
