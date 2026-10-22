import { useRouter } from 'expo-router';
import { CalendarDays, Check, ChevronRight, Info, Truck, Warehouse } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type StoreCheckout,
  type StoreOrder,
  useCheckoutOptions,
  useCreditCheck,
  useStoreMe,
  useStoreQuote,
} from '../../src/api/customer';
import { type AppProblem, problemFrom } from '../../src/api/problem';
import { customerCartIssues, linesOf } from '../../src/cart/cart';
import { useCustomerSendOrder } from '../../src/cart/use-customer-send';
import { creditWarningOf } from '../../src/customer/account';
import { StatePill } from '../../src/customer/order-row';
import { orderAmount } from '../../src/customer/orders';
import {
  checkoutFixes,
  daysAhead,
  pickupPlaceOf,
  quickDays,
  quoteFor,
} from '../../src/customer/shop';
import { CreditNote } from '../../src/customer/shop-credit';
import { monthDay } from '../../src/dates/calendar';
import { monthOf, weekdayOf } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { useCustomer } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../../src/theme/tokens';
import { MonthCalendar } from '../../src/ui/calendar';
import { PillButton, Segmented } from '../../src/ui/controls';
import { Group, Row } from '../../src/ui/grouped';
import { ProblemText } from '../../src/ui/kit';
import { HeaderTextButton, StoreHeader } from '../../src/customer/store-header';
import { Page, SectionHeader } from '../../src/ui/layout';
import { usePendingWords } from '../../src/customer/pending-words';
import { PendingSendView } from '../../src/ui/pending-send';
import { Sheet, SheetClose, SheetHeader } from '../../src/ui/sheet';
import { PAYMENT_DOTS } from '../../src/ui/status';
import { Text, TextInput } from '../../src/ui/text';

type Address = StoreCheckout['addresses'][number];

/**
 * «Захиалгын мэдээлэл» of «Bto300» (the Checkout board, ADR-0079 #5): the store, its lines and
 * today's total; «Хүлээн авах» (delivery to one of its addresses, or pickup at the centre) and the
 * day as four tiles up to the last day; the payment (never taken in the app); a note; why the
 * office may not confirm yet; and «Захиалга илгээх». The order lands «Хүлээгдэж буй» for the office
 * to confirm; a send without an answer keeps the cart locked (ADR-0061 #8); a closed channel says
 * so.
 */
