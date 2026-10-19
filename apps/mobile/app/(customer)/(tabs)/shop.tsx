import { useLocalSearchParams, useRouter } from 'expo-router';
import { PackageSearch, ScanBarcode, SlidersHorizontal, Star } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  useStoreCategories,
  useStoreProducts,
  useToggleFavourite,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { lineOf } from '../../../src/cart/cart';
import { CustomerProductCard } from '../../../src/customer/product-card';
import { emptyKindOf } from '../../../src/customer/shop';
import { ShopFilterSheet, type StoreShopFilters } from '../../../src/customer/shop-filter-sheet';
import { useAddOneStore } from '../../../src/customer/use-add';
import { useCustomer } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { useDebounced } from '../../../src/state/use-debounced';
import { colors, spacing, type } from '../../../src/theme/tokens';
import {
  ActiveChip,
  ChoiceChip,
  CircleButton,
  MenuChip,
  PillButton,
  SearchField,
} from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';

const GAP = 12;
const NO_FILTERS: StoreShopFilters = { sort: 'NEW', categoryIds: [] };

/**
 * «Бараа» of «Bto300» (the Shop board, ADR-0079 #4, #13): the scanner and the filter, the search by
 * name, code or barcode, «Бүгд» / «★ Дуртай N», the categories and the order as chips, the count,
 * and the products two by two with their ★, stock word and pack; «+» adds one of the default
 * unit, a card opens the product. «Нүүр» opens it on ★ with `?favourites=1`.
 */
export default function StoreShopScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ favourites?: string }>();
  const { server } = useCustomer();
  const { cart, pending } = useShop();
  const { width } = useWindowDimensions();
  const inset = useTabBarInset();
  const categories = useStoreCategories();
  const star = useToggleFavourite();
  const add = useAddOneStore();
  const [text, setText] = useState('');
  const [favourites, setFavourites] = useState(params.favourites === '1');
  const [filters, setFilters] = useState<StoreShopFilters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const q = useDebounced(text.trim(), 350);

  // «Дуртай» on «Нүүр» opens the shop on ★; the link is spent so a later one works again.
  useEffect(() => {
    if (params.favourites !== '1') return;
    setFavourites(true);
    router.setParams({ favourites: undefined });
  }, [params.favourites, router]);

  const query = { q, categoryIds: filters.categoryIds, favourites, sort: filters.sort };
  const products = useStoreProducts(query);
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  const first = products.data?.pages[0];
  const total = first?.total ?? null;
  const favouriteCount = first?.favouriteCount ?? null;
  const cardWidth = (width - spacing.lg * 2 - GAP) / 2;
  const locked = pending !== null;

  const categoryNames = filters.categoryIds.map(
    (id) => categories.data?.find((category) => category.id === id)?.name ?? '',
  );
  const sortLabel = {
    NEW: t('mobile.filter.sortNew'),
    PRICE_ASC: t('mobile.filter.sortPriceAsc'),
    PRICE_DESC: t('mobile.filter.sortPriceDesc'),
  }[filters.sort];
  const sortPhrase = {
    NEW: t('mobile.shop.sortedNew'),
    PRICE_ASC: t('mobile.shop.sortedPriceAsc'),
    PRICE_DESC: t('mobile.shop.sortedPriceDesc'),
  }[filters.sort];
  const empty = emptyKindOf(query);

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
          label={t('mobile.shop.filterButton', { n: filters.categoryIds.length > 0 ? 1 : 0 })}
          badge={filters.categoryIds.length > 0 ? 1 : 0}
          badgeTone="accent"
          onPress={() => setSheet(true)}
        />
      </View>
      <LargeTitle style={styles.title}>{t('mobile.tabs.shop')}</LargeTitle>
      <View style={styles.search}>
        <SearchField
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
        <ChoiceChip
          label={t('common.all')}
          selected={!favourites}
          onPress={() => setFavourites(false)}
          onWhite
          compact
        />
        <ChoiceChip
          label={
            favouriteCount === null
              ? t('mobile.customer.shop.favouritesLabel')
              : t('mobile.customer.shop.favourites', { n: favouriteCount })
          }
          icon={
            <Star
              size={15}
              strokeWidth={2}
              color={favourites ? colors.primaryForeground : colors.tint.amber}
              fill={favourites ? colors.primaryForeground : colors.tint.amber}
            />
          }
          selected={favourites}
          onPress={() => setFavourites(true)}
          onWhite
          compact
        />
        {categoryNames.length > 0 ? (
          <ActiveChip
            label={
              categoryNames.length === 1
                ? (categoryNames[0] ?? '')
                : t('mobile.shop.andMore', { name: categoryNames[0], n: categoryNames.length - 1 })
            }
            onPress={() => setSheet(true)}
            onRemove={() => setFilters({ ...filters, categoryIds: [] })}
            removeLabel={t('mobile.shop.removeFilter', { name: t('mobile.filter.categories') })}
          />
        ) : (
          <MenuChip label={t('mobile.filter.categories')} chevron onPress={() => setSheet(true)} />
        )}
        <MenuChip label={sortLabel} chevron onPress={() => setSheet(true)} />
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
            <CustomerProductCard
              product={item}
              server={server}
              line={lineOf(cart, item.id)}
              locked={locked}
              onOpen={() => router.push(`/product/${item.id}`)}
              onAdd={() => add(item)}
              onStar={() => star.mutate({ productId: item.id, favourite: !item.favourite })}
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
          products.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : products.error ? null : empty === 'noFavourites' ? (
            <View style={styles.empty}>
              <EmptyState
                icon={<Star size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.customer.shop.noFavourites')}
                hint={t('mobile.customer.shop.noFavouritesHint')}
              />
              <PillButton
                title={t('common.all')}
                variant="soft"
                height={44}
                onPress={() => setFavourites(false)}
              />
            </View>
          ) : (
            <View style={styles.empty}>
              <EmptyState
                icon={<PackageSearch size={44} strokeWidth={1.5} color={colors.input} />}
                title={t('mobile.shop.empty')}
                hint={t('mobile.shop.emptyHint')}
              />
              {filters.categoryIds.length > 0 ? (
                <PillButton
                  title={t('mobile.shop.clearFilters')}
                  variant="soft"
                  height={44}
                  onPress={() => setFilters({ ...filters, categoryIds: [] })}
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
      <ShopFilterSheet
        visible={sheet}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setSheet(false);
        }}
        onClose={() => setSheet(false)}
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
