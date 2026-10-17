import { useQueryClient } from '@tanstack/react-query';
import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MapPin, Minus, Package, Plus, ShoppingCart } from 'lucide-react-native';
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
import { formatMnt, formatQty } from '../../../src/format/format';
import { heroPictures, pageAt } from '../../../src/images/pictures';
import { QtyKeypad } from '../../../src/shop/qty-keypad';
import { useUnitOptions } from '../../../src/shop/unit-options';
import { useUnitWords } from '../../../src/shop/unit-words';
import { baseQty, baseUnitOf, defaultUnitOf, packOf, shortBy } from '../../../src/shop/units';
import { useLineQuote } from '../../../src/shop/use-line-quote';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../../../src/theme/tokens';
import { CircleButton, PillButton, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';

const MAX_QTY = 9999;

/**
 * One product (the Product board, ADR-0066): its pictures, name, code and category, the free stock
 * and the home warehouse, the unit switch, the unit's price, the quantity (− n +, the keypad,
 * +1 +5 +10), what goes short, and the server's total with «Сагсанд нэмэх». The product keeps one
 * line in the cart, in the unit chosen here.
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
  const heroWidth = width - spacing.lg * 2;

  const header = (
    <View style={styles.floatingBar} pointerEvents="box-none">
      <CircleButton
        icon={<ChevronLeft size={24} strokeWidth={2.4} color={colors.foreground} />}
        label={t('common.back')}
        onPress={() => router.back()}
        style={styles.glass}
      />
      <CircleButton
        icon={<ShoppingCart size={22} strokeWidth={1.9} color={colors.foreground} />}
        label={t('mobile.tabs.cartCount', { n: cart.lines.length })}
        badge={cart.lines.length}
        onPress={() => router.navigate('/cart')}
        style={styles.glass}
      />
    </View>
  );

  if (!product || !unit) {
    return (
      <Page white>
        <View style={styles.missing}>
          <View style={styles.missingBar}>
            <CircleButton
              icon={<ChevronLeft size={24} strokeWidth={2.4} color={colors.foreground} />}
              label={t('common.back')}
              onPress={() => router.back()}
            />
          </View>
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
    <Page white>
      <ScrollView contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}>
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
                setPage(pageAt(event.nativeEvent.contentOffset.x, heroWidth, images.length))
              }
              renderItem={({ item, index }) => (
                <Image
                  source={{ uri: `${server}${item.url}` }}
                  placeholder={item.placeholder ? { uri: `${server}${item.placeholder}` } : null}
                  placeholderContentFit="contain"
                  cachePolicy="memory-disk"
                  priority={index === 0 ? 'high' : 'normal'}
                  recyclingKey={item.url}
                  style={{ width: heroWidth, height: HERO_HEIGHT }}
                  contentFit="contain"
                  transition={150}
                />
              )}
            />
          ) : (
            <Package size={72} strokeWidth={1.2} color={colors.input} />
          )}
          {header}
        </View>
        {images.length > 1 ? (
          <View style={styles.dots}>
            {images.map((image, index) => (
              <View key={image.url} style={[styles.dot, index === page && styles.dotOn]} />
            ))}
          </View>
        ) : null}

        <View style={styles.info}>
          <Text style={type.title2}>{product.name}</Text>
          <Text style={[type.body, styles.muted]}>
            {category
              ? t('mobile.product.codeCategory', { sku: product.sku, category })
              : product.sku}
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
        </View>

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

        <View style={styles.price}>
          {unit.wholesale ? (
            <View style={styles.priceRow}>
              <Text style={type.title}>
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
        </View>

        <View style={styles.qtyRow}>
          <View style={styles.grow}>
            <Text style={type.heading}>{t('mobile.product.qty')}</Text>
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
              disabled={qty === 0}
              onPress={() => set(qty - 1)}
              style={styles.minus}
            >
              <Minus size={20} strokeWidth={2.4} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.product.typeQty', { n: qty })}
              onPress={() => setKeypad(true)}
              style={styles.qtyBox}
            >
              <Text style={styles.qtyText}>{String(qty)}</Text>
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
        <View style={styles.quick}>
          {[1, 5, 10].map((step) => (
            <Pressable
              key={step}
              accessibilityRole="button"
              onPress={() => set(qty + step)}
              style={styles.quickChip}
            >
              <Text style={styles.quickText}>{t('mobile.product.plus', { n: step })}</Text>
            </Pressable>
          ))}
        </View>
        {short.gt(0) ? (
          <Text accessibilityRole="alert" style={styles.short}>
            {t('mobile.product.short', {
              stock: formatQty(product.available),
              short: short.toFixed(),
              unit: words(base).name,
            })}
          </Text>
        ) : null}
        {!product.sellable ? (
          <Text style={[styles.short, styles.blocked]}>{t('mobile.shop.notSellable')}</Text>
        ) : null}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
        <View style={styles.totals}>
          <Text style={type.secondary}>{t('mobile.product.total')}</Text>
          <Text style={styles.total}>
            {quote.total
              ? t('pricing.money', { amount: formatMnt(quote.total) })
              : quote.loading
                ? t('mobile.product.pricing')
                : t('common.none')}
          </Text>
          {quote.breakdown ? (
            <Text style={type.caption} numberOfLines={1}>
              {quote.breakdown}
            </Text>
          ) : null}
        </View>
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

const HERO_HEIGHT = 318;

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: spacing.lg,
    height: HERO_HEIGHT,
    borderRadius: radii.hero,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBar: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  glass: { backgroundColor: colors.glassFill, boxShadow: shadows.hero },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.input },
  dotOn: { width: 18, backgroundColor: colors.foreground },
  info: { gap: 6, paddingTop: 14, paddingHorizontal: 20 },
  muted: { color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 6 },
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
  units: { marginTop: 20, marginHorizontal: 20 },
  price: { gap: 2, paddingTop: spacing.lg, paddingHorizontal: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  grow: { flex: 1, gap: 2 },
  stepper: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 25,
    backgroundColor: colors.fieldFill,
  },
  minus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    boxShadow: shadows.stepper,
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
  qtyBox: { width: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...type.title2, fontFamily: fonts.semibold, ...tabular },
  quick: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: 20,
  },
  quickChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.canvas,
    justifyContent: 'center',
  },
  quickText: type.bodyStrong,
  short: {
    ...type.chip,
    marginTop: 14,
    marginHorizontal: 20,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
  },
  blocked: { backgroundColor: colors.destructiveSoft, color: colors.destructive },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  totals: { flex: 1, gap: 1 },
  total: { ...type.title3, ...tabular },
  missing: { flex: 1, gap: spacing.lg },
  missingBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
