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
import { useToast } from '../../../src/ui/toast';
import { colors, fonts, shadows, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton, Segmented } from '../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Card, FooterBar, Notice, Pill, PAGE } from '../../../src/ui/staff-kit';
import { HeaderCart, StoreHeader } from '../../../src/ui/store-header';

const MAX_QTY = 9999;
const HERO_HEIGHT = 230;

/**
 * One product (the Product board of 2026-11-16 on ADR-0068 and ADR-0100): the blue header with ←,
 * the name over its category and the cart; a card with its pictures, the code and category, the
 * name, the free stock and the home warehouse and its discount program in words as «Bto300» says it
 * (the owner, 2026-10-23); a card with the unit switch, the unit's price and − n + (the keypad on
 * the number); what goes short; and the bar with the server's total beside «Сагсанд нэмэх». The
 * product keeps one line in the cart, in the unit
 * chosen here; 0 takes it out. A product whose home warehouse the staff app does not count
 * (ADR-0173 #1) reads «Дууссан» with the server's refusal, and «+» and the keypad only say so.
 */
export default function ProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; unit?: string; from?: string }>();
  const productId = Number.parseInt(params.id ?? '', 10);
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const toast = useToast();
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
        <StoreHeader title="" onBack={() => router.back()} right={<HeaderCart />} />
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
  // A home warehouse the staff app does not count (ADR-0173 #1): «Дууссан», and an app order
  // would be refused, so nothing is added; a line already in the cart can still be taken out.
  const blocked = product.stockBlocked;
  const short = shortBy(pieces, product.available);
  const out = blocked || new Decimal(product.available).lte(0);
  const category = categories.data?.find((entry) => entry.id === product.categoryId)?.name;
  const home = context.data?.warehouses.find((entry) => entry.id === product.homeWarehouseId);
  const locked = pending !== null;
  const canSell = product.sellable && !blocked && unit.wholesale !== null && !locked;
  const removing = blocked && qty === 0 && line !== undefined && !locked;
  const set = (next: number) => setQty(Math.max(0, Math.min(MAX_QTY, next)));
  const refuse = () => toast.show({ message: t('errors.PRODUCT_OUT_OF_APP_STOCK') });

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

  const heroWidth = width - spacing.lg * 2;
  const totalText = quote.total
    ? t('pricing.money', { amount: formatMnt(quote.total) })
    : quote.loading
      ? t('mobile.product.pricing')
      : t('common.none');

  return (
    <Page edges={[]}>
      <StoreHeader
        title={product.name}
        subtitle={category ?? null}
        onBack={() => router.back()}
        right={<HeaderCart />}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Card flush>
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
          <View style={styles.about}>
            <Text style={type.secondary}>
              {category
                ? t('mobile.product.codeCategory', { sku: product.sku, category })
                : product.sku}
            </Text>
            <Text accessibilityRole="header" style={type.title2}>
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
                <Text
                  style={[styles.chipText, { color: out ? colors.destructive : colors.success }]}
                >
                  {out
                    ? t('mobile.shop.outOfStock')
                    : t('mobile.product.stock', {
                        n: formatQty(product.available),
                        unit: words(base).name,
                      })}
                </Text>
              </View>
              {home ? <Pill label={home.name} icon={MapPin} /> : null}
            </View>
            {product.deal ? <DealNote deal={product.deal} /> : null}
          </View>
        </Card>

        <Card style={styles.buy}>
          {product.units.length > 1 ? (
            <Segmented
              options={unitOptions(product.units)}
              value={String(unit.id)}
              onChange={(next) => setUnitId(Number.parseInt(next, 10))}
              label={t('mobile.product.unit')}
            />
          ) : null}
          <View style={styles.priceBlock}>
            {unit.wholesale ? (
              <View style={styles.priceRow}>
                <Text style={styles.price}>
                  {t('pricing.money', { amount: formatMnt(unit.wholesale) })}
                </Text>
                <Text style={type.secondary}>
                  {t('mobile.product.per', { unit: words(unit).name })}
                </Text>
              </View>
            ) : (
              <Text style={[type.heading, styles.muted]}>{t('mobile.product.noPrice')}</Text>
            )}
            {note ? <Text style={[type.secondary, tabular]}>{note}</Text> : null}
          </View>
          <View style={styles.rule} />
          <View style={styles.qtyRow}>
            <View style={styles.grow}>
              <Text style={type.row}>{t('mobile.product.qty')}</Text>
              <Text style={[type.secondary, tabular]}>
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
                <Minus size={18} strokeWidth={2.4} color={colors.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.product.typeQty', { n: qty })}
                onPress={() => (blocked ? refuse() : setKeypad(true))}
                style={styles.qtyBox}
              >
                <Text style={styles.qtyText} accessibilityLiveRegion="polite">
                  {String(qty)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.product.more')}
                onPress={() => (blocked ? refuse() : set(qty + 1))}
                style={[styles.plus, blocked && styles.faded]}
              >
                <Plus size={18} strokeWidth={2.4} color={colors.primaryForeground} />
              </Pressable>
            </View>
          </View>
        </Card>

        {!blocked && short.gt(0) ? (
          <View accessibilityRole="alert">
            <Notice tone="warn" icon={TriangleAlert}>
              {t('mobile.product.short', {
                stock: formatQty(product.available),
                short: short.toFixed(),
                unit: words(base).name,
              })}
            </Notice>
          </View>
        ) : null}
        {!product.sellable ? (
          <Notice tone="bad" icon={TriangleAlert}>
            {t('mobile.shop.notSellable')}
          </Notice>
        ) : blocked ? (
          <Notice tone="bad" icon={TriangleAlert}>
            {t('errors.PRODUCT_OUT_OF_APP_STOCK')}
          </Notice>
        ) : null}
      </ScrollView>

      <FooterBar>
        <View style={styles.footerTotal}>
          <Text style={type.secondary}>{t('mobile.product.total')}</Text>
          <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {totalText}
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
          disabled={(!canSell && !removing) || (qty === 0 && !line) || quote.unpriced}
          onPress={save}
          height={50}
          style={styles.addButton}
        />
      </FooterBar>

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
  scroll: { flex: 1 },
  content: { ...PAGE },
  hero: { backgroundColor: colors.imageFill },
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
  about: { padding: spacing.lg, gap: spacing.sm },
  muted: { color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  stockChip: { backgroundColor: colors.successSoft },
  outChip: { backgroundColor: colors.destructiveSoft },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { ...type.secondary, fontFamily: fonts.semibold },
  buy: { gap: spacing.md },
  priceBlock: { gap: 2 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 },
  price: { ...type.title2, ...tabular },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // The boards' stepper: a 50 px grey track, white − and blue + of 44 px, the number between.
  stepper: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
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
  faded: { opacity: 0.4 },
  qtyBox: { minWidth: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...type.title2, ...tabular },
  footerTotal: { flexShrink: 1, minWidth: 84, maxWidth: '45%' },
  total: { ...type.title3, ...tabular },
  addButton: { flex: 1 },
  missing: { flex: 1, gap: spacing.lg, paddingTop: spacing.xl, paddingHorizontal: spacing.lg },
});
