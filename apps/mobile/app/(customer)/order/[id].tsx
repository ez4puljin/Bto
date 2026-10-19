import type { CustomerOrderState } from '@tugeel/shared/sales';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, ChevronRight, Package, RefreshCw, X } from 'lucide-react-native';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReorder, useStoreOrder, useStoreProductsOf } from '../../../src/api/customer';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { MAX_LINES } from '../../../src/cart/cart';
import {
  fitReorder,
  orderDayOf,
  type ReorderSkip,
  skippedByReason,
  unitPriceOf,
} from '../../../src/customer/order-lines';
import { StatePill, useTakerText } from '../../../src/customer/order-row';
import {
  backorderedIn,
  orderAmount,
  PROGRESS_STEPS,
  progressOf,
  takerOf,
} from '../../../src/customer/orders';
import { reorderPlan } from '../../../src/customer/reorder';
import { ubDate, ubTime } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { useCustomer } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Separator } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { FootNote, NavBar, Page, SectionHeader } from '../../../src/ui/layout';
import { PaymentDot } from '../../../src/ui/status';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** A line's picture; the separators between lines start past it. */
const THUMB = 48;
const LINE_INSET = spacing.lg + THUMB + spacing.md;
/** The bottom bar's button. */
const BUTTON = 50;

/**
 * An order of the store (the Order board, ADR-0079 #6): its number, state, day and who took it; the
 * progress «Илгээсэн → … → Хүргэгдсэн» (or the cancellation and its reason); how it is received and
 * paid, its invoice once sold; the lines with what waits for stock; the total («≈» until the
 * office confirms). «Дахин захиалах» puts its lines into the cart at today's prices.
 */
