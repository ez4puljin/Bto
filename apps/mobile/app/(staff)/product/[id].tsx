import { useQueryClient } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MapPin, Minus, Package, Plus, ShoppingCart, TriangleAlert } from 'lucide-react-native';
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
import { Text } from '../../../src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { cachedProduct, useCategories, useProductsOf, useRepContext } from '../../../src/api/rep';
import { lineOf } from '../../../src/cart/cart';
import { DealNote } from '../../../src/customer/deal-note';
import { formatMnt, formatQty } from '../../../src/format/format';
import { heroPictures, pageAt } from '../../../src/images/pictures';
import { QtyKeypad } from '../../../src/shop/qty-keypad';
import { useUnitOptions } from '../../../src/shop/unit-options';
import { useUnitWords } from '../../../src/shop/unit-words';
import { baseQty, baseUnitOf, defaultUnitOf, packOf, shortBy } from '../../../src/shop/units';
import { useLineQuote } from '../../../src/shop/use-line-quote';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';

const MAX_QTY = 9999;
const HERO_HEIGHT = 250;

/**
 * One product (the Product board, ADR-0068, in «Bto300»'s structure and sizes since ADR-0100): the
 * blue header with ← and the cart, its pictures edge to edge, the code and category, the name, the
 * free stock and the home warehouse, its discount program in words as «Bto300» says it (the owner,
 * 2026-10-23), the unit switch, the unit's price with − n + (the keypad on the number), what goes
 * short, the server's total and «Сагсанд нэмэх». The product keeps one line in the cart, in the unit
 * chosen here; 0 takes it out.
 */
