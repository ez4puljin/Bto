import {
  CUSTOMER_ORDER_STATES,
  FULFILMENTS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { Image } from 'expo-image';
import { CalendarDays, Package, Truck, Warehouse } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useStoreOrderCount, useStoreOrderReps, useStoreProducts } from '../api/customer';
import { type DateRange, daysBetween, monthDay, presetOf } from '../dates/calendar';
import { DateRangeSheet } from '../orders/date-range-sheet';
import { type PickedRecord, toggleChoice } from '../orders/order-filters';
import { PickList, PickSheet } from '../orders/pick-sheets';
import { useCustomer } from '../state/session';
import { useDebounced } from '../state/use-debounced';
import { colors, radii, spacing } from '../theme/tokens';
import { ChoiceChip, PillButton, SearchField } from '../ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { BarButton, SectionHeader } from '../ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { PaymentDot } from '../ui/status';
import {
  EMPTY_STORE_ORDER_FILTERS,
  sameTaker,
  type StoreOrderFilters,
  storeOrderParams,
  type StoreTaker,
  toggleTaker,
} from './order-filters';

type Over = 'none' | 'product' | 'dates';

const THUMB = 40;

/**
 * «Шүүлтүүр» of the store's orders (the owner 2026-10-20, like the rep app's): the days; who took
 * the order — «Апп», «Оффис», «Бүх ХТ» or a rep by name —; a product; the payment; delivery or
 * pickup; the state in the customer's words — on a draft; «N захиалга харуулах» counts the draft and
 * applies it, closing leaves the list as it was. «Цэвэрлэх» goes back to the default days, unfiltered.
 */
export function StoreOrderFilterSheet({
  visible,
  today,
  range,
  defaultRange,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  today: string;
  range: DateRange;
  defaultRange: DateRange;
  filters: StoreOrderFilters;
  onApply: (filters: StoreOrderFilters, range: DateRange) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(filters);
  const [days, setDays] = useState(range);
  const [over, setOver] = useState<Over>('none');
  useEffect(() => {
    if (!visible) return;
    setDraft(filters);
    setDays(range);
    setOver('none');
  }, [visible, filters, range]);
  const reps = useStoreOrderReps(visible);
  const count = useStoreOrderCount({ ...days, ...storeOrderParams(draft) }, visible);
  const total = count.data;
  const preset = presetOf(days, today);
  const set = (patch: Partial<StoreOrderFilters>) => setDraft({ ...draft, ...patch });

  const iconProps = { size: 17, color: colors.primaryForeground };
  const chipIcon = (on: boolean, icon: (color: string) => ReactNode) =>
    icon(on ? colors.primaryForeground : colors.foreground);
  const dot = (method: PaymentMethod, on: boolean) => (
    <View style={[styles.dotRing, on && styles.dotRingOn]}>
      <PaymentDot method={method} size={9} />
    </View>
  );
  const takerChip = (key: string, label: string, taker: StoreTaker) => (
    <ChoiceChip
      key={key}
      label={label}
      selected={sameTaker(draft.taker, taker)}
      onPress={() => set({ taker: toggleTaker(draft.taker, taker) })}
      onWhite
    />
  );

  return (
    <>
      <Sheet
        visible={visible && over !== 'dates'}
        onClose={onClose}
        closeLabel={t('common.close')}
        header={
          <SheetHeader
            left={
              <BarButton
                title={t('mobile.filter.clear')}
                onPress={() => {
                  setDraft(EMPTY_STORE_ORDER_FILTERS);
                  setDays(defaultRange);
                }}
              />
            }
            title={t('mobile.filter.title')}
            right={<SheetClose onPress={onClose} label={t('common.close')} />}
          />
        }
        footer={
          <PillButton
            title={
              total === undefined || total === null
                ? t('mobile.orderFilter.show')
                : total === 0
                  ? t('mobile.orderFilter.none')
                  : t('mobile.orderFilter.showCount', { n: total })
            }
            loading={count.isFetching && total === undefined}
            onPress={() => onApply(draft, days)}
          />
        }
      >
        <ScrollView contentContainerStyle={styles.body}>
          <SectionHeader style={styles.first}>{t('mobile.orderFilter.dates')}</SectionHeader>
          <Group>
            <Row
              icon={
                <IconTile color={colors.tint.red}>
                  <CalendarDays {...iconProps} />
                </IconTile>
              }
              title={
                days.from === days.to
                  ? monthDay(days.from)
                  : t('mobile.orders.range', { from: monthDay(days.from), to: monthDay(days.to) })
              }
              value={
                preset
                  ? t(`mobile.dateRange.presets.${preset}`)
                  : t('mobile.orderFilter.days', { n: daysBetween(days.from, days.to) })
              }
              onPress={() => setOver('dates')}
            />
          </Group>

          <SectionHeader style={styles.section}>
            {t('mobile.customer.orderFilter.taker')}
          </SectionHeader>
          <View style={styles.chips}>
            <ChoiceChip
              label={t('common.all')}
              selected={draft.taker === null}
              onPress={() => set({ taker: null })}
              onWhite
            />
            {takerChip('app', t('mobile.customer.orders.takerApp'), { kind: 'APP' })}
            {takerChip('office', t('mobile.customer.orders.takerOffice'), { kind: 'OFFICE' })}
            {takerChip('reps', t('mobile.customer.orderFilter.allReps'), {
              kind: 'REP',
              rep: null,
            })}
            {(reps.data ?? []).map((rep) =>
              takerChip(`rep-${rep.id}`, rep.name, {
                kind: 'REP',
                rep: { id: rep.id, name: rep.name },
              }),
            )}
          </View>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.product')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              icon={
                <IconTile color={draft.product ? colors.tint.green : colors.tint.gray}>
                  <Package {...iconProps} />
                </IconTile>
              }
              title={draft.product?.name ?? t('mobile.orderFilter.anyProduct')}
              onPress={() => setOver('product')}
            />
          </Group>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.payment')}</SectionHeader>
          <View style={styles.chips}>
            <ChoiceChip
              label={t('common.all')}
              selected={draft.paymentMethod === null}
              onPress={() => set({ paymentMethod: null })}
              onWhite
            />
            {PAYMENT_METHODS.map((method) => (
              <ChoiceChip
                key={method}
                label={t(`sales.paymentMethods.${method}`)}
                icon={dot(method, draft.paymentMethod === method)}
                selected={draft.paymentMethod === method}
                onPress={() => set({ paymentMethod: toggleChoice(draft.paymentMethod, method) })}
                onWhite
              />
            ))}
          </View>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.fulfilment')}</SectionHeader>
          <View style={styles.chips}>
            <ChoiceChip
              label={t('common.all')}
              selected={draft.fulfilment === null}
              onPress={() => set({ fulfilment: null })}
              onWhite
            />
            {[...FULFILMENTS].reverse().map((fulfilment) => {
              const on = draft.fulfilment === fulfilment;
              return (
                <ChoiceChip
                  key={fulfilment}
                  label={t(`sales.fulfilments.${fulfilment}`)}
                  icon={chipIcon(on, (color) =>
                    fulfilment === 'DELIVERY' ? (
                      <Truck size={15} strokeWidth={2} color={color} />
                    ) : (
                      <Warehouse size={15} strokeWidth={2} color={color} />
                    ),
                  )}
                  selected={on}
                  onPress={() => set({ fulfilment: toggleChoice(draft.fulfilment, fulfilment) })}
                  onWhite
                />
              );
            })}
          </View>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.state')}</SectionHeader>
          <View style={styles.chips}>
            <ChoiceChip
              label={t('common.all')}
              selected={draft.state === null}
              onPress={() => set({ state: null })}
              onWhite
            />
            {CUSTOMER_ORDER_STATES.map((state) => (
              <ChoiceChip
                key={state}
                label={t(`sales.customerStates.${state}`)}
                selected={draft.state === state}
                onPress={() => set({ state: toggleChoice(draft.state, state) })}
                onWhite
              />
            ))}
          </View>
        </ScrollView>
      </Sheet>
      <StoreProductPickSheet
        visible={visible && over === 'product'}
        selected={draft.product}
        onPick={(product) => {
          set({ product });
          setOver('none');
        }}
        onClose={() => setOver('none')}
      />
      <DateRangeSheet
        visible={visible && over === 'dates'}
        today={today}
        range={days}
        onApply={(next) => {
          setDays(next);
          setOver('none');
        }}
        onClose={() => setOver('none')}
      />
    </>
  );
}

