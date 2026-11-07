import { useRouter } from 'expo-router';
import { CalendarClock, ScanLine, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type ExpiryItem, useExpiryItems, useExpirySummary } from '../../../src/api/expiry';
import { problemFrom } from '../../../src/api/problem';
import { ExpiryRecordRow, HeaderSearch } from '../../../src/expiry/parts';
import { chipCount, EXPIRY_CHIPS, type ExpiryChip } from '../../../src/expiry/rules';
import { formatCount } from '../../../src/format/format';
import { isRep } from '../../../src/state/phase';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, spacing } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import {
  useKeyboardShown,
  useStoreTabBarHeight,
  useStoreTabBarInset,
} from '../../../src/ui/store-tab-bar';

/** A 32 px chip pressed over 44 px: the row leaves that room above and below it. */
const CHIP_SLOP = { top: 6, bottom: 6 };

/**
 * «Хугацаа илрүүлэлт» (ADR-0172 #9): the search, the chips with the summary's counts, the records
 * soonest first (the date, the days in their colour, the two counts and the total, the status), and
 * «Скан хийх» or «Хайх» to write a new one. A tab of the work menu for everyone but a rep, who comes
 * from «Нүүр» or «Профайл» and has the back arrow.
 */
export default function ExpiryHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const rep = isRep(me);
  const barInset = useStoreTabBarInset();
  const barHeight = useStoreTabBarHeight();
  const keyboard = useKeyboardShown();
  const [chip, setChip] = useState<ExpiryChip>('ACTIVE');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const summary = useExpirySummary();
  const items = useExpiryItems(chip, q);
  const rows = useMemo(() => (items.data?.pages ?? []).flatMap((page) => page.data), [items.data]);

  const renderItem = ({ item }: { item: ExpiryItem }) => (
    <ExpiryRecordRow item={item} onPress={() => router.push(`/expiry/${item.id}`)} />
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.expiry.title')}
        {...(rep ? { onBack: () => router.back() } : {})}
        right={null}
      >
        <HeaderSearch
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.expiry.search')}
          label={t('mobile.shop.searchLabel')}
        />
      </StoreHeader>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
      >
        {EXPIRY_CHIPS.map((entry) => {
          const label = t(`mobile.expiry.chips.${entry}`);
          return (
            <ChoiceChip
              key={entry}
              compact
              onWhite={false}
              hitSlop={CHIP_SLOP}
              label={
                summary.data
                  ? t('mobile.expiry.chipCount', {
                      label,
                      n: formatCount(chipCount(summary.data, entry)),
                    })
                  : label
              }
              selected={chip === entry}
              onPress={() => setChip(entry)}
            />
          );
        })}
      </ScrollView>

      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.list,
          { paddingBottom: (rep ? Math.max(insets.bottom, spacing.md) : barInset) + 90 },
        ]}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (items.hasNextPage && !items.isFetchingNextPage) void items.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={items.isRefetching && !items.isFetchingNextPage}
            onRefresh={() => {
              void summary.refetch();
              void items.refetch();
            }}
          />
        }
        ListEmptyComponent={
          items.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : items.error ? (
            <View style={styles.failed}>
              <ProblemText problem={problemFrom(items.error)} />
              <PillButton
                title={t('common.retry')}
                variant="soft"
                onPress={() => void items.refetch()}
              />
            </View>
          ) : q !== '' ? (
            <EmptyState
              icon={<Search size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.expiry.emptySearch')}
            />
          ) : (
            <EmptyState
              icon={<CalendarClock size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.expiry.empty')}
              hint={t('mobile.expiry.emptyHint')}
            />
          )
        }
        ListFooterComponent={
          items.isFetchingNextPage ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : null
        }
      />

      {keyboard ? null : (
        <View
          style={[
            styles.footer,
            rep
              ? { paddingBottom: Math.max(insets.bottom, spacing.md) }
              : { bottom: barHeight, paddingBottom: spacing.md },
          ]}
        >
          <PillButton
            title={t('mobile.expiry.scan')}
            icon={<ScanLine size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
            style={styles.action}
            onPress={() => router.push('/expiry/new?scan=1')}
          />
          <PillButton
            title={t('mobile.expiry.find')}
            variant="soft"
            icon={<Search size={20} strokeWidth={2.2} color={colors.secondaryForeground} />}
            style={styles.action}
            onPress={() => router.push('/expiry/new')}
          />
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: 14, paddingVertical: spacing.md },
  list: { paddingHorizontal: 14 },
  separator: { height: spacing.sm },
  loading: { marginTop: spacing.xl },
  failed: { gap: spacing.md },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    backgroundColor: colors.sheetBarFill,
  },
  action: { flex: 1, paddingHorizontal: spacing.md },
});
