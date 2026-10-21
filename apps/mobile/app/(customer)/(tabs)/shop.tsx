import type { RepProductSort } from '@tugeel/shared/sales';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Heart, PackageSearch, ScanLine, Search } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  type StoreProduct,
  useStoreCategories,
  useStoreProductCount,
  useStoreProducts,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { StoreCard, useCardActions } from '../../../src/customer/home-parts';
import {
  activeFilters,
  FloatingPill,
  type ListFilters,
  ListFilterSheet,
  NO_LIST_FILTERS,
  SortSheet,
} from '../../../src/customer/list-sheets';
import { emptyKindOf, type ShopChip, shopRouteParams } from '../../../src/customer/shop';
import { StoreHeaderBand } from '../../../src/customer/store-header';
import { useStoreTabBarInset } from '../../../src/customer/store-tab-bar';
import { formatCount } from '../../../src/format/format';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, spacing, storeType, TOUCH, type } from '../../../src/theme/tokens';
import { ActiveChip, ChoiceChip, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Text, TextInput } from '../../../src/ui/text';

const GAP = 10;

/**
 * «Бараа» of «Bto300» (ADR-0092 #7; the Shop board): the count in the title, the search by name,
 * code or barcode with the scanner, the chips «Бүгд · ♡ Дуртай · Хямдралтай · Шинэ», the chosen
 * categories, the products two by two, and the floating «Эрэмбэлэх | Шүүлтүүр». Links set a chip
 * (`?chip=deals`), categories (`?categoryIds=5`) or focus the search (`?search=1`).
 */
