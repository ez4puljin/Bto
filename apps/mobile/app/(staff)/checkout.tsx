import { addDays } from '@tugeel/shared/time';
import { defaultDeliveryDate } from '@tugeel/shared/sales';
import { useRouter } from 'expo-router';
import { ChartBar, Check, ChevronRight, Store } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppProblem } from '../../src/api/problem';
import {
  type RepOrder,
  useCustomer,
  useProductsOf,
  useQuote,
  useRepContext,
} from '../../src/api/rep';
import { type CartIssue, cartIssues, linesOf } from '../../src/cart/cart';
import { useSendOrder } from '../../src/cart/use-send';
import { dayNameOf, monthDay } from '../../src/dates/calendar';
import { monthOf, weekdayOf } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { placeOf } from '../../src/state/placement';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, shadows, spacing, type } from '../../src/theme/tokens';
import { ChoiceChip, PillButton, Segmented } from '../../src/ui/controls';
import { Group, Row } from '../../src/ui/grouped';
import { MonthCalendar } from '../../src/ui/calendar';
import { ProblemText } from '../../src/ui/kit';
import { BarButton, NavBar, Page, SectionHeader } from '../../src/ui/layout';
import { PendingSendCard } from '../../src/ui/pending-send';
import { Sheet, SheetClose, SheetHeader } from '../../src/ui/sheet';

/** How far ahead a delivery may be set. */
const DAYS_AHEAD = 60;

const PAY_DOTS = {
  CASH: colors.tint.green,
  BANK_TRANSFER: colors.tint.blue,
  CREDIT: colors.tint.orange,
} as const;

/**
 * «Захиалагчийн мэдээлэл» (the Checkout and CheckoutNote boards, ADR-0066 #6): the customer, who
 * takes the order and their phone, delivery or pickup with the address and the day, the payment,
 * a note, where the order lands, and «Баталгаажуулж илгээх». A sent order shows its number over
 * the page; a send without an answer keeps the cart locked (ADR-0061 #8).
 */
