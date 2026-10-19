import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  ChevronDown,
  CircleMinus,
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
import { useUnitWords } from '../../../src/shop/unit-words';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { EmptyState } from '../../../src/ui/kit';
import { BarButton, LargeTitle, Page, SectionHeader } from '../../../src/ui/layout';
import { PendingSendCard } from '../../../src/ui/pending-send';
import { useTabBarInset } from '../../../src/ui/tab-bar';

/**
 * «Сагс» (the Cart board, ADR-0068): one row per product with its pieces, the server's line total
 * and the unit pill that opens the product; «Засах» shows the remove buttons; the server's total;
 * «Захиалга илгээх» goes on to the customer's details.
 */
export default function CartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const { server } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const [editing, setEditing] = useState(false);
  const quote = useQuote(linesOf(cart));
  const ids = useMemo(() => [...new Set(cart.lines.map((line) => line.productId))], [cart.lines]);
  const products = useProductsOf(ids);
  const productOf = (id: number) => products.data?.find((product) => product.id === id);
  const locked = pending !== null;

  if (cart.lines.length === 0 && !locked) {
    return (
      <Page>
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

  const unpriced = quote.data?.lines.some((line) => !line.priced) === true;
  const discount = quote.data ? new Decimal(quote.data.discountTotal) : new Decimal(0);

  return (
    <Page>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}>
        <View style={styles.bar}>
          {locked ? null : (
            <BarButton
              title={editing ? t('mobile.cart.done') : t('common.edit')}
              onPress={() => setEditing(!editing)}
              strong={editing}
            />
          )}
        </View>
        <LargeTitle style={styles.title}>{t('mobile.tabs.cart')}</LargeTitle>
        <Text style={[type.body, styles.subtitle]}>
          {t('mobile.cart.count', { n: cart.lines.length })}
        </Text>

        {locked ? <PendingSendCard /> : null}

        <SectionHeader style={styles.section}>{t('mobile.cart.lines')}</SectionHeader>
        <View style={styles.group}>
          {cart.lines.map((line, index) => (
            <View key={line.productUnitId}>
              {index > 0 ? <Separator inset={80} /> : null}
              <CartRow
                line={line}
                product={productOf(line.productId)}
                priced={quote.data?.lines[index]}
                server={server}
                editing={editing && !locked}
                locked={locked}
                onOpen={() => router.push(`/product/${line.productId}`)}
                onRemove={() => dispatch({ type: 'remove', productUnitId: line.productUnitId })}
              />
            </View>
          ))}
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

        <SectionHeader style={styles.section}>{t('mobile.cart.totals')}</SectionHeader>
        <View style={styles.group}>
          <View style={styles.totalRow}>
            <Text style={type.heading}>{t('mobile.cart.total')}</Text>
            <Text style={styles.total}>
              {quote.data
                ? t('pricing.money', { amount: formatMnt(quote.data.total) })
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
          <Text style={[type.secondary, styles.note]}>{t('mobile.cart.priceNote')}</Text>
        </View>

        {unpriced ? (
          <Text style={[type.secondary, styles.warning]}>{t('mobile.cart.unpriced')}</Text>
        ) : null}
        {locked ? null : (
          <PillButton
            title={t('mobile.cart.next')}
            trailing={<ArrowRight size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
            disabled={quote.isLoading || unpriced}
            onPress={() => router.push('/checkout')}
            style={styles.next}
          />
        )}
      </ScrollView>
    </Page>
  );
}

/** «12 ширхэг · 29,100₮/ш» and the unit pill of one line. */
function CartRow({
  line,
  product,
  priced,
  server,
  editing,
  locked,
  onOpen,
  onRemove,
}: {
  line: CartLine;
  product: RepProduct | undefined;
  priced: Quote['lines'][number] | undefined;
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
  // One part in whole packs costs the warehouse price a piece; loose pieces their own price.
  const perPiece =
    parts.length === 1 && parts[0]?.basis === 'WAREHOUSE'
      ? product?.basePrice
      : parts.length === 1 && parts[0]?.productUnitId === base?.id
        ? parts[0]?.unitPrice
        : null;
  const detail =
    parts.length > 1
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
        <Text style={styles.name} numberOfLines={2}>
          {line.name}
        </Text>
        {detail ? (
          <Text style={type.secondary} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <Text style={[styles.lineTotal, priced && !priced.priced && styles.red]}>
          {priced?.priced
            ? t('pricing.money', { amount: formatMnt(priced.total ?? '0') })
            : priced
              ? t('mobile.cart.noPrice')
              : t('common.none')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobile.cart.changeQty', { name: line.name })}
          disabled={locked}
          onPress={onOpen}
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
  body: { paddingHorizontal: spacing.lg },
  bar: { height: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  subtitle: { marginTop: 2, marginHorizontal: spacing.xs, color: colors.muted },
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
  name: { ...type.heading },
  right: { alignItems: 'flex-end', gap: 6 },
  lineTotal: { ...type.heading },
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
  total: { ...type.title2 },
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
  next: { marginTop: 20 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  browse: { alignSelf: 'stretch' },
});
