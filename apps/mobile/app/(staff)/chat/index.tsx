import { CHAT_LIST_STATES, type ChatListState } from '@tugeel/shared/chat';
import { useIsFocused, useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { problemFrom } from '../../../src/api/problem';
import { useChatStreamDown } from '../../../src/chat/connection';
import {
  defaultFilter,
  firstLine,
  type StaffChatConversation,
} from '../../../src/chat/staff-logic';
import { useStaffChatBadge, useStaffChatList } from '../../../src/chat/staff-chat';
import { shortDate, ubDate, ubTime } from '../../../src/dates/dates';
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { CountBadge, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** The time of a row: today's `HH:mm`, an earlier day's `MM-DD`. */
function whenOf(iso: string, today: string): string {
  return ubDate(iso) === today ? ubTime(iso) : shortDate(ubDate(iso));
}

/**
 * «Харилцагчийн чат» (ADR-0224): the conversations in the user's scope, the latest message first,
 * under three filters («Хүлээж буй», «Ажилтантай», «Бүгд»; the first when anything waits, else the
 * second). Each row has the store, the last message, its time, the unread count and the marks;
 * pulling down refreshes, live events update and reorder.
 */
export default function StaffChatListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const focused = useIsFocused();
  const counts = useStaffChatBadge(true);
  const [chosen, setChosen] = useState<ChatListState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const streamDown = useChatStreamDown();

  // The first filter is picked once the badge is known; after it the user's choice stays.
  useEffect(() => {
    if (chosen === null && counts.settled) setChosen(defaultFilter(counts.waiting));
  }, [chosen, counts.settled, counts.waiting]);

  const filter = chosen ?? 'STAFF';
  const list = useStaffChatList(filter, focused && chosen !== null);
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const today = ubDate(new Date().toISOString());

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([list.refetch(), counts.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const renderRow = ({ item }: { item: StaffChatConversation }) => {
    const last = item.lastMessage;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/chat/${item.id}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.grow}>
          <View style={styles.top}>
            <Text style={[type.rowStrong, styles.grow]} numberOfLines={1}>
              {item.customerName}
            </Text>
            {last ? (
              <Text style={[type.caption, tabular]}>{whenOf(last.createdAt, today)}</Text>
            ) : null}
          </View>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {item.customerCode}
          </Text>
          <View style={styles.bottom}>
            <Text style={[type.secondary, styles.grow]} numberOfLines={1}>
              {last ? firstLine(last.body) : t('mobile.staffChat.noMessages')}
            </Text>
            {item.unread > 0 ? <CountBadge count={item.unread} tone="red" /> : null}
          </View>
          {item.awaitingStaff || item.mode === 'BOT' ? (
            <View style={styles.marks}>
              {item.awaitingStaff ? (
                <Pill label={t('mobile.staffChat.awaiting')} tone="warn" />
              ) : null}
              {item.mode === 'BOT' ? <Pill label={t('mobile.chat.bot')} tone="neutral" /> : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Page edges={['bottom']}>
      <StoreHeader title={t('mobile.staffChat.title')} onBack={() => router.back()} />
      <View style={styles.filter}>
        <Segmented
          label={t('mobile.staffChat.title')}
          value={chosen}
          onChange={setChosen}
          options={CHAT_LIST_STATES.map((value) => ({
            value,
            label: t(`mobile.staffChat.filter.${value}`),
          }))}
        />
      </View>
      {streamDown ? (
        <Text accessibilityRole="alert" style={[type.secondary, styles.note]}>
          {t('mobile.chat.disconnected')}
        </Text>
      ) : null}
      {chosen === null || list.isPending ? (
        list.isError ? (
          <ProblemText problem={problemFrom(list.error)} style={styles.problem} />
        ) : (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        )
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderRow}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          ListHeaderComponent={
            list.isError ? (
              <ProblemText problem={problemFrom(list.error)} style={styles.problem} />
            ) : null
          }
          ListEmptyComponent={
            list.isError ? null : (
              <EmptyState
                icon={<MessageCircle size={40} strokeWidth={1.5} color={colors.input} />}
                title={t(`mobile.staffChat.empty.${filter}`)}
              />
            )
          }
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <ActivityIndicator style={styles.loading} color={colors.primary} />
            ) : null
          }
          contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
        />
      )}
    </Page>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  filter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingBottom: spacing.xl },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
  },
  pressed: { backgroundColor: colors.secondary },
  grow: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  marks: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  loading: { marginTop: spacing.xxl },
  problem: { margin: spacing.lg },
  note: { textAlign: 'center', paddingBottom: spacing.sm },
});