export default function CheckoutScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, dispatch, stageId, pending } = useShop();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const quote = useQuote(linesOf(cart));
  const customer = useCustomer(cart.customer?.id ?? null);
  const ids = useMemo(() => [...new Set(cart.lines.map((line) => line.productId))], [cart.lines]);
  const products = useProductsOf(ids);
  const { send, sending } = useSendOrder();
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [sent, setSent] = useState<RepOrder | null>(null);
  const [sheet, setSheet] = useState<'none' | 'address' | 'date'>('none');
  const [noteFocused, setNoteFocused] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const noteRef = useRef<View>(null);
  const scrollY = useRef(0);
  const place = context.data ? placeOf(context.data, stageId) : null;
  const locked = pending !== null;

  // The proposed day is tomorrow; a stored day in the past moves to it too.
  useEffect(() => {
    if (today && (!cart.deliveryDate || cart.deliveryDate < today)) {
      dispatch({ type: 'deliveryDate', date: defaultDeliveryDate(today) });
    }
  }, [today, cart.deliveryDate, dispatch]);

  // The note is lifted above the keyboard, whether or not the window resizes for it.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboard(event.endCoordinates.height);
      noteRef.current?.measureInWindow((_x, y, _width, height) => {
        const over = y + height + spacing.lg - event.endCoordinates.screenY;
        if (over > 0) scroll.current?.scrollTo({ y: scrollY.current + over, animated: true });
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const issues: CartIssue[] = today ? cartIssues(cart, today, place ? stageId : null) : ['lines'];
  const addresses = customer.data?.addresses ?? [];
  const address = addresses.find((entry) => entry.id === cart.addressId);
  const homes = [
    ...new Set(
      (products.data ?? []).flatMap((product) => {
        const home = context.data?.warehouses.find((entry) => entry.id === product.homeWarehouseId);
        return home ? [home.name] : [];
      }),
    ),
  ];
  const dateText = (date: string | null) => {
    if (!date || !today) return t('common.none');
    const name = dayNameOf(date, today);
    const weekday = weekdayOf(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const day = `${monthDay(date)} ${t(`mobile.weekdays.${weekday}`)}`;
    return name === 'date'
      ? day
      : t('mobile.checkout.namedDay', { name: t(`mobile.days.${name}`), day });
  };
  const totalText = quote.data
    ? t('pricing.money', { amount: formatMnt(quote.data.total) })
    : t('common.none');

  const submit = async () => {
    Keyboard.dismiss();
    const result = await send();
    if (!result) return;
    if (result.kind === 'sent') {
      setProblem(null);
      setUnknown(false);
      setSent(result.order);
    } else if (result.kind === 'unknown') {
      setUnknown(true);
    } else {
      setUnknown(false);
      setProblem(result.problem);
    }
  };

  const payments = [
    { value: 'CASH' as const, label: t('sales.paymentMethods.CASH'), dot: PAY_DOTS.CASH },
    {
      value: 'BANK_TRANSFER' as const,
      label: t('sales.paymentMethods.BANK_TRANSFER'),
      dot: PAY_DOTS.BANK_TRANSFER,
    },
    { value: 'CREDIT' as const, label: t('sales.paymentMethods.CREDIT'), dot: PAY_DOTS.CREDIT },
  ];

  return (
    <Page>
      {noteFocused ? (
        <NavBar
          back={t('mobile.tabs.cart')}
          onBack={() => router.back()}
          title={t('mobile.checkout.short')}
          right={
            <BarButton title={t('mobile.keypad.done')} onPress={() => Keyboard.dismiss()} strong />
          }
        />
      ) : (
        <NavBar back={t('mobile.tabs.cart')} onBack={() => router.back()} />
      )}
      <ScrollView
        ref={scroll}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.body,
          { paddingBottom: (keyboard > 0 ? keyboard : 120) + insets.bottom + spacing.lg },
        ]}
      >
        <Text accessibilityRole="header" style={[type.title, styles.title]}>
          {t('mobile.checkout.title')}
        </Text>
        <Text style={[type.body, styles.subtitle]}>
          {t('mobile.checkout.summary', { n: cart.lines.length, total: totalText })}
        </Text>

        {locked ? <PendingSendCard onSent={setSent} /> : null}

        <SectionHeader style={styles.section}>{t('mobile.checkout.customer')}</SectionHeader>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => router.push('/customers')}
          style={({ pressed }) => [styles.customer, pressed && styles.pressed]}
        >
          <View style={styles.customerIcon}>
            <Store size={19} strokeWidth={2} color={colors.primaryForeground} />
          </View>
          <View style={styles.grow}>
            <Text style={[type.row, !cart.customer && styles.accent]}>
              {cart.customer ? cart.customer.name : t('mobile.checkout.chooseCustomer')}
            </Text>
            {cart.customer ? (
              <Text style={type.secondary}>
                {t('mobile.checkout.code', { code: cart.customer.code })}
              </Text>
            ) : null}
          </View>
          {cart.customer ? (
            <Text style={[type.body, styles.accent]}>{t('mobile.checkout.change')}</Text>
          ) : (
            <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
          )}
        </Pressable>

        <SectionHeader style={styles.section}>{t('mobile.checkout.contact')}</SectionHeader>
        <Group>
          <View style={styles.field}>
            <Text style={[type.row, styles.label]}>{t('mobile.checkout.contactName')}</Text>
            <TextInput
              value={cart.contactName}
              onChangeText={(name) => dispatch({ type: 'contact', name })}
              placeholder={t('mobile.checkout.contactNameHint')}
              placeholderTextColor={colors.input}
              editable={!locked}
              accessibilityLabel={t('mobile.checkout.contactName')}
              style={[type.row, styles.input]}
            />
          </View>
          <View style={styles.field}>
            <Text style={[type.row, styles.label]}>{t('mobile.checkout.contactPhone')}</Text>
            <TextInput
              value={cart.contactPhone}
              onChangeText={(phone) =>
                dispatch({ type: 'contact', phone: phone.replace(/[^0-9 +-]/g, '') })
              }
              placeholder={t('mobile.checkout.contactPhoneHint')}
              placeholderTextColor={colors.input}
              keyboardType="phone-pad"
              editable={!locked}
              accessibilityLabel={t('mobile.checkout.contactPhone')}
              style={[type.row, styles.input]}
            />
          </View>
        </Group>

        <SectionHeader style={styles.section}>{t('mobile.checkout.delivery')}</SectionHeader>
        <Group>
          <View style={styles.segmentRow}>
            <Segmented
              options={[
                { value: 'DELIVERY' as const, label: t('sales.fulfilments.DELIVERY') },
                { value: 'PICKUP' as const, label: t('sales.fulfilments.PICKUP') },
              ]}
              value={cart.fulfilment}
              onChange={(fulfilment) =>
                !locked && dispatch({ type: fulfilment === 'PICKUP' ? 'pickup' : 'delivery' })
              }
              height={38}
              label={t('mobile.checkout.delivery')}
            />
          </View>
          {cart.fulfilment === 'DELIVERY' ? (
            <Row
              title={t('mobile.checkout.address')}
              value={
                address
                  ? (address.label ?? address.address ?? t('mobile.checkout.addressNoText'))
                  : t('mobile.checkout.chooseAddress')
              }
              disabled={locked || !cart.customer}
              onPress={() => setSheet('address')}
            />
          ) : (
            <Row
              title={t('mobile.checkout.pickupAt')}
              value={homes.length > 0 ? homes.join(', ') : t('common.none')}
            />
          )}
          <Row
            title={
              cart.fulfilment === 'PICKUP'
                ? t('mobile.checkout.pickupDay')
                : t('mobile.checkout.deliveryDay')
            }
            right={
              <View style={styles.dateChip}>
                <Text style={styles.dateText}>{dateText(cart.deliveryDate)}</Text>
              </View>
            }
            chevron={false}
            disabled={locked}
            onPress={() => setSheet('date')}
          />
        </Group>

        <SectionHeader style={styles.section}>{t('mobile.checkout.payment')}</SectionHeader>
        <Segmented
          options={payments}
          value={cart.paymentMethod}
          onChange={(method) => !locked && dispatch({ type: 'payment', method })}
          height={44}
          label={t('mobile.checkout.payment')}
        />

        <SectionHeader
          style={styles.section}
          right={
            <Text style={styles.counter}>
              {t('mobile.checkout.noteCount', { n: cart.note.length })}
            </Text>
          }
        >
          {t('mobile.checkout.note')}
        </SectionHeader>
        <View ref={noteRef} collapsable={false}>
          <TextInput
            value={cart.note}
            onChangeText={(note) => dispatch({ type: 'note', note })}
            placeholder={t('mobile.checkout.noteHint')}
            placeholderTextColor={colors.input}
            multiline
            editable={!locked}
            onFocus={() => setNoteFocused(true)}
            onBlur={() => setNoteFocused(false)}
            accessibilityLabel={t('mobile.checkout.note')}
            style={[type.row, styles.note]}
          />
        </View>

        <SectionHeader style={styles.section}>{t('mobile.checkout.order')}</SectionHeader>
        <Group>
          <Row
            title={t('mobile.checkout.lines', { n: cart.lines.length })}
            right={<Text style={type.heading}>{totalText}</Text>}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={styles.place}
          >
            <ChartBar size={16} strokeWidth={2} color={colors.muted} />
            <Text style={[type.secondary, styles.grow]}>
              {place
                ? t('mobile.checkout.landsOn', {
                    pipeline: place.pipelineName,
                    stage: place.stageName,
                  })
                : t('mobile.checkout.noStage')}
            </Text>
          </Pressable>
        </Group>

        <ProblemText problem={problem} />
        {unknown ? (
          <Text style={[type.secondary, styles.issue]}>{t('mobile.cart.unknownHint')}</Text>
        ) : null}
        {!locked && issues.length > 0 && cart.lines.length > 0 ? (
          <Text style={[type.secondary, styles.issue]}>
            {t(`mobile.cart.issues.${issues[0] ?? 'lines'}`)}
          </Text>
        ) : null}
      </ScrollView>

      {keyboard > 0 || locked ? null : (
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
          <View style={styles.grow}>
            <Text style={type.secondary}>{t('mobile.cart.total')}</Text>
            <Text style={styles.total}>{totalText}</Text>
          </View>
          <PillButton
            title={t('mobile.checkout.send')}
            loading={sending}
            disabled={issues.length > 0 || quote.isLoading}
            onPress={() => void submit()}
          />
        </View>
      )}

      <AddressSheet
        visible={sheet === 'address'}
        addresses={addresses}
        chosen={cart.addressId}
        onPick={(addressId) => {
          dispatch({ type: 'address', addressId });
          setSheet('none');
        }}
        onClose={() => setSheet('none')}
      />
      {today ? (
        <DateSheet
          visible={sheet === 'date'}
          pickup={cart.fulfilment === 'PICKUP'}
          today={today}
          chosen={cart.deliveryDate}
          dayText={dateText}
          onPick={(date) => {
            dispatch({ type: 'deliveryDate', date });
            setSheet('none');
          }}
          onClose={() => setSheet('none')}
        />
      ) : null}

      <Modal visible={sent !== null} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.sentBackdrop}>
          <View style={styles.sentCard} accessibilityRole="alert">
            <View style={styles.sentIcon}>
              <Check size={30} strokeWidth={3} color={colors.primaryForeground} />
            </View>
            <Text style={styles.sentTitle}>{t('mobile.checkout.sent')}</Text>
            <Text style={[type.body, styles.sentLine]}>
              {[
                sent?.number,
                sent?.stageName,
                sent?.total ? t('pricing.money', { amount: formatMnt(sent.total) }) : null,
              ]
                .filter((part) => part)
                .join(' · ')}
            </Text>
            <View style={styles.sentActions}>
              <PillButton
                title={t('mobile.checkout.viewOrder')}
                variant="soft"
                height={48}
                style={styles.sentButton}
                onPress={() => {
                  const id = sent?.id;
                  setSent(null);
                  if (id) router.replace(`/order/${id}`);
                }}
              />
              <PillButton
                title={t('mobile.checkout.newOrder')}
                height={48}
                style={styles.sentButton}
                onPress={() => {
                  setSent(null);
                  router.dismissTo('/shop');
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

function AddressSheet({
  visible,
  addresses,
  chosen,
  onPick,
  onClose,
}: {
  visible: boolean;
  addresses: { id: number; label: string | null; address: string | null; isDefault: boolean }[];
  chosen: number | null;
  onPick: (addressId: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={160}
      header={
        <SheetHeader
          title={t('mobile.checkout.address')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.sheetBody}>
        {addresses.length === 0 ? (
          <Text style={[type.body, styles.empty]}>{t('mobile.checkout.noAddresses')}</Text>
        ) : (
          <Group>
            {addresses.map((entry) => (
              <Row
                key={entry.id}
                title={entry.label ?? entry.address ?? t('mobile.checkout.addressNoText')}
                subtitle={[
                  entry.label ? entry.address : null,
                  entry.isDefault ? t('mobile.checkout.default') : null,
                ]
                  .filter((part) => part)
                  .join(' · ')}
                role="radio"
                checked={entry.id === chosen}
                chevron={false}
                onPress={() => onPick(entry.id)}
              />
            ))}
          </Group>
        )}
      </ScrollView>
    </Sheet>
  );
}

function DateSheet({
  visible,
  pickup,
  today,
  chosen,
  dayText,
  onPick,
  onClose,
}: {
  visible: boolean;
  pickup: boolean;
  today: string;
  chosen: string | null;
  dayText: (date: string) => string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(monthOf(chosen ?? today));
  useEffect(() => {
    if (visible) setMonth(monthOf(chosen ?? today));
  }, [visible, chosen, today]);
  const quick = [today, addDays(today, 1), addDays(today, 2)];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.close')}
      top={42}
      header={
        <SheetHeader
          title={pickup ? t('mobile.checkout.pickupDay') : t('mobile.checkout.deliveryDay')}
          right={<SheetClose onPress={onClose} label={t('common.close')} />}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <View style={styles.quick}>
          {quick.map((date) => (
            <ChoiceChip
              key={date}
              label={dayText(date)}
              selected={chosen === date}
              onPress={() => onPick(date)}
            />
          ))}
        </View>
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          today={today}
          value={chosen}
          min={today}
          max={addDays(today, DAYS_AHEAD)}
          onPick={onPick}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  subtitle: { marginTop: spacing.xs, marginHorizontal: spacing.xs, color: colors.muted },
  section: { marginTop: 22 },
  customer: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  pressed: { backgroundColor: colors.accent },
  customerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  accent: { color: colors.primary },
  field: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  label: { width: 72 },
  input: { flex: 1, height: 44, paddingVertical: 0 },
  segmentRow: { paddingVertical: spacing.md, paddingHorizontal: 14 },
  dateChip: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.fieldFill,
    justifyContent: 'center',
  },
  dateText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 20, color: colors.foreground },
  counter: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.tint.gray },
  note: {
    minHeight: 92,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    textAlignVertical: 'top',
  },
  place: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  issue: { marginTop: spacing.md, marginHorizontal: spacing.xs, color: colors.destructive },
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
    alignItems: 'center',
    gap: spacing.md,
  },
  total: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: 14,
  },
  empty: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sentBackdrop: {
    flex: 1,
    backgroundColor: colors.dimFill,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sentCard: {
    paddingTop: 28,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderRadius: radii.hero,
    backgroundColor: colors.floatingFill,
    boxShadow: shadows.popup,
    alignItems: 'center',
    gap: spacing.sm,
  },
  sentIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.tint.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.foreground },
  sentLine: { color: colors.muted, textAlign: 'center' },
  sentActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: spacing.md },
  sentButton: { flex: 1, paddingHorizontal: spacing.sm },
});
