import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUpDown, PackageSearch, ScanBarcode, SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, type TextInput } from '../../../src/ui/text';
import { problemFrom } from '../../../src/api/problem';
import {
  type RepProduct,
  useCategories,
  useProducts,
  useRepContext,
  useSuppliers,
} from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { FilterSheet } from '../../../src/shop/filter-sheet';
import { activeCount, EMPTY_FILTERS, type ShopFilters } from '../../../src/shop/filters';
import { useAddOne } from '../../../src/shop/use-add';
import { useShopFilters } from '../../../src/shop/use-filters';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, type } from '../../../src/theme/tokens';
import {
  ActiveChip,
  CircleButton,
  MenuChip,
  PillButton,
  SearchField,
} from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { useTabBarInset } from '../../../src/ui/tab-bar';

const GAP = 12;

/**
 * «Бараа» (the Main board, ADR-0068): the scanner and the filter on top, the search, the order and
 * the filters as chips, the count, and the products two by two; «+» adds one of a product's
 * default unit, a card opens the product.
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const { width } = useWindowDimensions();
  const inset = useTabBarInset();
  const context = useRepContext();
  const categories = useCategories();
  const { filters, setFilters } = useShopFilters();
  const [text, setText] = useState('');
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<RepProduct>>(null);
  // The home's search pill opens the shop with `search` (a fresh value each time): the field takes
  // the focus and the keyboard opens, once the tab has drawn.
  const { search } = useLocalSearchParams<{ search?: string }>();
  useEffect(() => {
    if (!search) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    const timer = setTimeout(() => searchRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [search]);
  const [sheet, setSheet] = useState<'closed' | 'filters' | 'suppliers'>('closed');
  const q = useDebounced(text.trim(), 350);
  const shown = filters ?? EMPTY_FILTERS;
  const products = useProducts({ ...shown, q }, filters !== null);
  const suppliers = useSuppliers(shown.supplierIds.length > 0);
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const total = products.data?.pages[0]?.total ?? null;
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;

  const set = (patch: Partial<ShopFilters>) => setFilters({ ...shown, ...patch });
  const add = useAddOne();

  const warehouse = context.data?.warehouses.find((entry) => entry.id === shown.warehouseId);
  const categoryNames = shown.categoryIds.map(
    (id) => categories.data?.find((category) => category.id === id)?.name ?? '',
  );
  const supplierName =
    shown.supplierIds.length === 1
      ? suppliers.data?.find((supplier) => supplier.id === shown.supplierIds[0])?.name
      : undefined;
  const sortLabel = {
    NEW: t('mobile.filter.sortNew'),
    PRICE_ASC: t('mobile.filter.sortPriceAsc'),
    PRICE_DESC: t('mobile.filter.sortPriceDesc'),
  }[shown.sort];
  const sortPhrase = {
    NEW: t('mobile.shop.sortedNew'),
    PRICE_ASC: t('mobile.shop.sortedPriceAsc'),
    PRICE_DESC: t('mobile.shop.sortedPriceDesc'),
  }[shown.sort];

  const header = (
    <View>
      <View style={styles.top}>
        <CircleButton
          icon={<ScanBarcode size={22} strokeWidth={1.9} color={colors.foreground} />}
          label={t('mobile.scan.title')}
          onPress={() => router.push('/scan')}
        />
        <CircleButton
          icon={<SlidersHorizontal size={22} strokeWidth={1.9} color={colors.foreground} />}
          label={t('mobile.shop.filterButton', { n: activeCount(shown) })}
          badge={activeCount(shown)}
          badgeTone="accent"
          onPress={() => setSheet('filters')}
        />
      </View>
      <LargeTitle style={styles.title}>{t('mobile.tabs.shop')}</LargeTitle>
      <View style={styles.search}>
        <SearchField
          inputRef={searchRef}
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.shop.search')}
          accessibilityLabel={t('mobile.shop.searchLabel')}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <MenuChip
          label={sortLabel}
          icon={<ArrowUpDown size={15} strokeWidth={2} color={colors.foreground} />}
          onPress={() => setSheet('filters')}
        />
        {warehouse ? (
          <ActiveChip
            label={warehouse.name}
            onPress={() => setSheet('filters')}
            onRemove={() => set({ warehouseId: null })}
            removeLabel={t('mobile.shop.removeFilter', { name: warehouse.name })}
          />
        ) : null}
        {categoryNames.length > 0 ? (
          <ActiveChip
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
          <ActiveChip
            label={
              supplierName ?? t('mobile.shop.suppliersChosen', { n: shown.supplierIds.length })
            }
            onPress={() => setSheet('suppliers')}
            onRemove={() => set({ supplierIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.suppliers') })}
          />
        ) : null}
        {shown.inStock ? (
          <ActiveChip
            label={t('mobile.shop.inStockChip')}
            onPress={() => setSheet('filters')}
            onRemove={() => set({ inStock: false })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.shop.inStockChip') })}
          />
        ) : null}
        {categoryNames.length === 0 ? (
          <MenuChip
            label={t('mobile.filter.categories')}
            chevron
            onPress={() => setSheet('filters')}
          />
        ) : null}
        {shown.supplierIds.length === 0 ? (
          <MenuChip
            label={t('mobile.filter.suppliers')}
            chevron
            onPress={() => setSheet('suppliers')}
          />
        ) : null}
      </ScrollView>
      <Text style={[type.secondary, styles.count]}>
        {total === null ? ' ' : t('mobile.shop.count', { n: total, sort: sortPhrase })}
      </Text>
      {products.error ? <ProblemText problem={problemFrom(products.error)} /> : null}
    </View>
  );

  return (
    <Page white>
      <FlatList
        ref={listRef}
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
          <View style={{ width: cardWidth }}>
            <ProductCard
              product={item}
              server={server}
              line={lineOf(cart, item.id)}
              locked={pending !== null}
              onOpen={() => router.push(`/product/${item.id}`)}
              onAdd={() => add(item)}
            />
          </View>
        )}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (products.hasNextPage && !products.isFetchingNextPage) void products.fetchNextPage();
        }}
        refreshing={products.isRefetching && !products.isFetchingNextPage}
        onRefresh={() => void products.refetch()}
        ListEmptyComponent={
          products.isLoading || filters === null ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <View style={styles.empty}>
              <EmptyState
                icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.shop.empty')}
                hint={t('mobile.shop.emptyHint')}
              />
              {activeCount(shown) > 0 ? (
                <PillButton
                  title={t('mobile.shop.clearFilters')}
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
      <FilterSheet
        visible={sheet !== 'closed'}
        suppliersFirst={sheet === 'suppliers'}
        filters={shown}
        q={q}
        onApply={(next) => {
          setFilters(next);
          setSheet('closed');
        }}
        onClose={() => setSheet('closed')}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.lg },
  top: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: { marginTop: 2 },
  search: { paddingTop: 10 },
  // Edge to edge: the list pads its content, the chips scroll under the margins.
  chipRow: { marginHorizontal: -spacing.lg },
  chips: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 2,
    paddingHorizontal: spacing.lg,
  },
  count: { paddingTop: 10, paddingBottom: spacing.md },
  columns: { gap: GAP },
  rowGap: { height: 22 },
  loading: { marginTop: spacing.xxl },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md },
});
