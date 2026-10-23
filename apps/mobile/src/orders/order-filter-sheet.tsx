import {
  FULFILMENTS,
  PAYMENT_METHODS,
  type PaymentMethod,
  REP_ORDER_STATES,
} from '@tugeel/shared/sales';
import { CalendarDays, Package, Store, Truck, Warehouse } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useOrderCount } from '../api/rep';
import { type DateRange, daysBetween, monthDay, presetOf, presetRange } from '../dates/calendar';
import { colors, spacing } from '../theme/tokens';
import { ChoiceChip, PillButton } from '../ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../ui/grouped';
import { BarButton, FootNote, SectionHeader } from '../ui/layout';
import { Sheet, SheetClose, SheetHeader } from '../ui/sheet';
import { PaymentDot } from '../ui/status';
import { DateRangeSheet } from './date-range-sheet';
import {
  EMPTY_ORDER_FILTERS,
  type OrderFilters,
  orderFilterParams,
  toggleChoice,
} from './order-filters';
import { CustomerPickSheet, ProductPickSheet } from './pick-sheets';

type Over = 'none' | 'customer' | 'product' | 'dates';

/**
 * «Шүүлтүүр» of the order history (the owner, 2026-10-18): the days, a customer, a product, the
 * payment, delivery or pickup and the state, on a draft; «N захиалга харуулах» counts the draft
 * and applies it, closing leaves the list as it was. «Цэвэрлэх» goes back to this month, unfiltered.
 */
export function OrderFilterSheet({
  visible,
  today,
  range,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  today: string;
  range: DateRange;
  filters: OrderFilters;
  onApply: (filters: OrderFilters, range: DateRange) => void;
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
  const count = useOrderCount({ ...days, ...orderFilterParams(draft) }, visible);
  const total = count.data;
  const preset = presetOf(days, today);
  const set = (patch: Partial<OrderFilters>) => setDraft({ ...draft, ...patch });

  const tile = (color: string, icon: ReactNode) => <IconTile color={color}>{icon}</IconTile>;
  const iconProps = { size: 17, color: colors.primaryForeground };
  const chipIcon = (on: boolean, icon: (color: string) => ReactNode) =>
    icon(on ? colors.primaryForeground : colors.foreground);
  const dot = (method: PaymentMethod, on: boolean) => (
    <View style={[styles.dotRing, on && styles.dotRingOn]}>
      <PaymentDot method={method} size={9} />
    </View>
  );

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        closeLabel={t('common.close')}
        header={
          <SheetHeader
            left={
              <BarButton
                title={t('mobile.filter.clear')}
                onPress={() => {
                  setDraft(EMPTY_ORDER_FILTERS);
                  setDays(presetRange('month', today));
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
              icon={tile(colors.tint.red, <CalendarDays {...iconProps} />)}
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

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.customer')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              icon={tile(
                draft.customer ? colors.tint.blue : colors.tint.gray,
                <Store {...iconProps} />,
              )}
              title={draft.customer?.name ?? t('mobile.orderFilter.anyCustomer')}
              onPress={() => setOver('customer')}
            />
          </Group>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.product')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              icon={tile(
                draft.product ? colors.tint.green : colors.tint.gray,
                <Package {...iconProps} />,
              )}
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
            />
            {PAYMENT_METHODS.map((method) => (
              <ChoiceChip
                key={method}
                label={t(`sales.paymentMethods.${method}`)}
                icon={dot(method, draft.paymentMethod === method)}
                selected={draft.paymentMethod === method}
                onPress={() => set({ paymentMethod: toggleChoice(draft.paymentMethod, method) })}
              />
            ))}
          </View>

          <SectionHeader style={styles.section}>{t('mobile.orderFilter.fulfilment')}</SectionHeader>
          <View style={styles.chips}>
            <ChoiceChip
              label={t('common.all')}
              selected={draft.fulfilment === null}
              onPress={() => set({ fulfilment: null })}
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
            />
            {REP_ORDER_STATES.map((state) => (
              <ChoiceChip
                key={state}
                label={t(`mobile.orderFilter.states.${state}`)}
                selected={draft.state === state}
                onPress={() => set({ state: toggleChoice(draft.state, state) })}
              />
            ))}
          </View>
          <FootNote>{t('mobile.orderFilter.stateHint')}</FootNote>
        </ScrollView>
      </Sheet>
      <CustomerPickSheet
        visible={visible && over === 'customer'}
        selected={draft.customer}
        onPick={(customer) => {
          set({ customer });
          setOver('none');
        }}
        onClose={() => setOver('none')}
      />
      <ProductPickSheet
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

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  first: { marginTop: spacing.sm },
  section: { marginTop: 22 },
  // Bto300's filter sheet: the chips straight on the sheet (ADR-0100).
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dotRing: { padding: 2, borderRadius: 5 },
  dotRingOn: { backgroundColor: colors.card },
});
