import { addDays } from '@tugeel/shared/time';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  ChartBar,
  Check,
  ChevronRight,
  Store,
  Truck,
  Warehouse,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../src/ui/text';
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
import { monthDay } from '../../src/dates/calendar';
import { monthOf, weekdayOf } from '../../src/dates/dates';
import { formatMnt } from '../../src/format/format';
import { placeOf } from '../../src/state/placement';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../../src/theme/tokens';
import { PillButton, Segmented } from '../../src/ui/controls';
import { Group, Row } from '../../src/ui/grouped';
import { MonthCalendar } from '../../src/ui/calendar';
import { ProblemText } from '../../src/ui/kit';
import { Page, SectionHeader } from '../../src/ui/layout';
import { PendingSendCard } from '../../src/ui/pending-send';
import { Sheet, SheetClose, SheetHeader } from '../../src/ui/sheet';
import { HeaderTextButton, StoreHeader } from '../../src/ui/store-header';

/** How far ahead a delivery may be set. */
const DAYS_AHEAD = 60;

const PAY_DOTS = {
  CASH: colors.tint.green,
  BANK_TRANSFER: colors.tint.blue,
  CREDIT: colors.tint.orange,
} as const;

/**
 * «Захиалагчийн мэдээлэл» (the Checkout and CheckoutNote boards, ADR-0068 #6): the customer (no
 * contact person, the owner 2026-10-18), «Хүлээн авах» (delivery or pickup as two cards, the
 * address, and the day as four tiles: today, tomorrow, the day after, another day), the payment, a
 * note, where the order lands, and «Баталгаажуулж илгээх». A sent order shows its number over the
 * page; a send without an answer keeps the cart locked (ADR-0061 #8). Bto300's blue header with ←
 * and, while the note is typed in, «Болсон» (ADR-0100).
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

  // Every order starts on today, for delivery and pickup alike (the owner, 2026-10-17); a stored
  // day in the past moves to today too.
  useEffect(() => {
    if (today && (!cart.deliveryDate || cart.deliveryDate < today)) {
      dispatch({ type: 'deliveryDate', date: today });
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
  const weekdayName = (date: string) =>
    t(`mobile.weekdays.${weekdayOf(date) as 0 | 1 | 2 | 3 | 4 | 5 | 6}`);
  /** «10/17 Бя». */
  const dateText = (date: string | null) =>
    date ? `${monthDay(date)} ${weekdayName(date)}` : t('common.none');

  const delivery = cart.fulfilment === 'DELIVERY';
  // Loaded and empty: nothing to deliver to, so the delivery card is greyed.
  const noAddress = cart.customer !== null && customer.data !== undefined && addresses.length === 0;
  const canPickAddress = cart.customer !== null && customer.data !== undefined && !noAddress;
  const deliveryLine = !cart.customer
    ? t('mobile.checkout.noCustomerYet')
    : noAddress
      ? t('mobile.checkout.noAddressShort')
      : address
        ? (address.label ?? address.address ?? t('mobile.checkout.addressNoText'))
        : t('mobile.checkout.chooseAddress');
  const pickupLine =
    homes.length === 0
      ? t('mobile.checkout.fromWarehouse')
      : homes.length === 1
        ? (homes[0] ?? '')
        : t('mobile.checkout.moreHomes', { name: homes[0], n: homes.length - 1 });
  const chooseDelivery = () => {
    if (!delivery) dispatch({ type: 'delivery' });
    // The chosen card opens the addresses again; choosing it without an address opens them first.
    if (canPickAddress && (delivery || !address)) setSheet('address');
  };

  const quickDays = today
    ? [
        { date: today, name: t('mobile.days.today') },
        { date: addDays(today, 1), name: t('mobile.days.tomorrow') },
        { date: addDays(today, 2), name: t('mobile.days.dayAfter') },
      ]
    : [];
  const otherDay =
    cart.deliveryDate && !quickDays.some((day) => day.date === cart.deliveryDate)
      ? cart.deliveryDate
      : null;
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
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.checkout.title')}
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

        <SectionHeader style={styles.section}>{t('mobile.checkout.receive')}</SectionHeader>
        <View accessibilityRole="radiogroup" style={styles.options}>
          <ReceiveCard
            icon={(color) => <Truck size={18} strokeWidth={2} color={color} />}
            title={t('sales.fulfilments.DELIVERY')}
            line={deliveryLine}
            link={canPickAddress && !address}
            selected={delivery}
            disabled={locked || noAddress}
            dimmed={noAddress}
            chevron={delivery && canPickAddress}
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

        {today ? (
          <>
            <View style={styles.dayHead}>
              <Text style={[type.sectionHeader, styles.grow]}>
                {delivery ? t('mobile.checkout.deliveryDay') : t('mobile.checkout.pickupDay')}
              </Text>
              <Text style={type.secondary}>{dateText(cart.deliveryDate)}</Text>
            </View>
            <View style={styles.days}>
              {quickDays.map((day) => (
                <DayTile
                  key={day.date}
                  title={day.name}
                  line={dateText(day.date)}
                  selected={cart.deliveryDate === day.date}
                  disabled={locked}
                  onPress={() => dispatch({ type: 'deliveryDate', date: day.date })}
                />
              ))}
              <DayTile
                title={otherDay ? monthDay(otherDay) : t('mobile.checkout.otherDay')}
                line={otherDay ? weekdayName(otherDay) : null}
                icon={<CalendarDays size={14} strokeWidth={2} color={colors.muted} />}
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
          pickup={!delivery}
          today={today}
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

/** One of «Хүргэлтээр» / «Өөрөө авна»: an icon tile and a radio mark, the title, one line under it. */
function ReceiveCard({
  icon,
  title,
  line,
  link = false,
  selected,
  disabled,
  dimmed = false,
  chevron = false,
  onPress,
}: {
  icon: (color: string) => ReactNode;
  title: string;
  line: string;
  /** The line asks for something («Хаяг сонгох»): link-coloured. */
  link?: boolean;
  selected: boolean;
  disabled: boolean;
  /** Nothing to choose here (a customer without addresses): greyed. */
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
          <Text style={[type.secondary, styles.shrink, link && styles.link]} numberOfLines={2}>
            {line}
          </Text>
          {chevron ? <ChevronRight size={12} strokeWidth={2.6} color={colors.muted} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A day tile: its name over its date, or «Өөр өдөр» over a calendar icon. */
function DayTile({
  title,
  line,
  icon,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  /** The line under the title; null shows the icon instead. */
  line: string | null;
  icon?: ReactNode;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
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
      {line === null ? (
        icon
      ) : (
        <Text style={[type.caption, selected && styles.onPrimary]} numberOfLines={1}>
          {line}
        </Text>
      )}
    </Pressable>
  );
}

/** The calendar for a day past the tiles: today to DAYS_AHEAD days on. */
function DateSheet({
  visible,
  pickup,
  today,
  chosen,
  onPick,
  onClose,
}: {
  visible: boolean;
  pickup: boolean;
  today: string;
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
  link: { color: colors.link },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
  },
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
  onPrimary: { color: colors.primaryForeground },
  counter: { ...type.secondary, color: colors.tint.gray },
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
  total: { ...type.title2, ...tabular },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: 14,
  },
  empty: { marginTop: spacing.xl, textAlign: 'center', color: colors.muted },
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
  sentActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: spacing.md },
  sentButton: { flex: 1, paddingHorizontal: spacing.sm },
});
