import { type HomeSectionSort, parseHomeSectionKey } from '@tugeel/shared/sales';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PackageSearch } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useStoreCategories,
  useStoreSection,
  useStoreSectionCount,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import {
  CartButton,
  StoreCard,
  useCardActions,
  useSectionText,
} from '../../../src/customer/home-parts';
import { sectionSortsOf } from '../../../src/customer/home-sections';
import {
  activeFilters,
  FloatingPill,
  type ListFilters,
  ListFilterSheet,
  NO_LIST_FILTERS,
  SortSheet,
} from '../../../src/customer/list-sheets';
import { shopRouteParams } from '../../../src/customer/shop';
import { formatCount } from '../../../src/format/format';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, NavBar, Page } from '../../../src/ui/layout';
import { Text } from '../../../src/ui/text';

const GAP = 10;

/**
 * «Хэсгийн бүх бараа» (ADR-0092 #7, ADR-0093 #6; the SectionList board): a section's title, its line
 * and count, its products two by two, and the floating «Эрэмбэлэх | Шүүлтүүр». Opened from «Нүүр»'s
 * chevron or chip, a banner's segment, or a category page (`?categoryIds=5&from=category`).
 */
export default function SectionListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;
  const params = useLocalSearchParams<{ key: string; categoryIds?: string; from?: string }>();
  const key = String(params.key ?? '');
  const fromCategory = params.from === 'category';
  const parsed = parseHomeSectionKey(key);
  const categories = useStoreCategories();
  const actions = useCardActions();
  const sectionText = useSectionText();
  const [sort, setSort] = useState<HomeSectionSort>('DEFAULT');
  const [filters, setFilters] = useState<ListFilters>(() => ({
    ...NO_LIST_FILTERS,
    categoryIds: shopRouteParams({ categoryIds: params.categoryIds }).categoryIds ?? [],
  }));
  const [draft, setDraft] = useState<ListFilters>(filters);
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);
  const list = useStoreSection(key, { sort, ...filters });
  const draftCount = useStoreSectionCount(key, { sort, ...draft }, sheet === 'filter');
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const kind = first?.kind ?? parsed?.kind ?? 'SEGMENT';
  const text = sectionText(
    first ?? { kind, title: null, subtitle: null, lastDay: null },
    fromCategory ? 'category' : 'home',
  );
  const sorts = sectionSortsOf(kind).map((option) => ({
    value: option.value,
    label: t(`mobile.customer.sorts.${option.name}`),
  }));
  const total = first?.total ?? null;
  const problem = list.error ? problemFrom(list.error) : null;

  const categoryNames = filters.categoryIds.map(
    (id) => categories.data?.find((category) => category.id === id)?.name ?? '',
  );
  const sortLine = [
    t('mobile.customer.list.sortLine', {
      sort: sorts.find((option) => option.value === sort)?.label ?? '',
    }),
    categoryNames.length === 1
      ? categoryNames[0]
      : categoryNames.length > 1
        ? t('mobile.shop.andMore', { name: categoryNames[0], n: categoryNames.length - 1 })
        : null,
    filters.inStock ? t('mobile.customer.list.inStockLine') : null,
  ]
    .filter((part) => part)
    .join(' · ');
  const countLine = [
    text.subtitle,
    total === null ? null : t('mobile.customer.list.count', { n: formatCount(total) }),
  ]
    .filter((part) => part)
    .join(' · ');

  const header = (
    <View style={styles.header}>
      <LargeTitle>{text.title || ' '}</LargeTitle>
      {countLine ? <Text style={[type.body, styles.muted]}>{countLine}</Text> : null}
      <Text style={[type.chip, styles.sortLine]}>{sortLine}</Text>
      {problem && problem.status !== 404 ? <ProblemText problem={problem} /> : null}
    </View>
  );

  return (
    <Page white>
      <NavBar
        {...(fromCategory ? {} : { back: t('mobile.tabs.home') })}
        onBack={() => router.back()}
        right={<CartButton />}
      />
      <FlatList
        data={rows}
        numColumns={2}
        keyExtractor={(product) => String(product.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item }) => <StoreCard product={item} actions={actions} width={cardWidth} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : problem?.status === 404 ? (
            <EmptyState
              icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.customer.list.gone')}
            />
          ) : problem ? null : (
            <View style={styles.empty}>
              <EmptyState
                icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.list.empty')}
                {...(activeFilters(filters) > 0
                  ? { hint: t('mobile.customer.list.emptyHint') }
                  : {})}
              />
              {activeFilters(filters) > 0 ? (
                <PillButton
                  title={t('mobile.shop.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => setFilters(NO_LIST_FILTERS)}
                />
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator style={styles.more} color={colors.primary} />
          ) : null
        }
      />
      {problem?.status === 404 ? null : (
        <FloatingPill
          bottom={insets.bottom + 24}
          active={activeFilters(filters)}
          onSort={() => setSheet('sort')}
          onFilter={() => {
            setDraft(filters);
            setSheet('filter');
          }}
        />
      )}
      <SortSheet
        visible={sheet === 'sort'}
        options={sorts}
        value={sort}
        onPick={(value) => {
          setSort(value);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <ListFilterSheet
        visible={sheet === 'filter'}
        draft={draft}
        count={draftCount.data ?? null}
        onChange={setDraft}
        onApply={() => {
          setFilters(draft);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  header: { paddingTop: 2, paddingBottom: 14, gap: 2 },
  muted: { color: colors.muted },
  sortLine: { marginTop: spacing.xs, color: colors.label2 },
  columns: { gap: GAP },
  rowGap: { height: 12 },
  loading: { marginTop: spacing.xxl },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md },
});
