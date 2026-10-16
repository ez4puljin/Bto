import { defaultDeliveryDate, PAYMENT_METHODS } from '@tugeel/shared/sales';
import { useRouter } from 'expo-router';
import { ShoppingCart, Trash2, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppProblem } from '../../../src/api/problem';
import { useCustomer, useQuote, useRepContext } from '../../../src/api/rep';
import { type CartIssue, cartIssues, linesOf } from '../../../src/cart/cart';
import { useSendOrder } from '../../../src/cart/use-send';
import { deliveryDays, shortDate, weekdayOf } from '../../../src/dates/dates';
import { formatMnt, formatQty } from '../../../src/format/format';
import { placeOf } from '../../../src/state/placement';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, type } from '../../../src/theme/tokens';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Money,
  ProblemText,
  Screen,
  SectionTitle,
  Stepper,
  TextField,
  Title,
} from '../../../src/ui/kit';

/** «Сагс»: the lines priced by the server, the customer, delivery, date, payment, and «Илгээх». */
export default function CartScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { cart, dispatch, stageId } = useShop();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const quote = useQuote(linesOf(cart));
  const customer = useCustomer(cart.customer?.id ?? null);
  const { send, resend, forget, sending, pending } = useSendOrder();
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [unknown, setUnknown] = useState(false);
  const place = context.data ? placeOf(context.data, stageId) : null;
  const locked = pending !== null;

  // The proposed date is tomorrow; a stored date in the past moves to it too.
  useEffect(() => {
    if (today && (!cart.deliveryDate || cart.deliveryDate < today)) {
      dispatch({ type: 'deliveryDate', date: defaultDeliveryDate(today) });
    }
  }, [today, cart.deliveryDate, dispatch]);

  const issues: CartIssue[] = today ? cartIssues(cart, today, place ? stageId : null) : ['lines'];
  const lineErrors = new Set(
    (problem?.errors ?? []).flatMap((entry) => {
      const match = /^lines\.(\d+)/.exec(entry.path);
      return match ? [Number.parseInt(match[1] ?? '-1', 10)] : [];
    }),
  );

  const afterSend = (result: Awaited<ReturnType<typeof send>>) => {
    if (!result) return;
    if (result.kind === 'sent') {
      setProblem(null);
      setUnknown(false);
      router.push(`/order/${result.order.id}`);
    } else if (result.kind === 'unknown') {
      setUnknown(true);
    } else {
      setUnknown(false);
      setProblem(result.problem);
    }
  };

  const confirmSend = () => {
    Alert.alert(
      t('mobile.cart.confirmTitle'),
      t(place?.confirms ? 'mobile.cart.confirmReserves' : 'mobile.cart.confirmDraft', {
        stage: place?.stageName ?? '',
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('mobile.cart.send'), onPress: () => void send().then(afterSend) },
      ],
    );
  };

  if (cart.lines.length === 0 && !locked) {
    return (
      <Screen style={styles.empty}>
        <EmptyState
          icon={<ShoppingCart size={48} color={colors.muted} />}
          title={t('mobile.cart.empty')}
          hint={t('mobile.cart.emptyHint')}
        />
        <Button title={t('mobile.home.openShop')} onPress={() => router.push('/shop')} />
      </Screen>
    );
  }

  const addresses = customer.data?.addresses ?? [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Title>{t('mobile.tabs.cart')}</Title>

        {locked ? (
          <Card style={styles.warning}>
            <Text style={type.bodyStrong}>{t('mobile.cart.pendingTitle')}</Text>
            <Text style={type.body}>
              {unknown ? t('mobile.cart.unknownHint') : t('mobile.cart.pendingHint')}
            </Text>
            <Button
              title={t('mobile.cart.resend')}
              loading={sending}
              onPress={() => void resend().then(afterSend)}
            />
            <Button
              variant="ghost"
              title={t('mobile.cart.checkOrders')}
              onPress={() => router.push('/orders')}
            />
            <Button
              variant="danger"
              title={t('mobile.cart.forget')}
              onPress={() =>
                Alert.alert(t('mobile.cart.forgetTitle'), t('mobile.cart.forgetHint'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('mobile.cart.forget'),
                    style: 'destructive',
                    onPress: () => void forget(),
                  },
                ])
              }
            />
          </Card>
        ) : null}

        {cart.lines.map((line, index) => {
          const priced = quote.data?.lines[index];
          return (
            <Card key={line.productUnitId} style={lineErrors.has(index) && styles.lineError}>
              <View style={styles.lineHead}>
                <View style={styles.grow}>
                  <Text style={type.bodyStrong} numberOfLines={2}>
                    {line.name}
                  </Text>
                  <Text style={type.caption}>{line.sku}</Text>
                </View>
                {!locked ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    onPress={() => dispatch({ type: 'remove', productUnitId: line.productUnitId })}
                    hitSlop={8}
                  >
                    <Trash2 size={20} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
              {priced?.priced ? (
                <Text style={type.secondary}>
                  {priced.parts
                    .map((part) =>
                      t('mobile.cart.part', {
                        qty: formatQty(part.qty),
                        unit: part.uomName,
                        price: formatMnt(part.unitPrice),
                      }),
                    )
                    .join(' + ')}
                </Text>
              ) : priced ? (
                <Text style={[type.secondary, styles.error]}>{t('mobile.cart.noPrice')}</Text>
              ) : null}
              <View style={styles.lineFoot}>
                {locked ? (
                  <Text style={type.bodyStrong}>{`${line.qty} ${line.uomName}`}</Text>
                ) : (
                  <Stepper
                    label={line.uomName}
                    value={Number.parseInt(line.qty, 10)}
                    onChange={(qty) =>
                      dispatch({ type: 'setQty', productUnitId: line.productUnitId, qty })
                    }
                  />
                )}
                <Money value={priced?.priced ? priced.total : null} />
              </View>
            </Card>
          );
        })}

        <Card>
          <View style={styles.total}>
            <Text style={type.secondary}>{t('mobile.cart.subtotal')}</Text>
            <Money value={quote.data?.subtotal} style={type.body} />
          </View>
          <View style={styles.total}>
            <Text style={type.secondary}>{t('mobile.cart.discount')}</Text>
            <Money value={quote.data?.discountTotal} style={type.body} />
          </View>
          <View style={styles.total}>
            <Text style={type.heading}>{t('mobile.cart.total')}</Text>
            <Money value={quote.data?.total} style={type.heading} />
          </View>
          <Text style={type.caption}>{t('mobile.cart.priceNote')}</Text>
        </Card>

        <SectionTitle>{t('mobile.cart.customer')}</SectionTitle>
        <Card>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => router.push('/customers')}
            style={styles.customer}
          >
            <UserRound size={22} color={colors.primary} />
            <View style={styles.grow}>
              <Text style={type.bodyStrong}>
                {cart.customer ? cart.customer.name : t('mobile.cart.chooseCustomer')}
              </Text>
              {cart.customer ? <Text style={type.caption}>{cart.customer.code}</Text> : null}
            </View>
          </Pressable>
          {cart.customer ? (
            <View style={styles.chips}>
              {addresses.map((address) => (
                <Chip
                  key={address.id}
                  label={address.label ?? address.address ?? t('mobile.cart.address')}
                  selected={cart.fulfilment === 'DELIVERY' && cart.addressId === address.id}
                  onPress={() => !locked && dispatch({ type: 'address', addressId: address.id })}
                />
              ))}
              <Chip
                label={t('sales.fulfilments.PICKUP')}
                selected={cart.fulfilment === 'PICKUP'}
                onPress={() => !locked && dispatch({ type: 'pickup' })}
              />
            </View>
          ) : null}
        </Card>

        <SectionTitle>{t('mobile.cart.deliveryDate')}</SectionTitle>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {(today ? deliveryDays(today) : []).map((day, index) => (
            <Chip
              key={day}
              label={
                index === 0
                  ? t('mobile.cart.today')
                  : index === 1
                    ? t('mobile.cart.tomorrow')
                    : `${shortDate(day)} ${t(`mobile.weekdays.${weekdayOf(day)}` as 'mobile.weekdays.0')}`
              }
              selected={cart.deliveryDate === day}
              onPress={() => !locked && dispatch({ type: 'deliveryDate', date: day })}
            />
          ))}
        </ScrollView>

        <SectionTitle>{t('mobile.cart.payment')}</SectionTitle>
        <View style={styles.chips}>
          {PAYMENT_METHODS.map((method) => (
            <Chip
              key={method}
              label={t(`sales.paymentMethods.${method}`)}
              selected={cart.paymentMethod === method}
              onPress={() => !locked && dispatch({ type: 'payment', method })}
            />
          ))}
        </View>

        <TextField
          label={t('mobile.cart.note')}
          value={cart.note}
          editable={!locked}
          onChangeText={(note) => dispatch({ type: 'note', note })}
          multiline
        />

        <Card>
          <Text style={type.caption}>{t('mobile.home.landsOn')}</Text>
          <Text style={type.bodyStrong}>
            {place ? `${place.pipelineName} › ${place.stageName}` : t('mobile.settings.notChosen')}
          </Text>
          {!place ? (
            <Button
              variant="secondary"
              title={t('mobile.settings.title')}
              onPress={() => router.push('/settings')}
            />
          ) : null}
        </Card>

        <ProblemText problem={problem} />
        {!locked ? (
          <>
            {issues.length > 0 ? (
              <Text style={[type.secondary, styles.center]}>
                {t(`mobile.cart.issues.${issues[0] ?? 'lines'}`)}
              </Text>
            ) : null}
            <Button
              title={t('mobile.cart.send')}
              onPress={confirmSend}
              loading={sending}
              disabled={issues.length > 0 || quote.isLoading}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  empty: { justifyContent: 'center', padding: spacing.lg, gap: spacing.lg },
  warning: { backgroundColor: colors.warningSoft },
  lineError: { borderWidth: 1, borderColor: colors.destructive },
  lineHead: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grow: { flex: 1, gap: 2 },
  error: { color: colors.destructive },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  center: { textAlign: 'center' },
});
