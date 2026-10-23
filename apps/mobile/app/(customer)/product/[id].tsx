import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Minus, Package, Plus, TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cachedStoreProduct,
  useStoreCategories,
  useStoreProductsOf,
  useToggleFavourite,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { lineOf } from '../../../src/cart/cart';
import { DealNote } from '../../../src/customer/deal-note';
import { FavouriteButton, StockPill, usePackText } from '../../../src/customer/product-card';
import { StoreQtyKeypad } from '../../../src/customer/qty-keypad';
import { priceNoteOf, storeLineOf } from '../../../src/customer/shop';
import { useStoreLineQuote } from '../../../src/customer/shop-quote';
import { StoreHeader } from '../../../src/ui/store-header';
import { canOrder } from '../../../src/customer/stock';
import { formatMnt } from '../../../src/format/format';
import { heroPictures, pageAt } from '../../../src/images/pictures';
import { useUnitOptions } from '../../../src/shop/unit-options';
import { useUnitWords } from '../../../src/shop/unit-words';
import { defaultUnitOf } from '../../../src/shop/units';
import { useCustomer } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Text } from '../../../src/ui/text';

const MAX_QTY = 9999;
const HERO_HEIGHT = 250;

/**
 * One product in «Bto300» (the Product board, ADR-0079 #4, ADR-0092 #7): its pictures with back and
 * ♡, the code and category, the name, the stock word and the pack, its discount program in words,
 * the unit switch, the unit's price, − n + (the keypad on the number), «Зарим нь хойшилж
 * магадгүй…» when the server says so, the line's total and «Сагсанд нэмэх». The product keeps one line in the cart, in the unit chosen here. A
 * scanned box opens in boxes (`?unit=`); from the camera (`?from=scan`) the button goes back to it.
 * No stock number anywhere.
 */
