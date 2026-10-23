import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  ChevronDown,
  CircleMinus,
  Package,
  Percent,
  Plus,
  ShoppingCart,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  type StoreProduct,
  useCreditCheck,
  useStoreProductsOf,
  useStoreQuote,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { type CartLine, linesOf } from '../../../src/cart/cart';
import { useCustomerSendOrder } from '../../../src/cart/use-customer-send';
import { creditWarningOf } from '../../../src/customer/account';
import { orderDealHintsOf } from '../../../src/customer/deals';
import {
  lineDetailOf,
  type QuotedLine,
  type QuotedStock,
  quotedLine,
  quoteFor,
} from '../../../src/customer/shop';
import { CreditNote } from '../../../src/customer/shop-credit';
import { lineStockNote } from '../../../src/customer/stock';
import { formatMnt } from '../../../src/format/format';
import { useUnitWords } from '../../../src/shop/unit-words';
import { useCustomer } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { usePendingWords } from '../../../src/customer/pending-words';
import { PendingSendView } from '../../../src/ui/pending-send';
import { HeaderTextButton, StoreHeader } from '../../../src/ui/store-header';
import { useStoreTabBarInset } from '../../../src/ui/store-tab-bar';
import { Text } from '../../../src/ui/text';

/**
 * «Сагс» of «Bto300» (the Cart board, ADR-0079 #5): why the office may not confirm yet (the store
 * may still send), one row per product with its pieces, the server's line total, a stock note and
 * the unit pill that opens the product; «Засах» shows the remove buttons; what an order amount
 * program still needs («500,000₮ хүрвэл 3% хямд · дахиад 120,000₮», ADR-0092 #3); today's total
 * with its note; «Үргэлжлүүлэх» goes on to the checkout. A send without an answer locks the cart.
 */