export default function StoreOrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { server } = useCustomer();
  const { ready, cart, dispatch, pending } = useShop();
  const taker = useTakerText();
  const reorder = useReorder();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number.parseInt(id ?? '', 10);
  const order = useStoreOrder(Number.isFinite(orderId) ? orderId : null);
  const data = order.data;
  const productIds = useMemo(
    () => [...new Set((data?.lines ?? []).map((line) => line.productId))],
    [data],
  );
  const products = useStoreProductsOf(productIds);
  const thumbs = useMemo(
    () => new Map((products.data ?? []).map((product) => [product.id, product.thumbUrl])),
    [products.data],
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const approx = (amount: string) => t('mobile.orders.approx', { amount: money(amount) });
  const dayText = (date: string) => {
    const day = orderDayOf(date, null);
    return t('mobile.orders.dayDate', {
      day: day.day,
      weekday: t(`mobile.weekdaysLong.${day.weekday}`),
    });
  };
  const toCart = { label: t('mobile.tabs.cart'), onPress: () => router.navigate('/cart') };

  const onReorder = async () => {
    if (!data || busy || !ready) return;
    // The cart is locked while an earlier send waits for its answer.
    if (pending) {
      toast.show({ message: t('mobile.cart.pendingTitle'), action: toCart });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const answer = await reorder(data.id);
      const plan = reorderPlan(answer.reorder, answer.products);
      const { fits, full, otherUnit } = fitReorder(plan.lines, cart.lines, MAX_LINES);
      for (const entry of fits) dispatch({ type: 'add', line: entry.line, qty: entry.qty });
      const skipped: { productId: number; name: string | null; reason: ReorderSkip }[] = [
        ...plan.skipped,
        ...full.map((entry) => ({
          productId: entry.line.productId,
          name: entry.line.name,
          reason: 'CART_FULL' as const,
        })),
        ...otherUnit.map((entry) => ({
          productId: entry.line.productId,
          name: entry.line.name,
          reason: 'OTHER_UNIT' as const,
        })),
      ];
      const nameOf = (productId: number) =>
        data.lines.find((line) => line.productId === productId)?.productName ?? null;
      const notes = skippedByReason(skipped, nameOf).map((group) =>
        t('mobile.customer.order.skipLine', {
          reason: t(`mobile.customer.order.skips.${group.reason}`),
          names: [
            ...group.names,
            ...(group.unnamed > 0
              ? [t('mobile.customer.order.skipUnnamed', { n: group.unnamed })]
              : []),
          ].join(', '),
        }),
      );
      const head =
        fits.length > 0
          ? t('mobile.customer.order.reordered', { n: fits.length })
          : t('mobile.customer.order.reorderedNone');
      toast.show({
        message: [head, ...notes].join('\n'),
        ...(fits.length > 0 ? { action: toCart } : {}),
        ...(notes.length > 0 ? { durationMs: 8_000 } : {}),
      });
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setBusy(false);
    }
  };

  const bottomPad = Math.max(insets.bottom, spacing.md) + 18;
  const amount = data ? orderAmount(data) : null;
  const cancelled = data?.state === 'CANCELLED';
  const invoice = data?.invoice ?? null;

  return (
    <Page>
      <NavBar back={t('mobile.tabs.orders')} onBack={() => router.back()} />
      {order.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.pad}>
        {order.error ? <ProblemText problem={problemFrom(order.error)} /> : null}
      </View>
      {data ? (
        <>
          <ScrollView
            contentContainerStyle={[
              styles.body,
              { paddingBottom: 14 + BUTTON + bottomPad + spacing.lg },
            ]}
          >
            <View style={styles.head}>
              <Text accessibilityRole="header" style={[type.title, styles.number]}>
                {data.number ?? t('common.none')}
              </Text>
              <StatePill state={data.state} />
            </View>
            <Text style={[type.body, styles.created]}>
              {takerOf(data).kind === 'app'
                ? t('mobile.customer.order.createdApp', {
                    date: dayText(ubDate(data.createdAt)),
                    time: ubTime(data.createdAt),
                  })
                : t('mobile.customer.order.created', {
                    date: dayText(ubDate(data.createdAt)),
                    time: ubTime(data.createdAt),
                    taker: taker(takerOf(data)),
                  })}
            </Text>

            {cancelled ? (
              <View style={[styles.card, styles.cancelCard]}>
                <View style={styles.cancelDot}>
                  <X size={16} strokeWidth={3} color={colors.primaryForeground} />
                </View>
                <View style={styles.grow}>
                  <Text style={[type.rowStrong, styles.cancelTitle]}>
                    {t('sales.customerStates.CANCELLED')}
                  </Text>
                  {data.cancelReason ? (
                    <Text style={[type.body, styles.muted]}>{data.cancelReason}</Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <Progress state={data.state} />
            )}

            <SectionHeader style={styles.section}>{t('mobile.customer.order.info')}</SectionHeader>
            <View style={styles.card}>
              <InfoRow
                title={t('mobile.checkout.receive')}
                value={[t(`sales.fulfilments.${data.fulfilment}`), dayText(data.deliveryDate)].join(
                  ' · ',
                )}
              />
              {data.fulfilment === 'DELIVERY' ? (
                <>
                  <Separator />
                  <InfoRow
                    title={t('mobile.checkout.address')}
                    value={data.addressText ?? t('common.none')}
                  />
                </>
              ) : null}
              <Separator />
              <InfoRow
                title={t('mobile.checkout.payment')}
                right={
                  <View style={styles.payment}>
                    <PaymentDot method={data.paymentMethod} size={9} />
                    <Text style={[type.body, styles.value]}>
                      {t(`sales.paymentMethods.${data.paymentMethod}`)}
                    </Text>
                  </View>
                }
              />
              <Separator />
              {invoice ? (
                <InfoRow
                  title={t('mobile.customer.invoice.title')}
                  value={invoice.number}
                  link
                  onPress={() => router.push(`/invoice/${invoice.id}`)}
                />
              ) : (
                <InfoRow
                  title={t('mobile.customer.invoice.title')}
                  value={cancelled ? t('common.none') : t('mobile.customer.order.invoiceLater')}
                  soft
                />
              )}
              {data.note ? (
                <>
                  <Separator />
                  <InfoRow title={t('mobile.checkout.note')} value={data.note} />
                </>
              ) : null}
            </View>

            <SectionHeader style={styles.section}>{t('mobile.cart.lines')}</SectionHeader>
            <View style={styles.card}>
              {data.lines.map((line, index) => {
                const thumb = thumbs.get(line.productId) ?? null;
                const price = unitPriceOf(line);
                const qty = price
                  ? t('mobile.product.part', {
                      qty: formatQty(line.qty),
                      unit: line.unitName,
                      price: formatMnt(price),
                    })
                  : `${formatQty(line.qty)} ${line.unitName}`;
                const waiting = cancelled ? null : backorderedIn(line);
                return (
                  <View key={line.id}>
                    {index > 0 ? <Separator inset={LINE_INSET} /> : null}
                    <View style={styles.line}>
                      <View style={styles.thumb}>
                        {thumb ? (
                          <Image
                            source={{ uri: `${server}${thumb}` }}
                            style={styles.image}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={thumb}
                          />
                        ) : (
                          <Package size={22} strokeWidth={1.5} color={colors.input} />
                        )}
                      </View>
                      <View style={styles.grow}>
                        <Text style={type.rowStrong} numberOfLines={2}>
                          {line.productName}
                        </Text>
                        <Text style={[type.secondary, tabular]} numberOfLines={1}>
                          {qty}
                        </Text>
                        {waiting ? (
                          <View style={styles.waiting}>
                            <Text style={styles.waitingText}>
                              {t('mobile.customer.order.backordered', {
                                qty: formatQty(waiting.qty),
                                unit: waiting.inUnit ? line.unitName : line.baseUnitName,
                              })}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {line.total !== null ? (
                        <Text style={styles.lineTotal} numberOfLines={1}>
                          {money(line.total)}
                        </Text>
                      ) : line.estimatedTotal !== null ? (
                        <Text style={[styles.lineTotal, styles.estimate]} numberOfLines={1}>
                          {approx(line.estimatedTotal)}
                        </Text>
                      ) : (
                        <Text style={[type.body, styles.muted]} numberOfLines={1}>
                          {t('mobile.orders.priceLater')}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
              <Separator />
              <View style={styles.totalRow}>
                <Text style={type.heading}>{t('mobile.cart.total')}</Text>
                <Text
                  style={[styles.total, (amount?.estimate || cancelled) && styles.estimate]}
                  numberOfLines={1}
                >
                  {amount
                    ? amount.estimate
                      ? approx(amount.amount)
                      : money(amount.amount)
                    : t('mobile.orders.priceLater')}
                </Text>
              </View>
            </View>
            {data.state !== 'DELIVERED' && !cancelled ? (
              <FootNote>
                {data.lines.some((line) => backorderedIn(line) !== null)
                  ? `${t('mobile.customer.order.noteBackordered')} ${t('mobile.customer.order.noteChanges')}`
                  : t('mobile.customer.order.noteChanges')}
              </FootNote>
            ) : null}
            <ProblemText problem={problem} />
          </ScrollView>
          <View style={[styles.bottom, { paddingBottom: bottomPad }]}>
            <PillButton
              title={t('mobile.customer.order.reorder')}
              icon={<RefreshCw size={20} strokeWidth={2.2} color={colors.primaryForeground} />}
              loading={busy}
              disabled={!ready}
              height={BUTTON}
              style={styles.grow}
              onPress={() => void onReorder()}
            />
          </View>
        </>
      ) : null}
    </Page>
  );
}

/** «Илгээсэн → Батлагдсан → Бэлтгэж буй → Бэлэн → Хүргэгдсэн»: the steps done are green. */
function Progress({ state }: { state: CustomerOrderState }) {
  const { t } = useTranslation();
  const done = progressOf(state);
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={t('mobile.customer.order.progress')}
      style={[styles.card, styles.progress]}
    >
      {PROGRESS_STEPS.map((step, index) => {
        const reached = index <= done;
        const label = t(`mobile.customer.order.steps.${step}`);
        return (
          <View
            key={step}
            accessible
            accessibilityLabel={t(
              reached ? 'mobile.customer.order.stepDone' : 'mobile.customer.order.stepWaiting',
              { step: label },
            )}
            style={styles.step}
          >
            <View style={[styles.stepDot, reached ? styles.stepDone : styles.stepTodo]}>
              {reached ? (
                <Check size={16} strokeWidth={3} color={colors.primaryForeground} />
              ) : null}
            </View>
            <Text style={[styles.stepLabel, reached && styles.stepLabelDone]} numberOfLines={2}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** A row of «Мэдээлэл»: the title, and its value (or what `right` draws) on the right. */
function InfoRow({
  title,
  value,
  right,
  soft = false,
  link = false,
  onPress,
}: {
  title: string;
  value?: string;
  right?: ReactNode;
  /** A value that is not there yet («Хүргэсний дараа гарна»). */
  soft?: boolean;
  /** A value that opens something (the invoice): in the accent colour, with a chevron. */
  link?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={[type.row, styles.infoTitle]}>{title}</Text>
      {value !== undefined ? (
        <Text
          style={[
            type.body,
            styles.value,
            styles.infoValue,
            soft && styles.muted,
            link && styles.link,
          ]}
          numberOfLines={3}
        >
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <ChevronRight size={16} strokeWidth={2.6} color={colors.input} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.info}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.info, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg },
  body: { paddingHorizontal: spacing.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginHorizontal: spacing.xs,
  },
  number: { flexShrink: 1, ...tabular },
  created: { marginTop: 2, marginHorizontal: spacing.xs, color: colors.muted },
  muted: { color: colors.muted },
  grow: { flex: 1 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  section: { marginTop: 22 },
  progress: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDone: { backgroundColor: colors.tint.green },
  stepTodo: { borderWidth: 2, borderColor: colors.input, backgroundColor: colors.card },
  stepLabel: { ...type.caption, textAlign: 'center' },
  stepLabelDone: { fontFamily: fonts.semibold, color: colors.foreground },
  cancelCard: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
  },
  cancelDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cancelled,
  },
  cancelTitle: { color: colors.cancelled, marginTop: 4, marginBottom: 2 },
  info: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  infoTitle: { flexShrink: 0 },
  infoValue: { flex: 1, textAlign: 'right' },
  value: { color: colors.label2 },
  link: { color: colors.primary, ...tabular },
  pressed: { backgroundColor: colors.accent },
  payment: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  waiting: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
  },
  waitingText: { ...type.caption, fontFamily: fonts.semibold, color: colors.warningText },
  lineTotal: { ...type.rowStrong, ...tabular, textAlign: 'right' },
  // An amount not confirmed yet, or of a cancelled order: softer than a confirmed one.
  estimate: { color: colors.muted },
  totalRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  total: { ...type.title3, ...tabular, flexShrink: 1, textAlign: 'right' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.sheetBarFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    flexDirection: 'row',
  },
});