export default function StoreCheckoutScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useCustomer();
  const { cart, dispatch, pending } = useShop();
  const store = useStoreMe();
  const options = useCheckoutOptions();
  const lines = linesOf(cart);
  const quote = useStoreQuote(lines);
  const answered = quoteFor(quote.data, lines);
  const total = answered ? answered.quote.total : null;
  const credit = useCreditCheck(total);
  const warning = credit.data ? creditWarningOf(credit.data) : null;
  const sender = useCustomerSendOrder();
  const pendingWords = usePendingWords();
  const { send, sending } = sender;
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [closedAnswer, setClosedAnswer] = useState(false);
  const [sent, setSent] = useState<StoreOrder | null>(null);
  const [sheet, setSheet] = useState<'none' | 'address' | 'date'>('none');
  const [noteFocused, setNoteFocused] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const noteRef = useRef<View>(null);
  const scrollY = useRef(0);
  const locked = pending !== null;
  const data = options.data;

  // The store's default address and today, once the choices are known; a day out of range and an
  // address no longer live are replaced.
  useEffect(() => {
    if (!data || locked) return;
    for (const fix of checkoutFixes(cart, data)) dispatch(fix);
  }, [data, locked, cart, dispatch]);

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

  const today = data?.today ?? null;
  const lastDay = data?.lastDay ?? null;
  const issues = today && lastDay ? customerCartIssues(cart, today, lastDay) : ['lines' as const];
  const closed = data?.ordersOpen === false || closedAnswer;
  const addresses = data?.addresses ?? [];
  const address = addresses.find((entry) => entry.id === cart.addressId);
  const delivery = cart.fulfilment === 'DELIVERY';
  const noAddress = data !== undefined && addresses.length === 0;
  const weekdayName = (date: string) =>
    t(`mobile.weekdays.${weekdayOf(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`);
  /** «10/17 Бя». */
  const dateText = (date: string) => `${monthDay(date)} ${weekdayName(date)}`;
  const addressText = (entry: Address) =>
    entry.label ?? entry.address ?? t('mobile.checkout.addressNoText');

  const deliveryLine = noAddress
    ? t('mobile.checkout.noAddressShort')
    : address
      ? address.isDefault
        ? t('mobile.customer.checkout.defaultAddress', { address: addressText(address) })
        : addressText(address)
      : t('mobile.checkout.chooseAddress');
  const place = pickupPlaceOf(data?.pickup);
  const pickupLine =
    place.kind === 'none'
      ? t('mobile.checkout.fromWarehouse')
      : place.kind === 'more'
        ? t('mobile.checkout.moreHomes', { name: place.name, n: place.n })
        : place.name;
  const chooseDelivery = () => {
    if (!delivery) dispatch({ type: 'delivery' });
    // The chosen card opens the addresses when there is more than one to choose from.
    else if (addresses.length > 1) setSheet('address');
  };

  const tiles = today && lastDay ? quickDays(today, lastDay) : [];
  const tileNames = [t('mobile.days.today'), t('mobile.days.tomorrow'), t('mobile.days.dayAfter')];
  const otherDay =
    cart.deliveryDate && !tiles.includes(cart.deliveryDate) ? cart.deliveryDate : null;
  const totalText = quote.data
    ? t('pricing.money', { amount: formatMnt(quote.data.quote.total) })
    : t('common.none');
  const storeName = store.data?.name ?? me.store.name;

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
    } else if (result.problem.code === 'CUSTOMER_APP_CLOSED') {
      setUnknown(false);
      setProblem(null);
      setClosedAnswer(true);
    } else {
      setUnknown(false);
      setProblem(result.problem);
    }
  };

  const payments = (['CASH', 'BANK_TRANSFER', 'CREDIT'] as const).map((method) => ({
    value: method,
    label: t(`sales.paymentMethods.${method}`),
    dot: PAYMENT_DOTS[method],
  }));
  const sentAmount = sent ? orderAmount(sent) : null;

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.customer.checkout.title')}
        onBack={() => router.back()}
        right={
          noteFocused ? (
            <HeaderTextButton title={t('mobile.keypad.done')} onPress={() => Keyboard.dismiss()} />
          ) : null
        }
      />
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
          {t('mobile.customer.checkout.title')}
        </Text>
        <Text style={[type.body, styles.subtitle]}>
          {t('mobile.customer.checkout.summary', {
            store: storeName,
            n: cart.lines.length,
            total: totalText,
          })}
        </Text>

        {closed ? (
          <View accessibilityRole="alert" style={[styles.note, styles.closed]}>
            <Info size={18} strokeWidth={2} color={colors.cancelled} style={styles.noteIcon} />
            <Text style={[type.body, styles.grow, styles.closedText]}>
              {t('mobile.customer.checkout.closed')}
            </Text>
          </View>
        ) : null}
        {locked ? <PendingSendView sender={sender} onSent={setSent} words={pendingWords} /> : null}
        {options.error ? <ProblemText problem={problemFrom(options.error)} /> : null}

        <SectionHeader style={styles.section}>{t('mobile.checkout.receive')}</SectionHeader>
        <View accessibilityRole="radiogroup" style={styles.options}>
          <ReceiveCard
            icon={(color) => <Truck size={18} strokeWidth={2} color={color} />}
            title={t('sales.fulfilments.DELIVERY')}
            line={deliveryLine}
            selected={delivery}
            disabled={locked || noAddress}
            dimmed={noAddress}
            chevron={delivery && addresses.length > 1}
            onPress={chooseDelivery}
          />
          <ReceiveCard
            icon={(color) => <Warehouse size={18} strokeWidth={2} color={color} />}
            title={t('sales.fulfilments.PICKUP')}
            line={pickupLine}
            selected={!delivery}
            disabled={locked}
            onPress={() => dispatch({ type: 'pickup' })}
          />
        </View>

        {today && lastDay ? (
          <>
            <SectionHeader style={styles.section}>
              {delivery ? t('mobile.checkout.deliveryDay') : t('mobile.checkout.pickupDay')}
            </SectionHeader>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={
                delivery ? t('mobile.checkout.deliveryDay') : t('mobile.checkout.pickupDay')
              }
              style={styles.days}
            >
              {tiles.map((date, index) => (
                <DayTile
                  key={date}
                  title={tileNames[index] ?? monthDay(date)}
                  line={dateText(date)}
                  selected={cart.deliveryDate === date}
                  disabled={locked}
                  onPress={() => dispatch({ type: 'deliveryDate', date })}
                />
              ))}
              <DayTile
                title={otherDay ? monthDay(otherDay) : t('mobile.checkout.otherDay')}
                line={
                  otherDay
                    ? weekdayName(otherDay)
                    : t('mobile.customer.checkout.daysAhead', { n: daysAhead(today, lastDay) })
                }
                icon={
                  otherDay ? null : <CalendarDays size={13} strokeWidth={2} color={colors.muted} />
                }
                selected={otherDay !== null}
                disabled={locked}
                onPress={() => setSheet('date')}
              />
            </View>
          </>
        ) : null}

        <SectionHeader style={styles.section}>{t('mobile.checkout.payment')}</SectionHeader>
        <Segmented
          options={payments}
          value={cart.paymentMethod}
          onChange={(method) => !locked && dispatch({ type: 'payment', method })}
          height={44}
          label={t('mobile.checkout.payment')}
        />
        <Text style={[type.secondary, styles.payNote]}>
          {t('mobile.customer.checkout.payNote')}
        </Text>

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
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={500}
            editable={!locked}
            onFocus={() => setNoteFocused(true)}
            onBlur={() => setNoteFocused(false)}
            accessibilityLabel={t('mobile.checkout.note')}
            style={[type.row, styles.noteInput]}
          />
        </View>

        {warning ? (
          <View style={styles.credit}>
            <CreditNote warning={warning} variant="checkout" />
          </View>
        ) : null}
        <View style={[styles.note, styles.info]}>
          <Info size={18} strokeWidth={2} color={colors.muted} style={styles.noteIcon} />
          <Text style={[type.body, styles.grow, styles.infoText]}>
            {t('mobile.customer.checkout.info')}
          </Text>
        </View>

        <ProblemText problem={problem} />
        {unknown ? (
          <Text style={[type.secondary, styles.issue]}>{pendingWords.unknownHint}</Text>
        ) : null}
        {!locked && !closed && issues.length > 0 && cart.lines.length > 0 ? (
          <Text style={[type.secondary, styles.issue]}>
            {issues[0] === 'deliveryDate' && cart.fulfilment === 'PICKUP'
              ? t('mobile.customer.checkout.pickupDateIssue')
              : t(`mobile.cart.issues.${issues[0] ?? 'lines'}`)}
          </Text>
        ) : null}
      </ScrollView>

      {keyboard > 0 || locked ? null : (
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md) + 18 }]}>
          <View style={styles.grow}>
            <Text style={type.secondary}>{t('mobile.customer.checkout.totalToday')}</Text>
            <Text style={[styles.total, !answered && styles.stale]}>{totalText}</Text>
          </View>
          <PillButton
            title={t('mobile.customer.checkout.send')}
            loading={sending}
            disabled={issues.length > 0 || closed || answered === null}
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
      {today && lastDay ? (
        <DateSheet
          visible={sheet === 'date'}
          pickup={!delivery}
          today={today}
          lastDay={lastDay}
          chosen={cart.deliveryDate}
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
            <Text style={[type.row, styles.sentLine]}>
              {[
                sent?.number,
                sentAmount
                  ? sentAmount.estimate
                    ? t('mobile.orders.approx', {
                        amount: t('pricing.money', { amount: formatMnt(sentAmount.amount) }),
                      })
                    : t('pricing.money', { amount: formatMnt(sentAmount.amount) })
                  : null,
              ]
                .filter((part) => part)
                .join(' · ')}
            </Text>
            {sent ? <StatePill state={sent.state} /> : null}
            <Text style={[type.body, styles.sentHint]}>
              {t('mobile.customer.checkout.sentHint')}
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
                title={t('mobile.tabs.home')}
                height={48}
                style={styles.sentButton}
                onPress={() => {
                  setSent(null);
                  router.navigate('/');
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
  addresses: readonly Address[];
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
      </ScrollView>
    </Sheet>
  );
}

/** One of «Хүргэлтээр» / «Өөрөө авна»: an icon tile and a radio mark, the title, a line under it. */
function ReceiveCard({
  icon,
  title,
  line,
  selected,
  disabled,
  dimmed = false,
  chevron = false,
  onPress,
}: {
  icon: (color: string) => ReactNode;
  title: string;
  line: string;
  selected: boolean;
  disabled: boolean;
  /** Nothing to choose here (a store without addresses): greyed. */
  dimmed?: boolean;
  /** The chosen card opens a sheet on another tap. */
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${title}, ${line}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        pressed && styles.optionPressed,
        selected && styles.optionSelected,
        dimmed && styles.dimmed,
      ]}
    >
      <View style={styles.optionTop}>
        <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
          {icon(selected ? colors.primaryForeground : colors.label2)}
        </View>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <Check size={13} strokeWidth={3} color={colors.primaryForeground} /> : null}
        </View>
      </View>
      <View style={styles.optionText}>
        <Text style={type.heading} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.optionLine}>
          <Text style={[type.secondary, styles.shrink]} numberOfLines={2}>
            {line}
          </Text>
          {chevron ? <ChevronRight size={12} strokeWidth={2.6} color={colors.muted} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A day tile: its name over its date, or «Өөр өдөр» over «60 хоног». */
function DayTile({
  title,
  line,
  icon,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  line: string;
  icon?: ReactNode;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${title}, ${line}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.day,
        pressed && styles.dayPressed,
        selected && styles.daySelected,
      ]}
    >
      <Text
        style={[styles.dayTitle, selected && styles.onPrimary]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {title}
      </Text>
      <View style={styles.dayLine}>
        {icon}
        <Text style={[type.caption, selected && styles.onPrimary]} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </Pressable>
  );
}