export default function StoreCartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useStoreTabBarInset();
  const { server } = useCustomer();
  const { cart, dispatch, pending } = useShop();
  const sender = useCustomerSendOrder();
  const pendingWords = usePendingWords();
  const [editing, setEditing] = useState(false);
  const lines = linesOf(cart);
  const quote = useStoreQuote(lines);
  const answered = quoteFor(quote.data, lines);
  const credit = useCreditCheck(answered ? answered.quote.total : null);
  const warning = credit.data ? creditWarningOf(credit.data) : null;
  const ids = useMemo(() => [...new Set(cart.lines.map((line) => line.productId))], [cart.lines]);
  const products = useStoreProductsOf(ids);
  const productOf = (id: number) => products.data?.find((product) => product.id === id);
  const locked = pending !== null;

  if (cart.lines.length === 0 && !locked) {
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
            title={t('mobile.customer.cart.browse')}
            onPress={() => router.navigate('/shop')}
            style={styles.browse}
          />
        </View>
      </Page>
    );
  }

  const unpriced = answered !== null && answered.quote.lines.some((line) => !line.priced);
  const discount = answered ? new Decimal(answered.quote.discountTotal) : new Decimal(0);
  const orderDeals = orderDealHintsOf(answered?.orderDeals ?? []);

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.tabs.cart')}
        right={
          locked ? null : (
            <HeaderTextButton
              title={editing ? t('mobile.cart.done') : t('common.edit')}
              onPress={() => setEditing(!editing)}
            />
          )
        }
      />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}>
        <Text style={[type.body, styles.subtitle]}>
          {t('mobile.cart.count', { n: cart.lines.length })}
        </Text>

        {locked ? <PendingSendView sender={sender} words={pendingWords} /> : null}
        {warning ? (
          <View style={styles.credit}>
            <CreditNote
              warning={warning}
              variant="cart"
              onAccount={() => router.navigate('/account')}
            />
          </View>
        ) : null}

        <SectionHeader style={styles.section}>{t('mobile.cart.lines')}</SectionHeader>
        <View style={styles.group}>
          {cart.lines.map((line, index) => {
            const quoted = quotedLine(quote.data, line.productUnitId, line.qty);
            return (
              <View key={line.productUnitId}>
                {index > 0 ? <Separator inset={80} /> : null}
                <CartRow
                  line={line}
                  product={productOf(line.productId)}
                  quoted={quoted?.line}
                  stock={quoted?.stock}
                  server={server}
                  editing={editing && !locked}
                  locked={locked}
                  onOpen={() => router.push(`/product/${line.productId}`)}
                  onRemove={() => dispatch({ type: 'remove', productUnitId: line.productUnitId })}
                />
              </View>
            );
          })}
          {locked ? null : (
            <>
              <Separator />
              <Pressable
                accessibilityRole="button"
                onPress={() => router.navigate('/shop')}
                style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
              >
                <Plus size={22} strokeWidth={2.2} color={colors.primary} />
                <Text style={[type.row, styles.accent]}>{t('mobile.cart.addMore')}</Text>
              </Pressable>
            </>
          )}
        </View>

        {orderDeals.length > 0 ? (
          <View style={styles.orderDeals}>
            <Percent size={18} strokeWidth={2.2} color={colors.link} />
            <View style={styles.grow}>
              {orderDeals.map((hint, index) => (
                <Text key={index} style={[type.body, styles.orderDealText]}>
                  {hint.kind === 'next'
                    ? t(
                        hint.percent
                          ? 'mobile.customer.cart.orderDeal.nextPercent'
                          : 'mobile.customer.cart.orderDeal.nextAmount',
                        { threshold: hint.threshold, value: hint.value, missing: hint.missing },
                      )
                    : t(
                        hint.percent
                          ? 'mobile.customer.cart.orderDeal.reachedPercent'
                          : 'mobile.customer.cart.orderDeal.reachedAmount',
                        { value: hint.value },
                      )}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        <SectionHeader style={styles.section}>{t('mobile.cart.totals')}</SectionHeader>
        <View style={styles.group}>
          <View style={styles.totalRow}>
            <Text style={type.heading}>{t('mobile.cart.total')}</Text>
            <Text style={[styles.total, !answered && styles.stale]}>
              {quote.data
                ? t('pricing.money', { amount: formatMnt(quote.data.quote.total) })
                : t('common.none')}
            </Text>
          </View>
          {discount.gt(0) ? (
            <>
              <Separator />
              <View style={styles.discountRow}>
                <Text style={type.body}>{t('mobile.cart.discount')}</Text>
                <Text style={[type.bodyStrong, styles.green]}>
                  {t('mobile.cart.minus', { amount: formatMnt(discount.toFixed(0)) })}
                </Text>
              </View>
            </>
          ) : null}
          <Separator />
          <Text style={[type.secondary, styles.note]}>{t('mobile.customer.cart.priceNote')}</Text>
        </View>

        {quote.error ? <ProblemText problem={problemFrom(quote.error)} /> : null}
        {unpriced ? (
          <Text style={[type.secondary, styles.warning]}>{t('mobile.customer.cart.unpriced')}</Text>
        ) : null}
        {locked ? null : (
          <PillButton
            title={t('mobile.customer.cart.next')}
            trailing={<ArrowRight size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
            disabled={answered === null || unpriced}
            onPress={() => router.push('/checkout')}
            style={styles.next}
          />
        )}
      </ScrollView>
    </Page>
  );
}

/** «12 ширхэг · 29,100₮/ш», the stock note and the unit pill of one line. */
function CartRow({
  line,
  product,
  quoted,
  stock,
  server,
  editing,
  locked,
  onOpen,
  onRemove,
}: {
  line: CartLine;
  product: StoreProduct | undefined;
  /** The server's answer for this line as it is now; undefined while it loads. */
  quoted: QuotedLine | undefined;
  stock: QuotedStock | undefined;
  server: string;
  editing: boolean;
  locked: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const base = product?.units.find((unit) => unit.isBase);
  const detail = lineDetailOf(line, product, quoted);
  const detailText =
    detail.kind === 'parts'
      ? detail.parts
          .map((part) => {
            const unit = product?.units.find((entry) => entry.id === part.productUnitId);
            return `${part.qty} ${unit ? words(unit).name : part.uomName}`;
          })
          .join(' + ')
      : base
        ? [
            `${detail.pieces} ${words(base).name}`,
            detail.perPiece
              ? t('mobile.cart.perPiece', {
                  amount: formatMnt(detail.perPiece),
                  unit: words(base).short,
                })
              : null,
          ]
            .filter((part) => part !== null)
            .join(' · ')
        : null;
  const note = lineStockNote(stock);

  return (
    <View style={styles.row}>
      {editing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.cart.removeLine', { name: line.name })}
          onPress={onRemove}
          hitSlop={10}
        >
          <CircleMinus
            size={24}
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
        <Text style={type.heading} numberOfLines={2}>
          {line.name}
        </Text>
        {detailText ? (
          <Text style={type.secondary} numberOfLines={1}>
            {detailText}
          </Text>
        ) : null}
        {note ? (
          <Text style={[styles.stockNote, note === 'out' && styles.stockOut]} numberOfLines={2}>
            {t(`mobile.customer.stock.notes.${note}`)}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.lineTotal, quoted && !quoted.priced && styles.red]}>
          {quoted?.priced
            ? t('pricing.money', { amount: formatMnt(quoted.total ?? '0') })
            : quoted
              ? t('mobile.shop.noPrice')
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

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  subtitle: { marginHorizontal: spacing.xs, color: colors.muted },
  credit: { marginTop: 14 },
  orderDeals: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.secondary,
  },
  orderDealText: { color: colors.link },
  grow: { flex: 1, gap: 2 },
  section: { marginTop: 22 },
  group: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  text: { flex: 1 },
  stockNote: { ...type.caption, fontFamily: fonts.semibold, color: colors.warningText },
  stockOut: { color: colors.cancelled },
  right: { alignItems: 'flex-end', gap: 6 },
  lineTotal: { ...type.heading, ...tabular },
  red: { ...type.chip, fontFamily: fonts.semibold, color: colors.destructive },
  qtyPill: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 10,
    paddingRight: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.fieldFill,
  },
  qtyText: { ...type.chip, fontFamily: fonts.semibold },
  addRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.accent },
  accent: { color: colors.primary },
  totalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  total: { ...type.title2, ...tabular },
  stale: { color: colors.muted },
  discountRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  green: { color: colors.success },
  note: { paddingVertical: 11, paddingHorizontal: spacing.lg },
  warning: { marginTop: spacing.md, marginHorizontal: spacing.xs, color: colors.destructive },
  next: { marginTop: 20, borderRadius: 10 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  browse: { alignSelf: 'stretch' },
});
