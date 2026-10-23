import type { RepProductSort } from '@tugeel/shared/sales';
import { useRouter } from 'expo-router';
import { PackageSearch, ScanLine, Search } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
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
import { FloatingPill, SortSheet } from '../../../src/customer/list-sheets';
import { formatCount } from '../../../src/format/format';
import { FilterSheet } from '../../../src/shop/filter-sheet';
import { activeCount, EMPTY_FILTERS, type ShopFilters } from '../../../src/shop/filters';
import { useAddOne } from '../../../src/shop/use-add';
import { useShopFilters } from '../../../src/shop/use-filters';
import { useSignedIn } from '../../../src/state/session';
import { useDebounced } from '../../../src/state/use-debounced';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, storeType, TOUCH, type } from '../../../src/theme/tokens';
import { ActiveChip, MenuChip, PillButton } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { ProductCard } from '../../../src/ui/product-card';
import { StoreHeaderBand } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

const GAP = 10;

/**
 * «Бараа» (the Main board, ADR-0068, in «Bto300»'s look since ADR-0100): the title with the count,
 * the search with the scanner in the blue header, the chosen filters as chips with «Ангилал» and
 * «Нийлүүлэгч», the order, the products two by two and the floating «Эрэмбэлэх | Шүүлтүүр». The
 * cart on a card adds one of a product's default unit, a card opens the product.
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const { width } = useWindowDimensions();
  const inset = useStoreTabBarInset();
  const context = useRepContext();
  const categories = useCategories();
  const { filters, setFilters } = useShopFilters();
  const list = useRef<FlatList<RepProduct>>(null);
  const [scrolled, setScrolled] = useState(false);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<'closed' | 'sort' | 'filters' | 'suppliers'>('closed');
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

  // Nothing is written before the stored filters load: a sort or filter then would replace them.
  const set = (patch: Partial<ShopFilters>) => {
    if (filters !== null) setFilters({ ...filters, ...patch });
  };
  const add = useAddOne();

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

  const header = (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
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
      <Text style={[type.chip, styles.sortLine]}>{sortLabel}</Text>
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
      <FloatingPill
        bottom={inset}
        onTop={scrolled ? () => list.current?.scrollToOffset({ offset: 0, animated: true }) : null}
        active={activeCount(shown)}
        onSort={() => setSheet('sort')}
        onFilter={() => setSheet('filters')}
      />
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
