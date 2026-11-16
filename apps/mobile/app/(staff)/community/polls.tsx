import { useRouter } from 'expo-router';
import { ClipboardList, Vote } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { type Poll, useMyPolls } from '../../../src/api/community';
import { FirstLoad } from '../../../src/community/parts';
import { shortDate, ubDate } from '../../../src/dates/dates';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { PAGE, Pill, type Tone } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';

const STATUS_TONES = { OPEN: 'info', ANSWERED: 'ok', CLOSED: 'neutral' } as const satisfies Record<
  string,
  Tone
>;

const statusOf = (poll: Poll): keyof typeof STATUS_TONES =>
  !poll.open ? 'CLOSED' : poll.answered ? 'ANSWERED' : 'OPEN';

/** Votes and surveys (ADR-0146): those to answer first, then the answered and the closed. */
export default function PollsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const polls = useMyPolls();
  const rows = polls.data ?? [];
  const toAnswer = rows.filter((poll) => statusOf(poll) === 'OPEN');
  const done = rows.filter((poll) => statusOf(poll) !== 'OPEN');

  const renderPoll = (poll: Poll) => {
    const status = statusOf(poll);
    const Icon = poll.kind === 'VOTE' ? Vote : ClipboardList;
    const kind = t(`mobile.community.polls.kinds.${poll.kind}`);
    return (
      <Row
        key={poll.id}
        minHeight={56}
        icon={
          <IconTile color={poll.kind === 'VOTE' ? colors.tint.indigo : colors.tint.teal}>
            <Icon size={18} strokeWidth={2.2} color={colors.primaryForeground} />
          </IconTile>
        }
        title={poll.title}
        titleStyle={status === 'OPEN' ? type.rowStrong : undefined}
        subtitle={
          poll.open && poll.endsAt
            ? `${kind} · ${t('mobile.community.polls.until', { date: shortDate(ubDate(poll.endsAt)) })}`
            : kind
        }
        // The status pill ends the row: no chevron after it.
        chevron={false}
        right={
          <Pill
            label={t(`mobile.community.polls.status.${status}`)}
            tone={STATUS_TONES[status]}
            style={styles.pill}
          />
        }
        onPress={() => router.push(`/community/poll/${poll.id}`)}
      />
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.community.polls.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={polls.isRefetching} onRefresh={() => void polls.refetch()} />
        }
      >
        <FirstLoad query={polls}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Vote size={40} strokeWidth={1.5} color={colors.muted} />}
              title={t('mobile.community.polls.empty')}
            />
          ) : null}
          {toAnswer.length > 0 ? (
            <>
              <SectionHeader style={styles.section}>
                {t('mobile.community.polls.toAnswer')}
              </SectionHeader>
              <Group inset={ICON_INSET}>{toAnswer.map(renderPoll)}</Group>
            </>
          ) : null}
          {done.length > 0 ? (
            <>
              <SectionHeader style={styles.section}>
                {t('mobile.community.polls.done')}
              </SectionHeader>
              <Group inset={ICON_INSET}>{done.map(renderPoll)}</Group>
            </>
          ) : null}
        </FirstLoad>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: PAGE.padding, gap: PAGE.gap, paddingBottom: 40 },
  /** A label sits 16 px under the block above it and 8 px over its own list. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  pill: { alignSelf: 'center' },
});
