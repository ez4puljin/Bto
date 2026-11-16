import type { RepProductSort } from '@tugeel/shared/sales';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  PackageSearch,
  ScanLine,
  Search,
  SlidersHorizontal,
} from 'lucide-react-native';
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
import { Text, TextInput } from '../../../src/ui/text';
import { problemFrom } from '../../../src/api/problem';
import {
  type RepProduct,
  useCategories,
  useProducts,
  useRepContext,
  useSuppliers,
} from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { SortSheet } from '../../../src/customer/list-sheets';
import { shopRouteParams } from '../../../src/customer/shop';
import { formatCount } from '../../../src/format/format';
import { Chip } from '../../../src/shop/chip';
import { FilterSheet } from '../../../src/shop/filter-sheet';
import { activeCount, EMPTY_FILTERS, type ShopFilters } from '../../../src/shop/filters';
import { useAddOne } from '../../../src/shop/use-add';
import { useShopFilters } from '../../../src/shop/use-filters';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, storeType, TOUCH, type } from '../../../src/theme/tokens';
import { CircleButton, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { HeaderCart, StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const GAP = 12;

/**
 * «Бараа» (the Shop board of 2026-11-16 on ADR-0068 and ADR-0100): the title and the cart, the
 * search with the scanner in the blue header, «Шүүлтүүр» and the chosen filters as chips with
 * «Ангилал» and «Нийлүүлэгч», the count with the order (it opens «Эрэмбэлэх»), the products two by
 * two and a round «дээш» once the list is scrolled. The
 * cart on a card adds one of a product's default unit, a card opens the product. A link may focus
 * the search (`?search=1`, «Нүүр»'s search field) or choose categories (`?categoryIds=5`, a
 * category page's «бүх бараа»).
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryIds?: string; search?: string }>();
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const { width } = useWindowDimensions();
  const inset = useStoreTabBarInset();
  const context = useRepContext();
  const categories = useCategories();
  const { filters, setFilters } = useShopFilters();
  const list = useRef<FlatList<RepProduct>>(null);
  const search = useRef<TextInput>(null);
  const [scrolled, setScrolled] = useState(false);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<'closed' | 'sort' | 'filters' | 'suppliers'>('closed');
  const q = useDebounced(text.trim(), 350);
  const shown = filters ?? EMPTY_FILTERS;
  // The list waits for the stored filters and for a link's categories (`?categoryIds=`) to be
  // applied, so its first page is asked once, with them.
  const linkPending = shopRouteParams(params).categoryIds !== null;
  const products = useProducts({ ...shown, q }, filters !== null && !linkPending);
  const suppliers = useSuppliers(shown.supplierIds.length > 0);
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const total = products.data?.pages[0]?.total ?? null;
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;

  // Nothing is written before the stored filters load: a sort or filter then would replace them.
  const set = (patch: Partial<ShopFilters>) => {
    if (filters !== null) setFilters({ ...filters, ...patch });
  };
  const add = useAddOne();

  // A link into the shop is spent once used, so a later one works again. The search is focused at
  // once; the categories wait for the stored filters, then replace only their categories.
  useEffect(() => {
    if (!shopRouteParams(params).search) return;
    search.current?.focus();
    router.setParams({ search: undefined });
  }, [params, router]);
  useEffect(() => {
    const categoryIds = shopRouteParams(params).categoryIds;
    if (!categoryIds || filters === null) return;
    setText('');
    // Written once: the next run, before the spent link is gone, finds them already chosen.
    const same =
      filters.categoryIds.length === categoryIds.length &&
      categoryIds.every((id, at) => filters.categoryIds[at] === id);
    if (!same) setFilters({ ...filters, categoryIds });
    router.setParams({ categoryIds: undefined });
  }, [params, filters, setFilters, router]);

  const warehouse = context.data?.warehouses.find((entry) => entry.id === shown.warehouseId);
  const categoryNames = shown.categoryIds.map(
    (id) => categories.data?.find((category) => category.id === id)?.name ?? '',
  );
  const supplierName =
    shown.supplierIds.length === 1
      ? suppliers.data?.find((supplier) => supplier.id === shown.supplierIds[0])?.name
      : undefined;
  const sorts: { value: RepProductSort; label: string }[] = [
    { value: 'NEW', label: t('mobile.filter.sortNew') },
    { value: 'PRICE_ASC', label: t('mobile.filter.sortPriceAsc') },
    { value: 'PRICE_DESC', label: t('mobile.filter.sortPriceDesc') },
  ];
  const sortLabel = sorts.find((option) => option.value === shown.sort)?.label ?? '';

  const active = activeCount(shown);
  const header = (
    <View style={styles.head}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          tone={active > 0 ? 'primary' : 'plain'}
          icon={SlidersHorizontal}
          label={active > 0 ? `${t('mobile.filter.title')} · ${active}` : t('mobile.filter.title')}
          accessibilityLabel={t('mobile.shop.filterButton', { n: active })}
          onPress={() => setSheet('filters')}
        />
        {warehouse ? (
          <Chip
            tone="chosen"
            label={warehouse.name}
            onPress={() => setSheet('filters')}
            onRemove={() => set({ warehouseId: null })}
            removeLabel={t('mobile.shop.removeFilter', { name: warehouse.name })}
          />
        ) : null}
        {categoryNames.length > 0 ? (
          <Chip
            tone="chosen"
            label={
              categoryNames.length === 1
                ? (categoryNames[0] ?? '')
                : t('mobile.shop.andMore', { name: categoryNames[0], n: categoryNames.length - 1 })
            }
            onPress={() => setSheet('filters')}
            onRemove={() => set({ categoryIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.categories') })}
          />
        ) : null}
        {shown.supplierIds.length > 0 ? (
          <Chip
            tone="chosen"
            label={
              supplierName ?? t('mobile.shop.suppliersChosen', { n: shown.supplierIds.length })
            }
            onPress={() => setSheet('suppliers')}
            onRemove={() => set({ supplierIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.suppliers') })}
          />
        ) : null}
        {shown.inStock ? (
          <Chip
            tone="chosen"
            label={t('mobile.shop.inStockChip')}
            onPress={() => setSheet('filters')}
            onRemove={() => set({ inStock: false })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.shop.inStockChip') })}
          />
        ) : null}
        {categoryNames.length === 0 ? (
          <Chip
            label={t('mobile.filter.categories')}
            trailing={ChevronDown}
            onPress={() => setSheet('filters')}
          />
        ) : null}
        {shown.supplierIds.length === 0 ? (
          <Chip
            label={t('mobile.filter.suppliers')}
            trailing={ChevronDown}
            onPress={() => setSheet('suppliers')}
          />
        ) : null}
      </ScrollView>
      <View style={styles.sortLine}>
        <Text style={[type.secondary, styles.grow]} numberOfLines={1}>
          {total !== null ? t('mobile.customer.list.count', { n: formatCount(total) }) : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('mobile.filter.sort')}: ${sortLabel}`}
          onPress={() => setSheet('sort')}
          hitSlop={12}
          style={({ pressed }) => [styles.sort, pressed && styles.pressed]}
        >
          <ArrowDownUp size={14} strokeWidth={2.2} color={colors.link} />
          <Text style={styles.sortText}>{sortLabel}</Text>
        </Pressable>
      </View>
      {products.error ? (
        <ProblemText problem={problemFrom(products.error)} style={styles.problem} />
      ) : null}
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.shop')} right={<HeaderCart />}>
        <View style={styles.search}>
          <Search size={18} strokeWidth={2.2} color={colors.placeholder} />
          <TextInput
            ref={search}
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.shop.search')}
            placeholderTextColor={colors.placeholder}
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
            <ScanLine size={20} strokeWidth={1.8} color={colors.label2} />
          </Pressable>
        </View>
      </StoreHeader>
      <FlatList
        ref={list}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 600)}
        scrollEventThrottle={200}
        data={rows}
        numColumns={2}
        keyExtractor={(product) => String(product.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: inset + spacing.xl }]}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
          if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
        }}
        refreshing={products.isRefetching && !products.isFetchingNextPage}
        onRefresh={() => void products.refetch()}
        ListEmptyComponent={
          products.isLoading || filters === null || linkPending ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <View style={styles.empty}>
              <EmptyState
                icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.shop.empty')}
                hint={t('mobile.shop.emptyHint')}
              />
              {active > 0 ? (
                <PillButton
                  title={t('mobile.orders.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => setFilters({ ...EMPTY_FILTERS, sort: shown.sort })}
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
      {scrolled ? (
        <CircleButton
          icon={<ChevronUp size={20} strokeWidth={2.4} color={colors.foreground} />}
          label={t('mobile.customer.list.toTop')}
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={[styles.top, { bottom: inset + spacing.md }]}
        />
      ) : null}
      <SortSheet
        visible={sheet === 'sort'}
        options={sorts}
        value={shown.sort}
        onPick={(sort) => {
          set({ sort });
          setSheet('closed');
        }}
        onClose={() => setSheet('closed')}
      />
      <FilterSheet
        visible={sheet === 'filters' || sheet === 'suppliers'}
        suppliersFirst={sheet === 'suppliers'}
        filters={shown}
        q={q}
        onApply={(next) => {
          if (filters !== null) setFilters(next);
          setSheet('closed');
        }}
        onClose={() => setSheet('closed')}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  list: { paddingHorizontal: spacing.lg },
  search: {
    height: 40,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minWidth: 0, height: TOUCH, padding: 0, color: colors.foreground },
  searchScan: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' },
  head: { paddingBottom: spacing.md },
  // Edge to edge: the list pads its content, the chips scroll under the margins.
  chipRow: { marginHorizontal: -spacing.lg },
  chips: { gap: spacing.sm, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  sortLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  sort: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sortText: { ...type.secondary, fontFamily: fonts.medium, color: colors.link },
  problem: { marginTop: spacing.md },
  columns: { gap: GAP },
  rowGap: { height: GAP },
  loading: { marginTop: spacing.xxl },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md },
  top: { position: 'absolute', right: spacing.lg },
});