export default function StoreProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; unit?: string }>();
  const productId = Number.parseInt(params.id ?? '', 10);
  const { server } = useCustomer();
  const { cart, dispatch, pending } = useShop();
  const words = useUnitWords();
  const unitOptions = useUnitOptions();
  const packText = usePackText();
  const categories = useStoreCategories();
  const favourite = useToggleFavourite();
  // Opened from a list, the page shows what the list holds at once; the server's answer follows.
  const queryClient = useQueryClient();
  const valid = Number.isSafeInteger(productId);
  const seed = useMemo(() => {
    const cached = valid ? cachedStoreProduct(queryClient, productId) : undefined;
    return cached ? [cached] : undefined;
  }, [queryClient, productId, valid]);
  const query = useStoreProductsOf(valid ? [productId] : [], seed);
  const product = query.data?.[0];
  const line = lineOf(cart, productId);

  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [page, setPage] = useState(0);
  const [keypad, setKeypad] = useState(false);
  // The unit the page opens with: the scanned one, the cart line's, the default; the line's count
  // when it is in that unit.
  useEffect(() => {
    if (!product || unitId !== null) return;
    const scanned = product.units.find((unit) => String(unit.id) === params.unit);
    const inLine = line ? product.units.find((unit) => unit.id === line.productUnitId) : undefined;
    const start = scanned ?? inLine ?? defaultUnitOf(product.units);
    if (!start) return;
    setUnitId(start.id);
    if (line && line.productUnitId === start.id) setQty(Number.parseInt(line.qty, 10));
  }, [product, unitId, line, params.unit]);

  const unit = product?.units.find((entry) => entry.id === unitId);
  const orderable = product !== undefined && canOrder(product, unit);
  const quote = useStoreLineQuote(orderable && unit ? unit.id : null, qty);
  const images = useMemo(() => (product ? heroPictures(product) : []), [product]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.navigate('/shop');
  };

  if (!product || !unit) {
    return (
      <Page edges={[]}>
        <StoreHeader title="" onBack={back} />
        <View style={styles.missing}>
          {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
          {query.isSuccess && !product ? (
            <EmptyState
              icon={<Package size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.customer.product.gone')}
            />
          ) : null}
        </View>
      </Page>
    );
  }

  const locked = pending !== null;
  const category = categories.data?.find((entry) => entry.id === product.categoryId)?.name;
  const pack = packText(product.units, { withBase: true });
  const note = priceNoteOf(product, unit);
  const set = (next: number) => setQty(Math.max(1, Math.min(MAX_QTY, next)));
  const chooseUnit = (next: number) => {
    setUnitId(next);
    setQty(line && line.productUnitId === next ? Number.parseInt(line.qty, 10) : 1);
  };
  const unitName = words(unit).name;

  // Back to the page the product was opened from; opened by the camera (`?from=scan`) the page
  // was pushed over it, so back is the camera, ready for the next code.
  const save = () => {
    dispatch({ type: 'setLine', qty, line: storeLineOf(product, unit) });
    back();
  };
  const remove = () => {
    if (!line) return;
    dispatch({ type: 'remove', productUnitId: line.productUnitId });
    back();
  };

  return (
    <Page white edges={[]}>
      <StoreHeader title={category ?? ''} onBack={back} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={styles.hero}>
          {images.length > 0 ? (
            <FlatList
              data={images}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.url}
              initialNumToRender={1}
              maxToRenderPerBatch={1}
              windowSize={3}
              onMomentumScrollEnd={(event) =>
                setPage(pageAt(event.nativeEvent.contentOffset.x, width, images.length))
              }
              renderItem={({ item, index }) => (
                <Image
                  source={{ uri: `${server}${item.url}` }}
                  placeholder={item.placeholder ? { uri: `${server}${item.placeholder}` } : null}
                  placeholderContentFit="contain"
                  cachePolicy="memory-disk"
                  priority={index === 0 ? 'high' : 'normal'}
                  recyclingKey={item.url}
                  style={{ width, height: HERO_HEIGHT }}
                  contentFit="contain"
                  transition={150}
                />
              )}
            />
          ) : (
            <View style={[styles.noPicture, { height: HERO_HEIGHT }]}>
              <Package size={72} strokeWidth={1.2} color={colors.input} />
            </View>
          )}
          {images.length > 1 ? (
            <View style={styles.dots} pointerEvents="none">
              {images.map((image, index) => (
                <View key={image.url} style={[styles.dot, index === page && styles.dotOn]} />
              ))}
            </View>
          ) : null}
          <View style={styles.heart}>
            <FavouriteButton
              on={product.favourite}
              size={26}
              label={
                product.favourite
                  ? t('mobile.customer.product.favouriteRemove')
                  : t('mobile.customer.product.favouriteAdd')
              }
              onPress={() =>
                favourite.mutate({ productId: product.id, favourite: !product.favourite })
              }
            />
          </View>
        </View>

        <View style={styles.body}>
          <Text style={type.secondary}>
            {category
              ? t('mobile.product.codeCategory', { sku: product.sku, category })
              : product.sku}
          </Text>
          <Text accessibilityRole="header" style={[type.title2, styles.name]}>
            {product.name}
          </Text>
          <View style={styles.stockRow}>
            <StockPill stock={product.stock} large />
            {pack ? <Text style={[type.secondary, styles.shrink]}>{pack}</Text> : null}
          </View>
          {product.deal ? <DealNote deal={product.deal} /> : null}

          {product.units.length > 1 ? (
            <View style={styles.units}>
              <Segmented
                options={unitOptions(product.units)}
                value={String(unit.id)}
                onChange={(next) => chooseUnit(Number.parseInt(next, 10))}
                label={t('mobile.product.unit')}
              />
            </View>
          ) : null}

          <View style={styles.priceCard}>
            <View style={styles.grow}>
              {unit.wholesale ? (
                <View style={styles.priceRow}>
                  <Text style={styles.price}>
                    {t('pricing.money', { amount: formatMnt(unit.wholesale) })}
                  </Text>
                  <Text style={[type.body, styles.muted]}>
                    {t('mobile.product.per', { unit: unitName })}
                  </Text>
                </View>
              ) : (
                <Text style={[type.heading, styles.muted]}>{t('mobile.product.noPrice')}</Text>
              )}
              {note ? (
                <Text style={type.secondary}>
                  {note.kind === 'pack'
                    ? t('mobile.customer.product.packNote', {
                        n: note.n,
                        amount: formatMnt(note.amount),
                      })
                    : t('mobile.customer.product.loose')}
                </Text>
              ) : null}
            </View>
            {orderable ? (
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.product.less')}
                  accessibilityState={{ disabled: qty <= 1 || locked }}
                  disabled={qty <= 1 || locked}
                  onPress={() => set(qty - 1)}
                  style={[styles.minus, (qty <= 1 || locked) && styles.faded]}
                >
                  <Minus size={20} strokeWidth={2.4} color={colors.foreground} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.product.typeQty', { n: qty })}
                  disabled={locked}
                  onPress={() => setKeypad(true)}
                  style={styles.qtyBox}
                >
                  <Text style={styles.qtyText} accessibilityLiveRegion="polite">
                    {String(qty)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobile.product.more')}
                  accessibilityState={{ disabled: locked }}
                  disabled={locked}
                  onPress={() => set(qty + 1)}
                  style={[styles.plus, locked && styles.faded]}
                >
                  <Plus size={20} strokeWidth={2.4} color={colors.primaryForeground} />
                </Pressable>
              </View>
            ) : null}
          </View>

          {orderable && quote.mayBackorder ? (
            <View accessibilityRole="alert" style={styles.warning}>
              <TriangleAlert size={19} strokeWidth={2} color={colors.warningText} />
              <Text style={[type.body, styles.warningText]}>
                {t('mobile.customer.stock.mayBackorder')}
              </Text>
            </View>
          ) : null}
          {product.stock === 'OUT' ? (
            <View style={[styles.warning, styles.outBox]}>
              <TriangleAlert size={19} strokeWidth={2} color={colors.cancelled} />
              <Text style={[type.body, styles.outText]}>{t('mobile.customer.stock.out')}</Text>
            </View>
          ) : null}

          {orderable ? (
            <View style={styles.totalRow}>
              <Text style={[type.row, styles.muted]}>{t('mobile.customer.product.lineTotal')}</Text>
              <Text style={styles.total}>
                {quote.total
                  ? t('pricing.money', { amount: formatMnt(quote.total) })
                  : quote.unpriced
                    ? t('mobile.shop.noPrice')
                    : quote.loading
                      ? t('mobile.product.pricing')
                      : t('common.none')}
              </Text>
            </View>
          ) : null}
          {quote.error ? <ProblemText problem={problemFrom(quote.error)} /> : null}

          {line && !locked ? (
            <Pressable
              accessibilityRole="button"
              onPress={remove}
              hitSlop={6}
              style={styles.remove}
            >
              <Text style={[type.row, styles.removeText]}>{t('mobile.product.remove')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
        <PillButton
          title={
            line
              ? t('mobile.customer.product.updateQty', { qty, unit: unitName })
              : t('mobile.customer.product.addQty', { qty, unit: unitName })
          }
          disabled={!orderable || locked || quote.unpriced}
          onPress={save}
          height={50}
          style={styles.square}
        />
      </View>

      {orderable ? (
        <StoreQtyKeypad
          visible={keypad}
          product={product}
          server={server}
          unitId={unit.id}
          qty={qty}
          onCancel={() => setKeypad(false)}
          onDone={(nextUnit, nextQty) => {
            setUnitId(nextUnit);
            set(nextQty);
            setKeypad(false);
          }}
        />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  noPicture: { alignItems: 'center', justifyContent: 'center' },
  heart: { position: 'absolute', top: spacing.xs, right: spacing.xs },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dotIdle },
  dotOn: { width: 18, backgroundColor: colors.foreground },
  body: { paddingTop: spacing.lg, paddingHorizontal: spacing.lg },
  name: { marginTop: 2 },
  stockRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  shrink: { flexShrink: 1 },
  units: { marginTop: spacing.lg },
  priceCard: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  grow: { flex: 1, gap: 2 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5 },
  price: { ...type.title3, ...tabular },
  muted: { color: colors.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  minus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.fieldFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.4 },
  qtyBox: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...type.title2, fontFamily: fonts.bold, ...tabular },
  warning: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.warningSoft,
  },
  warningText: { flex: 1, color: colors.warningText },
  outBox: { backgroundColor: colors.destructiveSoft },
  outText: { flex: 1, color: colors.cancelled },
  totalRow: {
    marginTop: 10,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  total: { ...type.rowStrong, ...tabular },
  remove: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 6 },
  removeText: { color: colors.destructive },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.input,
  },
  missing: { flex: 1, gap: spacing.lg, paddingTop: spacing.xl },
  square: { borderRadius: 10 },
});