export default function StoreShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ chip?: string; categoryIds?: string; search?: string }>();
  const { width } = useWindowDimensions();
  const inset = useStoreTabBarInset();
  const categories = useStoreCategories();
  const actions = useCardActions();
  const search = useRef<TextInput>(null);
  const list = useRef<FlatList<StoreProduct>>(null);
  const [scrolled, setScrolled] = useState(false);
  const [text, setText] = useState('');
  const [chip, setChip] = useState<ShopChip>('all');
  const [sort, setSort] = useState<RepProductSort>('NEW');
  const [filters, setFilters] = useState<ListFilters>(NO_LIST_FILTERS);
  const [draft, setDraft] = useState<ListFilters>(NO_LIST_FILTERS);
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);
  const q = useDebounced(text.trim(), 350);

  // A link into the shop: «Нүүр»'s search, a category page, a chip. The link is spent so a later
  // one works again.
  useEffect(() => {
    const link = shopRouteParams(params);
    if (!link.chip && !link.categoryIds && !link.search) return;
    if (link.categoryIds) {
      setText('');
      setChip('all');
      setFilters({ categoryIds: link.categoryIds, inStock: false });
    }
    if (link.chip) setChip(link.chip);
    if (link.search) search.current?.focus();
    router.setParams({ chip: undefined, categoryIds: undefined, search: undefined });
  }, [params, router]);

  const query = { q, categoryIds: filters.categoryIds, chip, inStock: filters.inStock, sort };
  const products = useStoreProducts(query);
  const draftCount = useStoreProductCount(
    { ...query, categoryIds: draft.categoryIds, inStock: draft.inStock },
    sheet === 'filter',
  );
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const first = products.data?.pages[0];
  const total = first?.total ?? null;
  const favouriteCount = first?.favouriteCount ?? null;
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;
  const empty = emptyKindOf(query);

  const sorts = [
    { value: 'NEW' as const, label: t('mobile.customer.sorts.new') },
    { value: 'PRICE_ASC' as const, label: t('mobile.customer.sorts.priceAsc') },
    { value: 'PRICE_DESC' as const, label: t('mobile.customer.sorts.priceDesc') },
  ];
  const categoryNames = filters.categoryIds.map(
    (id) => categories.data?.find((category) => category.id === id)?.name ?? '',
  );
  const sortLine = [
    sorts.find((option) => option.value === sort)?.label ?? '',
    filters.categoryIds.length > 0
      ? t('mobile.customer.list.categoriesLine', { n: filters.categoryIds.length })
      : null,
    filters.inStock ? t('mobile.customer.list.inStockLine') : null,
  ]
    .filter((part) => part)
    .join(' · ');

  const chips: { value: ShopChip; label: string }[] = [
    { value: 'all', label: t('common.all') },
    {
      value: 'favourites',
      label:
        favouriteCount === null
          ? t('mobile.customer.shop.favouritesLabel')
          : t('mobile.customer.shop.favourites', { n: favouriteCount }),
    },
    { value: 'deals', label: t('mobile.customer.shop.chips.deals') },
    { value: 'new', label: t('mobile.customer.shop.chips.new') },
  ];

  const header = (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel={t('mobile.customer.shop.chips.label')}
      >
        {chips.map((option) => (
          <ChoiceChip
            key={option.value}
            label={option.label}
            selected={chip === option.value}
            onPress={() => setChip(option.value)}
            onWhite
            compact
            {...(option.value === 'favourites'
              ? {
                  icon: (
                    <Heart
                      size={15}
                      strokeWidth={2.2}
                      color={chip === 'favourites' ? colors.primaryForeground : colors.heart}
                    />
                  ),
                }
              : {})}
          />
        ))}
        {categoryNames.length > 0 ? (
          <ActiveChip
            label={
              categoryNames.length === 1
                ? (categoryNames[0] ?? '')
                : t('mobile.shop.andMore', { name: categoryNames[0], n: categoryNames.length - 1 })
            }
            onPress={() => {
              setDraft(filters);
              setSheet('filter');
            }}
            onRemove={() => setFilters({ ...filters, categoryIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.categories') })}
          />
        ) : null}
      </ScrollView>
      <Text style={[type.chip, styles.sortLine]}>{sortLine}</Text>
      {products.error ? <ProblemText problem={problemFrom(products.error)} /> : null}
    </View>
  );

  return (
    <Page white edges={[]}>
      <StoreHeaderBand>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={storeType.headerTitle}>
            {t('mobile.tabs.shop')}
          </Text>
          {total !== null ? (
            <Text style={[storeType.search, styles.count]}>
              {t('mobile.customer.list.count', { n: formatCount(total) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.search}>
          <Search size={17} strokeWidth={2.2} color={colors.muted} />
          <TextInput
            ref={search}
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.shop.search')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('mobile.shop.searchLabel')}
            autoCorrect={false}
            returnKeyType="search"
            style={[storeType.search, styles.searchInput]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.scan.title')}
            onPress={() => router.push('/scan')}
            hitSlop={6}
            style={styles.searchScan}
          >
            <ScanLine size={19} strokeWidth={1.8} color={colors.label2} />
          </Pressable>
        </View>
      </StoreHeaderBand>
      <FlatList
        ref={list}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 600)}
        scrollEventThrottle={200}
        data={rows}
        numColumns={2}
        keyExtractor={(product) => String(product.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: inset + 48 + spacing.xl }]}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => <StoreCard product={item} actions={actions} width={cardWidth} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
        }}
        refreshing={products.isRefetching && !products.isFetchingNextPage}
        onRefresh={() => void products.refetch()}
        ListEmptyComponent={
          products.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : products.error ? null : empty === 'noFavourites' ? (
            <View style={styles.empty}>
              <EmptyState
                icon={<Heart size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.shop.noFavourites')}
                hint={t('mobile.customer.shop.noFavouritesHint')}
              />
              <PillButton
                title={t('common.all')}
                variant="soft"
                height={44}
                onPress={() => setChip('all')}
              />
            </View>
          ) : (
            <View style={styles.empty}>
              <EmptyState
                icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.shop.empty')}
                hint={t('mobile.shop.emptyHint')}
              />
              {activeFilters(filters) > 0 || chip !== 'all' ? (
                <PillButton
                  title={t('mobile.shop.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => {
                    setFilters(NO_LIST_FILTERS);
                    setChip('all');
                  }}
                />
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          products.isFetchingNextPage ? (
            <ActivityIndicator style={styles.more} color={colors.primary} />
          ) : null
        }
      />
      <FloatingPill
        bottom={inset}
        onTop={scrolled ? () => list.current?.scrollToOffset({ offset: 0, animated: true }) : null}
        active={activeFilters(filters)}
        onSort={() => setSheet('sort')}
        onFilter={() => {
          setDraft(filters);
          setSheet('filter');
        }}
      />
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
  titleRow: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  count: { color: colors.onPrimaryMuted },
  search: {
    height: 34,
    marginHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    borderRadius: 17,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minWidth: 0, height: TOUCH, padding: 0, color: colors.foreground },
  searchScan: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  // Edge to edge: the list pads its content, the chips scroll under the margins.
  chipRow: { marginHorizontal: -spacing.lg },
  chips: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 2,
    paddingHorizontal: spacing.lg,
  },
  sortLine: { paddingTop: 10, paddingBottom: spacing.md, color: colors.label2 },
  columns: { gap: GAP },
  rowGap: { height: 12 },
  loading: { marginTop: spacing.xxl },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md },
});