export default function ProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; unit?: string; from?: string }>();
  const productId = Number.parseInt(params.id ?? '', 10);
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const words = useUnitWords();
  const unitOptions = useUnitOptions();
  const context = useRepContext();
  const categories = useCategories();
  // Opened from a list, the page shows what the list holds at once; the server's answer follows.
  const queryClient = useQueryClient();
  const valid = Number.isSafeInteger(productId);
  const seed = useMemo(() => {
    const cached = valid ? cachedProduct(queryClient, productId) : undefined;
    return cached ? [cached] : undefined;
  }, [queryClient, productId, valid]);
  const query = useProductsOf(valid ? [productId] : [], undefined, seed);
  const product = query.data?.[0];
  const line = lineOf(cart, productId);

  const [unitId, setUnitId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [page, setPage] = useState(0);
  const [keypad, setKeypad] = useState(false);
  // The unit and quantity the page opens with: the cart's line, the scanned unit, the default.
  useEffect(() => {
    if (!product || unitId !== null) return;
    const scanned = product.units.find((unit) => String(unit.id) === params.unit);
    if (line && product.units.some((unit) => unit.id === line.productUnitId)) {
      setUnitId(line.productUnitId);
      setQty(Number.parseInt(line.qty, 10));
    } else {
      setUnitId((scanned ?? defaultUnitOf(product.units))?.id ?? null);
    }
  }, [product, unitId, line, params.unit]);

  const unit = product?.units.find((entry) => entry.id === unitId);
  const quote = useLineQuote(product?.units ?? [], unit?.id ?? null, qty);
  const images = useMemo(() => (product ? heroPictures(product) : []), [product]);

  if (!product || !unit) {
    return (
      <Page edges={[]}>
        <StoreHeader title="" onBack={() => router.back()} />
        <View style={styles.missing}>
          {query.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {query.error ? <ProblemText problem={problemFrom(query.error)} /> : null}
          {query.isSuccess && !product ? (
            <EmptyState
              icon={<Package size={44} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.shop.gone')}
            />
          ) : null}
        </View>
      </Page>
    );
  }

  const base = baseUnitOf(product.units) ?? unit;
  const pack = packOf(product.units);
  const pieces = baseQty(qty, unit);
  const short = shortBy(pieces, product.available);
  const out = new Decimal(product.available).lte(0);
  const category = categories.data?.find((entry) => entry.id === product.categoryId)?.name;
  const home = context.data?.warehouses.find((entry) => entry.id === product.homeWarehouseId);
  const locked = pending !== null;
  const canSell = product.sellable && unit.wholesale !== null && !locked;
  const set = (next: number) => setQty(Math.max(0, Math.min(MAX_QTY, next)));

  const note = unit.isBase
    ? pack?.wholesale
      ? t('mobile.product.packPrice', {
          unit: words(pack).title,
          n: formatQty(pack.factorToBase),
          base: words(base).name,
          amount: formatMnt(pack.wholesale),
        })
      : null
    : product.basePrice
      ? t('mobile.product.inPack', {
          unit: words(unit).dative ?? words(unit).name,
          n: formatQty(unit.factorToBase),
          base: words(base).name,
          amount: formatMnt(product.basePrice),
        })
      : null;

  const save = () => {
    dispatch({
      type: 'setLine',
      qty,
      line: {
        productId: product.id,
        productUnitId: unit.id,
        sku: product.sku,
        name: product.name,
        uomName: unit.uomName,
        uomCode: unit.uomCode,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
        wholesale: unit.wholesale,
        thumbUrl: product.thumbUrl,
      },
    });
    if (params.from === 'scan') router.replace('/scan');
    else router.back();
  };

  return (
    <Page white edges={[]}>
      <StoreHeader title={category ?? ''} onBack={() => router.back()} />
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
          <View style={styles.chips}>
            <View style={[styles.chip, out ? styles.outChip : styles.stockChip]}>
              <View
                style={[
                  styles.stockDot,
                  { backgroundColor: out ? colors.destructive : colors.success },
                ]}
              />
              <Text style={[styles.chipText, { color: out ? colors.destructive : colors.success }]}>
                {out
                  ? t('mobile.shop.outOfStock')
                  : t('mobile.product.stock', {
                      n: formatQty(product.available),
                      unit: words(base).name,
                    })}
              </Text>
            </View>
            {home ? (
              <View style={[styles.chip, styles.placeChip]}>
                <MapPin size={14} strokeWidth={2} color={colors.label2} />
                <Text style={[styles.chipText, styles.placeText]}>{home.name}</Text>
              </View>
            ) : null}
          </View>
          {product.deal ? <DealNote deal={product.deal} /> : null}

          {product.units.length > 1 ? (
            <View style={styles.units}>
              <Segmented
                options={unitOptions(product.units)}
                value={String(unit.id)}
                onChange={(next) => setUnitId(Number.parseInt(next, 10))}
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
                    {t('mobile.product.per', { unit: words(unit).name })}
                  </Text>
                </View>
              ) : (
                <Text style={[type.heading, styles.muted]}>{t('mobile.product.noPrice')}</Text>
              )}
              {note ? <Text style={type.secondary}>{note}</Text> : null}
              <Text style={type.secondary}>
                {unit.isBase
                  ? (words(unit).instrumental ??
                    t('mobile.product.byUnit', { unit: words(unit).name }))
                  : t('mobile.product.equals', { n: pieces.toFixed(), unit: words(base).name })}
              </Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.product.less')}
                accessibilityState={{ disabled: qty === 0 }}
                disabled={qty === 0}
                onPress={() => set(qty - 1)}
                style={[styles.minus, qty === 0 && styles.faded]}
              >
                <Minus size={20} strokeWidth={2.4} color={colors.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.product.typeQty', { n: qty })}
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
                onPress={() => set(qty + 1)}
                style={styles.plus}
              >
                <Plus size={20} strokeWidth={2.4} color={colors.primaryForeground} />
              </Pressable>
            </View>
          </View>

          {short.gt(0) ? (
            <View accessibilityRole="alert" style={styles.warning}>
              <TriangleAlert size={19} strokeWidth={2} color={colors.warningText} />
              <Text style={[type.body, styles.warningText]}>
                {t('mobile.product.short', {
                  stock: formatQty(product.available),
                  short: short.toFixed(),
                  unit: words(base).name,
                })}
              </Text>
            </View>
          ) : null}
          {!product.sellable ? (
            <View style={[styles.warning, styles.outBox]}>
              <TriangleAlert size={19} strokeWidth={2} color={colors.destructive} />
              <Text style={[type.body, styles.outText]}>{t('mobile.shop.notSellable')}</Text>
            </View>
          ) : null}

          <View style={styles.totalRow}>
            <Text style={[type.row, styles.muted]}>{t('mobile.product.total')}</Text>
            <Text style={styles.total}>
              {quote.total
                ? t('pricing.money', { amount: formatMnt(quote.total) })
                : quote.loading
                  ? t('mobile.product.pricing')
                  : t('common.none')}
            </Text>
          </View>
          {quote.breakdown ? (
            <Text style={[type.caption, styles.breakdown]} numberOfLines={1}>
              {quote.breakdown}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
        <PillButton
          title={
            qty === 0 && line
              ? t('mobile.product.remove')
              : line
                ? t('mobile.product.update')
                : t('mobile.product.add')
          }
          icon={<ShoppingCart size={20} strokeWidth={2} color={colors.primaryForeground} />}
          disabled={!canSell || (qty === 0 && !line) || quote.unpriced}
          onPress={save}
          height={50}
          style={styles.square}
        />
      </View>

      <QtyKeypad
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
  muted: { color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  stockChip: { backgroundColor: colors.successSoft },
  outChip: { backgroundColor: colors.destructiveSoft },
  placeChip: { backgroundColor: colors.canvas },
  stockDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { ...type.chip, fontFamily: fonts.semibold },
  placeText: { fontFamily: fonts.medium, color: colors.label2 },
  units: { marginTop: spacing.lg },
  // «Bto300»'s price card: a hairline and 10 px corners (ADR-0095 #4).
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
  outText: { flex: 1, color: colors.destructive },
  totalRow: {
    marginTop: 10,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  total: { ...type.rowStrong, ...tabular },
  breakdown: { paddingHorizontal: spacing.xs, textAlign: 'right' },
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
  missing: { flex: 1, gap: spacing.lg, paddingTop: spacing.xl, paddingHorizontal: spacing.lg },
  square: { borderRadius: 10 },
});