/** The calendar for a day past the tiles: today to the last day the server allows. */
function DateSheet({
  visible,
  pickup,
  today,
  lastDay,
  chosen,
  onPick,
  onClose,
}: {
  visible: boolean;
  pickup: boolean;
  today: string;
  lastDay: string;
  chosen: string | null;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(monthOf(chosen ?? today));
  useEffect(() => {
    if (visible) setMonth(monthOf(chosen ?? today));
  }, [visible, chosen, today]);
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
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          today={today}
          value={chosen}
          min={today}
          max={lastDay}
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
  grow: { flex: 1 },
  options: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1,
    minHeight: 104,
    padding: spacing.md,
    gap: 10,
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.card,
  },
  optionPressed: { borderColor: colors.accent, backgroundColor: colors.accent },
  optionSelected: { borderColor: colors.primary },
  dimmed: { opacity: 0.5 },
  optionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.control,
    backgroundColor: colors.fieldFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconSelected: { backgroundColor: colors.primary },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderWidth: 0, backgroundColor: colors.primary },
  optionText: { gap: 2 },
  optionLine: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  shrink: { flexShrink: 1 },
  days: { flexDirection: 'row', gap: spacing.sm },
  day: {
    flex: 1,
    height: 56,
    paddingHorizontal: spacing.xs,
    gap: 2,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPressed: { backgroundColor: colors.accent },
  daySelected: { backgroundColor: colors.primary },
  dayTitle: { ...type.chip, fontFamily: fonts.semibold },
  dayLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  onPrimary: { color: colors.primaryForeground },
  payNote: { marginTop: spacing.sm, marginHorizontal: spacing.sm },
  counter: { ...type.secondary, color: colors.tint.gray },
  noteInput: {
    minHeight: 92,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    textAlignVertical: 'top',
  },
  credit: { marginTop: spacing.lg },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
  },
  noteIcon: { marginTop: 1 },
  info: { marginTop: spacing.md, backgroundColor: colors.card },
  infoText: { color: colors.label2 },
  closed: { marginTop: spacing.lg, backgroundColor: colors.destructiveSoft },
  closedText: { color: colors.cancelled },
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
  total: { ...type.title2, ...tabular },
  stale: { color: colors.muted },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: 14,
  },
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
  sentTitle: { ...type.title3 },
  sentLine: { color: colors.label2, textAlign: 'center', ...tabular },
  sentHint: { color: colors.muted, textAlign: 'center' },
  sentActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: spacing.md },
  sentButton: { flex: 1, paddingHorizontal: spacing.sm },
});
