import { type HomeSectionSort, parseHomeSectionKey } from '@tugeel/shared/sales';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  PackageSearch,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import {
  type RepProduct,
  useCategories,
  useRepSection,
  useRepSectionCount,
} from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { useSectionText } from '../../../src/customer/home-parts';
import { sectionSortsOf } from '../../../src/customer/home-sections';
import {
  activeFilters,
  CategoryFilterSheet,
  type ListFilters,
  NO_LIST_FILTERS,
  SortSheet,
} from '../../../src/customer/list-sheets';
import { shopRouteParams } from '../../../src/customer/shop';
import { formatCount } from '../../../src/format/format';
import { Chip } from '../../../src/shop/chip';
import { useAddOne } from '../../../src/shop/use-add';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing } from '../../../src/theme/tokens';
import { CircleButton, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { HeaderCart, StoreHeader } from '../../../src/ui/store-header';

const GAP = 12;

/**
 * A section's full list in the rep app (ADR-0100 #9, «Bto300»'s SectionList board): the section's
 * title with its count and line in the header, the order and the filters as chips, the rep's
 * product cards two by two and a round «дээш» once the list is scrolled. Opened from «Нүүр»'s › or link, a banner's segment, or a category page
 * (`?categoryIds=5&from=category`).
 */
export default function RepSectionScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;
  const grid = useRef<FlatList<RepProduct>>(null);
  const [scrolled, setScrolled] = useState(false);
  const params = useLocalSearchParams<{ key: string; categoryIds?: string; from?: string }>();
  const key = String(params.key ?? '');
  const fromCategory = params.from === 'category';
  const parsed = parseHomeSectionKey(key);
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const add = useAddOne();
  const categories = useCategories();
  const sectionText = useSectionText();
  const [sort, setSort] = useState<HomeSectionSort>('DEFAULT');
  const [filters, setFilters] = useState<ListFilters>(() => ({
    ...NO_LIST_FILTERS,
    categoryIds: shopRouteParams({ categoryIds: params.categoryIds }).categoryIds ?? [],
  }));
  const [draft, setDraft] = useState<ListFilters>(filters);
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);
  const list = useRepSection(key, { sort, ...filters });
  const draftCount = useRepSectionCount(key, { sort, ...draft }, sheet === 'filter');
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
  const sortLabel = sorts.find((option) => option.value === sort)?.label ?? '';
  const active = activeFilters(filters);
  const openFilter = () => {
    setDraft(filters);
    setSheet('filter');
  };

  const header = (
    <View style={styles.header}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}
      >
        <Chip
          icon={ArrowDownUp}
          label={sortLabel}
          trailing={ChevronDown}
          accessibilityLabel={`${t('mobile.filter.sort')}: ${sortLabel}`}
          onPress={() => setSheet('sort')}
        />
        <Chip
          tone={active > 0 ? 'primary' : 'plain'}
          icon={SlidersHorizontal}
          label={active > 0 ? `${t('mobile.filter.title')} · ${active}` : t('mobile.filter.title')}
          accessibilityLabel={t('mobile.shop.filterButton', { n: active })}
          onPress={openFilter}
        />
        {categoryNames.length > 0 ? (
          <Chip
            tone="chosen"
            label={
              categoryNames.length === 1
                ? (categoryNames[0] ?? '')
                : t('mobile.shop.andMore', { name: categoryNames[0], n: categoryNames.length - 1 })
            }
            onPress={openFilter}
            onRemove={() => setFilters({ ...filters, categoryIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.categories') })}
          />
        ) : null}
        {filters.inStock ? (
          <Chip
            tone="chosen"
            label={t('mobile.shop.inStockChip')}
            onPress={openFilter}
            onRemove={() => setFilters({ ...filters, inStock: false })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.shop.inStockChip') })}
          />
        ) : null}
      </ScrollView>
      {problem && problem.status !== 404 ? (
        <ProblemText problem={problem} style={styles.problem} />
      ) : null}
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader
        title={text.title}
        subtitle={
          [
            total === null ? null : t('mobile.customer.list.count', { n: formatCount(total) }),
            text.subtitle,
          ]
            .filter((part) => part)
            .join(' · ') || null
        }
        onBack={() => router.back()}
        right={<HeaderCart />}
      />
      <FlatList
        ref={grid}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 600)}
        scrollEventThrottle={200}
        data={rows}
        numColumns={2}
        keyExtractor={(product) => String(product.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            server={server}
            line={lineOf(cart, item.id)}
            locked={pending !== null}
            onOpen={() => router.push(`/product/${item.id}`)}
            onAdd={() => add(item)}
            width={cardWidth}
          />
        )}
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
                {...(active > 0 ? { hint: t('mobile.customer.list.emptyHint') } : {})}
              />
              {active > 0 ? (
                <PillButton
                  title={t('mobile.orders.clearFilters')}
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
      {scrolled ? (
        <CircleButton
          icon={<ChevronUp size={20} strokeWidth={2.4} color={colors.foreground} />}
          label={t('mobile.customer.list.toTop')}
          onPress={() => grid.current?.scrollToOffset({ offset: 0, animated: true })}
          style={[styles.top, { bottom: insets.bottom + spacing.xl }]}
        />
      ) : null}
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
      <CategoryFilterSheet
        visible={sheet === 'filter'}
        categories={categories.data}
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
  header: { paddingBottom: spacing.md },
  // Edge to edge: the list pads its content, the chips scroll under the margins.
  chipRow: { marginHorizontal: -spacing.lg },
  chips: { gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  problem: { marginTop: spacing.md },
  columns: { gap: GAP },
  rowGap: { height: GAP },
  loading: { marginTop: spacing.xxl },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md },
  top: { position: 'absolute', right: spacing.lg },
});
