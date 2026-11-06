import { useRouter } from 'expo-router';
import { ClipboardList, Vote } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { type Poll, useMyPolls } from '../../../src/api/community';
import { FirstLoad, StatusPill } from '../../../src/community/parts';
import { ubDate } from '../../../src/dates/dates';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

const STATUS = {
  OPEN: { background: colors.secondary, color: colors.link },
  ANSWERED: { background: colors.successSoft, color: colors.success },
  CLOSED: { background: colors.fill, color: colors.muted },
} as const;

const statusOf = (poll: Poll): keyof typeof STATUS =>
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
        minHeight={60}
        icon={
          <IconTile color={poll.kind === 'VOTE' ? colors.tint.indigo : colors.tint.teal}>
            <Icon size={16} strokeWidth={2.2} color={colors.primaryForeground} />
          </IconTile>
        }
        title={poll.title}
        subtitle={
          poll.open && poll.endsAt
            ? `${kind} · ${t('mobile.community.polls.until', { date: ubDate(poll.endsAt) })}`
            : kind
        }
        right={
          <StatusPill
            label={t(`mobile.community.polls.status.${status}`)}
            background={STATUS[status].background}
            color={STATUS[status].color}
          />
        }
        onPress={() => router.push(`/community/poll/${poll.id}`)}
      />
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.polls.title')}
        onBack={() => router.back()}
        right={null}
      />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={polls.isRefetching} onRefresh={() => void polls.refetch()} />
        }
      >
        <FirstLoad query={polls}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Vote size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.community.polls.empty')}
            />
          ) : null}
          {toAnswer.length > 0 ? (
            <View style={styles.section}>
              <Text style={[type.sectionHeader, styles.head]}>
                {t('mobile.community.polls.toAnswer')}
              </Text>
              <Group inset={ICON_INSET}>{toAnswer.map(renderPoll)}</Group>
            </View>
          ) : null}
          {done.length > 0 ? (
            <View style={styles.section}>
              <Text style={[type.sectionHeader, styles.head]}>
                {t('mobile.community.polls.done')}
              </Text>
              <Group inset={ICON_INSET}>{done.map(renderPoll)}</Group>
            </View>
          ) : null}
        </FirstLoad>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 14, paddingTop: spacing.sm, paddingBottom: 40 },
  section: { marginTop: spacing.md, gap: 6 },
  head: { paddingHorizontal: spacing.xs },
});
