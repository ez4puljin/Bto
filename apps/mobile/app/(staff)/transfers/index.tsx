import { useRouter } from 'expo-router';
import { ChevronRight, PackageOpen, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { useTransferContext, useTransferRequests } from '../../../src/api/transfers';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { initialsOf } from '../../../src/format/format';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { brandSheet } from '../../../src/theme/brand';
import { colors, fonts, radii, spacing, storeType, type } from '../../../src/theme/tokens';
import { numbersLabel } from '../../../src/transfers/grouping';
import { DraftPill, TransferStatusPill } from '../../../src/transfers/pills';
import {
  HOME_FILTERS,
  type HomeFilter,
  matchesFilter,
  serverStatusOf,
} from '../../../src/transfers/statuses';
import type { TransferRequestSummary } from '../../../src/transfers/types';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * «Шилжүүлэг» (ADR-0116 #1): the store (a switch when the seller has several), the status chips,
 * the store's requests newest first (the date, the TR- numbers, the status, «N бараа»), and «Шинэ
 * хүсэлт». A user without a STORE warehouse in their scope (a keeper) sees why there is nothing
 * here. The initials open the profile.
 */
export default function TransfersHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const context = useTransferContext();
  const stores = useMemo(() => context.data?.storeWarehouses ?? [], [context.data]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [filter, setFilter] = useState<HomeFilter>('ALL');

  // The first store once the context is there; a store that left the scope is dropped.
  useEffect(() => {
    if (stores.length === 0) return;
    if (storeId === null || !stores.some((store) => store.id === storeId)) {
      setStoreId(stores[0]?.id ?? null);
    }
  }, [stores, storeId]);

  const requests = useTransferRequests(storeId, serverStatusOf(filter));
  const rows = useMemo(
    () =>
      (requests.data?.pages ?? [])
        .flatMap((page) => page.data)
        .filter((request) => matchesFilter(request.status, filter)),
    [requests.data, filter],
  );
  const keeper = context.data !== undefined && stores.length === 0;

  const renderRequest = ({ item }: { item: TransferRequestSummary }) => {
    const label = numbersLabel(item.numbers);
    const at = item.requestedAt ?? item.createdAt;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/transfers/${item.id}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.grow}>
          <View style={styles.rowTop}>
            <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={1}>
              {label ?? t('inventory.docStatus.DRAFT')}
            </Text>
            {label ? <TransferStatusPill status={item.status} /> : <DraftPill />}
          </View>
          <Text style={type.secondary} numberOfLines={1}>
            {[
              `${ubDate(at)} ${ubTime(at)}`,
              t('mobile.transfers.home.items', { n: item.lineCount }),
              item.groupCount > 1
                ? t('mobile.transfers.home.groups', { n: item.groupCount })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {item.note ? (
            <Text style={type.secondary} numberOfLines={1}>
              {item.note}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
      </Pressable>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.transfers.title')}
        {...(rep ? { onBack: () => router.back() } : {})}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.tabs.profile')}
            onPress={() => router.push(rep ? '/profile' : '/store-profile')}
            hitSlop={7}
            style={({ pressed }) => [styles.avatar, pressed && styles.faded]}
          >
            <Text style={styles.avatarText}>{initialsOf(me.fullName)}</Text>
          </Pressable>
        }
      >
        {stores.length > 1 ? (
          <View style={styles.stores}>
            <Segmented
              options={stores.map((store) => ({ value: String(store.id), label: store.name }))}
              value={storeId === null ? null : String(storeId)}
              onChange={(value) => setStoreId(Number.parseInt(value, 10))}
              label={t('mobile.transfers.home.store')}
            />
          </View>
        ) : null}
      </StoreHeader>

      {keeper ? (
        <View style={styles.keeper}>
          <EmptyState
            icon={<PackageOpen size={48} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.transfers.home.noStore')}
            hint={t('mobile.transfers.home.noStoreHint')}
          />
        </View>
      ) : context.error && !context.data ? (
        <View style={styles.keeper}>
          <ProblemText problem={problemFrom(context.error)} />
          <PillButton
            title={t('common.retry')}
            variant="soft"
            height={44}
            onPress={() => void context.refetch()}
          />
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.chipRow}
          >
            {HOME_FILTERS.map((entry) => (
              <ChoiceChip
                key={entry}
                compact
                onWhite={false}
                label={t(`mobile.transfers.home.filters.${entry}`)}
                selected={filter === entry}
                onPress={() => setFilter(entry)}
              />
            ))}
          </ScrollView>
          <FlatList
            data={rows}
            keyExtractor={(request) => String(request.id)}
            renderItem={renderRequest}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: Math.max(insets.bottom, spacing.md) + 90 },
            ]}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (requests.hasNextPage && !requests.isFetchingNextPage) {
                void requests.fetchNextPage();
              }
            }}
            refreshControl={
              <RefreshControl
                refreshing={requests.isRefetching && !requests.isFetchingNextPage}
                onRefresh={() => {
                  void context.refetch();
                  void requests.refetch();
                }}
              />
            }
            ListEmptyComponent={
              requests.isLoading || storeId === null ? (
                <ActivityIndicator style={styles.loading} color={colors.primary} />
              ) : requests.error ? (
                <ProblemText problem={problemFrom(requests.error)} style={styles.problem} />
              ) : (
                <EmptyState
                  icon={<PackageOpen size={44} strokeWidth={1.5} color={colors.input} />}
                  title={t('mobile.transfers.home.empty')}
                  hint={t('mobile.transfers.home.emptyHint')}
                />
              )
            }
            ListFooterComponent={
              requests.isFetchingNextPage ? (
                <ActivityIndicator style={styles.loading} color={colors.primary} />
              ) : null
            }
          />
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <PillButton
              title={t('mobile.transfers.home.newRequest')}
              icon={<Plus size={20} strokeWidth={2.4} color={colors.primaryForeground} />}
              disabled={storeId === null}
              onPress={() => {
                if (storeId !== null) router.push(`/transfers/new?store=${storeId}`);
              }}
            />
          </View>
        </>
      )}
    </Page>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    grow: { flex: 1, minWidth: 0, gap: 2 },
    faded: { opacity: 0.7 },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      marginRight: spacing.sm,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { ...storeType.badge, fontFamily: fonts.bold, color: colors.primary },
    stores: { paddingHorizontal: 14, paddingBottom: spacing.md },
    keeper: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
    chipRow: { flexGrow: 0 },
    chips: { gap: spacing.sm, paddingHorizontal: 14, paddingVertical: spacing.md },
    list: { paddingHorizontal: 14 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 64,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.card,
      backgroundColor: colors.card,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowTitle: { flex: 1, minWidth: 0 },
    pressed: { backgroundColor: colors.accent },
    separator: { height: spacing.sm },
    loading: { marginTop: spacing.xl },
    problem: { marginTop: spacing.md },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 14,
      paddingTop: spacing.md,
      backgroundColor: colors.sheetBarFill,
    },
  }),
);
