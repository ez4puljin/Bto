import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleMinus,
  Gift,
  Package,
  Plus,
  ShoppingCart,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/text';
import { type Quote, type RepProduct, useProductsOf, useQuote } from '../../../src/api/rep';
import { type CartLine, linesOf } from '../../../src/cart/cart';
import { formatMnt } from '../../../src/format/format';
import { unpricedCount } from '../../../src/offline/estimate';
import { EstimateNote, KeptNote } from '../../../src/offline/kept-note';
import { useUnitWords } from '../../../src/shop/unit-words';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, FooterBar, Notice, PAGE } from '../../../src/ui/staff-kit';
import { HeaderTextButton, StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarHeight, useStoreTabBarInset } from '../../../src/ui/store-tab-bar';

/**
 * «Сагс» (the Cart board, ADR-0068; Bto300's look since ADR-0100): the blue header with «Засах»,
 * which shows the remove buttons; one row per product with its pieces, the server's line total and
 * the unit pill that opens the product; the server's total; «Захиалга илгээх», in the bar above the
 * tabs with the total beside it, goes on to the customer's details.
 */
export default function CartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const barHeight = useStoreTabBarHeight();
  const { server } = useSignedIn();
  const { cart, dispatch } = useShop();
  const [editing, setEditing] = useState(false);
  const quote = useQuote(linesOf(cart));
  const ids = useMemo(() => [...new Set(cart.lines.map((line) => line.productId))], [cart.lines]);
  const products = useProductsOf(ids);
  const productOf = (id: number) => products.data?.find((product) => product.id === id);
  if (cart.lines.length === 0) {
    return (
      <Page edges={[]}>
        <StoreHeader title={t('mobile.tabs.cart')} right={null} />
        <View style={[styles.empty, { paddingBottom: inset }]}>
          <EmptyState
            icon={<ShoppingCart size={48} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.cart.empty')}
            hint={t('mobile.cart.emptyHint')}
          />
          <PillButton
            title={t('mobile.cart.browse')}
            onPress={() => router.navigate('/shop')}
            style={styles.browse}
          />
        </View>
      </Page>
    );
  }

  // Without the server an estimate from the kept prices (ADR-0225 #4): «≈», and never a block.
  const estimated = quote.data?.estimated === true;
  const unpriced = !estimated && quote.data?.lines.some((line) => !line.priced) === true;
  // The N+M's free goods stand apart under «Бонус» (ADR-0217): their value is not a discount too.
  const bonuses = cart.lines.flatMap((line, index) => {
    const bonus = quote.data?.lines[index]?.bonus;
    return bonus && new Decimal(bonus.freeQtyBase).gt(0) ? [{ line, bonus }] : [];
  });
  const discount = quote.data
    ? Decimal.max(
        new Decimal(quote.data.discountTotal).minus(
          bonuses.reduce((sum, entry) => sum.plus(entry.bonus.freeAmount), new Decimal(0)),
        ),
        0,
      )
    : new Decimal(0);

  const totalText = quote.data
    ? estimated
      ? t('mobile.orders.approx', {
          amount: t('pricing.money', { amount: formatMnt(quote.data.total) }),
        })
      : t('pricing.money', { amount: formatMnt(quote.data.total) })
    : t('common.none');

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.tabs.cart')}
        subtitle={t('mobile.cart.count', { n: cart.lines.length })}
        right={
          <HeaderTextButton
            title={editing ? t('mobile.cart.done') : t('common.edit')}
            onPress={() => setEditing(!editing)}
          />
        }
      />
      <ScrollView
        style={styles.grow}
        contentContainerStyle={[styles.body, { paddingBottom: spacing.lg }]}
      >
        <KeptNote />
        <SectionHeader style={styles.section}>{t('mobile.cart.lines')}</SectionHeader>
        <Card flush>
          {cart.lines.map((line, index) => (
            <View key={line.productUnitId}>
              {index > 0 ? <Separator inset={80} /> : null}
              <CartRow
                line={line}
                product={productOf(line.productId)}
                priced={quote.data?.lines[index]}
                estimated={estimated}
                server={server}
                editing={editing}
                locked={false}
                onOpen={() => router.push(`/product/${line.productId}`)}
                onRemove={() => dispatch({ type: 'remove', productUnitId: line.productUnitId })}
              />
            </View>
          ))}
          <Separator />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/shop')}
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
          >
            <Plus size={20} strokeWidth={2.2} color={colors.link} />
            <Text style={styles.addText}>{t('mobile.cart.addMore')}</Text>
          </Pressable>
        </Card>

        {bonuses.length > 0 ? (
          <>
            <SectionHeader style={styles.section}>{t('mobile.cart.bonus')}</SectionHeader>
            <Card flush>
              {bonuses.map(({ line, bonus }, index) => (
                <View key={line.productUnitId}>
                  {index > 0 ? <Separator inset={80} /> : null}
                  <BonusRow
                    line={line}
                    product={productOf(line.productId)}
                    freeQtyBase={bonus.freeQtyBase}
                  />
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionHeader style={styles.section}>{t('mobile.cart.totals')}</SectionHeader>
        <Card flush>
          {discount.gt(0) ? (
            <>
              <View style={styles.discountRow}>
                <Text style={type.row}>{t('mobile.cart.discount')}</Text>
                <Text style={[type.row, tabular, styles.green]}>
                  {t('mobile.cart.minus', { amount: formatMnt(discount.toFixed(0)) })}
                </Text>
              </View>
              <Separator />
            </>
          ) : null}
          <View style={styles.totalRow}>
            <View style={styles.text}>
              <Text style={type.row}>{t('mobile.cart.total')}</Text>
              {estimated ? (
                <EstimateNote unpriced={unpricedCount(quote.data)} />
              ) : (
                <Text style={type.caption}>{t('mobile.cart.priceNote')}</Text>
              )}
            </View>
            <Text style={styles.total}>{totalText}</Text>
          </View>
        </Card>

        {unpriced ? (
          <Notice tone="bad" icon={CircleAlert}>
            {t('mobile.cart.unpriced')}
          </Notice>
        ) : null}
      </ScrollView>
      {/* The page's main button, right above the tab bar, with the total beside it. */}
      <View style={{ marginBottom: barHeight }}>
        <FooterBar style={styles.footer}>
          <View style={styles.footerTotal}>
            <Text style={type.secondary}>{t('mobile.cart.total')}</Text>
            <Text style={styles.footerAmount} numberOfLines={1}>
              {totalText}
            </Text>
          </View>
          <PillButton
            title={t('mobile.cart.next')}
            trailing={<ArrowRight size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
            disabled={(quote.isLoading && !estimated) || unpriced}
            onPress={() => router.push('/checkout')}
            style={styles.grow}
          />
        </FooterBar>
      </View>
    </Page>
  );
}

/** «12 ширхэг · 29,100₮/ш» and the unit pill of one line. */
function CartRow({
  line,
  product,
  priced,
  estimated,
  server,
  editing,
  locked,
  onOpen,
  onRemove,
}: {
  line: CartLine;
  product: RepProduct | undefined;
  priced: Quote['lines'][number] | undefined;
  /** The phone's estimate without the server: the line's amount carries «≈». */
  estimated: boolean;
  server: string;
  editing: boolean;
  locked: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const base = product?.units.find((unit) => unit.isBase);
  const baseWords = base ? words(base) : null;
  const pieces = new Decimal(line.factorToBase).times(line.qty).toFixed();
  const parts = priced?.priced ? priced.parts : [];
  // An N+M line (ADR-0217): the pill keeps the total typed, the text says the paid part.
  const free = priced?.bonus ? new Decimal(priced.bonus.freeQtyBase) : new Decimal(0);
  const main =
    free.gt(0) && baseWords
      ? t('mobile.cart.mainQty', {
          qty: new Decimal(pieces).minus(free).toFixed(),
          unit: baseWords.name,
        })
      : null;
  // One part in whole packs costs the warehouse price a piece; loose pieces their own price.
  const perPiece =
    parts.length === 1 && parts[0]?.basis === 'WAREHOUSE'
      ? product?.basePrice
      : parts.length === 1 && parts[0]?.productUnitId === base?.id
        ? parts[0]?.unitPrice
        : null;
  const detail = main
    ? [
        main,
        perPiece && baseWords
          ? t('mobile.cart.perPiece', { amount: formatMnt(perPiece), unit: baseWords.short })
          : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    : parts.length > 1
      ? parts
          .map((part) => {
            const unit = product?.units.find((entry) => entry.id === part.productUnitId);
            return `${part.qty} ${unit ? words(unit).name : part.uomName}`;
          })
          .join(' + ')
      : [
          baseWords ? `${pieces} ${baseWords.name}` : null,
          perPiece && baseWords
            ? t('mobile.cart.perPiece', { amount: formatMnt(perPiece), unit: baseWords.short })
            : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');

  return (
    <View style={styles.row}>
      {editing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.cart.removeLine', { name: line.name })}
          onPress={onRemove}
          hitSlop={8}
        >
          <CircleMinus
            size={26}
            strokeWidth={2}
            color={colors.primaryForeground}
            fill={colors.tint.red}
          />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={line.name}
        onPress={onOpen}
        style={styles.thumb}
      >
        {line.thumbUrl ? (
          <Image
            source={{ uri: `${server}${line.thumbUrl}` }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={line.thumbUrl}
          />
        ) : (
          <Package size={24} strokeWidth={1.5} color={colors.input} />
        )}
      </Pressable>
      <View style={styles.text}>
        <Text style={type.rowStrong} numberOfLines={2}>
          {line.name}
        </Text>
        {detail ? (
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.lineTotal, priced && !priced.priced && styles.red]}>
          {priced?.priced
            ? estimated
              ? t('mobile.orders.approx', {
                  amount: t('pricing.money', { amount: formatMnt(priced.total ?? '0') }),
                })
              : t('pricing.money', { amount: formatMnt(priced.total ?? '0') })
            : priced
              ? t('mobile.cart.noPrice')
              : t('common.none')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.cart.changeQty', { name: line.name })}
          disabled={locked}
          onPress={onOpen}
          hitSlop={8}
          style={styles.qtyPill}
        >
          <Text style={styles.qtyText}>{`${line.qty} ${words(line).name}`}</Text>
          {locked ? null : <ChevronDown size={14} strokeWidth={2.4} color={colors.muted} />}
        </Pressable>
      </View>
    </View>
  );
}

/** A line's free goods under «Бонус» (ADR-0217): the product, its free pieces, nothing to pay. */
function BonusRow({
  line,
  product,
  freeQtyBase,
}: {
  line: CartLine;
  product: RepProduct | undefined;
  freeQtyBase: string;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const base = product?.units.find((unit) => unit.isBase);
  return (
    <View style={styles.row}>
      <View style={[styles.thumb, styles.bonusTile]}>
        <Gift size={24} strokeWidth={1.8} color={colors.success} />
      </View>
      <View style={styles.text}>
        <Text style={type.rowStrong} numberOfLines={2}>
          {line.name}
        </Text>
        <Text style={[type.secondary, tabular]} numberOfLines={1}>
          {t('mobile.cart.bonusQty', { qty: freeQtyBase, unit: base ? words(base).name : '' })}
        </Text>
      </View>
      <Text style={[styles.lineTotal, styles.green]}>
        {t('pricing.money', { amount: formatMnt('0') })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { ...PAGE },
  // A label sits 8 px over its card inside the page's 16 px rhythm.
  section: { marginTop: 0, marginBottom: -spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  lineTotal: { ...type.rowStrong, ...tabular },
  red: { ...type.chip, fontFamily: fonts.semibold, color: colors.destructive },
  qtyPill: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 10,
    paddingRight: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.fill,
  },
  qtyText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.foreground },
  addRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  addText: { ...type.row, fontFamily: fonts.medium, color: colors.link },
  pressed: { backgroundColor: colors.accent },
  totalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  total: { ...type.title2, ...tabular },
  discountRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  green: { color: colors.success },
  bonusTile: { backgroundColor: colors.fill },
  footer: { paddingBottom: spacing.md },
  footerTotal: { flexShrink: 1, minWidth: 72 },
  footerAmount: { ...type.title3, ...tabular },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  browse: { alignSelf: 'stretch' },
});