/** «Бараа сонгох» for the store: the shop's products by name, code or barcode, with pictures. */
function StoreProductPickSheet({
  visible,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: PickedRecord | null;
  onPick: (record: PickedRecord | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { server } = useCustomer();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);
  const products = useStoreProducts(
    { q, categoryIds: [], chip: 'all', inStock: false, sort: 'NEW' },
    visible,
  );
  const rows = useMemo(
    () => products.data?.pages.flatMap((page) => page.data) ?? [],
    [products.data],
  );
  return (
    <PickSheet
      visible={visible}
      selected={selected}
      onPick={onPick}
      onClose={onClose}
      title={t('mobile.orderFilter.pickProduct')}
    >
      <PickList
        rows={rows}
        query={products}
        search={
          <SearchField
            value={text}
            onChangeText={setText}
            placeholder={t('mobile.orderFilter.productSearch')}
            accessibilityLabel={t('mobile.orderFilter.productSearch')}
          />
        }
        allTitle={t('mobile.orderFilter.anyProduct')}
        allIcon={
          <IconTile color={colors.tint.gray}>
            <Package size={17} color={colors.primaryForeground} />
          </IconTile>
        }
        emptyTitle={t('mobile.orderFilter.productsEmpty')}
        selected={selected}
        onPick={onPick}
        inset={spacing.lg + THUMB + spacing.md}
        renderRow={(product) => (
          <Row
            icon={
              <View style={styles.thumb}>
                {product.thumbUrl ? (
                  <Image
                    source={{ uri: `${server}${product.thumbUrl}` }}
                    style={styles.image}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={product.thumbUrl}
                  />
                ) : (
                  <Package size={20} strokeWidth={1.5} color={colors.input} />
                )}
              </View>
            }
            title={product.name}
            subtitle={t('mobile.checkout.code', { code: product.sku })}
            role="radio"
            checked={selected?.id === product.id}
            chevron={false}
            minHeight={60}
            onPress={() => onPick({ id: product.id, name: product.name })}
          />
        )}
      />
    </PickSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  first: { marginTop: spacing.sm },
  section: { marginTop: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dotRing: { padding: 2, borderRadius: 5 },
  dotRingOn: { backgroundColor: colors.card },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radii.control,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
});
