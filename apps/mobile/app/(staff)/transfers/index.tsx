import { useRouter } from 'expo-router';
import { ChevronRight, PackageOpen, Plus, ScanLine } from 'lucide-react-native';
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
import { problemFrom } from '../../../src/api/problem';
import { useTransferContext, useTransferRequests } from '../../../src/api/transfers';
import { shortDate, ubDate, ubTime } from '../../../src/dates/dates';
import { initialsOf } from '../../../src/format/format';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../../../src/theme/tokens';
import { numbersLabel } from '../../../src/transfers/grouping';
import { DraftPill, TransferStatusPill, TransferStatusTile } from '../../../src/transfers/pills';
import {
  HOME_FILTERS,
  type HomeFilter,
  matchesFilter,
  serverStatusOf,
} from '../../../src/transfers/statuses';
import type { TransferRequestSummary } from '../../../src/transfers/types';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { ICON_INSET, Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { FooterBar, Pill } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * «Шилжүүлэг» (ADR-0116 #1): the store (the header's second line, or a switch when the seller has
 * several), the status chips, the store's requests newest first in one grouped list (a tile in
 * the status's tone, the TR- numbers, the status, the date, «N бараа»), and «Шинэ хүсэлт» in the
 * bar under the page. A user without a STORE warehouse in their scope (a keeper) sees why there is nothing
 * here. The initials open the profile.
 */
export default function TransfersHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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

  const renderRequest = ({ item, index }: { item: TransferRequestSummary; index: number }) => {
    const label = numbersLabel(item.numbers);
    const at = item.requestedAt ?? item.createdAt;
    return (
      <View
        style={[
          styles.cell,
          index === 0 && styles.firstCell,
          index === rows.length - 1 && styles.lastCell,
        ]}
      >
        {index > 0 ? <Separator inset={ICON_INSET} /> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/transfers/${item.id}`)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <TransferStatusTile status={label ? item.status : 'DRAFT'} />
          <View style={styles.grow}>
            <View style={styles.rowTop}>
              <Text
                style={[type.rowStrong, tabular, styles.rowTitle, !label && styles.muted]}
                numberOfLines={1}
              >
                {label ?? t('inventory.docStatus.DRAFT')}
              </Text>
              {label ? <TransferStatusPill status={item.status} /> : <DraftPill />}
            </View>
            <Text style={[type.secondary, tabular]} numberOfLines={1}>
              {[
                `${shortDate(ubDate(at))} ${ubTime(at)}`,
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
            {item.status === 'SHIPPED' ? (
              <Pill
                label={t('mobile.transfers.home.readyToReceive')}
                tone="info"
                icon={ScanLine}
                style={styles.ready}
              />
            ) : null}
          </View>
          <ChevronRight size={18} strokeWidth={2.4} color={colors.input} style={styles.chevron} />
        </Pressable>
      </View>
    );
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.transfers.title')}
        subtitle={stores.length === 1 ? (stores[0]?.name ?? null) : null}
        onBack={() => router.back()}
        right={
          rep ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.tabs.profile')}
              onPress={() => router.push('/profile')}
              hitSlop={7}
              style={({ pressed }) => [styles.avatar, pressed && styles.faded]}
            >
              <Text style={styles.avatarText}>{initialsOf(me.fullName)}</Text>
            </Pressable>
          ) : null
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
            style={styles.fill}
            contentContainerStyle={styles.list}
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
          <FooterBar>
            <PillButton
              title={t('mobile.transfers.home.newRequest')}
              icon={<Plus size={20} strokeWidth={2.4} color={colors.primaryForeground} />}
              style={styles.fill}
              disabled={storeId === null}
              onPress={() => {
                if (storeId !== null) router.push(`/transfers/new?store=${storeId}`);
              }}
            />
          </FooterBar>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
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
  stores: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  keeper: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  fill: { flex: 1 },
  muted: { color: colors.muted },
  chipRow: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1 },
  cell: { backgroundColor: colors.card, overflow: 'hidden' },
  firstCell: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  lastCell: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  ready: { marginTop: 2 },
  chevron: { marginTop: spacing.sm },
  pressed: { backgroundColor: colors.accent },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: spacing.md },
});
